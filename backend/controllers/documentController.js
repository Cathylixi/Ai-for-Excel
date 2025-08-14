const fs = require('fs');
const path = require('path');
const pdfParse = require('pdf-parse');
const Document = require('../models/documentModel');
const { parseWordDocumentStructure } = require('../services/wordParserService');
const { parsePdfDocumentStructure } = require('../services/pdfParserService');
const { exportAssessmentScheduleToExcel } = require('../services/excelService');

// 上传文档处理函数
async function uploadDocument(req, res) {
  try {
    if (!req.file) {
      return res.status(400).json({
        success: false,
        message: '没有上传文件'
      });
    }

    const { documentType } = req.body; // 前端会传 'ClinicalProtocol'
    
    console.log('收到Clinical Protocol文件:', req.file.originalname, '类型:', req.file.mimetype);

    // 解析文档内容
    let parseResult = {
      extractedText: '',
      sectionedText: [],
      tables: [],
      parseInfo: {
        hasStructuredContent: false,
        sectionsCount: 0,
        tablesCount: 0,
        parseMethod: 'raw-text'
      }
    };
    
    try {
      if (req.file.mimetype === 'application/pdf') {
        // PDF结构化解析（使用新的多层算法）
        console.log('📄 开始PDF文档结构化解析...');
        parseResult = await parsePdfDocumentStructure(req.file.path);
        
        console.log(`✅ PDF解析完成 - 章节: ${parseResult.parseInfo.sectionsCount}, 表格: ${parseResult.parseInfo.tablesCount}`);
        
      } else if (req.file.mimetype === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document') {
        // Word (.docx) 结构化解析
        console.log('📝 开始Word文档结构化解析...');
        parseResult = await parseWordDocumentStructure(req.file.path);
        
        console.log(`✅ Word解析完成 - 章节: ${parseResult.parseInfo.sectionsCount}, 表格: ${parseResult.parseInfo.tablesCount}`);
        
      } else if (req.file.mimetype === 'application/msword') {
        // 老版本Word (.doc) - 简单处理
        const fileBuffer = fs.readFileSync(req.file.path);
        parseResult.extractedText = fileBuffer.toString('utf8');
        parseResult.parseInfo.parseMethod = 'doc-simple';

        console.log('📄 老版本Word解析完成');
      }
    } catch (parseError) {
      console.warn('文档解析失败:', parseError.message);
      // parseResult 保持默认值（空内容）
    }

    // 创建文档记录 - 包含结构化数据
    const document = new Document({
      originalName: req.file.originalname,
      fileName: req.file.filename,
      filePath: req.file.path,
      fileSize: req.file.size,
      mimeType: req.file.mimetype,
      protocolType: 'ClinicalProtocol',
      extractedText: parseResult.extractedText,
      sectionedText: parseResult.sectionedText,
      tables: parseResult.tables,
      assessmentSchedule: parseResult.assessmentSchedule,
      studyNumber: parseResult.studyNumber || null,
      parseInfo: parseResult.parseInfo,
      specificMetadata: {},
      ProjectCostEstimateDetails: {
        sdtmAnalysis: parseResult.sdtmAnalysis || undefined,
        // 其他字段使用schema默认
      }
    });

    const savedDocument = await document.save();

    console.log('✅ Clinical Protocol 文档保存成功，ID:', savedDocument._id);
    console.log(`📊 保存的数据结构:`, {
      sections: parseResult.parseInfo.sectionsCount,
      tables: parseResult.parseInfo.tablesCount,
      hasStructuredContent: parseResult.parseInfo.hasStructuredContent,
      hasAssessmentSchedule: parseResult.parseInfo.hasAssessmentSchedule,
      method: parseResult.parseInfo.parseMethod
    });
    
    // 🔥 成本估算快照（SDTM部分）
    try {
      const sdtmSummary = parseResult?.sdtmAnalysis?.summary;
      if (sdtmSummary) {
        const highCount = Number(sdtmSummary?.highComplexitySdtm?.count || 0);
        const mediumCount = Number(sdtmSummary?.mediumComplexitySdtm?.count || 0);
        const totalDomains = Number(sdtmSummary?.total_sdtm_domains || 0);

        const rates = { costPerHour: 1 };
        const hoursPerUnit = {
          annotatedCrf: 32,
          specsHigh: 3,
          specsMedium: 2,
          prodHigh: 16,
          prodMedium: 10,
          pinnacle21: 6,
          reviewersGuide: 32,
          defineXml: 32,
          xptConversion: 0.2
        };

        const units = {
          annotatedCrf: 1,
          specsHigh: highCount,
          specsMedium: mediumCount,
          prodHigh: highCount,
          prodMedium: mediumCount,
          pinnacle21: 2,
          reviewersGuide: 1,
          defineXml: 1,
          xptConversion: totalDomains
        };

        const estimatedCosts = {};
        Object.keys(units).forEach(key => {
          const unit = Number(units[key] || 0);
          const cpu = rates.costPerHour * Number(hoursPerUnit[key] || 0);
          estimatedCosts[key] = Number((unit * cpu).toFixed(2));
        });

        const subtotal = Object.values(estimatedCosts).reduce((acc, v) => acc + Number(v || 0), 0);

        // 组装目标结构（嵌套路径）
        savedDocument.ProjectCostEstimateDetails = savedDocument.ProjectCostEstimateDetails || {};
        const nestedCost = savedDocument.ProjectCostEstimateDetails.costEstimate || {};
        nestedCost['SDTM Datasets Production and Validation'] = { units, estimatedCosts, subtotal };
        nestedCost.createdAt = new Date();
        savedDocument.ProjectCostEstimateDetails.costEstimate = nestedCost;
        await savedDocument.save();
        console.log('💾 已保存SDTM成本估算快照');
      }
    } catch (costErr) {
      console.warn('⚠️ 生成SDTM成本估算快照失败:', costErr.message);
    }

    // 🔥 自动生成Excel文件（如果找到了评估时间表）
    let autoGeneratedExcel = null;
    if (parseResult.parseInfo.hasAssessmentSchedule && parseResult.assessmentSchedule) {
      try {
        console.log('📊 检测到评估时间表，开始自动生成Excel...');
        
        const targetDir = path.join(__dirname, '..', 'ScheduleOfAssessment');
        autoGeneratedExcel = exportAssessmentScheduleToExcel(
          parseResult.assessmentSchedule.htmlContent,
          savedDocument.originalName,
          targetDir
        );
          
        console.log(`✅ 评估时间表Excel自动生成成功: ${autoGeneratedExcel.filePath}`);
      } catch (excelError) {
        console.warn('⚠️ 自动生成Excel失败:', excelError.message);
        // 不影响文档上传的主流程
      }
    }

    res.json({
      success: true,
      message: 'Clinical Protocol 上传成功',
      uploadId: savedDocument._id,
      fileName: req.file.originalname,
      fileSize: req.file.size,
      extractedLength: parseResult.extractedText.length,
      protocolType: 'ClinicalProtocol',
      studyNumber: savedDocument.studyNumber || null,
      structuredData: {
        sectionsCount: parseResult.parseInfo.sectionsCount,
        tablesCount: parseResult.parseInfo.tablesCount,
        hasStructuredContent: parseResult.parseInfo.hasStructuredContent,
        hasAssessmentSchedule: parseResult.parseInfo.hasAssessmentSchedule,
        parseMethod: parseResult.parseInfo.parseMethod,
        assessmentSchedule: parseResult.assessmentSchedule ? {
          tableIndex: parseResult.assessmentSchedule.tableIndex,
          confidence: parseResult.assessmentSchedule.confidence,
          identifiedBy: parseResult.assessmentSchedule.identifiedBy
        } : null
      },
      // 为前端兼容：直接返回AI分析结果
      sdtmAnalysis: parseResult.sdtmAnalysis,
      costEstimate: (savedDocument.ProjectCostEstimateDetails && savedDocument.ProjectCostEstimateDetails.costEstimate) || {},
      autoGeneratedExcel: autoGeneratedExcel
    });

  } catch (error) {
    console.error('Clinical Protocol 上传错误:', error);
    
    // 清理临时文件
    if (req.file && fs.existsSync(req.file.path)) {
      fs.unlinkSync(req.file.path);
    }

    res.status(500).json({
      success: false,
      message: 'Clinical Protocol 上传失败',
      error: error.message
    });
  }
}

