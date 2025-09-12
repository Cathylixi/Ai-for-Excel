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
  generateCrfAnnotationRects,        // 🔥 新增：生成CRF注解矩形参数
  getCrfAnnotationStatus,           // 🔥 新增：获取CRF注解状态
  downloadAnnotatedCrf,              // 🔥 新增：下载注解CRF PDF
  getCrfAnnotationProgress,         // 🔥 新增：获取CRF注解进度（内存）
  resetCrfProgress,                 // 🔥 新增：重置进度（Re-annotate前）
  checkExistingSdtmData,            // 🔥 新增：检查现成SDTM数据
  redrawCrfAnnotationPdf,           // 🔥 新增：仅重绘PDF（跳过GPT）
  generateAdamToOutputTraceability,  // 🔥 新增：TFL可追溯性生成函数
  saveDataFlowTraceability          // 🔥 新增：数据流可追溯性保存函数
} = require('../controllers/documentController');

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

// 新增：分析指定文档的ADaM映射
router.post('/documents/:id/analyze-adam', analyzeDocumentForAdam);

// 🔥 新增：根据确认的ADaM域生成TFL可追溯性
router.post('/studies/:id/generate-adam-outputs', generateAdamToOutputTraceability);

// 🔥 新增：保存数据流可追溯性
router.post('/studies/:id/save-dataflow', saveDataFlowTraceability);

// 🔥 新增：生成CRF注解矩形参数
router.post('/studies/:studyId/generate-crf-annotation-rects', generateCrfAnnotationRects);

// 🔥 新增：获取CRF注解状态
router.get('/studies/:studyId/crf-annotation-status', getCrfAnnotationStatus);
// 进度（内存）
router.get('/studies/:studyId/crf-annotation-progress', getCrfAnnotationProgress);
router.post('/studies/:studyId/reset-crf-progress', resetCrfProgress);

// 🔥 新增：下载注解CRF PDF
router.get('/studies/:studyId/crf-annotated.pdf', downloadAnnotatedCrf);

// 🔥 新增：检查现成SDTM数据
router.get('/studies/:studyId/check-existing-sdtm-data', checkExistingSdtmData);

// 🔥 新增：仅重绘PDF（跳过GPT分析）
router.post('/studies/:studyId/redraw-crf-annotation-pdf', redrawCrfAnnotationPdf);

module.exports = router; 