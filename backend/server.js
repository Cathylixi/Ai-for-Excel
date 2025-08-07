const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const multer = require('multer');
const pdfParse = require('pdf-parse');
const mammoth = require('mammoth');
const XLSX = require('xlsx');
const fs = require('fs');
const path = require('path');
const https = require('https');
require('dotenv').config();

const app = express();

// 中间件配置
app.use(cors());
app.use(express.json());

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

// MongoDB Atlas 连接
const MONGODB_URI = process.env.MONGODB_URI;

// 打印连接信息用于调试
console.log('MongoDB URI:', MONGODB_URI ? '已设置' : '未设置');

console.log('正在连接 MongoDB Atlas...');

mongoose.connect(MONGODB_URI)
.then(() => {
  console.log('✅ MongoDB Atlas 连接成功！');
  console.log('数据库名称:', mongoose.connection.name);
})
.catch(err => {
  console.error('❌ MongoDB Atlas 连接失败:', err.message);
  console.log('🔄 将继续运行服务器（使用内存存储）');
});

// 基础路由 - 测试服务器是否运行
app.get('/', (req, res) => {
  res.json({ 
    message: '🎉 LLXExcel 后端服务器运行正常！',
    timestamp: new Date().toISOString(),
    database: mongoose.connection.readyState === 1 ? 'MongoDB Atlas 已连接' : '数据库未连接'
  });
});

// API 路由组
app.get('/api/test', (req, res) => {
  res.json({ 
    success: true,
    message: '后端 API 连接成功！',
    data: { 
      server: 'running', 
      database: mongoose.connection.readyState === 1 ? 'connected' : 'disconnected',
      databaseType: 'MongoDB Atlas'
    }
  });
});

// 添加文档相关路由
const documentRoutes = require('./routes/documentRoutes');
app.use('/api', documentRoutes);

// 文档分析API
app.post('/api/analyze-document', upload.single('document'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({
        success: false,
        message: '没有上传文件'
      });
    }

    console.log('收到文件:', req.file.originalname, '类型:', req.file.mimetype);

    // 解析文档内容
    let documentText = '';
    
    if (req.file.mimetype === 'application/pdf') {
      // 解析PDF
      const fileBuffer = fs.readFileSync(req.file.path);
      const pdfData = await pdfParse(fileBuffer);
      documentText = pdfData.text;
    } else if (req.file.mimetype === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document') {
      // 解析Word (.docx)
      const wordData = await mammoth.extractRawText({ path: req.file.path });
      documentText = wordData.value;
    } else if (req.file.mimetype === 'application/msword') {
      // 老版本Word (.doc) - 简单处理
      const fileBuffer = fs.readFileSync(req.file.path);
      documentText = fileBuffer.toString('utf8');
    }

    console.log('提取文本长度:', documentText.length);

    // 加载公司定价表
    const pricingData = loadPricingTable();
    
    // 使用简单关键词匹配算法（后续可升级为AI）
    const matchedServices = analyzeDocumentForServices(documentText, pricingData);

    // 清理上传的临时文件
    fs.unlinkSync(req.file.path);

    res.json({
      success: true,
      message: '文档分析完成',
      services: matchedServices,
      documentLength: documentText.length
    });

  } catch (error) {
    console.error('文档分析错误:', error);
    
    // 清理临时文件
    if (req.file && fs.existsSync(req.file.path)) {
      fs.unlinkSync(req.file.path);
    }

    res.status(500).json({
      success: false,
      message: '文档分析失败',
      error: error.message
    });
  }
});

// 加载公司定价表
function loadPricingTable() {
  try {
    const pricingPath = path.join(__dirname, 'Resource', 'LLX GRDA-21-02 (BMFS)_RFP 01JUL2025.xlsx');
    
    if (!fs.existsSync(pricingPath)) {
      console.log('定价表文件不存在，使用默认数据');
      return getDefaultPricingData();
    }

    const workbook = XLSX.readFile(pricingPath);
    const sheetName = workbook.SheetNames[0];
    const worksheet = workbook.Sheets[sheetName];
    const jsonData = XLSX.utils.sheet_to_json(worksheet);
    
    console.log('成功加载定价表，共', jsonData.length, '条记录');
    return jsonData;
    
  } catch (error) {
    console.error('加载定价表失败:', error);
    return getDefaultPricingData();
  }
}

