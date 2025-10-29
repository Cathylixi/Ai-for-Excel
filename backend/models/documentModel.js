const mongoose = require('mongoose');

// 文档上传数据模型 - 支持结构化存储
const DocumentSchema = new mongoose.Schema({
  originalName: { type: String, required: true },
  fileSize: { type: Number, required: true },
  
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
    isCostEstimate: { type: Boolean, default: null },
    // SAS Analysis 完成标记
    isSasAnalysis: { type: Boolean, default: null }
  },
  
  // 🔁 上传解析产物统一归档到 uploadExtraction（与 projectDone、CostEstimateDetails 同级）
  uploadExtraction: {
    // 传统的完整文本存储（保留兼容性）
    extractedText: { type: String },
    
    // 结构化章节
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
    
    // 表格集合 - 支持Word(HTML)和PDF(数组)混合格式
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
    
    // 评估时间表
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
  },
  
  // 🔥 成本估算与SDTM相关业务：统一归档到 CostEstimateDetails
  CostEstimateDetails: {

    // 🔥 项目选择结果 (Step 3 - Project Selection)
    projectSelection: {
      success: { type: Boolean, default: false }, // 用户是否完成项目选择
      selectedProjects: [{ type: String }], // 用户勾选的项目列表
      selectionDetails: { 
        type: mongoose.Schema.Types.Mixed, 
        default: {} 
      }, // 详细的选择信息
      selectedAt: { type: Date } // 选择完成时间
    },

    // SDTM分析结果字段 (AI原始分析)
    sdtmAnalysis: {
      success: { type: Boolean, default: false },
      procedures: [{ type: String }],
      mappings: {
        type: Map,
        of: { type: String }, // procedure名称 -> SDTM域字符串的映射（逗号分隔）
        default: new Map()
      },
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
      success: { type: Boolean, default: false }, // 🔥 新增：用户确认成功标志
      message: { type: String },
      procedures: [{ type: String }],
      mappings: { type: Map, of: { type: String }, default: new Map() },
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

    // SDTM分析状态 - 新的四步状态机（包含ADaM）
    sdtmAnalysisStatus: {
      type: String,
      enum: ['project_selection_done', 'sdtm_ai_analysis_done', 'user_confirmed_sdtm_done', 'adam_ai_analysis_done'],
      default: null
    },

    // SDTM表格输入数据快照
    sdtmTableInput: {
      type: mongoose.Schema.Types.Mixed,
      default: {}
    },

    // ADaM分析结果字段
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
    }
  },
  
  uploadedAt: { type: Date, default: Date.now }
});

// 指定自定义集合名称为 'clinicalprotocol'
// 🔥 已弃用：现在使用 studyModel.js 来存储所有文档数据
// const Document = mongoose.model('Document', DocumentSchema, 'clinicalprotocol');

// module.exports = Document;
module.exports = null; // 导出 null 以避免引用错误 