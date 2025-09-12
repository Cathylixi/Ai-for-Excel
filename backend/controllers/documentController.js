// Legacy Document model kept for backward compatibility (not used after migration)
const Document = require('../models/documentModel');
const Study = require('../models/studyModel');
// =========================
// In-memory CRF annotation progress (per study)
// =========================
const annotationProgressMap = new Map(); // key: studyId, value: progress object

function getDefaultProgress(totalForms = 0, totalBatches = 0) {
  return {
    overall: { totalForms, processedForms: 0, percentage: 0 },
    gptAnalysis: { totalForms, processedForms: 0, percentage: 0, status: 'pending' },
    pdfDrawing: { totalBatches, processedBatches: 0, percentage: 0, status: 'pending' },
    currentPhase: 'gpt',
    updatedAt: Date.now()
  };
}

function clampPercentage(value) {
  if (typeof value !== 'number' || Number.isNaN(value)) return 0;
  return Math.max(0, Math.min(100, Math.round(value)));
}

function updateAnnotationProgress(studyId, patch) {
  const current = annotationProgressMap.get(studyId) || getDefaultProgress();
  const updated = { ...current };

  if (patch.overall) {
    updated.overall = { ...updated.overall, ...patch.overall };
    if (typeof updated.overall.percentage === 'number') {
      updated.overall.percentage = clampPercentage(updated.overall.percentage);
    }
  }
  if (patch.gptAnalysis) {
    updated.gptAnalysis = { ...updated.gptAnalysis, ...patch.gptAnalysis };
    if (typeof updated.gptAnalysis.percentage === 'number') {
      updated.gptAnalysis.percentage = clampPercentage(updated.gptAnalysis.percentage);
    }
  }
  if (patch.pdfDrawing) {
    updated.pdfDrawing = { ...updated.pdfDrawing, ...patch.pdfDrawing };
    if (typeof updated.pdfDrawing.percentage === 'number') {
      updated.pdfDrawing.percentage = clampPercentage(updated.pdfDrawing.percentage);
    }
  }
  if (patch.currentPhase) {
    updated.currentPhase = patch.currentPhase;
  }

  updated.updatedAt = Date.now();
  annotationProgressMap.set(studyId, updated);
  return updated;
}

function inferProgressFromExistingData(study) {
  const crfData = study?.files?.crf;
  const crfFormList = crfData?.crfUploadResult?.crfFormList || {};
  const totalForms = Object.keys(crfFormList).length;
  const totalBatches = totalForms > 0 ? Math.ceil(totalForms / 5) : 0;

  if (crfData?.annotationReady) {
    return {
      overall: { totalForms, processedForms: totalForms, percentage: 100 },
      gptAnalysis: { totalForms, processedForms: totalForms, percentage: 100, status: 'completed' },
      pdfDrawing: { totalBatches, processedBatches: totalBatches, percentage: 100, status: 'completed' },
      currentPhase: 'completed',
      updatedAt: Date.now()
    };
  }

  // 估算：如果Mapping存在则认为GPT阶段完成
  const hasAnyGptData = Object.values(crfFormList).some(form => Array.isArray(form?.Mapping) && form.Mapping.some(m => Array.isArray(m?.sdtm_mappings) || typeof m?.sdtm_dataset_ai_result === 'string'));
  if (hasAnyGptData) {
    return {
      overall: { totalForms, processedForms: totalForms, percentage: totalForms ? 100 : 0 },
      gptAnalysis: { totalForms, processedForms: totalForms, percentage: totalForms ? 100 : 0, status: 'completed' },
      pdfDrawing: { totalBatches, processedBatches: 0, percentage: 0, status: 'running' },
      currentPhase: 'pdf',
      updatedAt: Date.now()
    };
  }

  return {
    overall: { totalForms, processedForms: 0, percentage: 0 },
    gptAnalysis: { totalForms, processedForms: 0, percentage: 0, status: 'pending' },
    pdfDrawing: { totalBatches, processedBatches: 0, percentage: 0, status: 'pending' },
    currentPhase: 'gpt',
    updatedAt: Date.now()
  };
}

async function getCrfAnnotationProgress(req, res) {
  try {
    const { studyId } = req.params;
    if (!studyId) return res.status(400).json({ success: false, message: 'Missing studyId' });

    let progress = annotationProgressMap.get(studyId);
    if (!progress) {
      const study = await Study.findById(studyId).select('files.crf');
      progress = inferProgressFromExistingData(study);
    }
    res.json({ success: true, data: progress });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Failed to get progress', error: err.message });
  }
}

async function resetCrfProgress(req, res) {
  try {
    const { studyId } = req.params;
    if (!studyId) return res.status(400).json({ success: false, message: 'Missing studyId' });
    annotationProgressMap.delete(studyId);
    res.json({ success: true, message: 'Progress reset' });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Failed to reset progress', error: err.message });
  }
}
const { parseWordDocumentStructure } = require('../services/wordParserService');
const { processPdfWithPypdf, formatResultForDatabase, formatResultForCrfSap, pypdfService, extractCrfPositions, extractCrfWordsOnly } = require('../services/pypdfService');
const { processWordsToRows } = require('../services/crf_analysis/words_to_rows_processor');
const { processCrfForms } = require('../services/crf_analysis/crf_form_processor');
const { analyzeSDTMMapping } = require('../services/sdtmAnalysisService');
const { performADaMAnalysis, generateOutputsFromDomains } = require('../services/adamAnalysisService');


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
      // 🔥 检查文件类型，CRF/SAP使用专用解析逻辑
      const isProtocol = !fileType || fileType.toLowerCase() === 'protocol';
      
                if (req.file.mimetype === 'application/pdf') {
        console.log('📄 Starting PDF processing...');
            const pypdfResult = await processPdfWithPypdf(req.file.buffer);
        
        if (isProtocol) {
          // Protocol使用完整解析（包含AI）
            parseResult = await formatResultForDatabase(pypdfResult);
          console.log(`✅ Protocol PDF processing completed - Pages: ${pypdfResult.total_pages}, Text length: ${parseResult.extractedText.length}`);
        } else {
          // CRF/SAP使用专用解析（跳过AI）
          parseResult = await formatResultForCrfSap(pypdfResult);
          console.log(`✅ ${fileType.toUpperCase()} PDF processing completed (no AI) - Pages: ${pypdfResult.total_pages}, Text length: ${parseResult.extractedText.length}`);
        }
                    
      } else if (req.file.mimetype === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document') {
        console.log('📝 Starting Word document processing...');
        
        if (isProtocol) {
          // Protocol使用完整解析（包含AI）
        parseResult = await parseWordDocumentStructure(req.file.buffer);
          console.log(`✅ Protocol Word解析完成 - 章节: ${parseResult.parseInfo.sectionsCount}, 表格: ${parseResult.parseInfo.tablesCount}`);
        } else {
          // CRF/SAP使用专用解析（跳过AI）
          parseResult = await parseWordDocumentStructure(req.file.buffer, { skipAssessmentSchedule: true });
          console.log(`✅ ${fileType.toUpperCase()} Word解析完成 (no AI) - 章节: ${parseResult.parseInfo.sectionsCount}, 表格: ${parseResult.parseInfo.tablesCount}`);
        }
        
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
      assessmentSchedule: parseResult.assessmentSchedule,
      // 仅在Protocol时保存 endpoints
      endpoints: slotKey === 'protocol' ? (parseResult.endpoints || []) : undefined
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
          assessmentSchedule: ex.assessmentSchedule || null,
          endpoints: Array.isArray(ex.endpoints) ? ex.endpoints : []
          // Note: internalLinks removed in simplified PDF version
        },
        
        // 🔥 新增：可追溯性数据
        traceability: study.traceability || {}
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

