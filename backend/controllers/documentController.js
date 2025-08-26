// Legacy Document model kept for backward compatibility (not used after migration)
const Document = require('../models/documentModel');
const Study = require('../models/studyModel');
const { parseWordDocumentStructure } = require('../services/wordParserService');
const { processPdfWithPypdf, formatResultForDatabase, pypdfService } = require('../services/pypdfService');
const { analyzeSDTMMapping } = require('../services/sdtmAnalysisService');
const { performADaMAnalysis } = require('../services/adamAnalysisService');


// 上传文档处理函数（Study-level with file slots）
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

    const { documentType, studyNumber: explicitStudyNumber, fileType } = req.body; // fileType: protocol|crf|sap
    
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

    // === Study upsert and file slot update ===
    const derivedStudyNumber = explicitStudyNumber || parseResult.studyNumber || null;
    const slotKey = (fileType || 'protocol').toLowerCase(); // default to protocol

    if (!derivedStudyNumber) {
      console.warn('⚠️ 未识别到studyNumber，仍将创建Study占位记录');
    }

    // Find or create study by studyNumber
    let study = await Study.findOne({ studyNumber: derivedStudyNumber });
    if (!study) {
      study = new Study({ studyNumber: derivedStudyNumber });
    }

    // Ensure files structure exists
    study.files = study.files || {};
    study.files[slotKey] = study.files[slotKey] || {};

    // Fill file slot
    study.files[slotKey].uploaded = true;
    study.files[slotKey].originalName = req.file.originalname;
    study.files[slotKey].fileSize = req.file.size;
    study.files[slotKey].mimeType = req.file.mimetype;
    study.files[slotKey].uploadedAt = new Date();
    study.files[slotKey].uploadExtraction = {
      extractedText: parseResult.extractedText,
      sectionedText: parseResult.sectionedText,
      tables: parseResult.tables,
      assessmentSchedule: parseResult.assessmentSchedule
    };

    // Write partial sdtm procedures (PDF path) into CostEstimateDetails at study level
    if (parseResult?.sdtmAnalysis?.procedures?.length > 0) {
      study.CostEstimateDetails = study.CostEstimateDetails || {};
      const existing = study.CostEstimateDetails.sdtmAnalysis || {};
      study.CostEstimateDetails.sdtmAnalysis = {
        ...existing,
        success: Boolean(parseResult.sdtmAnalysis.success),
        procedures: parseResult.sdtmAnalysis.procedures,
        summary: parseResult.sdtmAnalysis.summary || {
          total_procedures: parseResult.sdtmAnalysis.procedures?.length || 0,
          total_sdtm_domains: 0,
          unique_domains: [],
          highComplexitySdtm: { count: 0, domains: [] },
          mediumComplexitySdtm: { count: 0, domains: [] }
        }
      };
    }

    // Save study
    const savedStudy = await study.save();

    console.log('✅ Study saved successfully, ID:', savedStudy._id);
    console.log(`📊 Saved data structure:`, {
      sections: parseResult.parseInfo.sectionsCount,
      tables: parseResult.parseInfo.tablesCount,
      hasStructuredContent: parseResult.parseInfo.hasStructuredContent,
      hasAssessmentSchedule: parseResult.parseInfo.hasAssessmentSchedule,
      method: parseResult.parseInfo.parseMethod,
      studyNumber: savedStudy.studyNumber || 'Not found'
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
        savedStudy.CostEstimateDetails = savedStudy.CostEstimateDetails || {};
        const nestedCost = savedStudy.CostEstimateDetails.sdtmTableInput || {};
        nestedCost['SDTM Datasets Production and Validation'] = { units, estimatedCosts, subtotal };
        nestedCost.createdAt = new Date();
        savedStudy.CostEstimateDetails.sdtmTableInput = nestedCost;
        await savedStudy.save();
        console.log('💾 已保存SDTM成本估算快照');
      }
    } catch (costErr) {
      console.warn('⚠️ 生成SDTM成本估算快照失败:', costErr.message);
    }



    res.json({
      success: true,
      message: 'Study file uploaded successfully',
      uploadId: savedStudy._id,
      fileName: req.file.originalname,
      fileSize: req.file.size,
      extractedLength: parseResult.extractedText.length,
      protocolType: 'ClinicalProtocol', // kept for compatibility
      studyNumber: savedStudy.studyNumber || null,
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
      costEstimate: (savedStudy.CostEstimateDetails && savedStudy.CostEstimateDetails.sdtmTableInput) || {}
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

// 获取Study列表（兼容旧名）
async function getDocuments(req, res) {
  try {
    const studies = await Study.find({}).select('studyNumber files createdAt updatedAt projectDone CostEstimateDetails.sdtmAnalysisStatus').sort({ updatedAt: -1 }).lean();

    const documentsWithSummary = studies.map(s => {
      const proto = s.files?.protocol || {};
      const ex = proto.uploadExtraction || {};
      const sections = Array.isArray(ex.sectionedText) ? ex.sectionedText.length : 0;
      const tables = Array.isArray(ex.tables) ? ex.tables.length : 0;
      return {
        _id: s._id,
        studyNumber: s.studyNumber,
        uploadedAt: proto.uploadedAt || s.createdAt,
        protocolUploaded: Boolean(proto.uploaded),
        structuredInfo: {
          hasStructuredContent: sections > 0 || tables > 0,
          sectionsCount: sections,
          tablesCount: tables,
          parseMethod: 'study-level',
          sectionTitles: (ex.sectionedText || []).map(sec => sec.title) || [],
          hasExtractedText: !!ex.extractedText,
          hasAssessmentSchedule: Boolean(ex.assessmentSchedule),
          assessmentSchedule: ex.assessmentSchedule ? {
            tableIndex: ex.assessmentSchedule.tableIndex,
            confidence: ex.assessmentSchedule.confidence,
            identifiedBy: ex.assessmentSchedule.identifiedBy
          } : null
        }
      };
    });

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

// 🔥 修改：列出未完成的成本估算（projectDone.isCostEstimate为null或false）
async function listIncompleteEstimates(req, res) {
  try {
    // 查询条件：isCostEstimate 不等于 true（包括 null, false, undefined）
    const docs = await Study.find({ 
      $or: [
        { 'projectDone.isCostEstimate': { $ne: true } },
        { 'projectDone.isCostEstimate': { $exists: false } },
        { 'projectDone': { $exists: false } }
      ]
    })
      .select('_id studyNumber files createdAt updatedAt projectDone')
      .sort({ updatedAt: -1 })
      .lean();
    res.json({ success: true, data: docs });
  } catch (error) {
    console.error('查询未完成成本估算失败:', error);
    res.status(500).json({ success: false, message: '查询失败', error: error.message });
  }
}

// 获取Study详细内容（兼容旧路径）
async function getDocumentContent(req, res) {
  try {
    const { id } = req.params;
    const study = await Study.findById(id).lean();
    if (!study) {
      return res.status(404).json({
        success: false,
        message: 'Study 不存在'
      });
    }

    const proto = study.files?.protocol || {};
    const ex = proto.uploadExtraction || {};
    const pced = study.CostEstimateDetails || {};

    res.json({
      success: true,
      message: '获取Study内容成功',
      document: {
        _id: study._id,
        studyNumber: study.studyNumber || null,
        uploadedAt: proto.uploadedAt || study.createdAt,
        // 🔥 完整的 CostEstimateDetails 结构（按你要求的顺序）
        CostEstimateDetails: {
          // 顺序：projectSelection → sdtmAnalysis → userConfirmedSdtm → sdtmAnalysisStatus → sdtmTableInput → adamAnalysis → userConfirmedAdam → adamTableInput
          projectSelection: pced.projectSelection || { success: false, selectedProjects: [], selectionDetails: {} },
          sdtmAnalysis: pced.sdtmAnalysis || null,
          userConfirmedSdtm: pced.userConfirmedSdtm || null,
          sdtmAnalysisStatus: pced.sdtmAnalysisStatus || null,
          sdtmTableInput: pced.sdtmTableInput || {},
          adamAnalysis: pced.adamAnalysis || null,
          userConfirmedAdam: pced.userConfirmedAdam || null,
          adamTableInput: pced.adamTableInput || {}
        },
        
        // 🔥 保持向后兼容的sdtmData结构
        sdtmData: { original: pced.sdtmAnalysis || null, confirmed: pced.userConfirmedSdtm || null, status: pced.sdtmAnalysisStatus || 'pending_confirmation' },
        
        // 文档内容
        content: {
          extractedText: ex.extractedText || null,
          sections: ex.sectionedText || [],
          tables: ex.tables || [],
          assessmentSchedule: ex.assessmentSchedule || null
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

// 🔥 新增：获取Study的文档槽位状态（供前端列出CRF/SAP）
async function getStudyDocuments(req, res) {
  try {
    const { studyIdentifier } = req.params;
    // 允许传入 studyNumber 或 _id，两者择一
    let study = null;
    if (studyIdentifier && studyIdentifier.match(/^[0-9a-fA-F]{24}$/)) {
      study = await Study.findById(studyIdentifier).lean();
    }
    if (!study) {
      study = await Study.findOne({ studyNumber: studyIdentifier }).lean();
    }

    if (!study) {
      return res.json({
        success: true,
        data: {
          studyId: null,
          hasProtocol: false,
          hasCrf: false,
          hasSap: false,
          filesSummary: []
        }
      });
    }

    const files = study.files || {};
    const protocol = files.protocol || {};
    const crf = files.crf || {};
    const sap = files.sap || {};

    const filesSummary = [];
    if (protocol.uploaded) {
      filesSummary.push({
        slot: 'PROTOCOL',
        originalName: protocol.originalName || 'protocol.pdf',
        size: formatBytes(protocol.fileSize),
        uploadedAt: protocol.uploadedAt
      });
    }
    if (crf.uploaded) {
      filesSummary.push({
        slot: 'CRF',
        originalName: crf.originalName || 'crf.pdf',
        size: formatBytes(crf.fileSize),
        uploadedAt: crf.uploadedAt
      });
    }
    if (sap.uploaded) {
      filesSummary.push({
        slot: 'SAP',
        originalName: sap.originalName || 'sap.pdf',
        size: formatBytes(sap.fileSize),
        uploadedAt: sap.uploadedAt
      });
    }

    return res.json({
      success: true,
      data: {
        studyId: String(study._id),
        hasProtocol: !!protocol.uploaded,
        hasCrf: !!crf.uploaded,
        hasSap: !!sap.uploaded,
        filesSummary
      }
    });
  } catch (error) {
    console.error('❌ Error getting study documents:', error);
    return res.status(500).json({ success: false, message: 'Failed to get study documents', error: error.message });
  }
}

// 辅助：格式化文件大小
function formatBytes(bytes) {
  if (!bytes || bytes === 0) return '';
  const sizes = ['Bytes', 'KB', 'MB', 'GB'];
  const i = parseInt(Math.floor(Math.log(bytes) / Math.log(1024)), 10);
  return `${Math.round(bytes / Math.pow(1024, i), 2)} ${sizes[i]}`;
}



// 确认SDTM分析结果
async function confirmSDTMAnalysis(req, res) {
  try {
    const { id } = req.params;
    const { procedures, mappings, summary } = req.body;

    console.log(`确认Study ${id} 的SDTM分析结果`);

    const study = await Study.findById(id);
    if (!study) {
      return res.status(404).json({
        success: false,
        message: 'Study不存在'
      });
    }

    study.CostEstimateDetails = study.CostEstimateDetails || {};

    // 转换mappings为简化的 { procedure: "PE, VS" } 字符串映射（与sdtmAnalysis保持一致）
    const simplifiedMappings = new Map();
    if (mappings && typeof mappings === 'object') {
      if (mappings instanceof Map) {
        // 输入已是Map
        for (const [procedure, domains] of mappings) {
          if (Array.isArray(domains)) {
            simplifiedMappings.set(procedure, domains.join(', '));
          } else if (typeof domains === 'string') {
            simplifiedMappings.set(procedure, domains);
          } else if (domains != null) {
            simplifiedMappings.set(procedure, String(domains));
          }
        }
      } else {
        // 统一将对象/数组转换为值数组，便于处理如 {0:{...},1:{...}} 或 [{...},{...}]
        const values = Array.isArray(mappings) ? mappings : Object.values(mappings);
        const looksLikeArrayOfObjects = values.every(v => v && typeof v === 'object' && !Array.isArray(v));

        if (looksLikeArrayOfObjects) {
          // 形如 [{ procedure, sdtm_domains }] 或 {0:{...}}
          for (const item of values) {
            const procedureName = String(item.procedure || item.name || item.key || '').trim();
            let domainRaw = item.sdtm_domains; // 🔥 主要字段名
            if (domainRaw == null) domainRaw = item.domains;
            if (domainRaw == null) domainRaw = item.domain;
            if (domainRaw == null) domainRaw = item.value;
            if (domainRaw == null) domainRaw = item.values;

            let domainStr = '';
            if (Array.isArray(domainRaw)) {
              domainStr = domainRaw.join(', ');
            } else if (typeof domainRaw === 'string') {
              domainStr = domainRaw;
            } else if (domainRaw != null) {
              domainStr = String(domainRaw);
            }

            if (procedureName && domainStr) {
              simplifiedMappings.set(procedureName, domainStr);
            }
          }
        } else {
          // 形如 { 'Physical Examination': 'PE' } 的简单对象
          Object.entries(mappings).forEach(([procedure, domains]) => {
            if (!procedure) return;
            if (Array.isArray(domains)) {
              simplifiedMappings.set(procedure, domains.join(', '));
            } else if (typeof domains === 'string') {
              simplifiedMappings.set(procedure, domains);
            } else if (domains != null) {
              simplifiedMappings.set(procedure, String(domains));
            }
          });
        }
      }
    }

    // 更新用户确认的SDTM数据（嵌套路径）
    study.CostEstimateDetails.userConfirmedSdtm = {
      success: true, // 🔥 新增：设置用户确认成功标志
      procedures,
      mappings: simplifiedMappings,
      summary,
      confirmedAt: new Date()
    };
    
    // 🔥 设置状态为第3步完成：用户确认完成
    study.CostEstimateDetails.sdtmAnalysisStatus = 'user_confirmed_sdtm_done';

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

      const pced = study.CostEstimateDetails;
      const costEstimate = pced.sdtmTableInput || {};
      costEstimate['SDTM Datasets Production and Validation'] = { units, estimatedCosts, notes, subtotal };
      costEstimate.createdAt = new Date();
      pced.sdtmTableInput = costEstimate;
    } catch (calcErr) {
      console.warn('⚠️ 确认后生成成本估算失败:', calcErr.message);
    }

    await study.save();

    console.log('SDTM分析结果已确认并保存');

    res.json({
      success: true,
      message: 'SDTM分析结果已确认并保存',
      data: {
        documentId: id,
        confirmedAt: study.CostEstimateDetails.userConfirmedSdtm.confirmedAt,
        status: study.CostEstimateDetails.sdtmAnalysisStatus,
        costEstimate: study.CostEstimateDetails.sdtmTableInput || {}
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

// 确认ADaM分析结果
async function confirmADaMAnalysis(req, res) {
  try {
    const { id } = req.params;
    const { mappings, summary } = req.body;

    console.log(`确认Study ${id} 的ADaM分析结果`);

    const study = await Study.findById(id);
    if (!study) {
      return res.status(404).json({
        success: false,
        message: 'Study不存在'
      });
    }

    study.CostEstimateDetails = study.CostEstimateDetails || {};

    // 转换mappings为简化的 { sdtm_domain: "ADSL, ADAE" } 字符串映射（与adamAnalysis保持一致）
    const simplifiedMappings = new Map();
    if (mappings && typeof mappings === 'object') {
      if (mappings instanceof Map) {
        // 输入已是Map
        for (const [sdtmDomain, adamDomains] of mappings) {
          if (Array.isArray(adamDomains)) {
            simplifiedMappings.set(sdtmDomain, adamDomains.join(', '));
          } else if (typeof adamDomains === 'string') {
            simplifiedMappings.set(sdtmDomain, adamDomains);
          } else if (adamDomains != null) {
            simplifiedMappings.set(sdtmDomain, String(adamDomains));
          }
        }
      } else {
        // 统一将对象/数组转换为值数组，便于处理如 {0:{...},1:{...}} 或 [{...},{...}]
        const values = Array.isArray(mappings) ? mappings : Object.values(mappings);
        const looksLikeArrayOfObjects = values.every(v => v && typeof v === 'object' && !Array.isArray(v));

        if (looksLikeArrayOfObjects) {
          // 形如 [{ sdtm_domains, adam_domains }] 或 {0:{...}}
          for (const item of values) {
            const sdtmDomainName = String(item.sdtm_domains || item.sdtm_domain || item.name || item.key || '').trim();
            let adamDomainsRaw = item.adam_domains; // 🔥 主要字段名
            if (adamDomainsRaw == null) adamDomainsRaw = item.domains;
            if (adamDomainsRaw == null) adamDomainsRaw = item.domain;
            if (adamDomainsRaw == null) adamDomainsRaw = item.value;
            if (adamDomainsRaw == null) adamDomainsRaw = item.values;

            let adamDomainsStr = '';
            if (Array.isArray(adamDomainsRaw)) {
              adamDomainsStr = adamDomainsRaw.join(', ');
            } else if (typeof adamDomainsRaw === 'string') {
              adamDomainsStr = adamDomainsRaw;
            } else if (adamDomainsRaw != null) {
              adamDomainsStr = String(adamDomainsRaw);
            }

            if (sdtmDomainName && adamDomainsStr) {
              simplifiedMappings.set(sdtmDomainName, adamDomainsStr);
            }
          }
        } else {
          // 形如 { 'DM': 'ADSL' } 的简单对象
          Object.entries(mappings).forEach(([sdtmDomain, adamDomains]) => {
            if (!sdtmDomain) return;
            if (Array.isArray(adamDomains)) {
              simplifiedMappings.set(sdtmDomain, adamDomains.join(', '));
            } else if (typeof adamDomains === 'string') {
              simplifiedMappings.set(sdtmDomain, adamDomains);
            } else if (adamDomains != null) {
              simplifiedMappings.set(sdtmDomain, String(adamDomains));
            }
          });
        }
      }
    }

    // 更新用户确认的ADaM数据（嵌套路径）
    study.CostEstimateDetails.userConfirmedAdam = {
      success: true, // 🔥 新增：设置用户确认成功标志
      mappings: simplifiedMappings,
      summary,
      confirmedAt: new Date()
    };
    
    // 🔥 设置状态为ADaM用户确认完成
    study.CostEstimateDetails.sdtmAnalysisStatus = 'user_confirmed_adam_done';

    // 同步生成并保存ADaM成本估算快照（基于确认后的summary）
    try {
      const adamSummary = summary || {};
      const highCount = Number(adamSummary?.highComplexityAdam?.count || 0);
      const mediumCount = Number(adamSummary?.mediumComplexityAdam?.count || 0);
      const totalAdamDomains = Number(adamSummary?.total_adam_domains || 0);

      const rates = { costPerHour: 1 };
      const hoursPerUnit = {
        // ADaM任务的时间单位（基于项目需求调整）
        adamSpecsHigh: 4,           // ADaM Dataset Specs (High Complexity)
        adamSpecsMedium: 3,         // ADaM Dataset Specs (Medium Complexity)  
        adamProdHigh: 20,           // ADaM Production and Validation: Programs and Datasets (High Complexity)
        adamProdMedium: 12,         // ADaM Production and Validation: Programs and Datasets (Medium Complexity)
        adamPinnacle21: 8,          // ADaM Pinnacle 21 Report Creation and Review
        adamReviewersGuide: 40,     // ADaM Reviewer's Guide
        adamDefineXml: 40,          // ADaM Define.xml
        adamXptConversion: 0.3,     // ADaM Dataset Program xpt Conversion and Review
        adamTxtConversion: 0.2      // ADaM Program txt Conversion and Review (新增)
      };

      const units = {
        adamSpecsHigh: highCount,
        adamSpecsMedium: mediumCount,
        adamProdHigh: highCount,
        adamProdMedium: mediumCount,
        adamPinnacle21: 2,
        adamReviewersGuide: 1,
        adamDefineXml: 1,
        adamXptConversion: totalAdamDomains,
        adamTxtConversion: totalAdamDomains  // 新增：与xpt转换相同的数量
      };

      const estimatedCosts = {};
      Object.keys(units).forEach(key => {
        const unit = Number(units[key] || 0);
        const cpu = rates.costPerHour * Number(hoursPerUnit[key] || 0);
        estimatedCosts[key] = Number((unit * cpu).toFixed(2));
      });

      const subtotal = Object.values(estimatedCosts).reduce((acc, v) => acc + Number(v || 0), 0);

      // 🔥 生成ADaM Notes信息（具体域列表）
      const highDomains = summary?.highComplexityAdam?.domains || [];
      const mediumDomains = summary?.mediumComplexityAdam?.domains || [];
      const allAdamDomains = summary?.unique_adam_domains || [];
      
      const notes = {
        adamSpecsHigh: highDomains.join('/'),
        adamSpecsMedium: mediumDomains.join('/'),
        adamXptConversion: allAdamDomains.join('/'),
        adamTxtConversion: allAdamDomains.join('/')  // 新增：与xpt转换相同的域列表
      };

      const pced = study.CostEstimateDetails;
      const costEstimate = pced.adamTableInput || {};
      costEstimate['ADaM Datasets Production and Validation'] = { units, estimatedCosts, notes, subtotal };
      costEstimate.createdAt = new Date();
      pced.adamTableInput = costEstimate;
      
      console.log('💾 ADaM成本估算快照已生成并保存到adamTableInput');
    } catch (calcErr) {
      console.warn('⚠️ 确认后生成ADaM成本估算失败:', calcErr.message);
    }

    await study.save();

    console.log('ADaM分析结果已确认并保存');

    res.json({
      success: true,
      message: 'ADaM分析结果已确认并保存',
      data: {
        documentId: id,
        confirmedAt: study.CostEstimateDetails.userConfirmedAdam.confirmedAt,
        status: study.CostEstimateDetails.sdtmAnalysisStatus,
        costEstimate: study.CostEstimateDetails.adamTableInput || {}
      }
    });

  } catch (error) {
    console.error('确认ADaM分析结果错误:', error);
    res.status(500).json({
      success: false,
      message: '确认ADaM分析结果失败',
      error: error.message
    });
  }
}

// 🔥 新增：更新项目选择详细信息 (简化格式)
async function updateProjectSelection(req, res) {
  try {
    const { id } = req.params;
    const { projectSelectionDetails } = req.body;

    console.log(`更新Study ${id} 的项目选择详情`);

    const study = await Study.findById(id);
    if (!study) {
      return res.status(404).json({
        success: false,
        message: 'Study不存在'
      });
    }

    study.CostEstimateDetails = study.CostEstimateDetails || {};

    // 🔥 更新项目选择数据到新的 projectSelection 字段
    const selectedProjects = Object.keys(projectSelectionDetails).filter(
      project => {
        const value = projectSelectionDetails[project];
        // 包括有次数的项目(> 0)和无次数要求的项目(null)，排除lastUpdated字段
        return project !== 'lastUpdated' && (value === null || (typeof value === 'number' && value > 0));
      }
    );
    

    
    study.CostEstimateDetails.projectSelection = {
      success: selectedProjects.length > 0, // 判断用户是否完成了项目选择
      selectedProjects: selectedProjects,
      selectionDetails: {
        ...projectSelectionDetails,
        lastUpdated: new Date()
      },
      selectedAt: new Date()
    };
    
    // 🔥 设置状态为第1步完成：项目选择完成
    study.CostEstimateDetails.sdtmAnalysisStatus = 'project_selection_done';

    await study.save();

    console.log('项目选择详情已更新并保存');

    res.json({
      success: true,
      message: '项目选择详情已保存',
      data: {
        documentId: id,
        projectSelection: study.CostEstimateDetails.projectSelection, // 🔥 新字段
        projectSelectionDetails: study.CostEstimateDetails.projectSelection?.selectionDetails // 向后兼容
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

// 🔥 新增：标记任务开始（设置为进行中 false）
async function markTaskAsStarted(req, res) {
  try {
    const { id } = req.params;
    const { taskKey } = req.body;
    
    if (!taskKey || !['costEstimate', 'sasAnalysis'].includes(taskKey)) {
      return res.status(400).json({ success: false, message: 'Invalid taskKey, expected costEstimate or sasAnalysis' });
    }
    
    const study = await Study.findById(id);
    if (!study) {
      return res.status(404).json({ success: false, message: 'Study not found' });
    }
    
    study.projectDone = study.projectDone || {};
    
    if (taskKey === 'costEstimate') {
      study.projectDone.isCostEstimate = false;  // 设置为进行中
    } else if (taskKey === 'sasAnalysis') {
      study.projectDone.isSasAnalysis = false;   // 设置为进行中
    }
    
    await study.save();
    
    console.log(`✅ Task ${taskKey} marked as started for study ${id}`);
    res.json({ 
      success: true, 
      message: `Task ${taskKey} marked as started`, 
      data: { 
        documentId: id, 
        taskKey,
        status: 'started' 
      } 
    });
  } catch (error) {
    console.error('标记任务开始失败:', error);
    res.status(500).json({ success: false, message: '标记任务开始失败', error: error.message });
  }
}

// 🔥 新增：标记任务完成（通用）
async function markTaskAsDone(req, res) {
  try {
    const { id } = req.params;
    const { taskKey } = req.body;
    
    if (!taskKey || !['costEstimate', 'sasAnalysis'].includes(taskKey)) {
      return res.status(400).json({ success: false, message: 'Invalid taskKey, expected costEstimate or sasAnalysis' });
    }
    
    const study = await Study.findById(id);
    if (!study) {
      return res.status(404).json({ success: false, message: 'Study not found' });
    }
    
    study.projectDone = study.projectDone || {};
    
    if (taskKey === 'costEstimate') {
      study.projectDone.isCostEstimate = true;
    } else if (taskKey === 'sasAnalysis') {
      study.projectDone.isSasAnalysis = true;
    }
    
    await study.save();
    
    console.log(`✅ Task ${taskKey} marked as completed for study ${id}`);
    res.json({ 
      success: true, 
      message: `Task ${taskKey} marked as completed`, 
      data: { 
        documentId: id, 
        taskKey,
        status: 'completed' 
      } 
    });
  } catch (error) {
    console.error('标记任务完成失败:', error);
    res.status(500).json({ success: false, message: '标记任务完成失败', error: error.message });
  }
}

// 🔥 保持向后兼容：标记成本估算完成（Done）
async function markCostEstimateDone(req, res) {
  try {
    const { id } = req.params;
    const study = await Study.findById(id);
    if (!study) {
      return res.status(404).json({ success: false, message: '文档不存在' });
    }
    study.projectDone = study.projectDone || {};
    study.projectDone.isCostEstimate = true;
    await study.save();
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
    const study = await Study.findById(id).lean(false);
    if (!study) {
      return res.status(404).json({ success: false, message: 'Study 不存在' });
    }
    const assess = study.files?.protocol?.uploadExtraction?.assessmentSchedule || null;

    console.log('🎯 Start unified SDTM analysis for both Word and PDF...');
    
    // Step 1: Intelligently prepare procedures array
    let procedures = [];
    
    // Check if this is a PDF document with pre-extracted procedures
    if (study.CostEstimateDetails?.sdtmAnalysis?.procedures?.length > 0) {
      console.log('📄 PDF path: Using pre-extracted procedures from database...');
      procedures = study.CostEstimateDetails.sdtmAnalysis.procedures;
      console.log(`✅ Found ${procedures.length} pre-extracted procedures for PDF`);
    }
    // Otherwise, use Word HTML extraction flow
    else if (assess && assess.htmlContent) {
      console.log('📝 Word path: Extracting procedures from HTML Assessment Schedule...');
      const { extractProceduresFromSchedule } = require('../services/sdtmAnalysisService');
      procedures = extractProceduresFromSchedule(assess);
      console.log(`✅ Extracted ${procedures.length} procedures from Word HTML`);
    }
    else {
      return res.status(400).json({ 
        success: false, 
        message: '未找到有效的procedures来源（PDF预提取或Word HTML表格）' 
      });
    }

    // Validate procedures
    if (!procedures || procedures.length === 0) {
      return res.status(400).json({ 
        success: false, 
        message: '未能获取到有效的procedures进行分析' 
      });
    }

    // Step 2: Call unified AI analysis service (same for both Word and PDF)
    console.log(`🤖 Calling unified AI analysis with ${procedures.length} procedures...`);
    const mappingResult = await analyzeSDTMMapping(procedures);

    // Step 3: Merge results appropriately based on document type
    let sdtmAnalysis;
    if (study.CostEstimateDetails?.sdtmAnalysis?.procedures?.length > 0) {
      // PDF path: Keep existing procedures, only add mappings & summary
      console.log('📄 PDF: Preserving existing procedures, adding AI mappings & summary');
      sdtmAnalysis = {
        ...study.CostEstimateDetails.sdtmAnalysis, // Preserve existing procedures
        ...mappingResult, // Add new mappings and summary
        analyzedAt: new Date()
      };
    } else {
      // Word path: Include procedures from extraction
      console.log('📝 Word: Adding extracted procedures along with AI mappings & summary');
      sdtmAnalysis = {
        ...mappingResult,
        procedures: procedures, // Word needs procedures from extraction
        analyzedAt: new Date()
      };
    }

    // Save complete analysis results
    // 重新获取最新文档以避免版本冲突
    const latestStudy = await Study.findById(id);
    if (!latestStudy) {
      return res.status(404).json({ success: false, message: 'Study not found during save' });
    }
    
    latestStudy.CostEstimateDetails = latestStudy.CostEstimateDetails || {};
    latestStudy.CostEstimateDetails.sdtmAnalysis = sdtmAnalysis;

    // Generate cost estimation snapshot based on analysis results
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
      
      // Generate domain notes
      const highDomains = sdtmSummary?.highComplexitySdtm?.domains || [];
      const mediumDomains = sdtmSummary?.mediumComplexitySdtm?.domains || [];
      const allDomains = sdtmSummary?.unique_domains || [];
      
      const notes = {
        specsHigh: highDomains.join('/'),
        specsMedium: mediumDomains.join('/'),
        xptConversion: allDomains.join('/')
      };
      
      const pced = latestStudy.CostEstimateDetails;
      pced.sdtmTableInput = pced.sdtmTableInput || {};
      pced.sdtmTableInput['SDTM Datasets Production and Validation'] = { units, estimatedCosts, notes, subtotal };
      pced.sdtmTableInput.createdAt = new Date();
    } catch (e) { console.warn('Cost estimation generation failed:', e.message); }

    // Set analysis status to completed
    latestStudy.CostEstimateDetails.sdtmAnalysisStatus = 'sdtm_ai_analysis_done';

    await latestStudy.save();

    console.log('✅ Unified SDTM analysis completed for both Word and PDF');
    console.log(`📊 Analysis results: ${sdtmAnalysis.procedures?.length || 0} procedures, ${sdtmAnalysis.mappings?.size || 0} mappings`);
    res.json({ success: true, message: 'SDTM分析完成', data: { sdtmAnalysis } });
  } catch (error) {
    console.error('延迟执行SDTM分析失败:', error);
    res.status(500).json({ success: false, message: '分析失败', error: error.message });
  }
}

// ADaM分析处理函数
async function analyzeDocumentForAdam(req, res) {
  try {
    const { id } = req.params;
    const study = await Study.findById(id).lean(false);
    
    if (!study) {
      return res.status(404).json({ success: false, message: 'Study 不存在' });
    }

    console.log('🎯 开始ADaM分析，基于SDTM分析结果...');

    // 检查SDTM分析是否完成
    const sdtmAnalysis = study.CostEstimateDetails?.sdtmAnalysis;
    if (!sdtmAnalysis || !sdtmAnalysis.success) {
      return res.status(400).json({ 
        success: false, 
        message: '必须先完成SDTM分析才能进行ADaM分析' 
      });
    }

    console.log('✅ SDTM分析结果验证通过，开始ADaM分析...');

    // 调用ADaM分析服务
    const adamResult = await performADaMAnalysis(sdtmAnalysis);
    
    console.log('🔍 [DEBUG] ADaM分析结果:', {
      success: adamResult.success,
      mappingsCount: adamResult.mappings?.size || 0,
      totalDomains: adamResult.summary?.total_adam_domains || 0
    });

    // 保存ADaM分析结果到数据库
    const latestStudy = await Study.findById(id);
    latestStudy.CostEstimateDetails = latestStudy.CostEstimateDetails || {};
    latestStudy.CostEstimateDetails.adamAnalysis = adamResult;

    // 如果ADaM分析成功，更新状态并生成成本估算快照
    if (adamResult.success) {
      latestStudy.CostEstimateDetails.sdtmAnalysisStatus = 'adam_ai_analysis_done';
      
      // 🔥 新增：生成并保存ADaM成本估算快照
      try {
        const adamSummary = adamResult.summary || {};
        const highCount = Number(adamSummary?.highComplexityAdam?.count || 0);
        const mediumCount = Number(adamSummary?.mediumComplexityAdam?.count || 0);
        const totalAdamDomains = Number(adamSummary?.total_adam_domains || 0);

        const rates = { costPerHour: 1 };
        const hoursPerUnit = {
          // ADaM任务的时间单位（基于项目需求调整）
          adamSpecsHigh: 4,           // ADaM Dataset Specs (High Complexity)
          adamSpecsMedium: 3,         // ADaM Dataset Specs (Medium Complexity)  
          adamProdHigh: 20,           // ADaM Production and Validation: Programs and Datasets (High Complexity)
          adamProdMedium: 12,         // ADaM Production and Validation: Programs and Datasets (Medium Complexity)
          adamPinnacle21: 8,          // ADaM Pinnacle 21 Report Creation and Review
          adamReviewersGuide: 40,     // ADaM Reviewer's Guide
          adamDefineXml: 40,          // ADaM Define.xml
          adamXptConversion: 0.3,     // ADaM Dataset Program xpt Conversion and Review
          adamTxtConversion: 0.2      // ADaM Program txt Conversion and Review (新增)
        };

        const units = {
          adamSpecsHigh: highCount,
          adamSpecsMedium: mediumCount,
          adamProdHigh: highCount,
          adamProdMedium: mediumCount,
          adamPinnacle21: 2,
          adamReviewersGuide: 1,
          adamDefineXml: 1,
          adamXptConversion: totalAdamDomains,
          adamTxtConversion: totalAdamDomains  // 新增：与xpt转换相同的数量
        };

        const estimatedCosts = {};
        Object.keys(units).forEach(key => {
          const unit = Number(units[key] || 0);
          const cpu = rates.costPerHour * Number(hoursPerUnit[key] || 0);
          estimatedCosts[key] = Number((unit * cpu).toFixed(2));
        });

        const subtotal = Object.values(estimatedCosts).reduce((acc, v) => acc + Number(v || 0), 0);

        // 🔥 生成ADaM Notes信息（具体域列表）
        const highDomains = adamSummary?.highComplexityAdam?.domains || [];
        const mediumDomains = adamSummary?.mediumComplexityAdam?.domains || [];
        const allAdamDomains = adamSummary?.unique_adam_domains || [];
        
        const notes = {
          adamSpecsHigh: highDomains.join('/'),
          adamSpecsMedium: mediumDomains.join('/'),
          adamXptConversion: allAdamDomains.join('/'),
          adamTxtConversion: allAdamDomains.join('/')  // 新增：与xpt转换相同的域列表
        };

        const pced = latestStudy.CostEstimateDetails;
        pced.adamTableInput = pced.adamTableInput || {};
        pced.adamTableInput['ADaM Datasets Production and Validation'] = { units, estimatedCosts, notes, subtotal };
        pced.adamTableInput.createdAt = new Date();
        console.log('💾 已生成并保存ADaM成本估算快照到adamTableInput');

      } catch (costErr) {
        console.warn('⚠️ 生成ADaM成本估算快照失败:', costErr.message);
      }
      
      console.log('✅ ADaM分析状态已更新为: adam_ai_analysis_done');
    }

    await latestStudy.save();

    console.log('✅ ADaM分析完成并保存到数据库');
    console.log(`📊 ADaM分析结果: ${adamResult.mappings?.size || 0} 个映射, ${adamResult.summary?.unique_adam_domains?.length || 0} 个ADaM域`);

    res.json({ 
      success: true, 
      message: 'ADaM分析完成', 
      data: { adamAnalysis: adamResult } 
    });

  } catch (error) {
    console.error('❌ ADaM分析失败:', error);
    res.status(500).json({ 
      success: false, 
      message: 'ADaM分析失败', 
      error: error.message 
    });
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

    const study = await Study.findById(id);
    if (!study) {
      return res.status(404).json({
        success: false,
        message: 'Study not found'
      });
    }

    // 更新Unit数据到数据库
    if (!study.CostEstimateDetails) study.CostEstimateDetails = {};
    if (!study.CostEstimateDetails.sdtmTableInput) study.CostEstimateDetails.sdtmTableInput = {};
    if (!study.CostEstimateDetails.sdtmTableInput.units) study.CostEstimateDetails.sdtmTableInput.units = {};

    // 合并新的Unit数据（可更新）
    Object.assign(study.CostEstimateDetails.sdtmTableInput.units, units);

    // 🔥 同步更新 SDTM Datasets Production and Validation 部分
    const sdtmSection = study.CostEstimateDetails.sdtmTableInput['SDTM Datasets Production and Validation'];
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
    await study.save();

    console.log(`✅ 已更新Study ${id} 的Units:`, units);

    res.json({
      success: true,
      message: 'Units updated successfully',
      data: {
        units: study.CostEstimateDetails.sdtmTableInput.units
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
    
    console.log('🗑️ 删除Study请求:', id);
    
    const deletedStudy = await Study.findByIdAndDelete(id);
    
    if (!deletedStudy) {
      return res.status(404).json({ 
        success: false, 
        message: 'Study not found' 
      });
    }
    
    console.log('✅ Study删除成功:', {
      id: deletedStudy._id,
      studyNumber: deletedStudy.studyNumber
    });
    
    res.json({ 
      success: true, 
      message: 'Study deleted successfully',
      data: {
        deletedDocumentId: deletedStudy._id,
        studyNumber: deletedStudy.studyNumber
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

// 新增：为现有Study上传额外文件（CRF/SAP），仅记录元数据，不解析
async function uploadAdditionalFile(req, res) {
  try {
    const { id } = req.params; // Study ID
    const { fileType } = req.body; // 'crf' | 'sap'

    if (!req.file) {
      return res.status(400).json({ success: false, message: 'No file uploaded' });
    }
    if (!fileType || !['crf', 'sap'].includes(String(fileType).toLowerCase())) {
      return res.status(400).json({ success: false, message: 'Invalid fileType, expected crf or sap' });
    }

    const study = await Study.findById(id);
    if (!study) {
      return res.status(404).json({ success: false, message: 'Study not found' });
    }

    const slotKey = String(fileType).toLowerCase();
    study.files = study.files || {};
    study.files[slotKey] = study.files[slotKey] || {};
    
    // 仅保存元数据，不进行解析
    study.files[slotKey].uploaded = true;
    study.files[slotKey].originalName = req.file.originalname;
    study.files[slotKey].fileSize = req.file.size;
    study.files[slotKey].mimeType = req.file.mimetype;
    study.files[slotKey].uploadedAt = new Date();
    // 不解析时，保留现有的 uploadExtraction，不强制写入

    await study.save();

    return res.json({
      success: true,
      message: `Uploaded ${slotKey.toUpperCase()} successfully`,
      data: {
        studyId: String(study._id),
        fileType: slotKey,
        originalName: req.file.originalname,
        fileSize: req.file.size,
        uploadedAt: study.files[slotKey].uploadedAt
      }
    });
  } catch (error) {
    console.error('uploadAdditionalFile error:', error);
    return res.status(500).json({ success: false, message: 'Upload additional file failed', error: error.message });
  }
}

module.exports = {
  uploadDocument,
  getDocuments,
  listIncompleteEstimates,
  getDocumentContent,
  getStudyDocuments,
  confirmSDTMAnalysis,
  confirmADaMAnalysis,
  updateProjectSelection,
  markTaskAsStarted,
  markTaskAsDone,
  markCostEstimateDone,
  analyzeDocumentForSdtm,
  analyzeDocumentForAdam,
  updateUnits,
  deleteDocument,
  uploadAdditionalFile
}; 