// 获取文档列表
async function getDocuments(req, res) {
  try {
    const documents = await Document.find({ protocolType: 'ClinicalProtocol' })
      .select('originalName fileSize uploadedAt protocolType specificMetadata parseInfo sectionedText tables assessmentSchedule')
      .sort({ uploadedAt: -1 });

    // 为每个文档添加结构化数据的摘要信息
    const documentsWithSummary = documents.map(doc => ({
      _id: doc._id,
      originalName: doc.originalName,
      fileSize: doc.fileSize,
      uploadedAt: doc.uploadedAt,
      protocolType: doc.protocolType,
      specificMetadata: doc.specificMetadata,
      structuredInfo: {
        hasStructuredContent: doc.parseInfo?.hasStructuredContent || false,
        sectionsCount: doc.parseInfo?.sectionsCount || 0,
        tablesCount: doc.parseInfo?.tablesCount || 0,
        parseMethod: doc.parseInfo?.parseMethod || 'unknown',
        sectionTitles: doc.sectionedText?.map(section => section.title) || [],
        hasExtractedText: !!doc.extractedText,
        hasAssessmentSchedule: doc.parseInfo?.hasAssessmentSchedule || false,
        assessmentSchedule: doc.assessmentSchedule ? {
          tableIndex: doc.assessmentSchedule.tableIndex,
          confidence: doc.assessmentSchedule.confidence,
          identifiedBy: doc.assessmentSchedule.identifiedBy
        } : null
      }
    }));

    res.json({
      success: true,
      message: '获取文档列表成功',
      documents: documentsWithSummary
    });

  } catch (error) {
    console.error('获取文档列表错误:', error);
    res.status(500).json({
      success: false,
      message: '获取文档列表失败',
      error: error.message
    });
  }
}

