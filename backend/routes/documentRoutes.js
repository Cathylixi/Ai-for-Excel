const express = require('express');
const multer = require('multer');
const { 
  uploadDocument, 
  getDocuments, 
  getDocumentContent, 
  getStudyDocuments,
  confirmSDTMAnalysis,
  confirmADaMAnalysis,
  updateProjectSelection,
  markTaskAsStarted,
  markTaskAsDone,
  markCostEstimateDone,
  listIncompleteEstimates,
  analyzeDocumentForSdtm,
  analyzeDocumentForAdam,
  updateUnits,
  uploadAdditionalFile,
  uploadCrfFile,     // 🔥 新增：专门的CRF上传函数
  uploadSapFile,     // 🔥 新增：专门的SAP上传函数
  getCrfData,        // 🔥 新增：获取CRF数据（包含LabelForm/OIDForm）
  getCriterias,      // 🔥 新增：获取Inclusion/Exclusion Criteria数据
  getStudyDesign,    // 🔥 新增：获取Study Design数据（主章节及所有子章节）
  getCrfFormList,    // 🔥 新增：获取CRF Form列表
  getCrfExcelDataByForm, // 🔥 新增：按Form获取Excel数据
  saveCrfCorrectedData, // 🔥 新增：保存修正后的CRF数据
  saveCrfCorrectedDataBatch, // 🔥 新增：保存修正后的CRF数据（分批版本）
  generateCrfAnnotationRects,        // 🔥 新增：生成CRF注解矩形参数
  getCrfAnnotationStatus,           // 🔥 新增：获取CRF注解状态
  downloadAnnotatedCrf,              // 🔥 新增：下载注解CRF PDF
  getCrfAnnotationProgress,         // 🔥 新增：获取CRF注解进度（内存）
  resetCrfProgress,                 // 🔥 新增：重置进度（Re-annotate前）
  checkExistingSdtmData,            // 🔥 新增：检查现成SDTM数据
  redrawCrfAnnotationPdf,           // 🔥 新增：仅重绘PDF（跳过GPT）
  generateSdtmMappingOnly,          // 🔥 新增：只生成SDTM映射
  generatePdfAnnotationOnly,        // 🔥 新增：只生成PDF注解
  generateAdamToOutputTraceability,  // 🔥 新增：TFL可追溯性生成函数
  saveDataFlowTraceability,         // 🔥 新增：数据流可追溯性保存函数
  extractProtocolInfo,              // 🔥 新增：提取protocol信息用于Spec页面
  saveSpecStudyData,                // 🔥 新增：保存Spec Study表格数据
  importSDTMIGData,                 // 🔥 新增：导入SDTMIG参考数据
  getSDTMIGDatasetsList,            // 🔥 新增：获取SDTMIG Dataset列表
  getSDTMIGDatasetInfo,             // 🔥 新增：获取Dataset详细信息
  saveSpecDatasetsData,             // 🔥 新增：保存Spec Datasets表格数据
  getCRFVariablesData,              // 🔥 新增：获取CRF Variables数据
  saveSpecVariablesData,            // 🔥 新增：保存Spec Variables表格数据
  // getSDTMIGVariablesReqPerm,        // 🔥 新增：获取SDTMIG Variables (Req+Perm)
  // getSDTMIGVariablesExp             // 🔥 新增：获取SDTMIG Variables_Exp数据
  getAllSDTMIGVariables,            // 🔥 新增：获取所有SDTMIG Variables（不分Core类型）
  updateSpecStatus,                 // 🔥 新增：更新Spec创建状态
  updateSpecSectionStatus,          // 🔥 新增：更新Spec各section状态
  generateSdtmMappingForSingleForm  // 🔥 新增：单表单GPT处理（逐表单模式）
} = require('../controllers/documentController');

// 🔥 新增：SUPP_Details和TESTCD_Details相关控制器
const { 
  generateSUPPDetailsData,
  saveSpecSUPPDetailsData,
  generateTESTCDDetailsData,
  saveSpecTESTCDDetailsData,
  generateTADetailsData,
  saveSpecTADetailsData,
  generateTEDetailsData,
  saveSpecTEDetailsData,
  generateTIDetailsData,
  saveSpecTIDetailsData,
  generateTSDetailsData,
  generateTSDetailsDataStream,
  saveSpecTSDetailsData,
  getSpecTSDetailsData,
  generateDatasetSpecificSpecsAPI,
  downloadDatasetSpecificSpecsZip,
  generateInternalSpec,
  downloadInternalSpec
} = require('../controllers/SpecDocumentController');

const router = express.Router();