// 默认定价数据（示例）
function getDefaultPricingData() {
  return [
    { service: 'Business Consulting', keywords: ['consulting', 'business', 'strategy', 'advisory'], price: 5000 },
    { service: 'Financial Analysis', keywords: ['financial', 'analysis', 'audit', 'accounting'], price: 3000 },
    { service: 'Market Research', keywords: ['market', 'research', 'survey', 'analysis'], price: 2500 },
    { service: 'Risk Assessment', keywords: ['risk', 'assessment', 'compliance', 'security'], price: 4000 },
    { service: 'Project Management', keywords: ['project', 'management', 'planning', 'coordination'], price: 3500 },
    { service: 'Training Services', keywords: ['training', 'education', 'workshop', 'seminar'], price: 2000 },
    { service: 'IT Support', keywords: ['IT', 'technology', 'support', 'infrastructure'], price: 1500 },
    { service: 'Legal Services', keywords: ['legal', 'contract', 'compliance', 'regulatory'], price: 6000 }
  ];
}

// 文档服务分析算法
function analyzeDocumentForServices(documentText, pricingData) {
  const text = documentText.toLowerCase();
  const matchedServices = [];
  
  pricingData.forEach(item => {
    const keywords = item.keywords || [];
    let matchCount = 0;
    
    keywords.forEach(keyword => {
      if (text.includes(keyword.toLowerCase())) {
        matchCount++;
      }
    });
    
    // 如果匹配到至少一个关键词，就认为需要该服务
    if (matchCount > 0) {
      matchedServices.push({
        name: item.service,
        price: item.price,
        matchScore: matchCount,
        keywords: keywords.filter(k => text.includes(k.toLowerCase()))
      });
    }
  });
  
  // 按匹配分数排序
  matchedServices.sort((a, b) => b.matchScore - a.matchScore);
  
  console.log('匹配到', matchedServices.length, '个服务项目');
  return matchedServices;
}

// 错误处理中间件
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).json({ 
    success: false,
    message: '服务器内部错误',
    error: process.env.NODE_ENV === 'development' ? err.message : '内部错误'
  });
});

// 404 处理
app.use('*', (req, res) => {
  res.status(404).json({ 
    success: false,
    message: '请求的路径不存在',
    path: req.originalUrl
  });
});

// 启动服务器
const PORT = process.env.PORT || 4000;

// 使用HTTPS启动服务器（使用Office开发证书）
const certPath = process.env.HOME + '/.office-addin-dev-certs/localhost.crt';
const keyPath = process.env.HOME + '/.office-addin-dev-certs/localhost.key';

if (fs.existsSync(certPath) && fs.existsSync(keyPath)) {
  const httpsOptions = {
    key: fs.readFileSync(keyPath),
    cert: fs.readFileSync(certPath)
  };
  
  https.createServer(httpsOptions, app).listen(PORT, () => {
    console.log(`🚀 LLX Excel Business Cost 服务器运行在 https://localhost:${PORT}`);
    console.log(`📝 环境: ${process.env.NODE_ENV || 'development'}`);
    console.log(`🌐 数据库: MongoDB Atlas`);
    console.log(`🔒 SSL: 已启用 (使用Office开发证书)`);
    console.log(`📊 API 端点:`);
    console.log(`  GET  /api/test - 测试连接`);
    console.log(`  POST /api/upload-document - 上传Clinical Protocol (支持结构化解析)`);
    console.log(`  GET  /api/documents - 获取已上传的文档列表`);
    console.log(`  GET  /api/documents/:id/content - 获取文档的详细结构化内容`);
    console.log(`  PATCH /api/documents/:id/confirm-sdtm - 确认SDTM分析结果`);
    console.log(`  GET  /api/documents/:id/export-schedule - 导出评估时间表为Excel文件`);
  });
} else {
  // 如果没有找到证书，使用HTTP（开发模式）
  app.listen(PORT, () => {
    console.log(`🚀 服务器运行在 http://localhost:${PORT}`);
    console.log(`📝 环境: ${process.env.NODE_ENV || 'development'}`);
    console.log(`🌐 数据库: MongoDB Atlas`);
    console.log(`⚠️  警告: 未找到HTTPS证书，使用HTTP模式`);
  });
}

module.exports = app;