// 🔥 新增：列出未完成的成本估算（projectDone.isCostEstimate=false）
async function listIncompleteEstimates(req, res) {
  try {
    const docs = await Document.find({ 'projectDone.isCostEstimate': false })
      .select('_id originalName studyNumber uploadedAt')
      .sort({ uploadedAt: -1 })
      .lean();
    res.json({ success: true, data: docs });
  } catch (error) {
    console.error('查询未完成成本估算失败:', error);
    res.status(500).json({ success: false, message: '查询失败', error: error.message });
  }
}

// 获取文档详细内容
async function getDocumentContent(req, res) {
  try {
    const { id } = req.params;
    
    const document = await Document.findById(id)
      .select('originalName fileSize uploadedAt protocolType extractedText sectionedText tables assessmentSchedule parseInfo ProjectCostEstimateDetails studyNumber');
    
    if (!document) {
      return res.status(404).json({
        success: false,
        message: '文档不存在'
      });
    }

    const pced = document.ProjectCostEstimateDetails || {};

    res.json({
      success: true,
      message: '获取文档内容成功',
      document: {
        _id: document._id,
        originalName: document.originalName,
        fileSize: document.fileSize,
        uploadedAt: document.uploadedAt,
        protocolType: document.protocolType,
        parseInfo: document.parseInfo,
        projectSelectionDetails: pced.projectSelectionDetails || {},
        sdtmData: {
          original: pced.sdtmAnalysis || null,
          confirmed: pced.userConfirmedSdtm || null,
          status: pced.sdtmAnalysisStatus || 'pending_confirmation'
        },
        costEstimate: pced.costEstimate || {},
        studyNumber: document.studyNumber || null,
        content: {
          extractedText: document.extractedText,
          sections: document.sectionedText || [],
          tables: document.tables || [],
          assessmentSchedule: document.assessmentSchedule || null
        }
      }
    });
    
  } catch (error) {
    console.error('获取文档内容错误:', error);
    res.status(500).json({
      success: false,
      message: '获取文档内容失败',
      error: error.message
    });
  }
}

