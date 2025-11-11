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
    ,
    // 🔥 新增：Endpoints 抽取结果（可变长度）
    endpoints: [{
      category: { type: String, enum: ['Primary', 'Secondary', 'Safety', 'Exploratory', 'Other'], default: 'Other' },
      title: { type: String },
      cleanedTitle: { type: String },
      content: { type: String },
      level: { type: Number },
      sectionIndex: { type: Number },
      extractMethod: { type: String, enum: ['ai', 'rule'], default: 'ai' }
    }],
    
    // 🔥 新增：Inclusion/Exclusion Criteria 及其他 Criteria 抽取结果
    criterias: {
      type: mongoose.Schema.Types.Mixed,
      default: {}
      // 示例结构: 
      // {
      //   inclusion_criteria: [{ title, level, content, sectionIndex, originalTitle }],
      //   exclusion_criteria: [{ title, level, content, sectionIndex, originalTitle }],
      //   ...其他criteria类型
      // }
    },
    
    // 🔥 Study Design section and all its subsections extraction result
    studyDesign: {
      type: mongoose.Schema.Types.Mixed,
      default: null
      // Structure example: 
      // {
      //   title: "STUDY DESIGN",
      //   level: 1,
      //   sectionIndex: 5,
      //   content: "This is a Phase III study...",
      //   number: "3",
      //   source: "pattern",
      //   children: [
      //     { title: "Study Design Overview", level: 2, sectionIndex: 6, content: "...", number: "3.1" },
      //     { title: "Study Population", level: 2, sectionIndex: 7, content: "...", number: "3.2" },
      //     { title: "Inclusion Criteria", level: 3, sectionIndex: 8, content: "...", number: "3.2.1" },
      //     ...
      //   ]
      // }
      // If multiple Study Design blocks exist: { blocks: [...] }
    },
    
    // 🔥 Objectives section and all its subsections extraction result (with GPT fallback)
    objectives: {
      type: mongoose.Schema.Types.Mixed,
      default: null
      // Structure identical to studyDesign, with additional tracking fields:
      // {
      //   title: "OBJECTIVES",
      //   level: 1,
      //   sectionIndex: 3,
      //   content: "The primary objective of this study...",
      //   number: "2",
      //   source: "pattern",
      //   extractionMethod: "regex" | "gpt",  // How it was identified
      //   gptConfidence: 0.85,  // (Optional) If GPT was used, confidence score
      //   gptReason: "...",     // (Optional) If GPT was used, explanation
      //   children: [
      //     { title: "Primary Objective", level: 2, sectionIndex: 4, content: "...", number: "2.1" },
      //     { title: "Secondary Objectives", level: 2, sectionIndex: 5, content: "...", number: "2.2" },
      //     ...
      //   ]
      // }
      // If multiple Objectives blocks exist (rare): { blocks: [...] }
    }
  }
}, { _id: false });