// 🔥 新增：获取CRF数据（包含LabelForm/OIDForm）
async function getCrfData(req, res) {
  try {
    const { studyId } = req.params;
    
    let study = null;
    if (studyId && studyId.match(/^[0-9a-fA-F]{24}$/)) {
      study = await Study.findById(studyId).lean();
    }
    if (!study) {
      study = await Study.findOne({ studyNumber: studyId }).lean();
    }

    if (!study) {
      return res.status(404).json({
        success: false,
        message: 'Study 不存在'
      });
    }

    const crfData = study.files?.crf || {};
    if (!crfData.uploaded) {
      return res.status(404).json({
        success: false,
        message: 'CRF 文件尚未上传'
      });
    }

    return res.json({
      success: true,
      message: '获取CRF数据成功',
      data: {
        studyId: String(study._id),
        studyNumber: study.studyNumber,
        fileInfo: {
          originalName: crfData.originalName,
          fileSize: crfData.fileSize,
          uploadedAt: crfData.uploadedAt
        },
        crfUploadResult: crfData.crfUploadResult || {}
      }
    });

  } catch (error) {
    console.error('❌ Error getting CRF data:', error);
    return res.status(500).json({ 
      success: false, 
      message: 'Failed to get CRF data', 
      error: error.message 
    });
  }
}