// 导出评估时间表
async function exportAssessmentSchedule(req, res) {
  try {
    const { id } = req.params;
    const document = await Document.findById(id);

    if (!document) {
      return res.status(404).json({
        success: false,
        message: '文档不存在'
      });
    }

    if (!document.assessmentSchedule || !document.assessmentSchedule.htmlContent) {
      return res.status(400).json({
        success: false,
        message: '文档中未找到评估时间表'
      });
    }

    console.log('📊 开始手动导出评估时间表...');
    
    const targetDir = path.join(__dirname, '..', 'ScheduleOfAssessment');
    const result = exportAssessmentScheduleToExcel(
      document.assessmentSchedule.htmlContent,
      document.originalName,
      targetDir
    );

    res.json({
      success: true,
      message: '评估时间表导出成功',
      fileName: result.fileName,
      filePath: result.filePath,
      rowsCount: result.rowsCount,
      columnsCount: result.columnsCount
    });

  } catch (error) {
    console.error('❌ 导出评估时间表失败:', error);
    res.status(500).json({
      success: false,
      message: '导出评估时间表失败',
      error: error.message
    });
  }
}

// 确认SDTM分析结果
async function confirmSDTMAnalysis(req, res) {
  try {
    const { id } = req.params;
    const { procedures, mappings, summary } = req.body;

    console.log(`确认文档 ${id} 的SDTM分析结果`);

    const document = await Document.findById(id);
    if (!document) {
      return res.status(404).json({
        success: false,
        message: '文档不存在'
      });
    }

    document.ProjectCostEstimateDetails = document.ProjectCostEstimateDetails || {};

    // 更新用户确认的SDTM数据（嵌套路径）
    document.ProjectCostEstimateDetails.userConfirmedSdtm = {
      procedures,
      mappings,
      summary,
      confirmedAt: new Date()
    };
    
    // 更新状态
    document.ProjectCostEstimateDetails.sdtmAnalysisStatus = 'confirmed';

    // 同步生成并保存成本估算快照（基于确认后的summary）
    try {
      const sdtmSummary = summary || {};
      const highCount = Number(sdtmSummary?.highComplexitySdtm?.count || 0);
      const mediumCount = Number(sdtmSummary?.mediumComplexitySdtm?.count || 0);
      const totalDomains = Number(sdtmSummary?.total_sdtm_domains || 0);

      const rates = { costPerHour: 1 };
      const hoursPerUnit = {
        annotatedCrf: 32,
        specsHigh: 3,
        specsMedium: 2,
        prodHigh: 16,
        prodMedium: 10,
        pinnacle21: 6,
        reviewersGuide: 32,
        defineXml: 32,
        xptConversion: 0.2
      };

      const units = {
        annotatedCrf: 1,
        specsHigh: highCount,
        specsMedium: mediumCount,
        prodHigh: highCount,
        prodMedium: mediumCount,
        pinnacle21: 2,
        reviewersGuide: 1,
        defineXml: 1,
        xptConversion: totalDomains
      };

      const estimatedCosts = {};
      Object.keys(units).forEach(key => {
        const unit = Number(units[key] || 0);
        const cpu = rates.costPerHour * Number(hoursPerUnit[key] || 0);
        estimatedCosts[key] = Number((unit * cpu).toFixed(2));
      });

      const subtotal = Object.values(estimatedCosts).reduce((acc, v) => acc + Number(v || 0), 0);

      const pced = document.ProjectCostEstimateDetails;
      const costEstimate = pced.costEstimate || {};
      costEstimate['SDTM Datasets Production and Validation'] = { units, estimatedCosts, subtotal };
      costEstimate.createdAt = new Date();
      pced.costEstimate = costEstimate;
    } catch (calcErr) {
      console.warn('⚠️ 确认后生成成本估算失败:', calcErr.message);
    }

    await document.save();

    console.log('SDTM分析结果已确认并保存');

    res.json({
      success: true,
      message: 'SDTM分析结果已确认并保存',
      data: {
        documentId: id,
        confirmedAt: document.ProjectCostEstimateDetails.userConfirmedSdtm.confirmedAt,
        status: document.ProjectCostEstimateDetails.sdtmAnalysisStatus,
        costEstimate: document.ProjectCostEstimateDetails.costEstimate || {}
      }
    });

  } catch (error) {
    console.error('确认SDTM分析结果错误:', error);
    res.status(500).json({
      success: false,
      message: '确认SDTM分析结果失败',
      error: error.message
    });
  }
}

