const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const https = require('https');
const os = require('os');
require('dotenv').config();

const app = express();

// 中间件
app.use(cors());
app.use(express.json({ limit: '10mb' }));

// MongoDB Atlas 连接
const MONGODB_URI = process.env.MONGODB_URI;
console.log('MongoDB URI:', MONGODB_URI ? '已设置' : '未设置');
console.log('正在连接 MongoDB Atlas...');

mongoose
  .connect(MONGODB_URI)
  .then(() => {
    console.log('✅ MongoDB Atlas 连接成功！');
    console.log('数据库名称:', mongoose.connection.name);
  })
  .catch((err) => {
    console.error('❌ MongoDB Atlas 连接失败:', err.message);
  });

// 健康检查
app.get('/api/test', (req, res) => {
  res.json({
    success: true,
    message: '后端 API 连接成功！',
    data: {
      server: 'running',
      database: mongoose.connection.readyState === 1 ? 'connected' : 'disconnected',
      databaseType: 'MongoDB Atlas',
    },
  });
});

// 业务路由：文档上传/SDTM等
const documentRoutes = require('./routes/documentRoutes');
app.use('/api', documentRoutes);

// 404 处理
app.use('*', (req, res) => {
  res.status(404).json({
    success: false,
    message: '请求的路径不存在',
    path: req.originalUrl,
  });
});

// 启动 HTTPS 服务器（使用 Office Add-in 开发证书）
const PORT = process.env.PORT || 4000;
try {
  const certPath = path.join(os.homedir(), '.office-addin-dev-certs');
  const sslOptions = {
    key: fs.readFileSync(path.join(certPath, 'localhost.key')),
    cert: fs.readFileSync(path.join(certPath, 'localhost.crt')),
  };
  https.createServer(sslOptions, app).listen(PORT, () => {
    console.log(`🚀 LLX Excel Business Cost 服务器运行在 https://localhost:${PORT}`);
    console.log(`📝 环境: ${process.env.NODE_ENV || 'development'}`);
    console.log('🌐 数据库: MongoDB Atlas');
    console.log('🔒 SSL: 已启用 (使用Office开发证书)');
  });
} catch (e) {
  console.error('❌ HTTPS 证书加载失败，请安装 office-addin-dev-certs。错误:', e.message);
  console.log('⚠️ 回退到 HTTP（会触发前端混合内容问题）');
  app.listen(PORT, () => {
    console.log(`🚀 服务器运行在 http://localhost:${PORT}`);
  });
}

module.exports = app;