// 🔥 新增：获取Study的文档槽位状态（供前端列出CRF/SAP）
async function getStudyDocuments(req, res) {
  try {
    const { studyIdentifier } = req.params;
    // 允许传入 studyNumber 或 _id，两者择一
    // 🔥 优化：只选择必要字段，避免加载巨大的crfUploadResult
    const selectFields = 'studyNumber files.protocol files.crf.uploaded files.crf.originalName files.crf.fileSize files.crf.uploadedAt files.sap';
    
    let study = null;
    if (studyIdentifier && studyIdentifier.match(/^[0-9a-fA-F]{24}$/)) {
      study = await Study.findById(studyIdentifier).select(selectFields).lean();
    }
    if (!study) {
      study = await Study.findOne({ studyNumber: studyIdentifier }).select(selectFields).lean();
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

    // 转换mappings为 Map<ADaM, [SDTM]> 存储格式
    const simplifiedMappings = new Map();
    if (mappings && typeof mappings === 'object') {
      if (mappings instanceof Map) {
        for (const [adam, sdtmList] of mappings) {
          const list = Array.isArray(sdtmList) ? sdtmList : String(sdtmList || '').split(',').map(s => s.trim()).filter(Boolean);
          simplifiedMappings.set(String(adam), list);
        }
      } else if (Array.isArray(mappings)) {
        mappings.forEach(item => {
          const adam = String(item.adam || item.adam_domain || item.name || item.key || '').trim();
          const sdtmList = Array.isArray(item.sdtm_domains) ? item.sdtm_domains : String(item.sdtm_domains || '').split(',').map(s => s.trim()).filter(Boolean);
          if (adam) simplifiedMappings.set(adam, sdtmList);
        });
      } else {
        Object.entries(mappings).forEach(([adam, sdtmList]) => {
          const list = Array.isArray(sdtmList) ? sdtmList : String(sdtmList || '').split(',').map(s => s.trim()).filter(Boolean);
          simplifiedMappings.set(String(adam), list);
        });
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
      // console.log(`✅ Found ${procedures.length} pre-extracted procedures for PDF`);
    }
    // Otherwise, use Word HTML extraction flow
    else if (assess && assess.htmlContent) {
      console.log('📝 Word path: Extracting procedures from HTML Assessment Schedule...');
      const { extractProceduresFromSchedule } = require('../services/sdtmAnalysisService');
      procedures = extractProceduresFromSchedule(assess);
      // console.log(`✅ Extracted ${procedures.length} procedures from Word HTML`);
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
      // console.log('📄 PDF: Preserving existing procedures, adding AI mappings & summary');
      sdtmAnalysis = {
        ...study.CostEstimateDetails.sdtmAnalysis, // Preserve existing procedures
        ...mappingResult, // Add new mappings and summary
        analyzedAt: new Date()
      };
    } else {
      // Word path: Include procedures from extraction
      // console.log('📝 Word: Adding extracted procedures along with AI mappings & summary');
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

    console.log('✅ Unified SDTM analysis completed');
    // console.log(`📊 Analysis results: ${sdtmAnalysis.procedures?.length || 0} procedures, ${sdtmAnalysis.mappings?.size || 0} mappings`);
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

    // 🔥 新增：提取protocol endpoints信息
    const protocolEndpoints = study.files?.protocol?.uploadExtraction?.endpoints || [];
    console.log(`📋 已载入协议Endpoints用于ADaM分析: ${protocolEndpoints.length} 项`);

    // 调用ADaM分析服务
    const adamResult = await performADaMAnalysis(sdtmAnalysis, protocolEndpoints);
    
    // console.log('🔍 [DEBUG] ADaM分析结果:', { success: adamResult.success, mappingsCount: adamResult.mappings?.size || 0, totalDomains: adamResult.summary?.total_adam_domains || 0 });

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
    // console.log(`📊 ADaM分析结果: ${adamResult.mappings?.size || 0} 个映射, ${adamResult.summary?.unique_adam_domains?.length || 0} 个ADaM域`);

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

// 🔥 新增：为现有Study上传CRF文件，解析并存储 extractedText/sectionedText/tables（跳过 assessmentSchedule）
async function uploadCrfFile(req, res) {
  try {
    const { id } = req.params; // Study ID

    if (!req.file) {
      return res.status(400).json({ success: false, message: 'No CRF file uploaded' });
    }

    const study = await Study.findById(id);
    if (!study) {
      return res.status(404).json({ success: false, message: 'Study not found' });
    }

    study.files = study.files || {};
    study.files.crf = study.files.crf || {};

    // 🔥 Step 1: 持久化原始PDF（仅在本次请求有文件时执行）
    try {
      if (req.file && req.file.mimetype === 'application/pdf') {
        const { CRF_TMP_DIR } = require('../config/crfConfig');
        const fs = require('fs');
        const path = require('path');
        const filename = `crf_${id}_${Date.now()}.pdf`;
        const fullPath = path.join(CRF_TMP_DIR, filename);
        await fs.promises.writeFile(fullPath, req.file.buffer);

        study.files.crf.sourcePath = fullPath;
        study.files.crf.originalName = req.file.originalname;
        study.files.crf.fileSize = req.file.size;
        study.files.crf.mimeType = req.file.mimetype;
        study.files.crf.uploaded = true;
        study.files.crf.uploadedAt = new Date();

        await study.save();
        // console.log('💾 已持久化CRF原始PDF到: ', fullPath);
      }
    } catch (persistErr) {
      console.warn('⚠️ 持久化原PDF失败（继续解析流程）:', persistErr.message);
    }

    // 默认解析结果（当解析失败时使用降级结构）
    let crfParseResult = {
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

    // 解析CRF文件内容（PDF/Word），不进行 assessmentSchedule 识别
    // 🔥 新增：初始化词和行位置变量（在外部作用域）
    let wordsWithPosition = {};
    let rowsWithPosition = {};
    let identifiedPatterns = {};
    
    try {
      if (req.file.mimetype === 'application/pdf') {
        // console.log('📄 开始解析CRF PDF文件...');
        const pypdfResult = await processPdfWithPypdf(req.file.buffer);
        crfParseResult = await formatResultForCrfSap(pypdfResult); // 🔥 使用CRF专用解析
        
        // 🔥 新增：提取CRF PDF的词位置信息（简化版）
        try {
          // console.log('🔍 开始提取CRF词位置信息...');
          const wordsResult = await extractCrfWordsOnly(req.file.buffer, id);
          // console.log(`✅ CRF词位置提取完成`);
          // console.log(`📊 CRF统计: ${wordsResult.metadata?.total_words || 0} 词, ${wordsResult.metadata?.total_pages || 0} 页`);
          
          // 保存词位置结果
          if (wordsResult.success) {
            wordsWithPosition = wordsResult;
            
            // 🔥 新增：将词位置转换为行位置
            try {
              // console.log('🔄 开始将词位置转换为行位置...');
              const rowsResult = processWordsToRows(wordsResult, 3.5); // 使用3.5pt的Y坐标容差
              // console.log(`✅ 行位置转换完成: ${rowsResult.metadata?.total_rows || 0} 行, ${rowsResult.metadata?.total_words || 0} 词`);
              
              if (rowsResult.success) {
                rowsWithPosition = rowsResult;

                // 🔍 新增：基于前10页行文本调用AI识别页眉/页脚/页码/Form名称pattern
                try {
                  const firstPages = (rowsResult.pages || []).slice(0, 10).map(p => ({
                    page_number: p.page_number,
                    rows: (p.rows || []).map(r => ({ row_index: r.row_index, full_text: r.full_text }))
                  }));
                  // 只有存在OPENAI_API_KEY时才调用，避免阻塞上传
                  if (process.env.OPENAI_API_KEY && firstPages.length > 0) {
                    const { identifyCrfHeaderFooterAndFormPatterns } = require('../services/openaiService');
                    const aiPatterns = await identifyCrfHeaderFooterAndFormPatterns(firstPages);
                    if (aiPatterns && aiPatterns.success) {
                      identifiedPatterns = aiPatterns;
                      
                      // 🔥 新增：基于AI patterns和行数据提取完整的Form信息
                      try {
                        // console.log('🎯 开始基于AI patterns处理CRF Forms...');
                        const formData = processCrfForms(rowsResult, identifiedPatterns);
                        
                        // 更新crfFormList和crfFormName（不再为空）
                        if (formData && formData.crfFormList) {
                          // console.log(`✅ 成功处理${formData.crfFormName.total_forms}个CRF Forms`);
                          
                          // 将处理结果存储到变量中，稍后保存到数据库
                          global.processedCrfFormList = formData.crfFormList;
                          global.processedCrfFormName = formData.crfFormName;
                        }
                      } catch (formErr) {
                        console.warn('⚠️ CRF Form处理失败（已忽略）:', formErr.message);
                        global.processedCrfFormList = {};
                        global.processedCrfFormName = { names: [], total_forms: 0 };
                      }
                    } else {
                      identifiedPatterns = { success: false, header_patterns: [], footer_patterns: [], page_number_patterns: [], form_name_patterns: [] };
                      global.processedCrfFormList = {};
                      global.processedCrfFormName = { names: [], total_forms: 0 };
                    }
                  } else {
                    if (!process.env.OPENAI_API_KEY) console.warn('⚠️ OPENAI_API_KEY 未设置，跳过AI pattern识别');
                    global.processedCrfFormList = {};
                    global.processedCrfFormName = { names: [], total_forms: 0 };
                  }
                } catch (aiErr) {
                  console.warn('⚠️ AI识别页眉/页脚/Form名称pattern失败（已忽略）:', aiErr.message);
                  global.processedCrfFormList = {};
                  global.processedCrfFormName = { names: [], total_forms: 0 };
                }
              }
            } catch (rowsErr) {
              console.warn('⚠️ 词到行转换失败，但不影响上传:', rowsErr.message);
            }
          }
        } catch (wordsErr) {
          console.warn('⚠️ CRF词位置提取失败，但不影响正常上传:', wordsErr.message);
          // 词位置提取失败不影响正常的文件上传流程
        }
        
      } else if (req.file.mimetype === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document') {
        // console.log('📝 开始解析CRF Word文档...');
        crfParseResult = await parseWordDocumentStructure(req.file.buffer, { skipAssessmentSchedule: true }); // 🔥 CRF跳过AI
      } else if (req.file.mimetype === 'application/msword') {
        crfParseResult.extractedText = req.file.buffer.toString('utf8');
        crfParseResult.parseInfo.parseMethod = 'doc-simple';
      }

      // 适配CRF：去除 assessmentSchedule 字段及相关标记
      if (crfParseResult) {
        const crfAdapted = {
          extractedText: crfParseResult.extractedText || '',
          sectionedText: Array.isArray(crfParseResult.sectionedText) ? crfParseResult.sectionedText : [],
          tables: Array.isArray(crfParseResult.tables) ? crfParseResult.tables : [],
          // CRF显式不保存 assessmentSchedule
          assessmentSchedule: null,
          parseInfo: {
            ...(crfParseResult.parseInfo || {}),
            hasAssessmentSchedule: false
          }
        };
        crfParseResult = crfAdapted;
      }

      console.log(`✅ CRF解析完成 - 章节: ${crfParseResult.parseInfo.sectionsCount}, 表格: ${crfParseResult.parseInfo.tablesCount}`);
    } catch (parseErr) {
      console.warn('⚠️ CRF文档解析失败，将以基础元数据保存:', parseErr.message);
      // 保持 crfParseResult 为默认值，继续正常上传
    }

    // 使用原子$set更新，避免并发保存互相覆盖
    const crfUploadedAt = new Date();
    const updatedStudy = await Study.findByIdAndUpdate(
      id,
      {
        $set: {
          'files.crf.uploaded': true,
          'files.crf.originalName': req.file.originalname,
          'files.crf.fileSize': req.file.size,
          'files.crf.mimeType': req.file.mimetype,
          'files.crf.uploadedAt': crfUploadedAt,
          // 🔥 **修复**: 确保包含sourcePath字段
          'files.crf.sourcePath': study.files.crf.sourcePath,
          'files.crf.crfUploadResult': {
            crfFormList: global.processedCrfFormList || {},
            crfFormName: global.processedCrfFormName || { names: [], total_forms: 0 },
            Extract_words_with_position: wordsWithPosition,
            Extract_rows_with_position: rowsWithPosition,
            identified_patterns: identifiedPatterns
          }
        }
      },
      { new: true }
    );

    // 🎨 **移除自动注解**: CRF上传后不自动生成注解，等待用户手动触发
    console.log('✅ CRF上传完成，注解生成将等待用户手动触发');
    // 注解生成现在通过 /generate-crf-annotation-rects API 手动触发

    return res.json({
      success: true,
      message: 'Uploaded CRF successfully',
      data: {
        studyId: String(study._id),
        fileType: 'crf',
        originalName: req.file.originalname,
        fileSize: req.file.size,
        uploadedAt: crfUploadedAt,
        crfUploadResult: {
          crfFormList: global.processedCrfFormList || {},
          crfFormName: global.processedCrfFormName || { names: [], total_forms: 0 },
          Extract_words_with_position: wordsWithPosition,
          Extract_rows_with_position: rowsWithPosition,
          identified_patterns: identifiedPatterns
        }
      }
    });
  } catch (error) {
    console.error('uploadCrfFile error:', error);
    return res.status(500).json({ success: false, message: 'Upload CRF file failed', error: error.message });
  } finally {
    // 清理临时全局变量
    delete global.processedCrfFormList;
    delete global.processedCrfFormName;
  }
}

// 🔥 新增：为现有Study上传SAP文件，解析并存储 extractedText/sectionedText/tables（跳过 assessmentSchedule）
async function uploadSapFile(req, res) {
  try {
    const { id } = req.params; // Study ID

    if (!req.file) {
      return res.status(400).json({ success: false, message: 'No SAP file uploaded' });
    }

    const study = await Study.findById(id);
    if (!study) {
      return res.status(404).json({ success: false, message: 'Study not found' });
    }

    study.files = study.files || {};
    study.files.sap = study.files.sap || {};

    // 默认解析结果（当解析失败时使用降级结构）
    let sapParseResult = {
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

    // 解析SAP文件内容（PDF/Word），不进行 assessmentSchedule 识别
    try {
      if (req.file.mimetype === 'application/pdf') {
        console.log('📄 开始解析SAP PDF文件...');
        const pypdfResult = await processPdfWithPypdf(req.file.buffer);
        sapParseResult = await formatResultForCrfSap(pypdfResult); // 🔥 使用SAP专用解析
      } else if (req.file.mimetype === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document') {
        console.log('📝 开始解析SAP Word文档...');
        sapParseResult = await parseWordDocumentStructure(req.file.buffer, { skipAssessmentSchedule: true }); // 🔥 SAP跳过AI
      } else if (req.file.mimetype === 'application/msword') {
        sapParseResult.extractedText = req.file.buffer.toString('utf8');
        sapParseResult.parseInfo.parseMethod = 'doc-simple';
      }

      // 适配SAP：去除 assessmentSchedule 字段及相关标记
      if (sapParseResult) {
        const sapAdapted = {
          extractedText: sapParseResult.extractedText || '',
          sectionedText: Array.isArray(sapParseResult.sectionedText) ? sapParseResult.sectionedText : [],
          tables: Array.isArray(sapParseResult.tables) ? sapParseResult.tables : [],
          // SAP显式不保存 assessmentSchedule
          assessmentSchedule: null,
          parseInfo: {
            ...(sapParseResult.parseInfo || {}),
            hasAssessmentSchedule: false
          }
        };
        sapParseResult = sapAdapted;
      }

      console.log(`✅ SAP解析完成 - 章节: ${sapParseResult.parseInfo.sectionsCount}, 表格: ${sapParseResult.parseInfo.tablesCount}`);
    } catch (parseErr) {
      console.warn('⚠️ SAP文档解析失败，将以基础元数据保存:', parseErr.message);
      // 保持 sapParseResult 为默认值，继续正常上传
    }

    // 使用原子$set更新，避免并发保存互相覆盖
    const sapUploadedAt = new Date();
    await Study.findByIdAndUpdate(
      id,
      {
        $set: {
          'files.sap.uploaded': true,
          'files.sap.originalName': req.file.originalname,
          'files.sap.fileSize': req.file.size,
          'files.sap.mimeType': req.file.mimetype,
          'files.sap.uploadedAt': sapUploadedAt,
          'files.sap.uploadExtraction': {
            extractedText: sapParseResult.extractedText,
            sectionedText: sapParseResult.sectionedText,
            tables: sapParseResult.tables,
            assessmentSchedule: null
          }
        }
      },
      { new: true }
    );

    return res.json({
      success: true,
      message: 'Uploaded SAP successfully',
      data: {
        studyId: String(study._id),
        fileType: 'sap',
        originalName: req.file.originalname,
        fileSize: req.file.size,
        uploadedAt: sapUploadedAt,
        parseInfo: sapParseResult.parseInfo || {
          hasStructuredContent: false,
          sectionsCount: 0,
          tablesCount: 0,
          parseMethod: 'raw-text',
          hasAssessmentSchedule: false
        }
      }
    });
  } catch (error) {
    console.error('uploadSapFile error:', error);
    return res.status(500).json({ success: false, message: 'Upload SAP file failed', error: error.message });
  }
}

// 🔥 保留向后兼容：通用额外文件上传（委托给专门函数）
async function uploadAdditionalFile(req, res) {
  const { fileType } = req.body;
  
  if (!fileType) {
    return res.status(400).json({ success: false, message: 'fileType is required' });
  }
  
  const lowerFileType = String(fileType).toLowerCase();
  
  if (lowerFileType === 'crf') {
    return uploadCrfFile(req, res);
  } else if (lowerFileType === 'sap') {
    return uploadSapFile(req, res);
  } else {
    return res.status(400).json({ success: false, message: 'Invalid fileType, expected crf or sap' });
  }
}

// 🔥 新增：根据确认的ADaM域生成TFL(Tables, Figures, Listings)清单并存储在traceability中
async function generateAdamToOutputTraceability(req, res) {
  try {
    const { id } = req.params; // Study ID
    
    console.log('🎯 开始生成ADaM到输出的可追溯性数据...');
    
    // 1. 获取Study并提取已确认的ADaM域
    const study = await Study.findById(id);
    if (!study) {
      return res.status(404).json({
        success: false,
        message: 'Study not found'
      });
    }
    
    // 🔥 调试：检查完整的数据路径
    console.log('🔍 [DEBUG] CostEstimateDetails:', study.CostEstimateDetails);
    console.log('🔍 [DEBUG] userConfirmedAdam:', study.CostEstimateDetails?.userConfirmedAdam);
    console.log('🔍 [DEBUG] userConfirmedAdam.summary:', study.CostEstimateDetails?.userConfirmedAdam?.summary);
    
    const adamDomains = study.CostEstimateDetails?.userConfirmedAdam?.summary?.unique_adam_domains;
    console.log('🔍 [DEBUG] 提取到的adamDomains:', adamDomains);
    
    if (!adamDomains || adamDomains.length === 0) {
      console.error('❌ 没有找到确认的ADaM域数据');
      return res.status(400).json({
        success: false,
        message: 'No confirmed ADaM domains found. Please complete ADaM analysis first.'
      });
    }
    
    console.log(`📊 找到 ${adamDomains.length} 个已确认的ADaM域:`, adamDomains);
    
    // 🔥 新增：提取protocol endpoints信息
    const protocolEndpoints = study.files?.protocol?.uploadExtraction?.endpoints || [];
    console.log(`📋 已载入协议Endpoints: ${protocolEndpoints.length} 项`);
    
    // 🔥 阶段1：初始化TFL生成状态为 success: false
    const initializePayload = {
      'traceability.TFL_generation_adam_to_output': {
        success: false,
        generatedAt: new Date(),
        source_domains: adamDomains,
        outputs: [],
        summary: {
          uniqueTable: 0,
          repeatTable: 0,
          uniqueFigure: 0,
          repeatFigure: 0,
          uniqueListing: 0,
          repeatListing: 0
        }
      }
    };
    
    await Study.findByIdAndUpdate(id, { $set: initializePayload }, { new: true });
    console.log('✅ 已初始化TFL生成状态 (success: false)');
    
    // 2. 调用AI服务生成TFL清单（传入endpoints信息）
    const tflResult = await generateOutputsFromDomains(adamDomains, protocolEndpoints);
    
    if (!tflResult.success) {
      return res.status(500).json({
        success: false,
        message: tflResult.message || 'TFL generation failed'
      });
    }
    
    // 3. 统计各类型的Unique/Repeating数量
    const summary = {
      uniqueTable: 0,
      repeatTable: 0,
      uniqueFigure: 0,
      repeatFigure: 0,
      uniqueListing: 0,
      repeatListing: 0
    };
    
    tflResult.outputs.forEach(output => {
      const type = output.type; // 'Table', 'Figure', 'Listing'
      const uniqueness = output.uniqueness; // 'Unique', 'Repeating'
      
      if (uniqueness === 'Unique') {
        if (type === 'Table') summary.uniqueTable++;
        else if (type === 'Figure') summary.uniqueFigure++;
        else if (type === 'Listing') summary.uniqueListing++;
      } else if (uniqueness === 'Repeating') {
        if (type === 'Table') summary.repeatTable++;
        else if (type === 'Figure') summary.repeatFigure++;
        else if (type === 'Listing') summary.repeatListing++;
      }
    });
    
    console.log('📈 TFL统计结果:', summary);
    
    // 🔥 阶段2：更新TFL生成状态为 success: true，并保存完整结果
    const finalPayload = {
      'traceability.TFL_generation_adam_to_output': {
        success: true, // 🔥 标记为成功
        generatedAt: new Date(),
        source_domains: adamDomains,
        outputs: tflResult.outputs,
        summary: summary
      }
    };
    
    await Study.findByIdAndUpdate(id, { $set: finalPayload }, { new: true });
    
    console.log('✅ TFL可追溯性数据已成功存储到数据库 (success: true)');
    
    // 5. 返回成功响应
    res.json({
      success: true,
      message: 'TFL traceability generated successfully',
      data: {
        source_domains: adamDomains,
        outputs: tflResult.outputs,
        summary: summary,
        generatedAt: new Date()
      }
    });
    
  } catch (error) {
    console.error('❌ 生成ADaM TFL可追溯性失败:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to generate TFL traceability',
      error: error.message
    });
  }
}

// 🔥 新增：保存数据流可追溯性到数据库
async function saveDataFlowTraceability(req, res) {
  try {
    const { id } = req.params; // Study ID
    const { mappings, stage, hasSDTM, hasADaM } = req.body;
    
    console.log(`🔄 保存数据流可追溯性 (${stage} 阶段)...`);
    console.log(`📊 收到 ${mappings?.length || 0} 个映射项`);
    
    // 1. 获取Study
    const study = await Study.findById(id);
    if (!study) {
      return res.status(404).json({
        success: false,
        message: 'Study not found'
      });
    }
    
    // 2. 构建数据流数据
    const dataFlowData = {
      lastUpdated: new Date(),
      hasSDTM: hasSDTM || false,
      hasADaM: hasADaM || false,
      mappings: mappings || []
    };
    
    // 3. 原子性更新数据库
    const updatePayload = {
      'traceability.dataFlow': dataFlowData
    };
    
    await Study.findByIdAndUpdate(id, { $set: updatePayload }, { new: true });
    
    console.log(`✅ 数据流可追溯性已保存 (${stage} 阶段)`);
    
    // 4. 返回成功响应
    res.json({
      success: true,
      message: `Data flow traceability saved successfully (${stage} stage)`,
      data: {
        stage: stage,
        mappingsCount: mappings?.length || 0,
        hasSDTM: hasSDTM,
        hasADaM: hasADaM,
        lastUpdated: new Date()
      }
    });
    
  } catch (error) {
    console.error('❌ 保存数据流可追溯性失败:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to save data flow traceability',
      error: error.message
    });
  }
}

// 🔥 新增：生成CRF注解矩形参数
async function generateCrfAnnotationRects(req, res) {
  try {
    const { studyId } = req.params;
    
    if (!studyId) {
      return res.status(400).json({
        success: false,
        message: '缺少studyId参数'
      });
    }

    console.log(`🚀 开始为Study ${studyId}生成CRF注解矩形参数...`);

    // 获取Study数据
    const study = await Study.findById(studyId);
    if (!study) {
      return res.status(404).json({
        success: false,
        message: 'Study not found'
      });
    }

    // 检查是否有CRF数据
    if (!study.files?.crf?.crfUploadResult) {
      return res.status(404).json({
        success: false,
        message: 'No CRF data found for this study'
      });
    }

    // 🧠 **第一步**: 生成SDTM映射
    console.log('🧠 开始生成SDTM映射...');
    const { generateSdtmMappingForAllForms } = require('../services/crf_analysis/sdtmMappingService');
    
    // 克隆crfFormList并生成SDTM映射
    let updatedCrfFormList = JSON.parse(JSON.stringify(study.files.crf.crfUploadResult.crfFormList));

    // 初始化并更新GPT阶段进度
    const totalForms = Object.keys(updatedCrfFormList || {}).length;
    updateAnnotationProgress(studyId, {
      overall: { totalForms, processedForms: 0, percentage: 0 },
      gptAnalysis: { totalForms, processedForms: 0, percentage: 0, status: 'running' },
      pdfDrawing: { totalBatches: Math.ceil((totalForms || 0) / 5), processedBatches: 0, percentage: 0, status: 'pending' },
      currentPhase: 'gpt'
    });
    
    let gptProcessedForms = 0;
    updatedCrfFormList = await generateSdtmMappingForAllForms(updatedCrfFormList, () => {
      gptProcessedForms += 1;
      updateAnnotationProgress(studyId, {
        overall: {
          processedForms: gptProcessedForms,
          percentage: totalForms ? (gptProcessedForms / totalForms) * 100 : 0
        },
        gptAnalysis: {
          processedForms: gptProcessedForms,
          percentage: totalForms ? (gptProcessedForms / totalForms) * 100 : 0,
          status: gptProcessedForms === totalForms ? 'completed' : 'running'
        }
      });
    });

    // GPT阶段完成，切换到PDF阶段
    updateAnnotationProgress(studyId, { currentPhase: 'pdf', gptAnalysis: { status: 'completed', percentage: 100 } });
    
    // 将更新后的数据写回数据库
    await Study.findByIdAndUpdate(
      studyId,
      {
        $set: {
          'files.crf.crfUploadResult.crfFormList': updatedCrfFormList
        }
      }
    );
    
    console.log('✅ SDTM映射生成并保存完成');
    
    // 🎨 **第二步**: 分批生成注解并写入PDF（每批5个表格，5分钟超时）
    const updatedStudy = await Study.findById(studyId);
    const batchResult = await annotatePdfInBatches(updatedStudy, studyId, { batchSize: 5, batchTimeoutMs: 5 * 60 * 1000 });

    res.json({
      success: true,
      message: 'CRF annotation process (batched) started and completed',
      data: batchResult
    });

  } catch (error) {
    console.error('❌ 生成CRF注解矩形参数失败:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to generate CRF annotation rectangles',
      error: error.message
    });
  }
}

// 🎨 **辅助函数**: 生成注解PDF的输出路径
function generateAnnotatedPdfPath(sourcePath) {
  const path = require('path');
  const ext = path.extname(sourcePath);  // .pdf
  const base = path.basename(sourcePath, ext);  // filename
  const dir = path.dirname(sourcePath);  // directory
  
  // 生成带_annotated后缀的文件名
  const annotatedFileName = `${base}_annotated${ext}`;
  const outputPath = path.join(dir, annotatedFileName);
  
  console.log('📁 路径生成:', {
    source: sourcePath,
    output: outputPath,
    fileName: annotatedFileName
  });
  
  return outputPath;
}

// 🎨 **辅助函数**: 调用Python脚本（可配置超时）
async function callPdfAnnotationScriptWithTimeout(sourcePath, rectsByPage, outputPath, timeoutMs) {
  const { spawn } = require('child_process');
  const path = require('path');

  const scriptPath = path.join(__dirname, '../services/pdf_annotate.py');

  return new Promise((resolve, reject) => {
    // console.log('🐍 [Batch] 启动Python进程...');
    // console.log('📝 脚本路径:', scriptPath);
    // console.log('📄 源PDF:', sourcePath);
    // console.log('📊 本批矩形页数:', Object.keys(rectsByPage || {}).length);

    const rectsJson = JSON.stringify(rectsByPage || {});

    const pythonProcess = spawn('python3', [
      scriptPath,
      sourcePath,
      rectsJson,
      outputPath
    ], {
      stdio: ['pipe', 'pipe', 'pipe']
    });

    let stdout = '';
    let stderr = '';

    pythonProcess.stdout.on('data', (data) => {
      const output = data.toString();
      stdout += output;
      console.log(output.trim()); // 直接输出Python的打印内容
    });

    pythonProcess.stderr.on('data', (data) => {
      const error = data.toString();
      stderr += error;
      console.warn('🐍 [Batch] Python错误:', error.trim());
    });

    const killTimer = setTimeout(() => {
      console.warn(`⏰ [Batch] Python进程超时(${Math.round(timeoutMs/1000)}s)，强制终止`);
      try { pythonProcess.kill('SIGTERM'); } catch (_) {}
      reject(new Error('Python脚本执行超时'));
    }, timeoutMs);

    pythonProcess.on('close', (code) => {
      clearTimeout(killTimer);
      // console.log('🐍 [Batch] Python进程结束，退出代码:', code);
      if (code === 0) {
        resolve({ success: true, stdout: stdout.trim(), outputPath });
      } else {
        reject(new Error(`Python脚本失败，退出代码: ${code}\n标准错误: ${stderr}\n标准输出: ${stdout}`));
      }
    });

    pythonProcess.on('error', (err) => {
      clearTimeout(killTimer);
      console.error('❌ [Batch] 启动Python进程失败:', err);
      reject(new Error(`启动Python进程失败: ${err.message}`));
    });
  });
}

// 🎨 **辅助函数**: 调用Python脚本生成注解PDF
async function callPdfAnnotationScript(sourcePath, rectsByPage, outputPath) {
  const { spawn } = require('child_process');
  const path = require('path');
  
  // Python脚本路径
  const scriptPath = path.join(__dirname, '../services/pdf_annotate.py');
  
  return new Promise((resolve, reject) => {
    console.log('🐍 启动Python进程...');
    console.log('📝 脚本路径:', scriptPath);
    console.log('📄 源PDF:', sourcePath);
    console.log('📊 矩形数据页数:', Object.keys(rectsByPage).length);
    
    // 将矩形数据转换为JSON字符串
    const rectsJson = JSON.stringify(rectsByPage);
    
    // 启动Python进程
    const pythonProcess = spawn('python3', [
      scriptPath,
      sourcePath,
      rectsJson,  // 直接传递JSON字符串
      outputPath
    ], {
      stdio: ['pipe', 'pipe', 'pipe']
    });
    
    let stdout = '';
    let stderr = '';
    
    // 收集标准输出
    pythonProcess.stdout.on('data', (data) => {
      const output = data.toString();
      stdout += output;
      console.log(output.trim()); // 直接输出Python的打印内容
    });
    
    // 收集标准错误
    pythonProcess.stderr.on('data', (data) => {
      const error = data.toString();
      stderr += error;
      console.warn('🐍 Python错误:', error.trim());
    });
    
    // 进程结束处理
    pythonProcess.on('close', (code) => {
      // console.log('🐍 Python进程结束，退出代码:', code);
      
      if (code === 0) {
        console.log('✅ Python脚本执行成功');
        resolve({
          success: true,
          stdout: stdout.trim(),
          outputPath: outputPath
        });
      } else {
        console.error('❌ Python脚本执行失败');
        reject(new Error(`Python脚本失败，退出代码: ${code}\n标准错误: ${stderr}\n标准输出: ${stdout}`));
      }
    });
    
    // 进程错误处理
    pythonProcess.on('error', (err) => {
      console.error('❌ 启动Python进程失败:', err);
      reject(new Error(`启动Python进程失败: ${err.message}`));
    });
    
    // 设置超时 (20分钟) - 增加时间以支持大型CRF文件处理
    const timeout = setTimeout(() => {
      console.warn('⏰ Python进程超时，强制终止');
      pythonProcess.kill('SIGTERM');
      reject(new Error('Python脚本执行超时'));
    }, 20 * 60 * 1000);
    
    pythonProcess.on('close', () => {
      clearTimeout(timeout);
    });
  });
}

// 🎨 **新增**: 分批注解PDF（每批5个表格，单批5分钟超时）
async function annotatePdfInBatches(studyData, studyId, options = {}) {
  const fs = require('fs');
  const path = require('path');
  const { generateAnnotationRectsForForms } = require('../services/crf_analysis/annotationRectService');

  const batchSize = options.batchSize || 5;
  const batchTimeoutMs = options.batchTimeoutMs || (5 * 60 * 1000);

  const sourcePath = studyData?.files?.crf?.sourcePath;
  if (!sourcePath) throw new Error('源PDF路径不存在');

  const crfFormList = studyData?.files?.crf?.crfUploadResult?.crfFormList || {};
  const formKeys = Object.keys(crfFormList);
  const totalForms = formKeys.length;
  if (totalForms === 0) {
    console.log('⏸️ 无Form可注解');
    return { totalForms: 0, totalBatches: 0, processedForms: 0 };
  }

  console.log(`🎯 分批注解启动：共 ${totalForms} 个表格，批大小=${batchSize}，单批超时=${Math.round(batchTimeoutMs/1000)}秒`);

  // 计算输出路径与工作路径
  const finalOutputPath = generateAnnotatedPdfPath(sourcePath);
  const workPathA = finalOutputPath;
  const workPathB = finalOutputPath.replace(/\.pdf$/i, '_work.pdf');

  let currentInput = sourcePath;
  let lastOutput = null;

  let colorState = { map: new Map(), index: 0 };

  const totalBatches = Math.ceil(totalForms / batchSize);
  let processedForms = 0;
  let succeededBatches = 0;
  let failedBatches = 0;

  for (let batchIndex = 0; batchIndex < totalBatches; batchIndex++) {
    const start = batchIndex * batchSize;
    const end = Math.min(start + batchSize, totalForms);
    const batchFormKeys = formKeys.slice(start, end);

    // console.log(`\n🔄 开始处理第 ${batchIndex + 1}/${totalBatches} 批：表格索引范围 [${start + 1} - ${end}]，Keys: [${batchFormKeys.join(', ')}]`);

    // 生成本批矩形
    const { rectsByPage, colorState: updatedColorState } = generateAnnotationRectsForForms(studyData, batchFormKeys, colorState);
    colorState = updatedColorState;

    const batchRectsCount = Object.values(rectsByPage).reduce((s, arr) => s + (arr?.length || 0), 0);
    // console.log(`📦 本批矩形总数: ${batchRectsCount}`);

    if (batchRectsCount === 0) {
      console.log('⏭️ 本批无矩形，跳过Python调用');
      processedForms = end;
      console.log(`✅ 已分批注解至第 ${processedForms} 个表格 / 共 ${totalForms}`);
      continue;
    }

    // 切换输出文件以避免读写同一路径冲突
    const outputPath = (batchIndex % 2 === 0) ? workPathA : workPathB;

    try {
      await callPdfAnnotationScriptWithTimeout(currentInput, rectsByPage, outputPath, batchTimeoutMs);
      lastOutput = outputPath;
      currentInput = outputPath; // 下一批以上一批的输出作为输入
      succeededBatches++;
      processedForms = end;
      console.log(`✅ 本批完成。已分批注解至第 ${processedForms} 个表格 / 共 ${totalForms}`);

      // 更新PDF进度（每批完成一次）
      updateAnnotationProgress(studyId, {
        pdfDrawing: {
          totalBatches,
          processedBatches: batchIndex + 1,
          percentage: ((batchIndex + 1) / totalBatches) * 100,
          status: batchIndex + 1 === totalBatches ? 'completed' : 'running'
        }
      });
    } catch (err) {
      console.warn(`❌ 本批失败：${err.message}。将继续下一批。`);
      failedBatches++;
      // 失败时不更新 currentInput，继续用上一轮的有效PDF
    }
  }

  // 确保最终文件位于 finalOutputPath
  try {
    if (lastOutput && lastOutput !== finalOutputPath) {
      fs.copyFileSync(lastOutput, finalOutputPath);
      console.log('📁 已拷贝最终输出文件到:', finalOutputPath);
    }
  } catch (copyErr) {
    console.warn('⚠️ 拷贝最终输出失败:', copyErr.message);
  }

  // 更新数据库：标记完成 & 下载链接
  const downloadUrl = `/api/studies/${studyId}/crf-annotated.pdf`;
  await Study.findByIdAndUpdate(
    studyId,
    {
      $set: {
        'files.crf.annotatedPath': finalOutputPath,
        'files.crf.annotationReady': true,
        'files.crf.annotatedAt': new Date(),
        'files.crf.downloadUrl': downloadUrl
      }
    }
  );

  console.log(`🎉 分批注解完成：成功批次 ${succeededBatches}，失败批次 ${failedBatches}，最终下载链接: ${downloadUrl}`);

  // 最终完成：标记进度为completed并安排清理
  updateAnnotationProgress(studyId, {
    currentPhase: 'completed',
    pdfDrawing: { status: 'completed', percentage: 100 },
    overall: { processedForms: totalForms, percentage: 100 }
  });
  setTimeout(() => { try { annotationProgressMap.delete(studyId); } catch (_) {} }, 60 * 1000);

  return {
    studyId,
    totalForms,
    totalBatches,
    processedForms,
    succeededBatches,
    failedBatches,
    downloadUrl
  };
}

// 🎨 **新增**: 上传完成后自动生成注解PDF
async function generateAnnotatedPdfAfterUpload(studyData, studyId) {
  console.log('🎨 generateAnnotatedPdfAfterUpload 开始...');
  // console.log('📋 Study ID:', studyId);
  
  // 1. 检查是否有源PDF路径
  const sourcePath = studyData?.files?.crf?.sourcePath;
  if (!sourcePath) {
    throw new Error('源PDF路径不存在，无法生成注解');
  }
  console.log('📄 源PDF路径:', sourcePath);
  
  // 2. 检查是否有CRF数据
  if (!studyData?.files?.crf?.crfUploadResult?.crfFormList) {
    throw new Error('CRF表单数据不存在，无法生成注解');
  }
  
  const formCount = Object.keys(studyData.files.crf.crfUploadResult.crfFormList).length;
  console.log('📊 CRF表单数量:', formCount);
  
  if (formCount === 0) {
    console.log('⏸️  无CRF表单数据，跳过注解生成');
    return;
  }
  
  // 3. 生成矩形数据
  console.log('🔢 开始生成注解矩形数据...');
  const { generateAnnotationRects } = require('../services/crf_analysis/annotationRectService');
  const rectsByPage = generateAnnotationRects(studyData);
  
  const totalRects = Object.values(rectsByPage).reduce((sum, rects) => sum + rects.length, 0);
  console.log('📊 生成矩形统计:', {
    totalPages: Object.keys(rectsByPage).length,
    totalRects: totalRects
  });
  
  if (totalRects === 0) {
    console.log('⏸️  无注解矩形数据，跳过PDF生成');
    return;
  }
  
  // 4. 生成输出PDF路径
  const outputPath = generateAnnotatedPdfPath(sourcePath);
  console.log('📁 注解PDF输出路径:', outputPath);
  
  // 5. 调用Python脚本生成注解PDF
  console.log('🐍 开始调用Python脚本生成注解PDF...');
  const annotationResult = await callPdfAnnotationScript(sourcePath, rectsByPage, outputPath);
  
  console.log('✅ 注解PDF生成成功:', annotationResult);
  
  // 6. 更新数据库
  console.log('💾 更新数据库注解字段...');
  
  // 🔥 生成下载链接
  const downloadUrl = `/api/studies/${studyId}/crf-annotated.pdf`;
  console.log('🔗 生成下载链接:', downloadUrl);
  
  await Study.findByIdAndUpdate(
    studyId,
    {
      $set: {
        'files.crf.annotatedPath': outputPath,
        'files.crf.annotationReady': true,
        'files.crf.annotatedAt': new Date(),
        'files.crf.downloadUrl': downloadUrl  // 🔥 新增：保存下载链接
      }
    }
  );
  
  console.log('🎉 CRF注解PDF生成完整流程完成!');
  return {
    success: true,
    annotatedPath: outputPath,
    annotationStats: annotationResult
  };
}

// 🔥 **新增**: 获取CRF注解状态
async function getCrfAnnotationStatus(req, res) {
  try {
    const { studyId } = req.params;
    
    // console.log('📋 获取CRF注解状态...');
    // console.log('📋 Study ID:', studyId);
    
    // 查找Study文档
    const study = await Study.findById(studyId);
    if (!study) {
      return res.status(404).json({
        success: false,
        message: 'Study not found'
      });
    }
    
    // 提取CRF注解相关信息
    const crfData = study?.files?.crf;
    const annotationStatus = {
      hasUpload: !!crfData?.uploaded,
      hasCrfData: !!(crfData?.crfUploadResult?.crfFormList && Object.keys(crfData.crfUploadResult.crfFormList).length > 0),
      annotationReady: !!crfData?.annotationReady,
      downloadUrl: crfData?.downloadUrl || null,
      annotatedAt: crfData?.annotatedAt || null,
      originalName: crfData?.originalName || null
    };
    
    // console.log('📊 CRF注解状态:', annotationStatus);
    
    res.json({
      success: true,
      data: {
        studyId: studyId,
        annotationStatus: annotationStatus
      }
    });
    
  } catch (error) {
    console.error('❌ 获取CRF注解状态失败:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get CRF annotation status',
      error: error.message
    });
  }
}

// 🔥 **新增**: 检查是否有现成的SDTM映射数据
async function checkExistingSdtmData(req, res) {
  try {
    const { studyId } = req.params;
    
    // console.log('🔍 开始检查Study的现成SDTM数据...');
    // console.log('📋 Study ID:', studyId);
    
    if (!studyId) {
      console.warn('❌ 缺少studyId参数');
      return res.status(400).json({
        success: false,
        message: 'Study ID is required'
      });
    }
    
    const study = await Study.findById(studyId)
      .select('files.crf.crfUploadResult.crfFormList') // 只选择必要字段
      .lean();
    
    if (!study) {
      console.warn('❌ Study未找到:', studyId);
      return res.status(404).json({
        success: false,
        message: 'Study not found'
      });
    }
    
    const crfFormList = study?.files?.crf?.crfUploadResult?.crfFormList;
    const hasExistingData = checkIfHasExistingSdtmData(crfFormList);
    
    // console.log('📊 SDTM数据检查结果:', {
    //   studyId: studyId,
    //   totalForms: crfFormList ? Object.keys(crfFormList).length : 0,
    //   hasExistingData: hasExistingData
    // });
    
    res.json({
      success: true,
      hasExistingData: hasExistingData,
      message: hasExistingData ? 'Existing SDTM data found' : 'No existing SDTM data'
    });
    
  } catch (error) {
    console.error('❌ 检查现成SDTM数据失败:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to check existing SDTM data',
      error: error.message
    });
  }
}

// 🔥 **新增**: 仅重新绘制PDF（跳过GPT步骤）
async function redrawCrfAnnotationPdf(req, res) {
  try {
    const { studyId } = req.params;
    
    // console.log('🎨 开始Re-draw PDF流程...');
    // console.log('📋 Study ID:', studyId);
    
    if (!studyId) {
      console.warn('❌ 缺少studyId参数');
      return res.status(400).json({
        success: false,
        message: '缺少studyId参数'
      });
    }

    // 获取Study数据
    const study = await Study.findById(studyId);
    if (!study) {
      console.warn('❌ Study未找到:', studyId);
      return res.status(404).json({
        success: false,
        message: 'Study not found'
      });
    }

    // 检查是否有CRF数据
    if (!study.files?.crf?.crfUploadResult) {
      console.warn('❌ Study没有CRF数据:', studyId);
      return res.status(404).json({
        success: false,
        message: 'No CRF data found for this study'
      });
    }

    console.log('🔍 检查现成的SDTM映射数据...');
    
    // 检查是否有现成的SDTM数据
    const crfFormList = study.files.crf.crfUploadResult.crfFormList;
    const hasExistingData = checkIfHasExistingSdtmData(crfFormList);
    
    if (!hasExistingData) {
      console.warn('❌ 没有找到现成的SDTM数据，无法Re-draw');
      return res.status(400).json({
        success: false,
        message: 'No existing SDTM mapping data found. Please run full annotation first.',
        code: 'NO_EXISTING_DATA'
      });
    }
    
    console.log('✅ 找到现成的SDTM数据，开始Re-draw PDF...');
    console.log('🚀 跳过GPT分析步骤，直接进行PDF绘制');
    
    // 直接调用分批PDF绘制（跳过GPT步骤）
    const batchResult = await annotatePdfInBatches(study, studyId, { 
      batchSize: 5, 
      batchTimeoutMs: 5 * 60 * 1000 
    });
    
    console.log('🎉 Re-draw PDF完成!');
    // console.log('📊 绘制结果:', {
    //   totalForms: batchResult.totalForms,
    //   processedForms: batchResult.processedForms,
    //   succeededBatches: batchResult.succeededBatches,
    //   failedBatches: batchResult.failedBatches
    // });

    res.json({
      success: true,
      message: 'PDF re-drawn successfully (skipped GPT analysis)',
      data: {
        ...batchResult,
        skippedGptAnalysis: true,
        costSaved: true
      }
    });

  } catch (error) {
    console.error('❌ Re-draw PDF失败:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to re-draw PDF',
      error: error.message
    });
  }
}

// 🔥 **辅助函数**: 检查是否有现成的SDTM数据
function checkIfHasExistingSdtmData(crfFormList) {
  if (!crfFormList || typeof crfFormList !== 'object') {
    console.log('📊 SDTM数据检查: crfFormList无效或为空');
    return false;
  }
  
  const formKeys = Object.keys(crfFormList);
  console.log(`📊 SDTM数据检查: 检查${formKeys.length}个Forms`);
  
  let formsWithData = 0;
  let totalForms = 0;
  
  const hasData = Object.values(crfFormList).some(form => {
    totalForms++;
    const hasUniqueData = Array.isArray(form.form_sdtm_mapping_unique) && form.form_sdtm_mapping_unique.length > 0;
    const hasMappingData = Array.isArray(form.Mapping) && form.Mapping.some(mapping => 
      Array.isArray(mapping.sdtm_mappings) && mapping.sdtm_mappings.length > 0
    );
    
    if (hasUniqueData || hasMappingData) {
      formsWithData++;
      console.log(`  ✅ Form "${form.title || 'Unknown'}" 有SDTM数据`);
      return true;
    } else {
      console.log(`  ❌ Form "${form.title || 'Unknown'}" 缺少SDTM数据`);
      return false;
    }
  });
  
  // console.log(`📊 SDTM数据检查结果: ${formsWithData}/${totalForms} Forms有数据，总体判断: ${hasData ? '有数据' : '无数据'}`);
  
  return hasData;
}

// 🔥 **新增**: 下载注解CRF PDF
async function downloadAnnotatedCrf(req, res) {
  try {
    const { studyId } = req.params;
    
    console.log('📥 开始下载注解CRF PDF...');
    // console.log('📋 Study ID:', studyId);
    
    // 验证Study ID格式
    if (!studyId) {
      return res.status(400).json({
        success: false,
        message: 'Study ID is required'
      });
    }
    
    // 查找Study文档
    const study = await Study.findById(studyId);
    if (!study) {
      console.warn('❌ Study not found:', studyId);
      return res.status(404).json({
        success: false,
        message: 'Study not found'
      });
    }
    
    // 检查是否有CRF注解数据
    const annotatedPath = study?.files?.crf?.annotatedPath;
    const annotationReady = study?.files?.crf?.annotationReady;
    
    if (!annotationReady) {
      console.warn('❌ CRF注解未准备就绪:', studyId);
      return res.status(404).json({
        success: false,
        message: 'CRF annotation is not ready. Please generate annotation first.'
      });
    }
    
    if (!annotatedPath) {
      console.warn('❌ 注解PDF路径不存在:', studyId);
      return res.status(404).json({
        success: false,
        message: 'Annotated PDF path not found'
      });
    }
    
    console.log('📁 注解PDF路径:', annotatedPath);
    
    // 检查文件是否存在
    const fs = require('fs');
    const path = require('path');
    
    if (!fs.existsSync(annotatedPath)) {
      console.warn('❌ 注解PDF文件不存在:', annotatedPath);
      return res.status(404).json({
        success: false,
        message: 'Annotated PDF file not found on server'
      });
    }
    
    // 获取文件统计信息
    const stats = fs.statSync(annotatedPath);
    const fileName = path.basename(annotatedPath);
    
    console.log('📊 文件信息:', {
      path: annotatedPath,
      size: stats.size,
      fileName: fileName
    });
    
    // 设置响应头
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${fileName}"`);
    res.setHeader('Content-Length', stats.size);
    // 🔧 **修复**: 允许前端访问Content-Disposition头部
    res.setHeader('Access-Control-Expose-Headers', 'Content-Disposition, Content-Length');
    
    console.log('📤 开始发送PDF文件...');
    
    // 发送文件
    res.sendFile(path.resolve(annotatedPath), (err) => {
      if (err) {
        console.error('❌ 发送文件失败:', err);
        if (!res.headersSent) {
          res.status(500).json({
            success: false,
            message: 'Failed to send annotated PDF file',
            error: err.message
          });
        }
      } else {
        console.log('✅ 注解PDF发送成功:', fileName);
      }
    });
    
  } catch (error) {
    console.error('❌ 下载注解CRF PDF失败:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to download annotated CRF PDF',
      error: error.message
    });
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
  uploadAdditionalFile,
  uploadCrfFile,     // 🔥 新增：专门的CRF上传函数
  uploadSapFile,     // 🔥 新增：专门的SAP上传函数
  getCrfData,        // 🔥 新增：获取CRF数据（包含LabelForm/OIDForm）
  generateCrfAnnotationRects,        // 🔥 新增：生成CRF注解矩形参数
  getCrfAnnotationStatus,           // 🔥 新增：获取CRF注解状态
  downloadAnnotatedCrf,              // 🔥 新增：下载注解CRF PDF
  checkExistingSdtmData,            // 🔥 新增：检查现成SDTM数据
  redrawCrfAnnotationPdf,           // 🔥 新增：仅重绘PDF（跳过GPT）
  generateAdamToOutputTraceability,  // 🔥 新增：TFL可追溯性生成函数
  saveDataFlowTraceability,          // 🔥 新增：数据流可追溯性保存函数
  getCrfAnnotationProgress,         // 🔥 新增：获取CRF注解进度（内存）
  resetCrfProgress                  // 🔥 新增：重置进度（Re-annotate前）
}; 