// 🔥 新增：更新项目选择详细信息 (简化格式)
async function updateProjectSelection(req, res) {
  try {
    const { id } = req.params;
    const { projectSelectionDetails } = req.body;

    console.log(`更新文档 ${id} 的项目选择详情`);

    const document = await Document.findById(id);
    if (!document) {
      return res.status(404).json({
        success: false,
        message: '文档不存在'
      });
    }

    document.ProjectCostEstimateDetails = document.ProjectCostEstimateDetails || {};

    // 直接存储项目选择详情 (项目名: 次数 格式)
    document.ProjectCostEstimateDetails.projectSelectionDetails = {
      ...projectSelectionDetails,
      lastUpdated: new Date()
    };

    await document.save();

    console.log('项目选择详情已更新并保存');

    res.json({
      success: true,
      message: '项目选择详情已保存',
      data: {
        documentId: id,
        projectSelectionDetails: document.ProjectCostEstimateDetails.projectSelectionDetails
      }
    });

  } catch (error) {
    console.error('更新项目选择详情错误:', error);
    res.status(500).json({
      success: false,
      message: '保存项目选择详情失败',
      error: error.message
    });
  }
}

// 🔥 新增：标记成本估算完成（Done）
async function markCostEstimateDone(req, res) {
  try {
    const { id } = req.params;
    const document = await Document.findById(id);
    if (!document) {
      return res.status(404).json({ success: false, message: '文档不存在' });
    }
    document.projectDone = document.projectDone || {};
    document.projectDone.isCostEstimate = true;
    await document.save();
    res.json({ success: true, message: '已标记为成本估算完成', data: { documentId: id, isCostEstimate: true } });
  } catch (error) {
    console.error('标记成本估算完成失败:', error);
    res.status(500).json({ success: false, message: '标记失败', error: error.message });
  }
}