// 配置文件上传 - 使用内存存储，不保存到硬盘
const upload = multer({
  storage: multer.memoryStorage(), // 直接存储在内存中
  limits: {
    fileSize: 10 * 1024 * 1024 // 10MB限制
  },
  fileFilter: (req, file, cb) => {
    const allowedMimes = [
      'application/pdf',
      'application/msword',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
    ];
    cb(null, allowedMimes.includes(file.mimetype));
  }
});

router.get('/test', (req, res) => {
  res.json({ success: true, message: '后端 API 连接成功！', data: { server: 'running', database: 'connected', databaseType: 'MongoDB Atlas' } });
});

// 列出未完成的成本估算
router.get('/documents/incomplete-estimates', listIncompleteEstimates);

// Clinical Protocol 专用上传API
router.post('/upload-document', upload.single('document'), uploadDocument);

// 额外文件上传（CRF/SAP）到指定Study（通用接口，向后兼容）
router.post('/documents/:id/additional-file', upload.single('file'), uploadAdditionalFile);

// 🔥 新增：专门的CRF文件上传（解析并存储 extractedText/sectionedText/tables）
router.post('/studies/:id/upload-crf', upload.single('file'), uploadCrfFile);

// 🔥 新增：专门的SAP文件上传（解析并存储 extractedText/sectionedText/tables）
router.post('/studies/:id/upload-sap', upload.single('file'), uploadSapFile);

// 触发延迟SDTM分析
router.post('/documents/:id/analyze-sdtm', analyzeDocumentForSdtm);

// 获取已上传的文档列表 API
router.get('/documents', getDocuments);

// 获取特定文档的详细结构化内容 API
router.get('/documents/:id/content', getDocumentContent);



// 确认SDTM分析结果 API
router.patch('/documents/:id/confirm-sdtm', confirmSDTMAnalysis);

// 确认ADaM分析结果 API
router.patch('/documents/:id/confirm-adam', confirmADaMAnalysis);

// 更新项目选择详细信息 API
router.patch('/documents/:id/project-selection', updateProjectSelection);

// 标记任务开始（设置为进行中）
router.patch('/documents/:id/mark-started', markTaskAsStarted);

// 标记任务完成（通用）
router.patch('/documents/:id/mark-done', markTaskAsDone);

// 标记成本估算完成（Done）- 保持向后兼容
router.patch('/documents/:id/mark-complete', markCostEstimateDone);

// 更新Excel中的Unit数据
router.patch('/documents/:id/update-units', updateUnits);

// 🔥 新增：获取Study的文档槽位状态
router.get('/studies/:studyIdentifier/documents', getStudyDocuments);

// 🔥 新增：获取CRF数据（包含LabelForm/OIDForm）
router.get('/studies/:studyId/crf-data', getCrfData);

// 🔥 新增：获取Inclusion/Exclusion Criteria数据
router.get('/studies/:studyId/criterias', getCriterias);

// 🔥 新增：获取Study Design数据（主章节及所有子章节）
router.get('/studies/:studyId/study-design', getStudyDesign);

// 🔥 新增：获取CRF Form列表
router.get('/studies/:studyId/crf-form-list', getCrfFormList);

// 🔥 新增：按Form获取Excel数据
router.get('/studies/:studyId/crf-excel-data-by-form', getCrfExcelDataByForm);

// 🔥 新增：保存修正后的CRF数据
router.post('/studies/:studyId/save-crf-corrected-data', saveCrfCorrectedData);

// 🔥 新增：保存修正后的CRF数据（分批版本）
router.post('/studies/:studyId/save-crf-corrected-data-batch', saveCrfCorrectedDataBatch);

// 新增：分析指定文档的ADaM映射
router.post('/documents/:id/analyze-adam', analyzeDocumentForAdam);

// 🔥 新增：根据确认的ADaM域生成TFL可追溯性
router.post('/studies/:id/generate-adam-outputs', generateAdamToOutputTraceability);

// 🔥 新增：保存数据流可追溯性
router.post('/studies/:id/save-dataflow', saveDataFlowTraceability);

// 🔥 新增：生成CRF注解矩形参数
router.post('/studies/:studyId/generate-crf-annotation-rects', generateCrfAnnotationRects);

// 🧠 新增：只生成SDTM映射（不生成PDF）
router.post('/studies/:studyId/generate-sdtm-mapping-only', generateSdtmMappingOnly);

// 🧠 新增：单表单GPT处理（逐表单模式）
router.post('/studies/:studyId/generate-sdtm-mapping-for-form', generateSdtmMappingForSingleForm);

