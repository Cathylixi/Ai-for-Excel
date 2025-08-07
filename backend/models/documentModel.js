const mongoose = require('mongoose');

// 文档上传数据模型 - 支持结构化存储
const DocumentSchema = new mongoose.Schema({
  originalName: { type: String, required: true },
  fileName: { type: String, required: true },
  filePath: { type: String, required: true },
  fileSize: { type: Number, required: true },
  mimeType: { type: String, required: true },
  
  // 文档类型 - 这是唯一需要的分类字段
  protocolType: { 
    type: String, 
    enum: ['Generic', 'ClinicalProtocol', 'Chemistry', 'Other'], 
    default: 'ClinicalProtocol',
    required: true
  },
  specificMetadata: { 
    type: mongoose.Schema.Types.Mixed, 
    default: {} 
  },
  
  // 新增：项目选择和配置参数
  projectSelection: {
    selectedTasks: [{ type: String }], // 用户选中的任务列表
    dataTransferTimes: {
      sdtm: { type: Number, default: 0 }, // SDTM数据传输次数
      adam: { type: Number, default: 0 }  // ADaM数据传输次数
    },
    rerunTimes: {
      dsur: { type: Number, default: 0 }, // DSUR重跑次数
      dsmb: { type: Number, default: 0 }  // DSMB重跑次数
    },
    configuredAt: { type: Date }
  },
  
  // 传统的完整文本存储（保留兼容性）
  extractedText: { type: String },
  
  // 新的结构化存储字段（优化版）
  sectionedText: [{
    title: { type: String, required: true },
    level: { type: Number, required: true }, // 1 for h1, 2 for h2, etc.
    content: { type: String, required: true },
    source: { type: String, enum: ['html', 'pattern', 'content', 'ai'], default: 'html' },
    patternType: { type: String }, // For pattern-detected sections
    titleScore: { type: Number }, // For content-detected sections
    originalLine: { type: String } // Original line for debugging
  }],
  
  tables: [{
    htmlContent: { type: String, required: true }, // 完整的table HTML
    extractedAt: { type: Date, default: Date.now },
    tableIndex: { type: Number, required: true } // 在文档中的表格序号
  }],
  
  // 新增：评估时间表专用字段
  assessmentSchedule: {
    htmlContent: { type: String }, // 识别出的评估时间表HTML
    tableIndex: { type: Number }, // 该表格在tables数组中的索引
    identifiedBy: { type: String, enum: ['ai', 'keyword', 'manual', 'keyword-backup'], default: 'ai' }, // 识别方法
    confidence: { type: Number, min: 0, max: 1 }, // AI识别置信度
    extractedAt: { type: Date, default: Date.now }
  },
  
  // 新增：SDTM分析结果字段 (AI原始分析)
  sdtmAnalysis: {
    success: { type: Boolean, default: false },
    message: { type: String },
    procedures: [{ type: String }], // 从第一列提取的procedures列表
    mappings: [{
      procedure: { type: String, required: true },
      sdtm_domains: [{ type: String }] // 对应的SDTM域列表
    }],
    summary: {
      total_procedures: { type: Number, default: 0 },
      total_sdtm_domains: { type: Number, default: 0 },
      unique_domains: [{ type: String }] // 涉及的所有不同SDTM域
    },
    analyzedAt: { type: Date }
  },
  
  // 新增：用户确认后的SDTM分析结果
  userConfirmedSdtm: {
    success: { type: Boolean },
    message: { type: String },
    procedures: [{ type: String }],
    mappings: [{
      procedure: { type: String, required: true },
      sdtm_domains: [{ type: String }]
    }],
    summary: {
      total_procedures: { type: Number },
      total_sdtm_domains: { type: Number },
      unique_domains: [{ type: String }]
    },
    confirmedAt: { type: Date, default: Date.now }
  },
  
  // 新增：SDTM分析状态
  sdtmAnalysisStatus: {
    type: String,
    enum: ['pending_confirmation', 'confirmed'],
    default: 'pending_confirmation'
  },
  
  // 解析状态信息
  parseInfo: {
    hasStructuredContent: { type: Boolean, default: false },
    sectionsCount: { type: Number, default: 0 },
    tablesCount: { type: Number, default: 0 },
    parseMethod: { type: String }, // 'raw-text' or 'structured-html'
    hasAssessmentSchedule: { type: Boolean, default: false } // 是否识别出评估时间表
  },
  
  uploadedAt: { type: Date, default: Date.now }
});

// 指定自定义集合名称为 'clinicalprotocol'
const Document = mongoose.model('Document', DocumentSchema, 'clinicalprotocol');

module.exports = Document; 