// 新增：延迟执行SDTM分析（上传后，单独触发）
async function analyzeDocumentForSdtm(req, res) {
  try {
    const { id } = req.params;
    const document = await Document.findById(id).select('assessmentSchedule ProjectCostEstimateDetails');
    if (!document) {
      return res.status(404).json({ success: false, message: '文档不存在' });
    }
    if (!document.assessmentSchedule || !document.assessmentSchedule.htmlContent) {
      return res.status(400).json({ success: false, message: '未找到评估时间表，无法进行SDTM分析' });
    }

    const { performSDTMAnalysis } = require('../services/sdtmAnalysisService');

    console.log('🎯 开始完整的SDTM分析流程...');
    const sdtmAnalysis = await performSDTMAnalysis(document.assessmentSchedule);

    // 保存结果
    document.ProjectCostEstimateDetails = document.ProjectCostEstimateDetails || {};
    document.ProjectCostEstimateDetails.sdtmAnalysis = sdtmAnalysis;

    // 基于初步分析生成成本估算快照（可被后续确认覆盖）
    try {
      const sdtmSummary = sdtmAnalysis?.summary || {};
      const highCount = Number(sdtmSummary?.highComplexitySdtm?.count || 0);
      const mediumCount = Number(sdtmSummary?.mediumComplexitySdtm?.count || 0);
      const totalDomains = Number(sdtmSummary?.total_sdtm_domains || 0);
      const rates = { costPerHour: 1 };
      const hoursPerUnit = { annotatedCrf: 32, specsHigh: 3, specsMedium: 2, prodHigh: 16, prodMedium: 10, pinnacle21: 6, reviewersGuide: 32, defineXml: 32, xptConversion: 0.2 };
      const units = { annotatedCrf: 1, specsHigh: highCount, specsMedium: mediumCount, prodHigh: highCount, prodMedium: mediumCount, pinnacle21: 2, reviewersGuide: 1, defineXml: 1, xptConversion: totalDomains };
      const estimatedCosts = {};
      Object.keys(units).forEach(k => { const u = Number(units[k] || 0); const cpu = rates.costPerHour * Number(hoursPerUnit[k] || 0); estimatedCosts[k] = Number((u * cpu).toFixed(2)); });
      const subtotal = Object.values(estimatedCosts).reduce((acc, v) => acc + Number(v || 0), 0);
      const pced = document.ProjectCostEstimateDetails;
      pced.costEstimate = pced.costEstimate || {};
      pced.costEstimate['SDTM Datasets Production and Validation'] = { units, estimatedCosts, subtotal };
      pced.costEstimate.createdAt = new Date();
    } catch (e) { console.warn('生成初步成本估算失败:', e.message); }

    await document.save();

    res.json({ success: true, message: 'SDTM分析完成', data: { sdtmAnalysis } });
  } catch (error) {
    console.error('延迟执行SDTM分析失败:', error);
    res.status(500).json({ success: false, message: '分析失败', error: error.message });
  }
}

// 更新Excel中的Unit数据
async function updateUnits(req, res) {
  try {
    const { id } = req.params;
    const { units } = req.body;

    if (!units || typeof units !== 'object') {
      return res.status(400).json({
        success: false,
        message: 'Invalid units data provided'
      });
    }

    const document = await Document.findById(id);
    if (!document) {
      return res.status(404).json({
        success: false,
        message: 'Document not found'
      });
    }

    // 更新Unit数据到数据库
    if (!document.ProjectCostEstimateDetails) {
      document.ProjectCostEstimateDetails = {};
    }
    if (!document.ProjectCostEstimateDetails.costEstimate) {
      document.ProjectCostEstimateDetails.costEstimate = {};
    }
    if (!document.ProjectCostEstimateDetails.costEstimate.units) {
      document.ProjectCostEstimateDetails.costEstimate.units = {};
    }

    // 合并新的Unit数据（可更新）
    Object.assign(document.ProjectCostEstimateDetails.costEstimate.units, units);

    // 保存到数据库
    await document.save();

    console.log(`✅ 已更新文档 ${id} 的Units:`, units);

    res.json({
      success: true,
      message: 'Units updated successfully',
      data: {
        units: document.ProjectCostEstimateDetails.costEstimate.units
      }
    });

  } catch (error) {
    console.error('❌ 更新Units失败:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to update units: ' + error.message
    });
  }
}

module.exports = {
  uploadDocument,
  getDocuments,
  listIncompleteEstimates,
  getDocumentContent,
  exportAssessmentSchedule,
  confirmSDTMAnalysis,
  updateProjectSelection,
  markCostEstimateDone,
  analyzeDocumentForSdtm,
  updateUnits
}; 