// 🎨 新增：只生成PDF注解（使用已存在的SDTM数据）
router.post('/studies/:studyId/generate-pdf-annotation-only', generatePdfAnnotationOnly);

// 🔥 新增：获取CRF注解状态
router.get('/studies/:studyId/crf-annotation-status', getCrfAnnotationStatus);
// 进度（内存）
router.get('/studies/:studyId/crf-annotation-progress', getCrfAnnotationProgress);
router.post('/studies/:studyId/reset-crf-progress', resetCrfProgress);

// 🔥 新增：下载注解CRF PDF
router.get('/studies/:studyId/crf-annotated.pdf', downloadAnnotatedCrf);

// 🔥 新增：检查现成SDTM数据
router.get('/studies/:studyId/check-existing-sdtm-data', checkExistingSdtmData);

// 🔥 新增：提取protocol信息用于Spec页面
router.get('/studies/:id/protocol-info', extractProtocolInfo);

// 🔥 新增：保存Spec Study表格数据
router.post('/studies/:id/spec-study-data', saveSpecStudyData);

// 🔥 新增：导入SDTMIG参考数据（一次性操作，应用到所有studies）
router.post('/import-sdtmig-data', importSDTMIGData);

// 🔥 新增：获取SDTMIG Dataset列表用于Spec页面 (包含studyId以访问CRF数据)
router.get('/studies/:studyId/sdtmig-datasets-list', getSDTMIGDatasetsList);

// 🔥 新增：获取特定Dataset的详细信息
router.get('/sdtmig-dataset-info/:datasetName', getSDTMIGDatasetInfo);

// 🔥 新增：保存Spec Datasets表格数据
router.post('/studies/:id/spec-datasets-data', saveSpecDatasetsData);

// 🔥 新增：获取CRF Variables数据用于Spec Variables表格
router.get('/studies/:id/crf-variables-data', getCRFVariablesData);

// 🔥 新增：保存Spec Variables表格数据
router.post('/studies/:id/spec-variables-data', saveSpecVariablesData);


// 🔥 新增：获取所有SDTMIG Variables（不分Core类型）用于新统一处理逻辑
router.get('/sdtmig-variables-all', getAllSDTMIGVariables);

// 🔥 新增：仅重绘PDF（跳过GPT分析）
router.post('/studies/:studyId/redraw-crf-annotation-pdf', redrawCrfAnnotationPdf);

// 🔥 新增：SUPP_Details相关路由
router.post('/studies/:studyId/generate-supp-details', generateSUPPDetailsData);
router.post('/studies/:studyId/spec-supp-details-data', saveSpecSUPPDetailsData);

// 🔥 新增：TESTCD_Details相关路由
router.post('/studies/:studyId/generate-testcd-details', generateTESTCDDetailsData);
router.post('/studies/:studyId/spec-testcd-details-data', saveSpecTESTCDDetailsData);

// 🔥 新增：TA_Data相关路由
router.post('/studies/:studyId/generate-ta-details', generateTADetailsData);
router.post('/studies/:studyId/spec-ta-details-data', saveSpecTADetailsData);

// 🔥 新增：TE_Data相关路由
router.post('/studies/:studyId/generate-te-details', generateTEDetailsData);
router.post('/studies/:studyId/spec-te-details-data', saveSpecTEDetailsData);

// 🔥 新增：TI_Data相关路由
router.post('/studies/:studyId/generate-ti-details', generateTIDetailsData);
router.post('/studies/:studyId/spec-ti-details-data', saveSpecTIDetailsData);

// 🔥 新增：TS_Data相关路由
router.post('/studies/:studyId/generate-ts-details', generateTSDetailsData);
router.get('/studies/:studyId/generate-ts-details-stream', generateTSDetailsDataStream);
router.get('/studies/:studyId/ts-details', getSpecTSDetailsData);
router.post('/studies/:studyId/spec-ts-details-data', saveSpecTSDetailsData);

// 🔥 新增：生成 Dataset-Specific Specs
router.post('/studies/:studyId/generate-dataset-specs', generateDatasetSpecificSpecsAPI);
router.get('/studies/:studyId/dataset-specs.zip', downloadDatasetSpecificSpecsZip);

// Internal Spec generation and download routes
router.post('/studies/:studyId/generate-internal-spec', generateInternalSpec);
router.get('/download-internal-spec/:filename', downloadInternalSpec);

// 🔥 新增：更新Spec创建状态
router.post('/studies/:id/spec-status', updateSpecStatus);

// 🔥 新增：更新Spec各section状态
router.post('/studies/:id/spec-section-status', updateSpecSectionStatus);

module.exports = router; 