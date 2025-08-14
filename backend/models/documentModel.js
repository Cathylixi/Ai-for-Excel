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

  // 新增：研究编号（从文档正文识别）
  studyNumber: { type: String },

  // 🔥 项目完成状态追踪（移到最外层，与studyNumber同级）
  projectDone: {
    // 成本估算是否完成（向导完成标记）
    isCostEstimate: { type: Boolean, default: false },
    // SAS Analysis 完成标记
    isSasAnalysis: { type: Boolean, default: false }
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
  
  // 🔥 成本估算与SDTM相关业务：统一归档到 ProjectCostEstimateDetails
  ProjectCostEstimateDetails: {

    // SDTM分析结果字段 (AI原始分析)
    sdtmAnalysis: {
      success: { type: Boolean, default: false },
      message: { type: String },
      procedures: [{ type: String }],
      mappings: [{
        procedure: { type: String, required: true },
        sdtm_domains: [{ type: String }]
      }],
      summary: {
        total_procedures: { type: Number, default: 0 },
        total_sdtm_domains: { type: Number, default: 0 },
        unique_domains: [{ type: String }],
        highComplexitySdtm: {
          count: { type: Number, default: 0 },
          domains: [{ type: String }]
        },
        mediumComplexitySdtm: {
          count: { type: Number, default: 0 },
          domains: [{ type: String }]
        }
      },
      analyzedAt: { type: Date }
    },

    // 用户确认后的SDTM分析结果
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
        unique_domains: [{ type: String }],
        highComplexitySdtm: {
          count: { type: Number },
          domains: [{ type: String }]
        },
        mediumComplexitySdtm: {
          count: { type: Number },
          domains: [{ type: String }]
        }
      },
      confirmedAt: { type: Date, default: Date.now }
    },

    // SDTM分析状态
    sdtmAnalysisStatus: {
      type: String,
      enum: ['pending_confirmation', 'confirmed'],
      default: 'pending_confirmation'
    },

    // 项目选择详细信息 (简化格式)
    projectSelectionDetails: {
      type: mongoose.Schema.Types.Mixed,
      default: {}
    },

    // 成本估算快照
    costEstimate: {
      type: mongoose.Schema.Types.Mixed,
      default: {}
    }
  },
  
  uploadedAt: { type: Date, default: Date.now }
});

// 指定自定义集合名称为 'clinicalprotocol'
const Document = mongoose.model('Document', DocumentSchema, 'clinicalprotocol');

module.exports = Document; 