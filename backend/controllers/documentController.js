const Document = require('../models/documentModel');
const { parseWordDocumentStructure } = require('../services/wordParserService');
const { processPdfWithPypdf, formatResultForDatabase } = require('../services/pypdfService');


// 上传文档处理函数
async function uploadDocument(req, res) {
  try {
    console.log('📥 上传请求详情:', {
      hasFile: !!req.file,
      body: req.body,
      headers: req.headers['content-type']
    });
    
    if (!req.file) {
      console.error('❌ 没有接收到文件');
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
            // PDF simplified processing (using Python pypdf for text extraction only)
            console.log('📄 Starting PDF simplified text extraction...');
            const pypdfResult = await processPdfWithPypdf(req.file.buffer);
            parseResult = await formatResultForDatabase(pypdfResult);
            
            console.log(`✅ PDF processing completed - Pages: ${pypdfResult.total_pages}, Text length: ${parseResult.extractedText.length}, Sections: ${parseResult.parseInfo.sectionsCount}, Study Number: ${parseResult.studyNumber || 'Not found'}`);
                    
      } else if (req.file.mimetype === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document') {
        // Word (.docx) 结构化解析（使用内存Buffer）
        console.log('📝 开始Word文档结构化解析...');
        parseResult = await parseWordDocumentStructure(req.file.buffer);
        
        console.log(`✅ Word解析完成 - 章节: ${parseResult.parseInfo.sectionsCount}, 表格: ${parseResult.parseInfo.tablesCount}`);
        
      } else if (req.file.mimetype === 'application/msword') {
        // 老版本Word (.doc) - 简单处理
        parseResult.extractedText = req.file.buffer.toString('utf8');
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
      fileSize: req.file.size,
      protocolType: 'ClinicalProtocol',
      uploadExtraction: {
        extractedText: parseResult.extractedText,
        sectionedText: parseResult.sectionedText,
        tables: parseResult.tables,
        assessmentSchedule: parseResult.assessmentSchedule,
        // Note: internalLinks removed in simplified PDF version
      },
      studyNumber: parseResult.studyNumber || null,
      parseInfo: parseResult.parseInfo,
      specificMetadata: {}, // Simplified: no metadata extraction for now
      ProjectCostEstimateDetails: {
        sdtmAnalysis: parseResult.sdtmAnalysis || undefined,
        // 其他字段使用schema默认
      }
    });

    const savedDocument = await document.save();

    console.log('✅ Clinical Protocol document saved successfully, ID:', savedDocument._id);
    console.log(`📊 Saved data structure:`, {
      sections: parseResult.parseInfo.sectionsCount,
      tables: parseResult.parseInfo.tablesCount,
      hasStructuredContent: parseResult.parseInfo.hasStructuredContent,
      hasAssessmentSchedule: parseResult.parseInfo.hasAssessmentSchedule,
      method: parseResult.parseInfo.parseMethod,
      studyNumber: parseResult.studyNumber || 'Not found'
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
        totalPages: parseResult.parseInfo.totalPages || 0,
        assessmentSchedule: parseResult.assessmentSchedule ? {
          tableIndex: parseResult.assessmentSchedule.tableIndex,
          confidence: parseResult.assessmentSchedule.confidence,
          identifiedBy: parseResult.assessmentSchedule.identifiedBy
        } : null
      },
      // 为前端兼容：直接返回AI分析结果
      sdtmAnalysis: parseResult.sdtmAnalysis,
      costEstimate: (savedDocument.ProjectCostEstimateDetails && savedDocument.ProjectCostEstimateDetails.costEstimate) || {}
    });

  } catch (error) {
    console.error('Clinical Protocol 上传错误:', error);
    
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
      .select('originalName fileSize uploadedAt protocolType specificMetadata parseInfo uploadExtraction extractedText sectionedText tables assessmentSchedule')
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
        sectionTitles: (doc.uploadExtraction?.sectionedText || doc.sectionedText || []).map(section => section.title) || [],
        hasExtractedText: !!(doc.uploadExtraction?.extractedText || doc.extractedText),
        hasAssessmentSchedule: doc.parseInfo?.hasAssessmentSchedule || false,
        assessmentSchedule: (doc.uploadExtraction?.assessmentSchedule || doc.assessmentSchedule) ? {
          tableIndex: (doc.uploadExtraction?.assessmentSchedule || doc.assessmentSchedule).tableIndex,
          confidence: (doc.uploadExtraction?.assessmentSchedule || doc.assessmentSchedule).confidence,
          identifiedBy: (doc.uploadExtraction?.assessmentSchedule || doc.assessmentSchedule).identifiedBy
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
      .select('originalName fileSize uploadedAt protocolType uploadExtraction extractedText sectionedText tables assessmentSchedule parseInfo ProjectCostEstimateDetails studyNumber');
    
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
        studyNumber: document.studyNumber || null,
        // 🔥 完整的 ProjectCostEstimateDetails 结构
        ProjectCostEstimateDetails: {
          // 项目选择数据
          projectSelection: pced.projectSelection || { success: false, selectedProjects: [], selectionDetails: {} },
          projectSelectionDetails: pced.projectSelectionDetails || {}, // 向后兼容
          
          // SDTM分析状态 (关键字段)
          sdtmAnalysisStatus: pced.sdtmAnalysisStatus || null,
          
          // SDTM分析数据
          sdtmAnalysis: pced.sdtmAnalysis || null,
          userConfirmedSdtm: pced.userConfirmedSdtm || null,
          
          // 成本估算数据
          costEstimate: pced.costEstimate || {}
        },
        
        // 🔥 保持向后兼容的sdtmData结构
        sdtmData: {
          original: pced.sdtmAnalysis || null,
          confirmed: pced.userConfirmedSdtm || null,
          status: pced.sdtmAnalysisStatus || 'pending_confirmation'
        },
        
        // 文档内容
        content: {
          extractedText: document.uploadExtraction?.extractedText || document.extractedText || null,
          sections: document.uploadExtraction?.sectionedText || document.sectionedText || [],
          tables: document.uploadExtraction?.tables || document.tables || [],
          assessmentSchedule: document.uploadExtraction?.assessmentSchedule || document.assessmentSchedule || null
          // Note: internalLinks removed in simplified PDF version
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
      success: true, // 🔥 新增：设置用户确认成功标志
      procedures,
      mappings,
      summary,
      confirmedAt: new Date()
    };
    
    // 🔥 设置状态为第3步完成：用户确认完成
    document.ProjectCostEstimateDetails.sdtmAnalysisStatus = 'user_confirmed_sdtm_done';

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

      // 🔥 生成Notes信息（具体域列表）
      const highDomains = summary?.highComplexitySdtm?.domains || [];
      const mediumDomains = summary?.mediumComplexitySdtm?.domains || [];
      const allDomains = summary?.unique_domains || [];
      
      const notes = {
        specsHigh: highDomains.join('/'),
        specsMedium: mediumDomains.join('/'),
        xptConversion: allDomains.join('/')
      };

      const pced = document.ProjectCostEstimateDetails;
      const costEstimate = pced.costEstimate || {};
      costEstimate['SDTM Datasets Production and Validation'] = { units, estimatedCosts, notes, subtotal };
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

    // 🔥 更新项目选择数据到新的 projectSelection 字段
    const selectedProjects = Object.keys(projectSelectionDetails).filter(
      project => {
        const value = projectSelectionDetails[project];
        // 包括有次数的项目(> 0)和无次数要求的项目(null)，排除lastUpdated字段
        return project !== 'lastUpdated' && (value === null || (typeof value === 'number' && value > 0));
      }
    );
    

    
    document.ProjectCostEstimateDetails.projectSelection = {
      success: selectedProjects.length > 0, // 判断用户是否完成了项目选择
      selectedProjects: selectedProjects,
      selectionDetails: {
        ...projectSelectionDetails,
        lastUpdated: new Date()
      },
      selectedAt: new Date()
    };
    
    // 🔥 设置状态为第1步完成：项目选择完成
    document.ProjectCostEstimateDetails.sdtmAnalysisStatus = 'project_selection_done';

    await document.save();

    console.log('项目选择详情已更新并保存');

    res.json({
      success: true,
      message: '项目选择详情已保存',
      data: {
        documentId: id,
        projectSelection: document.ProjectCostEstimateDetails.projectSelection, // 🔥 新字段
        projectSelectionDetails: document.ProjectCostEstimateDetails.projectSelectionDetails // 向后兼容
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
    const document = await Document.findById(id).select('uploadExtraction assessmentSchedule ProjectCostEstimateDetails');
    if (!document) {
      return res.status(404).json({ success: false, message: '文档不存在' });
    }
    const assess = document.uploadExtraction?.assessmentSchedule || document.assessmentSchedule;
    if (!assess || !assess.htmlContent) {
      return res.status(400).json({ success: false, message: '未找到评估时间表，无法进行SDTM分析' });
    }

    const { performSDTMAnalysis } = require('../services/sdtmAnalysisService');

    console.log('🎯 开始完整的SDTM分析流程...');
    const sdtmAnalysis = await performSDTMAnalysis(assess);

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
      
      // 🔥 生成Notes信息（具体域列表）
      const highDomains = sdtmSummary?.highComplexitySdtm?.domains || [];
      const mediumDomains = sdtmSummary?.mediumComplexitySdtm?.domains || [];
      const allDomains = sdtmSummary?.unique_domains || [];
      
      const notes = {
        specsHigh: highDomains.join('/'),
        specsMedium: mediumDomains.join('/'),
        xptConversion: allDomains.join('/')
      };
      
      const pced = document.ProjectCostEstimateDetails;
      pced.costEstimate = pced.costEstimate || {};
      pced.costEstimate['SDTM Datasets Production and Validation'] = { units, estimatedCosts, notes, subtotal };
      pced.costEstimate.createdAt = new Date();
    } catch (e) { console.warn('生成初步成本估算失败:', e.message); }

    // 🔥 设置状态为第2步完成：AI SDTM分析完成
    document.ProjectCostEstimateDetails.sdtmAnalysisStatus = 'sdtm_ai_analysis_done';

    await document.save();

    console.log('✅ SDTM分析完成，状态已更新为 sdtm_ai_analysis_done');
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

    // 🔥 同步更新 SDTM Datasets Production and Validation 部分
    const sdtmSection = document.ProjectCostEstimateDetails.costEstimate['SDTM Datasets Production and Validation'];
    if (sdtmSection && sdtmSection.units) {
      // 更新SDTM section中的units
      Object.assign(sdtmSection.units, units);
      
      // 重新计算 estimatedCosts 和 subtotal
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
      
      const estimatedCosts = {};
      Object.keys(sdtmSection.units).forEach(key => {
        const unit = Number(sdtmSection.units[key] || 0);
        const cpu = rates.costPerHour * Number(hoursPerUnit[key] || 0);
        estimatedCosts[key] = Number((unit * cpu).toFixed(2));
      });
      
      const subtotal = Object.values(estimatedCosts).reduce((acc, v) => acc + Number(v || 0), 0);
      
      // 更新 estimatedCosts 和 subtotal
      sdtmSection.estimatedCosts = estimatedCosts;
      sdtmSection.subtotal = subtotal;
      
      console.log('🔄 已同步更新 SDTM section:', { units: sdtmSection.units, estimatedCosts, subtotal });
    }

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

// 删除文档
async function deleteDocument(req, res) {
  try {
    const { id } = req.params;
    
    console.log('🗑️ 删除文档请求:', id);
    
    const deletedDoc = await Document.findByIdAndDelete(id);
    
    if (!deletedDoc) {
      return res.status(404).json({ 
        success: false, 
        message: 'Document not found' 
      });
    }
    
    console.log('✅ 文档删除成功:', {
      id: deletedDoc._id,
      studyNumber: deletedDoc.studyNumber,
      documentType: deletedDoc.documentType
    });
    
    res.json({ 
      success: true, 
      message: 'Document deleted successfully',
      data: {
        deletedDocumentId: deletedDoc._id,
        studyNumber: deletedDoc.studyNumber
      }
    });
  } catch (error) {
    console.error('❌ 文档删除失败:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Failed to delete document', 
      error: error.message 
    });
  }
}

module.exports = {
  uploadDocument,
  getDocuments,
  listIncompleteEstimates,
  getDocumentContent,
  confirmSDTMAnalysis,
  updateProjectSelection,
  markCostEstimateDone,
  analyzeDocumentForSdtm,
  updateUnits,
  deleteDocument
}; 