// CRF-specific file slot schema - 专用于CRF文件
const CrfFileSlotSchema = new mongoose.Schema({
  uploaded: { type: Boolean, default: false },
  originalName: { type: String },
  fileSize: { type: Number },
  mimeType: { type: String },
  uploadedAt: { type: Date },
  // 🔥 持久化与标注相关字段
  sourcePath: { type: String },
  annotatedPath: { type: String },
  annotationReady: { type: Boolean, default: false },
  annotatedAt: { type: Date },
  downloadUrl: { type: String },  // 🔥 新增：注解PDF下载链接
  // 🔥 新增：SDTM分析完成状态（GPT分析完成后设置为true）
  crf_sdtm_ready_for_annotation: { type: Boolean, default: false },
  crfUploadResult: {
    crfFormList: { type: mongoose.Schema.Types.Mixed, default: {} },
    crfFormName: { type: mongoose.Schema.Types.Mixed, default: {} },
    Extract_words_with_position: { type: mongoose.Schema.Types.Mixed, default: {} },
    Extract_rows_with_position: { type: mongoose.Schema.Types.Mixed, default: {} },
    // ✅ 新增：AI识别到的页眉/页脚/页码/Form名称pattern集合
    identified_patterns: { type: mongoose.Schema.Types.Mixed, default: {} }
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
      of: [{ type: String }], // ADaM域 -> [SDTM域数组]
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
    mappings: { type: Map, of: [{ type: String }], default: new Map() },
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
    crf: { type: CrfFileSlotSchema, default: {} },
    sap: { type: FileSlotSchema, default: {} }
  },


  projectDone: {
    isCostEstimate: { type: Boolean, default: null },
    isSasAnalysis: { type: Boolean, default: null }
  },

  CostEstimateDetails: { type: CostEstimateDetailsSchema, default: {} },
  SasAnalysisDetails: { type: mongoose.Schema.Types.Mixed, default: {} },

  // 🔥 新增：Spec分析数据结构 - 完整的12个表格定义
  Spec: {
    first_version: {
      // 1. Study表格 - Attribute, Value
      Study: {
        table_title: [{ type: String }], // ['Attribute', 'Value']
        table_content: [{ 
          // 每行格式：{Attribute: "属性名", Value: "属性值"}
          Attribute: { type: String },
          Value: { type: String }
        }],
        created_at: { type: Date, default: Date.now },
        updated_at: { type: Date, default: Date.now },
        status: { type: String, enum: ['false', 'created', 'confirmed'], default: 'false' } // 🔥 新增
      },
      
      // 2. Updated Tracker表格 - 4个字段
      UpdatedTracker: {
        table_title: [{ type: String }], // ['Changed by (initials)', 'Date Specs Updated', 'Domain Updated', 'Update Description']
        table_content: [{
          "Changed by (initials)": { type: String },
          "Date Specs Updated": { type: String },
          "Domain Updated": { type: String },
          "Update Description": { type: String }
        }],
        created_at: { type: Date, default: Date.now },
        updated_at: { type: Date, default: Date.now },
        status: { type: String, enum: ['false', 'created', 'confirmed'], default: 'false' } // 🔥 新增
      },
      
      // 3. Datasets表格 - 6个字段
      Datasets: {
        table_title: [{ type: String }], // ['Dataset', 'Description', 'Class', 'Structure', 'Purpose', 'Key Variables']
        table_content: [{
          Dataset: { type: String },
          Description: { type: String },
          Class: { type: String },
          Structure: { type: String },
          Purpose: { type: String },
          "Key Variables": { type: String }
        }],
        created_at: { type: Date, default: Date.now },
        updated_at: { type: Date, default: Date.now },
        status: { type: String, enum: ['false', 'created', 'confirmed'], default: 'false' } // 🔥 新增
      },
      
      // 4. Variables表格 - 10个字段 (新增Core字段)
      Variables: {
        table_title: [{ type: String }], // ['Dataset', 'Variable', 'Label', 'Data Type', 'Length', 'Format', 'Origin', 'Method Keyword', 'Source/Derivation', 'Core']
        table_content: [{
          Dataset: { type: String },
          Variable: { type: String },
          Label: { type: String },
          "Data Type": { type: String },
          Length: { type: String },
          Format: { type: String },
          Origin: { type: String },
          "Method Keyword": { type: String },
          "Source/Derivation": { type: String },
          Core: { type: String } // 🔥 新增：CDISC Core字段
        }],
        created_at: { type: Date, default: Date.now },
        updated_at: { type: Date, default: Date.now },
        status: { type: String, enum: ['false', 'created', 'confirmed'], default: 'false' } // 🔥 新增
      },
      
      // 5. Methods表格 - 3个字段
      Methods: {
        table_title: [{ type: String }], // ['Method Keyword', 'Name', 'Description']
        table_content: [{
          "Method Keyword": { type: String },
          Name: { type: String },
          Description: { type: String }
        }],
        created_at: { type: Date, default: Date.now },
        updated_at: { type: Date, default: Date.now },
        status: { type: String, enum: ['false', 'created', 'confirmed'], default: 'false' } // 🔥 新增
      },
      
      // 6. TESTCD_Details表格 - 32个字段
      TESTCD_Details: {
        table_title: [{ type: String }], // 完整的32个字段表头
        table_content: [{
          Dataset: { type: String },
          "--TESTCD Value": { type: String },
          "--TEST Value": { type: String },
          "Raw Dataset Name or External Source Name": { type: String },
          "Selection Criteria": { type: String },
          "--CAT Value": { type: String },
          "--SCAT Value": { type: String },
          "--STAT Source/Derivation": { type: String },
          "--REASND Source/Derivation": { type: String },
          "--ORRES Source/Derivation": { type: String },
          "--ORRESU Source/Derivation": { type: String },
          "--STRESC Source/Derivation": { type: String },
          "--STRESN Source/Derivation": { type: String },
          "--STRESU Source/Derivation": { type: String },
          "--DTC Source/Derivation": { type: String },
          "--CLSIG Source/Derivation": { type: String },
          "--POS Source/Derivation": { type: String },
          "--LAT Source/Derivation": { type: String },
          "--LOC Source/Derivation": { type: String },
          "--DIR Source/Derivation": { type: String },
          "--NAM Source/Derivation": { type: String },
          "--SPEC Source/Derivation": { type: String },
          "--OBJ Value": { type: String },
          "--METHOD Source/Derivation": { type: String },
          FOCID: { type: String },
          "TSTDTL Source/Derivation": { type: String },
          "--EVLINT Source/Derivation": { type: String },
          "--EVINTX Source/Derivation": { type: String },
          "--EVAL Source/Derivation": { type: String },
          "--EVALINT Source/Derivation": { type: String },
          "RAW Variable 1": { type: String },
          "RAW Variable 2": { type: String }
        }],
        created_at: { type: Date, default: Date.now },
        updated_at: { type: Date, default: Date.now },
        status: { type: String, enum: ['false', 'created', 'confirmed'], default: 'false' } // 🔥 新增
      },
      
      // 7. SUPP_Details表格 - 10个字段
      SUPP_Details: {
        table_title: [{ type: String }], // ['Dataset', 'QNAM', 'QLABEL', 'Raw Dataset Name or External Source Name', 'Selection Criteria', 'IDVAR', 'IDVARVAL', 'QVAL', 'QORIG', 'QEVAL']
        table_content: [{
          Dataset: { type: String },
          QNAM: { type: String },
          QLABEL: { type: String },
          "Raw Dataset Name or External Source Name": { type: String },
          "Selection Criteria": { type: String },
          IDVAR: { type: String },
          IDVARVAL: { type: String },
          QVAL: { type: String },
          QORIG: { type: String },
          QEVAL: { type: String }
        }],
        created_at: { type: Date, default: Date.now },
        updated_at: { type: Date, default: Date.now },
        status: { type: String, enum: ['false', 'created', 'confirmed'], default: 'false' } // 🔥 新增
      },
      
      // 8. TA_Data表格 - 10个字段
      TA_Data: {
        table_title: [{ type: String }], // ['STUDYID', 'DOMAIN', 'ARMCD', 'ARM', 'TAETORD', 'ETCD', 'ELEMENT', 'TABRANCH', 'TATRANS', 'EPOCH']
        table_content: [{
          STUDYID: { type: String },
          DOMAIN: { type: String },
          ARMCD: { type: String },
          ARM: { type: String },
          TAETORD: { type: String },
          ETCD: { type: String },
          ELEMENT: { type: String },
          TABRANCH: { type: String },
          TATRANS: { type: String },
          EPOCH: { type: String }
        }],
        created_at: { type: Date, default: Date.now },
        updated_at: { type: Date, default: Date.now },
        status: { type: String, enum: ['false', 'created', 'confirmed'], default: 'false' } // 🔥 新增
      },
      
      // 9. TE_Data表格 - 7个字段
      TE_Data: {
        table_title: [{ type: String }], // ['STUDYID', 'DOMAIN', 'ETCD', 'ELEMENT', 'TESTRL', 'TEENRL', 'TEDUR']
        table_content: [{
          STUDYID: { type: String },
          DOMAIN: { type: String },
          ETCD: { type: String },
          ELEMENT: { type: String },
          TESTRL: { type: String },
          TEENRL: { type: String },
          TEDUR: { type: String }
        }],
        created_at: { type: Date, default: Date.now },
        updated_at: { type: Date, default: Date.now },
        status: { type: String, enum: ['false', 'created', 'confirmed'], default: 'false' } // 🔥 新增
      },
      
      // 10. TI_Data表格 - 6个字段
      TI_Data: {
        table_title: [{ type: String }], // ['STUDYID', 'DOMAIN', 'IETESTCD', 'IETEST', 'IECAT', 'TIVERS']
        table_content: [{
          STUDYID: { type: String },
          DOMAIN: { type: String },
          IETESTCD: { type: String },
          IETEST: { type: String },
          IECAT: { type: String },
          TIVERS: { type: String }
        }],
        created_at: { type: Date, default: Date.now },
        updated_at: { type: Date, default: Date.now },
        status: { type: String, enum: ['false', 'created', 'confirmed'], default: 'false' } // 🔥 新增
      },
      
      // 11. TV_Data表格 - 7个字段
      TV_Data: {
        table_title: [{ type: String }], // ['STUDYID', 'DOMAIN', 'VISITNUM', 'VISIT', 'ARMCD', 'TVSTRL', 'TVENRL']
        table_content: [{
          STUDYID: { type: String },
          DOMAIN: { type: String },
          VISITNUM: { type: String },
          VISIT: { type: String },
          ARMCD: { type: String },
          TVSTRL: { type: String },
          TVENRL: { type: String }
        }],
        created_at: { type: Date, default: Date.now },
        updated_at: { type: Date, default: Date.now },
        status: { type: String, enum: ['false', 'created', 'confirmed'], default: 'false' } // 🔥 新增
      },
      
      // 12. TS_Data表格 - 21个字段（增加TSVAL1-TSVAL10和metadata）
      TS_Data: {
        table_title: [{ type: String }],
        table_content: [{
          STUDYID: { type: String },
          DOMAIN: { type: String },
          TSSEQ: { type: String },
          TSGRPID: { type: String },
          TSPARMCD: { type: String },
          TSPARM: { type: String },
          TSVAL: { type: String },
          TSVAL1: { type: String },   // 🔥 新增：TSVAL超过200字符时的第2段
          TSVAL2: { type: String },   // 🔥 新增：第3段
          TSVAL3: { type: String },   // 🔥 新增：第4段
          TSVAL4: { type: String },   // 🔥 新增：第5段
          TSVAL5: { type: String },   // 🔥 新增：第6段
          TSVAL6: { type: String },   // 🔥 新增：第7段
          TSVAL7: { type: String },   // 🔥 新增：第8段
          TSVAL8: { type: String },   // 🔥 新增：第9段
          TSVAL9: { type: String },   // 🔥 新增：第10段
          TSVAL10: { type: String },  // 🔥 新增：第11段（最多支持2200字符）
          TSVALNF: { type: String },
          TSVALCD: { type: String },
          TSVCDREF: { type: String },
          TSVCDVER: { type: String }
        }],
        metadata: {
          maxTSVALColumns: { type: Number, default: 1 } // 🔥 新增：记录实际使用的最大TSVAL列数
        },
        created_at: { type: Date, default: Date.now },
        updated_at: { type: Date, default: Date.now },
        status: { type: String, enum: ['false', 'created', 'confirmed'], default: 'false' }
      },

      // 🔥 新增：Dataset-specific Specs 导出信息
      datasetSpecsExport: {
        zipFileName: { type: String },
        zipFileSize: { type: Number },
        zipPath: { type: String },
        downloadUrl: { type: String },
        generated_at: { type: Date },
        datasets_summary: [{
          dataset: { type: String },
          fileName: { type: String },
          size: { type: Number },
          variables: { type: Number },
          testcd: { type: Number },
          supp: { type: Number },
          success: { type: Boolean },
          error: { type: String }
        }]
      }
    }
  },

  // 🔥 新增：可追溯性数据
  traceability: {
    TFL_generation_adam_to_output: {
      success: { type: Boolean, default: false }, // 🔥 新增：TFL生成状态标记
      generatedAt: { type: Date },
      source_domains: [{ type: String }],
      outputs: [{
        adamDataset: { type: String }, // 🔥 新增：对应的ADaM数据集
        num: { type: String },
        type: { type: String, enum: ['Table', 'Figure', 'Listing'] },
        title: { type: String },
        uniqueness: { type: String, enum: ['Unique', 'Repeating'] },
        repeatOf: { type: String },
        correspondingListing: { type: String }
      }],
      summary: {
        uniqueTable: { type: Number, default: 0 },
        repeatTable: { type: Number, default: 0 },
        uniqueFigure: { type: Number, default: 0 },
        repeatFigure: { type: Number, default: 0 },
        uniqueListing: { type: Number, default: 0 },
        repeatListing: { type: Number, default: 0 }
      }
    },
    // 🔥 新增：数据流可追溯性
    dataFlow: {
      lastUpdated: { type: Date },
      hasSDTM: { type: Boolean, default: false },
      hasADaM: { type: Boolean, default: false },
      mappings: [{
        procedure: { type: String }, // 可能为空字符串（手动添加的SDTM域）
        sdtmDomain: { type: String },
        adamDataset: { type: String, default: '' } // ADaM阶段填充
      }]
    }
  },

  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now }
});

StudySchema.pre('save', function(next) {
  this.updatedAt = new Date();
  next();
});

const Study = mongoose.model('Study', StudySchema, 'studies');
module.exports = Study;


