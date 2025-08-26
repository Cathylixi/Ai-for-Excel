const mongoose = require('mongoose');

// Shared file slot schema for different document types under a Study
const FileSlotSchema = new mongoose.Schema({
  uploaded: { type: Boolean, default: false },
  originalName: { type: String },
  fileSize: { type: Number },
  mimeType: { type: String },
  uploadedAt: { type: Date },
  uploadExtraction: {
    extractedText: { type: String },
    
    // 结构化章节 (复制自documentModel.js)
    sectionedText: [{
      title: { type: String, required: true },
      level: { type: Number, required: true }, // 1 for h1, 2 for h2, etc.
      content: { type: String, required: false, default: null }, // Allow null for empty sections
      source: { type: String, enum: ['html', 'pattern', 'content', 'ai', 'pre-numbered', 'table-of-contents'], default: 'html' },
      patternType: { type: String }, // For pattern-detected sections
      titleScore: { type: Number }, // For content-detected sections
      originalLine: { type: String }, // Original line for debugging
      number: { type: String } // Section number (1, 1.1, 1.2.1, etc.)
    }],
    
    // 表格集合 - 支持Word(HTML)和PDF(数组)混合格式 (复制自documentModel.js)
    tables: [{
      // Word文档专用字段
      htmlContent: { type: String, required: false }, // Word表格的完整HTML
      
      // PDF文档专用字段  
      data: { type: [[String]], required: false }, // PDF表格的二维数组数据
      page: { type: Number }, // PDF表格所在页码
      rows: { type: Number }, // PDF表格行数
      columns: { type: Number }, // PDF表格列数
      
      // 通用字段
      source: { type: String, enum: ['word', 'pdf'], required: true }, // 数据来源标识
      tableIndex: { type: Number, required: true }, // 在文档中的表格序号
      extractedAt: { type: Date, default: Date.now }
    }],
    
    // 评估时间表 (复制自documentModel.js)
    assessmentSchedule: {
      htmlContent: { type: String }, // For Word HTML tables
      data: { type: [[String]] },    // For PDF array tables
      tableIndex: { type: Number }, // 该表格在tables数组中的索引
      identifiedBy: { type: String, enum: ['ai', 'ai_pdf', 'keyword', 'manual', 'keyword-backup'], default: 'ai' }, // 识别方法
      source: { type: String, enum: ['word', 'pdf'] }, // Data source of the identified schedule
      page: { type: Number }, // Page number if from PDF
      confidence: { type: Number, min: 0, max: 1 }, // AI识别置信度
      extractedAt: { type: Date, default: Date.now }
    }
  }
}, { _id: false });

// Cost estimate details schema (kept compatible with existing structure)
const CostEstimateDetailsSchema = new mongoose.Schema({
  projectSelection: {
    success: { type: Boolean, default: false },
    selectedProjects: [{ type: String }],
    selectionDetails: { type: mongoose.Schema.Types.Mixed, default: {} },
    selectedAt: { type: Date }
  },
  sdtmAnalysis: {
    success: { type: Boolean, default: false },
    procedures: [{ type: String }],
    mappings: { type: Map, of: { type: String }, default: new Map() },
    summary: {
      total_procedures: { type: Number, default: 0 },
      total_sdtm_domains: { type: Number, default: 0 },
      unique_domains: [{ type: String }],
      highComplexitySdtm: { count: { type: Number, default: 0 }, domains: [{ type: String }] },
      mediumComplexitySdtm: { count: { type: Number, default: 0 }, domains: [{ type: String }] }
    },
    analyzedAt: { type: Date }
  },
  userConfirmedSdtm: {
    success: { type: Boolean, default: false },
    procedures: [{ type: String }],
    mappings: { type: Map, of: { type: String }, default: new Map() },
    summary: {
      total_procedures: { type: Number },
      total_sdtm_domains: { type: Number },
      unique_domains: [{ type: String }],
      highComplexitySdtm: { count: { type: Number }, domains: [{ type: String }] },
      mediumComplexitySdtm: { count: { type: Number }, domains: [{ type: String }] }
    },
    confirmedAt: { type: Date }
  },
  sdtmAnalysisStatus: {
    type: String,
    enum: ['project_selection_done', 'sdtm_ai_analysis_done', 'user_confirmed_sdtm_done', 'adam_ai_analysis_done', 'user_confirmed_adam_done'],
    default: null
  },
  sdtmTableInput: { type: mongoose.Schema.Types.Mixed, default: {} },

  // ADaM分析结果字段（按要求排在 sdtmTableInput 之后）
  adamAnalysis: {
    success: { type: Boolean, default: false },
    mappings: {
      type: Map,
      of: { type: String }, // SDTM域 -> ADaM域字符串的映射（逗号分隔）
      default: new Map()
    },
    summary: {
      total_adam_domains: { type: Number, default: 0 },
      unique_adam_domains: [{ type: String }],
      highComplexityAdam: {
        count: { type: Number, default: 0 },
        domains: [{ type: String }]
      },
      mediumComplexityAdam: {
        count: { type: Number, default: 0 },
        domains: [{ type: String }]
      }
    },
    analyzedAt: { type: Date }
  },
  
  // ✅ 新增：用户确认的ADaM（与 userConfirmedSdtm 对齐，放在 adamAnalysis 之后）
  userConfirmedAdam: {
    success: { type: Boolean, default: false },
    mappings: { type: Map, of: { type: String }, default: new Map() },
    summary: {
      total_adam_domains: { type: Number },
      unique_adam_domains: [{ type: String }],
      highComplexityAdam: { count: { type: Number }, domains: [{ type: String }] },
      mediumComplexityAdam: { count: { type: Number }, domains: [{ type: String }] }
    },
    confirmedAt: { type: Date }
  },

  // ✅ 新增：ADaM表格输入数据快照（与 sdtmTableInput 一致，放在 userConfirmedAdam 之后）
  adamTableInput: { type: mongoose.Schema.Types.Mixed, default: {} }
}, { _id: false });

const StudySchema = new mongoose.Schema({
  studyNumber: { type: String, index: true },

  // Files grouped by slots. Add more slots as needed (icf, csr, etc.)
  files: {
    protocol: { type: FileSlotSchema, default: {} },
    crf: { type: FileSlotSchema, default: {} },
    sap: { type: FileSlotSchema, default: {} }
  },

  projectDone: {
    isCostEstimate: { type: Boolean, default: null },
    isSasAnalysis: { type: Boolean, default: null }
  },

  CostEstimateDetails: { type: CostEstimateDetailsSchema, default: {} },
  SasAnalysisDetails: { type: mongoose.Schema.Types.Mixed, default: {} },

  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now }
});

StudySchema.pre('save', function(next) {
  this.updatedAt = new Date();
  next();
});

const Study = mongoose.model('Study', StudySchema, 'studies');
module.exports = Study;


