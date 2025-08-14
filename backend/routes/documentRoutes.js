const express = require('express');
const multer = require('multer');
const fs = require('fs');
const { 
  uploadDocument, 
  getDocuments, 
  getDocumentContent, 
  exportAssessmentSchedule,
  confirmSDTMAnalysis,
  updateProjectSelection,
  markCostEstimateDone,
  listIncompleteEstimates,
  analyzeDocumentForSdtm,
  updateUnits
} = require('../controllers/documentController');

const router = express.Router();

// 配置文件上传
const upload = multer({
  dest: 'uploads/',
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

// 确保uploads目录存在
if (!fs.existsSync('uploads')) {
  fs.mkdirSync('uploads');
}

router.get('/test', (req, res) => {
  res.json({ success: true, message: '后端 API 连接成功！', data: { server: 'running', database: 'connected', databaseType: 'MongoDB Atlas' } });
});

// 列出未完成的成本估算
router.get('/documents/incomplete-estimates', listIncompleteEstimates);

// Clinical Protocol 专用上传API
router.post('/upload-document', upload.single('document'), uploadDocument);

// 触发延迟SDTM分析
router.post('/documents/:id/analyze-sdtm', analyzeDocumentForSdtm);

// 获取已上传的文档列表 API
router.get('/documents', getDocuments);

// 获取特定文档的详细结构化内容 API
router.get('/documents/:id/content', getDocumentContent);

// 导出评估时间表为Excel文件 API
router.get('/documents/:id/export-schedule', exportAssessmentSchedule);

// 确认SDTM分析结果 API
router.patch('/documents/:id/confirm-sdtm', confirmSDTMAnalysis);

// 更新项目选择详细信息 API
router.patch('/documents/:id/project-selection', updateProjectSelection);

// 标记成本估算完成（Done）
router.patch('/documents/:id/mark-complete', markCostEstimateDone);

// 更新Excel中的Unit数据
router.patch('/documents/:id/update-units', updateUnits);

module.exports = router; 