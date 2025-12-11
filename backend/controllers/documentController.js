
// Legacy Document model kept for backward compatibility (not used after migration)
// 🔥 已弃用：现在使用 studyModel.js 来存储所有文档数据
// const Document = require('../models/documentModel');
const Study = require('../models/studyModel');
// =========================
// In-memory CRF annotation progress (per study)
// =========================
const annotationProgressMap = new Map(); // key: studyId, value: progress object

function getDefaultProgress(totalForms = 0, totalBatches = 0) {
  return {
    overall: { totalForms, processedForms: 0, percentage: 0 },
    gptAnalysis: { totalForms, processedForms: 0, percentage: 0, status: 'pending' },
    pdfDrawing: { totalBatches, processedBatches: 0, percentage: 0, status: 'pending' },
    currentPhase: 'gpt',
    // 🔥 新增：表单级状态跟踪数组
    perFormStatuses: [], // [{formKey, gpt_status: 'pending'|'processing'|'done'|'error', updated_at, error}]
    updatedAt: Date.now()
  };
}

function clampPercentage(value) {
  if (typeof value !== 'number' || Number.isNaN(value)) return 0;
  return Math.max(0, Math.min(100, Math.round(value)));
}

function updateAnnotationProgress(studyId, patch) {
  const current = annotationProgressMap.get(studyId) || getDefaultProgress();
  const updated = { ...current };

  if (patch.overall) {
    updated.overall = { ...updated.overall, ...patch.overall };
    if (typeof updated.overall.percentage === 'number') {
      updated.overall.percentage = clampPercentage(updated.overall.percentage);
    }
  }
  if (patch.gptAnalysis) {
    updated.gptAnalysis = { ...updated.gptAnalysis, ...patch.gptAnalysis };
    if (typeof updated.gptAnalysis.percentage === 'number') {
      updated.gptAnalysis.percentage = clampPercentage(updated.gptAnalysis.percentage);
    }
  }
  if (patch.pdfDrawing) {
    updated.pdfDrawing = { ...updated.pdfDrawing, ...patch.pdfDrawing };
    if (typeof updated.pdfDrawing.percentage === 'number') {
      updated.pdfDrawing.percentage = clampPercentage(updated.pdfDrawing.percentage);
    }
  }
  if (patch.currentPhase) {
    updated.currentPhase = patch.currentPhase;
  }

  updated.updatedAt = Date.now();
  annotationProgressMap.set(studyId, updated);
  return updated;
}

function inferProgressFromExistingData(study) {
  const crfData = study?.files?.crf;
  const crfFormList = crfData?.crfUploadResult?.crfFormList || {};
  const totalForms = Object.keys(crfFormList).length;
  const totalBatches = totalForms > 0 ? Math.ceil(totalForms / 5) : 0;

  // 🔥 新增：从数据库重建表单级状态数组
  const perFormStatuses = [];
  Object.keys(crfFormList).forEach(formKey => {
    const form = crfFormList[formKey];
    const gptStatus = form?.gpt_status || 'pending';
    const gptError = form?.gpt_error || null;
    const gptUpdatedAt = form?.gpt_updated_at || null;
    
    perFormStatuses.push({
      formKey,
      gpt_status: gptStatus,
      updated_at: gptUpdatedAt,
      error: gptError
    });
  });
  
  // 统计已完成的表单数（done状态）
  const processedFromDb = perFormStatuses.filter(f => f.gpt_status === 'done').length;

  if (crfData?.annotationReady) {
    return {
      overall: { totalForms, processedForms: totalForms, percentage: 100 },
      gptAnalysis: { totalForms, processedForms: totalForms, percentage: 100, status: 'completed' },
      pdfDrawing: { totalBatches, processedBatches: totalBatches, percentage: 100, status: 'completed' },
      currentPhase: 'completed',
      perFormStatuses, // 🔥 新增
      updatedAt: Date.now()
    };
  }

  // 估算：如果Mapping存在则认为GPT阶段完成
  const hasAnyGptData = Object.values(crfFormList).some(form => Array.isArray(form?.Mapping) && form.Mapping.some(m => Array.isArray(m?.sdtm_mappings) || typeof m?.sdtm_dataset_ai_result === 'string'));
  if (hasAnyGptData) {
    return {
      overall: { totalForms, processedForms: processedFromDb || totalForms, percentage: totalForms ? ((processedFromDb || totalForms) / totalForms) * 100 : 0 },
      gptAnalysis: { totalForms, processedForms: processedFromDb || totalForms, percentage: totalForms ? ((processedFromDb || totalForms) / totalForms) * 100 : 0, status: 'completed' },
      pdfDrawing: { totalBatches, processedBatches: 0, percentage: 0, status: 'running' },
      currentPhase: 'pdf',
      perFormStatuses, // 🔥 新增
      updatedAt: Date.now()
    };
  }

  return {
    overall: { totalForms, processedForms: processedFromDb, percentage: totalForms ? (processedFromDb / totalForms) * 100 : 0 },
    gptAnalysis: { totalForms, processedForms: processedFromDb, percentage: totalForms ? (processedFromDb / totalForms) * 100 : 0, status: 'pending' },
    pdfDrawing: { totalBatches, processedBatches: 0, percentage: 0, status: 'pending' },
    currentPhase: 'gpt',
    perFormStatuses, // 🔥 新增
    updatedAt: Date.now()
  };
}

async function getCrfAnnotationProgress(req, res) {
  try {
    const { studyId } = req.params;
    if (!studyId) return res.status(400).json({ success: false, message: 'Missing studyId' });

    let progress = annotationProgressMap.get(studyId);
    if (!progress) {
      const study = await Study.findById(studyId).select('files.crf');
      progress = inferProgressFromExistingData(study);
    }
    res.json({ success: true, data: progress });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Failed to get progress', error: err.message });
  }
}

async function resetCrfProgress(req, res) {
  try {
    const { studyId } = req.params;
    if (!studyId) return res.status(400).json({ success: false, message: 'Missing studyId' });
    annotationProgressMap.delete(studyId);
    res.json({ success: true, message: 'Progress reset' });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Failed to reset progress', error: err.message });
  }
}

// 🔥 新增：提取protocol信息用于Spec页面
async function extractProtocolInfo(req, res) {
  try {
    const { id } = req.params; // Study ID
    
    console.log('📋 开始提取protocol信息，Study ID:', id);

    // 获取Study数据，只选择protocol相关字段
    const study = await Study.findById(id).select('files.protocol.uploadExtraction.extractedText');
    
    if (!study) {
      return res.status(404).json({ 
        success: false, 
        message: 'Study not found' 
      });
    }

    // 检查protocol文件是否存在
    const protocolText = study.files?.protocol?.uploadExtraction?.extractedText;
    
    if (!protocolText) {
      console.warn('⚠️ Protocol extractedText不存在，返回空值');
      return res.json({
        success: true,
        data: {
          sponsorName: null,
          protocolTitle: null,
          protocolNumber: null,
          message: 'No protocol text available'
        }
      });
    }

    console.log(`📄 Protocol文本长度: ${protocolText.length} 字符`);

    // 调用GPT解析protocol元数据
    const { extractProtocolMetadata } = require('../services/openaiService');
    const metadata = await extractProtocolMetadata(protocolText);

    console.log('✅ Protocol信息提取完成:', metadata);

    return res.json({
      success: true,
      data: {
        sponsorName: metadata.sponsorName,
        protocolTitle: metadata.protocolTitle,
        protocolNumber: metadata.protocolNumber,
        message: 'Protocol metadata extracted successfully'
      }
    });

  } catch (error) {
    console.error('❌ 提取protocol信息失败:', error);
    return res.status(500).json({ 
      success: false, 
      message: 'Failed to extract protocol info', 
      error: error.message 
    });
  }
}

// 🔥 新增：保存Spec Study表格数据到数据库
async function saveSpecStudyData(req, res) {
  try {
    const { id } = req.params; // Study ID
    const { table_title, table_content } = req.body;
    
    console.log('💾 开始保存Spec Study表格数据 (User Confirmed整表覆盖模式)，Study ID:', id);
    console.log('📋 表头数据:', table_title);
    console.log('📊 表格内容:', table_content?.length, '行');

    // 验证输入数据
    if (!Array.isArray(table_title) || !Array.isArray(table_content)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid data format: table_title and table_content must be arrays'
      });
    }

    // 获取Study
    const study = await Study.findById(id);
    if (!study) {
      return res.status(404).json({
        success: false,
        message: 'Study not found'
      });
    }
    
    // 🔥 记录当前数据库状态
    const currentCount = study?.Spec?.first_version?.Study?.table_content?.length || 0;
    console.log(`🔄 [Backend] Study覆盖前数据: ${currentCount} 行，覆盖后数据: ${table_content?.length || 0} 行`);

    // 初始化Spec结构如果不存在
    if (!study.Spec) {
      study.Spec = {};
    }
    if (!study.Spec.first_version) {
      study.Spec.first_version = {};
    }
    if (!study.Spec.first_version.Study) {
      study.Spec.first_version.Study = {
        table_title: [],
        table_content: [],
        created_at: new Date(),
        updated_at: new Date()
      };
    }

    // 更新Study表格数据
    study.Spec.first_version.Study.table_title = table_title;
    study.Spec.first_version.Study.table_content = table_content;
    study.Spec.first_version.Study.updated_at = new Date();

    // 保存到数据库
    await study.save();

    console.log('✅ Spec Study表格数据保存成功');

    return res.json({
      success: true,
      message: 'Spec Study data saved successfully',
      data: {
        studyId: id,
        table_title_count: table_title.length,
        table_content_count: table_content.length,
        saved_at: new Date()
      }
    });

  } catch (error) {
    console.error('❌ 保存Spec Study数据失败:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to save Spec Study data',
      error: error.message
    });
  }
}

// 🔥 新增：导入SDTMIG参考数据到独立collection（一次性操作）
async function importSDTMIGData(req, res) {
  try {
    console.log('🚀 开始导入SDTMIG参考数据到独立collection...');
    
    // 调用提取服务
    const { extractSDTMIGData, validateExtractedData } = require('../services/Spec_SDTMIG_Extraction_Service');
    const SDTMIGReference = require('../models/sdtmigReferenceModel');
    
    // 提取Excel数据
    const extractionResult = await extractSDTMIGData();
    
    if (!extractionResult.success) {
      return res.status(500).json({
        success: false,
        message: 'Failed to extract SDTMIG data',
        error: extractionResult.error
      });
    }
    
    // 验证数据格式
    if (!validateExtractedData(extractionResult)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid SDTMIG data format'
      });
    }
    
    const { Datasets, Variables, Variables_Req, Variables_Perm, Variables_Exp } = extractionResult.data;
    
    console.log('📊 准备导入数据到独立collection:', {
      datasets_rows: Datasets.row_count,
      variables_rows: Variables.row_count,
      variables_req_rows: Variables_Req.row_count,
      variables_perm_rows: Variables_Perm.row_count,
      variables_exp_rows: Variables_Exp.row_count,
      datasets_columns: Datasets.table_title.length,
      variables_columns: Variables.table_title.length
    });
    
    // 🔧 新策略：存储到独立的SDTMIGReference collection
    
    // 1. 检查是否已存在v3.4版本的数据
    const existingRef = await SDTMIGReference.findOne({ version: '3.4' });
    if (existingRef) {
      console.log('📋 发现已存在的SDTMIG v3.4数据，删除旧数据...');
      await SDTMIGReference.deleteOne({ version: '3.4' });
    }
    
    // 2. 创建新的SDTMIG参考数据文档（包含分类Variables）
    const sdtmigRef = new SDTMIGReference({
      version: '3.4',
      Datasets: {
        table_title: Datasets.table_title,
        table_content: Datasets.table_content,
        source_file: Datasets.source_file,
        sheet_name: Datasets.sheet_name,
        total_rows: Datasets.row_count,
        loaded_at: Datasets.loaded_at
      },
      Variables: {
        table_title: Variables.table_title,
        table_content: Variables.table_content,
        source_file: Variables.source_file,
        sheet_name: Variables.sheet_name,
        total_rows: Variables.row_count,
        loaded_at: Variables.loaded_at
      },
      Variables_Req: {
        table_title: Variables_Req.table_title,
        table_content: Variables_Req.table_content,
        Dataset_unique: Variables_Req.Dataset_unique, // 🔥 新增：唯一Dataset Name列表
        source_file: Variables_Req.source_file,
        sheet_name: Variables_Req.sheet_name,
        filter_criteria: Variables_Req.filter_criteria,
        total_rows: Variables_Req.row_count,
        unique_datasets_count: Variables_Req.unique_datasets_count, // 🔥 新增：唯一Dataset数量
        loaded_at: Variables_Req.loaded_at
      },
      Variables_Perm: {
        table_title: Variables_Perm.table_title,
        table_content: Variables_Perm.table_content,
        Dataset_unique: Variables_Perm.Dataset_unique, // 🔥 新增：唯一Dataset Name列表
        source_file: Variables_Perm.source_file,
        sheet_name: Variables_Perm.sheet_name,
        filter_criteria: Variables_Perm.filter_criteria,
        total_rows: Variables_Perm.row_count,
        unique_datasets_count: Variables_Perm.unique_datasets_count, // 🔥 新增：唯一Dataset数量
        loaded_at: Variables_Perm.loaded_at
      },
      Variables_Exp: {
        table_title: Variables_Exp.table_title,
        table_content: Variables_Exp.table_content,
        Dataset_unique: Variables_Exp.Dataset_unique, // 🔥 新增：唯一Dataset Name列表
        source_file: Variables_Exp.source_file,
        sheet_name: Variables_Exp.sheet_name,
        filter_criteria: Variables_Exp.filter_criteria,
        total_rows: Variables_Exp.row_count,
        unique_datasets_count: Variables_Exp.unique_datasets_count, // 🔥 新增：唯一Dataset数量
        loaded_at: Variables_Exp.loaded_at
      },
      imported_at: new Date(),
      imported_by: 'API'
    });
    
    // 3. 保存到数据库
    console.log('💾 保存SDTMIG参考数据到独立collection...');
    const savedRef = await sdtmigRef.save();
    
    console.log('✅ SDTMIG参考数据保存成功，ID:', savedRef._id);
    
    console.log('🎉 SDTMIG数据导入完成');
    
    return res.json({
      success: true,
      message: 'SDTMIG reference data imported successfully to independent collection',
      data: {
        sdtmig_reference_id: savedRef._id,
        datasets: {
          rows: Datasets.row_count,
          columns: Datasets.table_title.length,
          headers: Datasets.table_title
        },
        variables: {
          rows: Variables.row_count,
          columns: Variables.table_title.length,
          headers: Variables.table_title
        },
        variables_req: {
          rows: Variables_Req.row_count,
          columns: Variables_Req.table_title.length,
          unique_datasets: Variables_Req.unique_datasets_count, // 🔥 新增：唯一Dataset数量
          datasets: Variables_Req.Dataset_unique // 🔥 新增：唯一Dataset名称列表
        },
        variables_perm: {
          rows: Variables_Perm.row_count,
          columns: Variables_Perm.table_title.length,
          unique_datasets: Variables_Perm.unique_datasets_count, // 🔥 新增：唯一Dataset数量
          datasets: Variables_Perm.Dataset_unique // 🔥 新增：唯一Dataset名称列表
        },
        variables_exp: {
          rows: Variables_Exp.row_count,
          columns: Variables_Exp.table_title.length,
          unique_datasets: Variables_Exp.unique_datasets_count, // 🔥 新增：唯一Dataset数量
          datasets: Variables_Exp.Dataset_unique // 🔥 新增：唯一Dataset名称列表
        },
        collection: 'sdtmig_reference',
        imported_at: new Date()
      }
    });
    
  } catch (error) {
    console.error('❌ 导入SDTMIG数据失败:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to import SDTMIG data',
      error: error.message
    });
  }
}

// 🔥 修改：获取CRF Dataset列表用于Spec页面 (仅包含CRF实际使用的Dataset)
async function getSDTMIGDatasetsList(req, res) {
  try {
    const { studyId } = req.params; // 从路由参数获取studyId
    console.log('📋 获取CRF Dataset列表，Study ID:', studyId);
    
    // 🔥 从CRF数据中提取所有使用的Dataset
    let crfDatasets = [];
    
    if (studyId) {
      try {
        console.log('🔍 开始从CRF数据中提取Dataset...');
        
        // 获取Study的CRF数据
        const study = await Study.findById(studyId).select('files.crf.crfUploadResult.crfFormList');
        
        if (study?.files?.crf?.crfUploadResult?.crfFormList) {
          const crfFormList = study.files.crf.crfUploadResult.crfFormList;
          const crfUsedDatasets = new Set();
          
          // 遍历所有CRF Form
          Object.keys(crfFormList).forEach(formKey => {
            const form = crfFormList[formKey];
            const mappingUnique = form?.Mapping_corrected_form_sdtm_mapping_unique;
            
            if (Array.isArray(mappingUnique)) {
              mappingUnique.forEach(domainStr => {
                // 🔥 提取Dataset名称：处理两种格式
                // 格式1: "DM (Demographics)" → "DM"
                // 格式2: "CMOTH in SUPPCM" → "SUPPCM"
                let datasetName;
                
                if (domainStr.includes(' in SUPP')) {
                  // 如果是 "xxxxx in SUPPxx" 格式，提取SUPP部分
                  const suppMatch = domainStr.match(/\s+in\s+(SUPP[A-Z0-9]+)/i);
                  datasetName = suppMatch ? suppMatch[1] : domainStr.split(' (')[0].trim();
                } else {
                  // 原有逻辑：从"DM (Demographics)"中提取"DM"
                  datasetName = domainStr.split(' (')[0].trim();
                }
                
                console.log(`🔍 [Dataset提取] "${domainStr}" → "${datasetName}"`);
                
                // 🔥 修改：直接添加所有CRF中出现的Dataset，无任何过滤
                if (datasetName) {
                  crfUsedDatasets.add(datasetName);
                }
              });
            }
          });
          
          crfDatasets = Array.from(crfUsedDatasets).sort();
          console.log('📊 CRF中使用的所有Dataset:', crfDatasets);
          
        } else {
          console.warn('⚠️ Study中没有CRF数据，返回空Dataset列表');
        }
        
      } catch (crfError) {
        console.error('❌ 提取CRF Dataset失败:', crfError.message);
        // 返回空数组作为降级处理
        crfDatasets = [];
      }
    }
    
    // 🔥 新增：合并特殊Dataset (TA, TE, TI, TV, TS)
    const specialDatasets = ['TA', 'TE', 'TI', 'TV', 'TS'];
    const finalDatasets = [...crfDatasets];
    
    specialDatasets.forEach(dataset => {
      if (!finalDatasets.includes(dataset)) {
        finalDatasets.push(dataset);
      }
    });
    
    console.log('📊 最终Dataset列表统计:', {
      crf_datasets_count: crfDatasets.length,
      special_datasets_added: finalDatasets.length - crfDatasets.length,
      total_count: finalDatasets.length,
      final_datasets: finalDatasets
    });
    
    return res.json({
      success: true,
      message: 'Dataset list retrieved successfully (CRF + Special)',
      data: {
        datasets: finalDatasets,
        total_count: finalDatasets.length,
        crf_count: crfDatasets.length,
        special_count: finalDatasets.length - crfDatasets.length,
        source: 'CRF data + Special datasets (TA, TE, TI, TV, TS)'
      }
    });
    
  } catch (error) {
    console.error('❌ 获取CRF Dataset列表失败:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to get CRF Dataset list',
      error: error.message
    });
  }
}

// 🔥 新增：根据Dataset Name查找详细信息
async function getSDTMIGDatasetInfo(req, res) {
  try {
    const { datasetName } = req.params;
    
    console.log('🔍 查找Dataset信息:', datasetName);
    
    const SDTMIGReference = require('../models/sdtmigReferenceModel');
    
    // 获取最新的SDTMIG参考数据
    const sdtmigData = await SDTMIGReference.findOne({ version: '3.4' }).sort({ imported_at: -1 });
    
    if (!sdtmigData) {
      return res.status(404).json({
        success: false,
        message: 'SDTMIG reference data not found'
      });
    }
    
    // 在Datasets.table_content中查找匹配的Dataset
    const datasetInfo = sdtmigData.Datasets.table_content.find(
      row => row['Dataset Name'] === datasetName
    );
    
    if (!datasetInfo) {
      // 🔥 新增：检查是否是SUPP格式的Dataset
      if (datasetName.startsWith('SUPP') && datasetName.length > 4) {
        const baseDomain = datasetName.slice(4); // 去掉"SUPP"前缀
        
        console.log(`🔍 检测到SUPP Dataset: ${datasetName}, Base Domain: ${baseDomain}`);
        
        // 构造SUPP专门信息
        const suppInfo = {
          Dataset: datasetName,
          Description: `Supplemental Qualifiers for ${baseDomain}`,
          Class: 'Relationship', 
          Structure: 'One record per supplemental qualifier per related parent domain record(s)',
          Purpose: 'Tabulation',
          'Key Variables': ''
        };
        
        console.log('✅ 生成SUPP Dataset信息:', suppInfo);
        
        // 返回格式与原有成功情况保持一致
        return res.json({
          success: true,
          message: 'SUPP Dataset information generated successfully',
          data: {
            dataset_name: datasetName,
            dataset_info: suppInfo,
            source: 'Generated for SUPP dataset' // 标识这是生成的数据
          }
        });
      }
      
      // 原有的not found错误（非SUPP格式的未找到数据）
      return res.status(404).json({
        success: false,
        message: `Dataset '${datasetName}' not found in SDTMIG reference data`
      });
    }
    
    // 映射到所需的字段格式
    const mappedInfo = {
      Dataset: datasetInfo['Dataset Name'],
      Description: datasetInfo['Dataset Label'], // Dataset Label → Description
      Class: datasetInfo['Class'],               // Class → Class
      Structure: datasetInfo['Structure'],       // Structure → Structure  
      Purpose: 'Tabulation',                     // 固定值
      'Key Variables': ''                        // 暂时留空，后续可以从Variables中提取
    };
    
    console.log('✅ 找到Dataset信息:', mappedInfo);
    
    return res.json({
      success: true,
      message: 'Dataset information retrieved successfully',
      data: {
        dataset_name: datasetName,
        dataset_info: mappedInfo,
        original_data: datasetInfo // 提供原始数据供参考
      }
    });
    
  } catch (error) {
    console.error('❌ 查找Dataset信息失败:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to get Dataset information',
      error: error.message
    });
  }
}

// 🔥 新增：保存Spec Datasets表格数据到数据库
async function saveSpecDatasetsData(req, res) {
  try {
    const { id } = req.params; // Study ID
    const { table_title, table_content } = req.body;
    
    console.log('💾 开始保存Spec Datasets表格数据 (User Confirmed整表覆盖模式)，Study ID:', id);
    console.log('📋 表头数据:', table_title);
    console.log('📊 表格内容:', table_content?.length, '行');

    // 验证输入数据
    if (!Array.isArray(table_title) || !Array.isArray(table_content)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid data format: table_title and table_content must be arrays'
      });
    }

    // 获取Study
    const study = await Study.findById(id);
    if (!study) {
      return res.status(404).json({
        success: false,
        message: 'Study not found'
      });
    }
    
    // 🔥 记录当前数据库状态
    const currentCount = study?.Spec?.first_version?.Datasets?.table_content?.length || 0;
    console.log(`🔄 [Backend] Datasets覆盖前数据: ${currentCount} 行，覆盖后数据: ${table_content?.length || 0} 行`);

    // 初始化Spec结构如果不存在
    if (!study.Spec) {
      study.Spec = {};
    }
    if (!study.Spec.first_version) {
      study.Spec.first_version = {};
    }
    if (!study.Spec.first_version.Datasets) {
      study.Spec.first_version.Datasets = {
        table_title: [],
        table_content: [],
        created_at: new Date(),
        updated_at: new Date()
      };
    }

    // 更新Datasets表格数据
    study.Spec.first_version.Datasets.table_title = table_title;
    study.Spec.first_version.Datasets.table_content = table_content;
    study.Spec.first_version.Datasets.updated_at = new Date();

    // 保存到数据库
    await study.save();

    console.log('✅ Spec Datasets表格数据保存成功');

    return res.json({
      success: true,
      message: 'Spec Datasets data saved successfully',
      data: {
        studyId: id,
        table_title_count: table_title.length,
        table_content_count: table_content.length,
        saved_at: new Date()
      }
    });

  } catch (error) {
    console.error('❌ 保存Spec Datasets数据失败:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to save Spec Datasets data',
      error: error.message
    });
  }
}

// 🔥 新增：获取CRF Variables数据用于Spec Variables表格
async function getCRFVariablesData(req, res) {
  try {
    const { id } = req.params; // Study ID
    
    console.log('📋 获取CRF Variables数据，Study ID:', id);
    
    // 获取Study的CRF数据
    const study = await Study.findById(id).select('files.crf.crfUploadResult.crfFormList');
    
    if (!study) {
      return res.status(404).json({
        success: false,
        message: 'Study not found'
      });
    }
    
    const crfFormList = study.files?.crf?.crfUploadResult?.crfFormList;
    
    if (!crfFormList || Object.keys(crfFormList).length === 0) {
      return res.status(404).json({
        success: false,
        message: 'No CRF data found for this study'
      });
    }
    
    // 提取所有Form的Mapping数据
    const allMappingData = [];
    
    Object.keys(crfFormList).forEach(formKey => {
      const form = crfFormList[formKey];
      const mappingChecklist = form?.Mapping_corrected_CRF_Annotation_Checklist;
      
      if (Array.isArray(mappingChecklist)) {
        mappingChecklist.forEach(mapping => {
          // 预处理Form_Mapping：提取纯Dataset名称
          const formMappingRaw = mapping.Form_Mapping || '';
          const processedDataset = formMappingRaw.split(' (')[0].trim(); // "DM (Demographics)" → "DM"
          
          allMappingData.push({
            form_name: form.title || formKey,
            form_key: formKey,
            question_number: mapping.Question_Number,
            question_variable: mapping.Question_Variable,
            form_mapping_raw: formMappingRaw,
            processed_dataset: processedDataset,
            page_number: mapping.Page_Number || 'Unknown'
          });
        });
      }
    });
    
    console.log('📊 CRF Variables数据统计:', {
      total_forms: Object.keys(crfFormList).length,
      total_mappings: allMappingData.length,
      unique_datasets: [...new Set(allMappingData.map(m => m.processed_dataset))].length,
      unique_variables: [...new Set(allMappingData.map(m => m.question_variable))].length
    });
    
    return res.json({
      success: true,
      message: 'CRF Variables data retrieved successfully',
      data: {
        study_id: id,
        mapping_data: allMappingData,
        statistics: {
          total_forms: Object.keys(crfFormList).length,
          total_mappings: allMappingData.length,
          unique_datasets: [...new Set(allMappingData.map(m => m.processed_dataset))],
          unique_variables: [...new Set(allMappingData.map(m => m.question_variable))]
        }
      }
    });
    
  } catch (error) {
    console.error('❌ 获取CRF Variables数据失败:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to get CRF Variables data',
      error: error.message
    });
  }
}

// 🔥 新增：保存Spec Variables表格数据到数据库
async function saveSpecVariablesData(req, res) {
  try {
    const { id } = req.params; // Study ID
    const { table_title, table_content } = req.body;
    
    console.log('💾 开始保存Spec Variables表格数据 (User Confirmed整表覆盖模式)，Study ID:', id);
    console.log('📋 表头数据:', table_title);
    console.log('📊 表格内容:', table_content?.length, '行');

    // 验证输入数据
    if (!Array.isArray(table_title) || !Array.isArray(table_content)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid data format: table_title and table_content must be arrays'
      });
    }

    // 获取Study
    const study = await Study.findById(id);
    if (!study) {
      return res.status(404).json({
        success: false,
        message: 'Study not found'
      });
    }
    
    // 🔥 记录当前数据库状态
    const currentCount = study?.Spec?.first_version?.Variables?.table_content?.length || 0;
    console.log(`🔄 [Backend] Variables覆盖前数据: ${currentCount} 行，覆盖后数据: ${table_content?.length || 0} 行`);

    // 初始化Spec结构如果不存在
    if (!study.Spec) {
      study.Spec = {};
    }
    if (!study.Spec.first_version) {
      study.Spec.first_version = {};
    }
    if (!study.Spec.first_version.Variables) {
      study.Spec.first_version.Variables = {
        table_title: [],
        table_content: [],
        created_at: new Date(),
        updated_at: new Date()
      };
    }

    // 更新Variables表格数据
    study.Spec.first_version.Variables.table_title = table_title;
    study.Spec.first_version.Variables.table_content = table_content;
    study.Spec.first_version.Variables.updated_at = new Date();

    // 保存到数据库
    await study.save();

    console.log('✅ Spec Variables表格数据保存成功');

    return res.json({
      success: true,
      message: 'Spec Variables data saved successfully',
      data: {
        studyId: id,
        table_title_count: table_title.length,
        table_content_count: table_content.length,
        saved_at: new Date()
      }
    });

  } catch (error) {
    console.error('❌ 保存Spec Variables数据失败:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to save Spec Variables data',
      error: error.message
    });
  }
}

// 🔥 新增：获取SDTMIG Variables (Core='Req'或'Perm') 用于Spec Variables表格
/*
async function getSDTMIGVariablesReqPerm(req, res) {
  try {
    console.log('📋 获取SDTMIG Variables (Req+Perm)...');
    
    const SDTMIGReference = require('../models/sdtmigReferenceModel');
    
    // 获取最新的SDTMIG参考数据
    const sdtmigData = await SDTMIGReference.findOne({ version: '3.4' }).sort({ imported_at: -1 });
    
    if (!sdtmigData) {
      return res.status(404).json({
        success: false,
        message: 'SDTMIG reference data not found. Please import SDTMIG data first.'
      });
    }
    
    // 从Variables中过滤Core='Req'或'Perm'的记录
    const allVariables = sdtmigData.Variables?.table_content || [];
    const reqPermVariables = allVariables.filter(variable => 
      variable.Core === 'Req' || variable.Core === 'Perm'
    );
    
    console.log('📊 SDTMIG Variables统计:', {
      total_variables: allVariables.length,
      req_perm_variables: reqPermVariables.length,
      req_count: reqPermVariables.filter(v => v.Core === 'Req').length,
      perm_count: reqPermVariables.filter(v => v.Core === 'Perm').length
    });
    
    // 提取表头字段
    const table_title = sdtmigData.Variables?.table_title || [];
    
    console.log('✅ SDTMIG Variables (Req+Perm) 获取成功');
    
    return res.json({
      success: true,
      message: 'SDTMIG Variables (Req+Perm) retrieved successfully',
      data: {
        table_title: table_title,
        variables: reqPermVariables,
        statistics: {
          total_variables: reqPermVariables.length,
          req_count: reqPermVariables.filter(v => v.Core === 'Req').length,
          perm_count: reqPermVariables.filter(v => v.Core === 'Perm').length,
          unique_datasets: [...new Set(reqPermVariables.map(v => v['Dataset Name']))].length
        },
        source: 'sdtmig_reference v3.4'
      }
    });
    
  } catch (error) {
    console.error('❌ 获取SDTMIG Variables失败:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to get SDTMIG Variables',
      error: error.message
    });
  }
}
*/

// 🔥 新增：获取SDTMIG Variables_Exp数据用于CRF Variables信息补充
/*
async function getSDTMIGVariablesExp(req, res) {
  try {
    console.log('📋 获取SDTMIG Variables_Exp数据...');
    
    const SDTMIGReference = require('../models/sdtmigReferenceModel');
    
    // 获取最新的SDTMIG参考数据
    const sdtmigData = await SDTMIGReference.findOne({ version: '3.4' }).sort({ imported_at: -1 });
    
    if (!sdtmigData) {
      return res.status(404).json({
        success: false,
        message: 'SDTMIG reference data not found. Please import SDTMIG data first.'
      });
    }
    
    // 获取Variables_Exp数据
    const expVariables = sdtmigData.Variables_Exp?.table_content || [];
    const table_title = sdtmigData.Variables_Exp?.table_title || [];
    
    console.log('📊 SDTMIG Variables_Exp统计:', {
      total_exp_variables: expVariables.length,
      unique_datasets: [...new Set(expVariables.map(v => v['Dataset Name']))].length
    });
    
    console.log('✅ SDTMIG Variables_Exp数据获取成功');
    
    return res.json({
      success: true,
      message: 'SDTMIG Variables_Exp data retrieved successfully',
      data: {
        table_title: table_title,
        variables_exp: expVariables,
        statistics: {
          total_variables: expVariables.length,
          unique_datasets: [...new Set(expVariables.map(v => v['Dataset Name']))]
        },
        source: 'sdtmig_reference v3.4 Variables_Exp'
      }
    });
    
  } catch (error) {
    console.error('❌ 获取SDTMIG Variables_Exp数据失败:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to get SDTMIG Variables_Exp data',
      error: error.message
    });
  }
}
*/

// 🔥 新增：获取CRF Form列表
async function getCrfFormList(req, res) {
  try {
    const { studyId } = req.params;
    
    console.log('📋 获取CRF Form列表，Study ID:', studyId);
    console.log('🔍 调试 - 请求参数:', { studyId, method: req.method, url: req.url });
    
    const study = await Study.findById(studyId)
      .select('files.crf.crfUploadResult.crfFormList')
      .lean();
    
    console.log('🔍 调试 - Study查询结果:', {
      found: !!study,
      hasFiles: !!study?.files,
      hasCrf: !!study?.files?.crf,
      hasUploadResult: !!study?.files?.crf?.crfUploadResult,
      hasFormList: !!study?.files?.crf?.crfUploadResult?.crfFormList
    });
    
    if (!study) {
      console.error('❌ Study not found with ID:', studyId);
      return res.status(404).json({
        success: false,
        message: 'Study not found'
      });
    }
    
    const crfFormList = study?.files?.crf?.crfUploadResult?.crfFormList;
    console.log('🔍 调试 - CRF FormList:', {
      exists: !!crfFormList,
      type: typeof crfFormList,
      keysCount: crfFormList ? Object.keys(crfFormList).length : 0,
      keys: crfFormList ? Object.keys(crfFormList) : []
    });
    
    if (!crfFormList || Object.keys(crfFormList).length === 0) {
      console.error('❌ No CRF FormList found for study:', studyId);
      return res.status(404).json({
        success: false,
        message: 'No CRF data found for this study'
      });
    }
    
    const formKeys = Object.keys(crfFormList);
    
    console.log('📊 CRF Form列表统计:', {
      total_forms: formKeys.length,
      form_keys: formKeys
    });
    
    return res.json({
      success: true,
      message: 'CRF Form list retrieved successfully',
      data: {
        studyId,
        formKeys,
        totalForms: formKeys.length
      }
    });
    
  } catch (error) {
    console.error('❌ 获取CRF Form列表失败:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to get CRF Form list',
      error: error.message
    });
  }
}

// 🔥 新增：构建单个Form的Excel数据
function buildExcelDataForSingleForm(form, formKey) {
  console.log(`🔧 构建Form ${formKey} 的Excel数据...`);
  console.log('🔍 调试 - Form结构:', {
    formKey,
    hasForm: !!form,
    hasMapping: !!form?.Mapping,
    mappingLength: form?.Mapping?.length || 0,
    hasFormSdtmMapping: !!form?.form_sdtm_mapping_unique,
    formSdtmMappingLength: form?.form_sdtm_mapping_unique?.length || 0
  });
  
  const formName = formKey;
  const formMapping = extractFormMappingString(form.form_sdtm_mapping_unique);
  const formRows = [];
  
  console.log('🔍 调试 - 处理后的Form信息:', {
    formName,
    formMapping,
    formMappingLength: formMapping ? formMapping.length : 0
  });
  
  if (Array.isArray(form.Mapping)) {
    form.Mapping.forEach((mapping, i) => {
      const pageNumber = extractPageNumber(mapping, form);
      const questionNumber = mapping.index || null;
      const question = mapping.label_row || '';
      const questionVariable = extractQuestionVariables(mapping.sdtm_mappings);
      
      formRows.push([
        formName,          // Form Name
        formMapping,       // Form Mapping (整个Form一样)
        pageNumber,        // Page Number
        questionNumber,    // Question Number
        question,          // Question
        questionVariable   // Question Variable
      ]);
    });
  }
  
  console.log(`✅ Form ${formKey} 生成 ${formRows.length} 行Excel数据`);
  return formRows;
}

// 🔥 新增：按Form获取Excel数据
async function getCrfExcelDataByForm(req, res) {
  try {
    const { studyId } = req.params;
    const { formKey } = req.query;
    
    console.log('📋 获取单个Form Excel数据:', { studyId, formKey });
    console.log('🔍 调试 - 请求详情:', { method: req.method, url: req.url, query: req.query });
    
    if (!studyId || !formKey) {
      return res.status(400).json({
        success: false,
        message: 'Missing studyId or formKey parameter'
      });
    }
    
    const study = await Study.findById(studyId)
      .select('files.crf.crfUploadResult.crfFormList')
      .lean();
    
    if (!study) {
      return res.status(404).json({
        success: false,
        message: 'Study not found'
      });
    }
    
    const crfFormList = study?.files?.crf?.crfUploadResult?.crfFormList;
    if (!crfFormList || !crfFormList[formKey]) {
      return res.status(404).json({
        success: false,
        message: `Form ${formKey} not found in CRF data`
      });
    }
    
    const form = crfFormList[formKey];
    const formRows = buildExcelDataForSingleForm(form, formKey);
    
    console.log('📊 单个Form Excel数据统计:', {
      formKey,
      totalRows: formRows.length,
      hasMapping: !!form.Mapping,
      mappingCount: form.Mapping?.length || 0
    });
    
    return res.json({
      success: true,
      message: `Form ${formKey} Excel data generated successfully`,
      data: {
        studyId,
        formKey,
        rows: formRows,
        totalRows: formRows.length,
        headers: ["Form Name", "Form Mapping", "Page Number", "Question Number", "Question", "Question Variable"]
      }
    });
    
  } catch (error) {
    console.error('❌ 获取单个Form Excel数据失败:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to get Form Excel data',
      error: error.message
    });
  }
}

// 🔥 新增：获取所有SDTMIG Variables（不分Core类型）用于新的统一处理逻辑
async function getAllSDTMIGVariables(req, res) {
  try {
    console.log('📋 获取所有SDTMIG Variables（全部Core类型）...');
    
    const SDTMIGReference = require('../models/sdtmigReferenceModel');
    
    // 获取最新的SDTMIG参考数据
    const sdtmigData = await SDTMIGReference.findOne({ version: '3.4' }).sort({ imported_at: -1 });
    
    if (!sdtmigData) {
      return res.status(404).json({
        success: false,
        message: 'SDTMIG reference data not found. Please import SDTMIG data first.'
      });
    }
    
    // 获取所有Variables（不分Core类型）
    const allVariables = sdtmigData.Variables?.table_content || [];
    const table_title = sdtmigData.Variables?.table_title || [];
    
    // Core类型统计
    const coreStats = {};
    allVariables.forEach(v => {
      const core = v.Core;
      coreStats[core] = (coreStats[core] || 0) + 1;
    });
    
    console.log('📊 所有SDTMIG Variables统计:', {
      total_variables: allVariables.length,
      core_distribution: coreStats,
      unique_datasets: [...new Set(allVariables.map(v => v['Dataset Name']))].length
    });
    
    console.log('✅ 所有SDTMIG Variables获取成功');
    
    return res.json({
      success: true,
      message: 'All SDTMIG Variables retrieved successfully',
      data: {
        table_title: table_title,
        variables: allVariables,
        statistics: {
          total_variables: allVariables.length,
          core_distribution: coreStats,
          unique_datasets: [...new Set(allVariables.map(v => v['Dataset Name']))]
        },
        source: 'sdtmig_reference v3.4 Variables (all Core types)'
      }
    });
    
  } catch (error) {
    console.error('❌ 获取所有SDTMIG Variables失败:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to get all SDTMIG Variables',
      error: error.message
    });
  }
}

const { parseWordDocumentStructure } = require('../services/wordParserService');
const { processPdfWithPypdf, formatResultForDatabase, formatResultForCrfSap, pypdfService, extractCrfPositions, extractCrfWordsOnly } = require('../services/pypdfService');
const { processWordsToRows } = require('../services/crf_analysis/words_to_rows_processor');
const { processCrfForms } = require('../services/crf_analysis/crf_form_processor');
const { analyzeSDTMMapping } = require('../services/sdtmAnalysisService');
const { performADaMAnalysis, generateOutputsFromDomains } = require('../services/adamAnalysisService');

/**
 * 🔥 新增：从 sectionedText 中提取所有 Inclusion/Exclusion Criteria 及其他 Criteria 章节
 * @param {Array} sectionedText - 解析后的章节数组
 * @returns {Object} criterias - 按类型分组的 criteria 对象
 * 
 * 返回结构示例:
 * {
 *   inclusion_criteria: [{ title, level, content, sectionIndex, originalTitle }],
 *   exclusion_criteria: [{ title, level, content, sectionIndex, originalTitle }]
 * }
 */
function extractCriteriasFromSections(sectionedText) {
  if (!Array.isArray(sectionedText) || sectionedText.length === 0) {
    console.log('⚠️ sectionedText 为空或无效，跳过 criteria 提取');
    return {};
  }

  const criterias = {};
  let totalCriteriaSectionsFound = 0;

  console.log(`🔍 开始从 ${sectionedText.length} 个章节中提取 Criteria...`);

  sectionedText.forEach((section, index) => {
    if (!section || !section.title) {
      return; // 跳过无效章节
    }

    const originalTitle = section.title;
    // 规范化标题：小写、去空格、去冒号
    const normalizedTitle = originalTitle.trim().toLowerCase().replace(/\s+/g, ' ').replace(/:$/, '');

    // 检测是否为 criteria 类章节
    const criteriaMatch = detectCriteriaType(normalizedTitle);

    if (criteriaMatch) {
      totalCriteriaSectionsFound++;
      
      // criteriaMatch 可能返回单个类型或数组（如 "Inclusion/Exclusion Criteria"）
      const types = Array.isArray(criteriaMatch) ? criteriaMatch : [criteriaMatch];

      types.forEach(type => {
        const normalizedKey = normalizeCriteriaKey(type);
        
        // 初始化数组（如果不存在）
        if (!criterias[normalizedKey]) {
          criterias[normalizedKey] = [];
        }

        // 存储章节信息
        criterias[normalizedKey].push({
          title: section.title,
          level: section.level,
          content: section.content || null,
          sectionIndex: index,
          originalTitle: originalTitle,
          source: section.source,
          number: section.number || null
        });

        console.log(`  ✅ 找到 ${normalizedKey}: "${originalTitle}" (章节 ${index}, level ${section.level})`);
      });
    }
  });

  const criteriaTypeCount = Object.keys(criterias).length;
  console.log(`✅ Criteria 提取完成: 找到 ${totalCriteriaSectionsFound} 个章节，归类为 ${criteriaTypeCount} 种类型`);
  
  // 打印每种类型的数量
  Object.entries(criterias).forEach(([key, sections]) => {
    console.log(`   📋 ${key}: ${sections.length} 个章节`);
  });

  return criterias;
}

/**
 * 检测标题是否为 Criteria 类型，并返回匹配的类型
 * @param {string} normalizedTitle - 规范化后的标题（小写、去空格）
 * @returns {string|Array|null} - 单个类型字符串、类型数组（多个criteria）或 null
 */
function detectCriteriaType(normalizedTitle) {
  // 常见的 criteria 关键词模式
  const criteriaPatterns = [
    // 复合型（包含多个criteria的标题）
    { pattern: /inclusion\s*[\/&]\s*exclusion\s+criteri[ao]n?/i, types: ['inclusion', 'exclusion'] },
    { pattern: /exclusion\s*[\/&]\s*inclusion\s+criteri[ao]n?/i, types: ['exclusion', 'inclusion'] },
    
    // 单独型
    { pattern: /\binclusion\s+criteri[ao]n?\b/i, types: ['inclusion'] },
    { pattern: /\bexclusion\s+criteri[ao]n?\b/i, types: ['exclusion'] },
    { pattern: /\beligibility\s+criteri[ao]n?\b/i, types: ['eligibility'] },
    { pattern: /\bentry\s+criteri[ao]n?\b/i, types: ['entry'] },
    { pattern: /\bdiscontinuation\s+criteri[ao]n?\b/i, types: ['discontinuation'] },
    { pattern: /\bwithdrawal\s+criteri[ao]n?\b/i, types: ['withdrawal'] },
    { pattern: /\brandomization\s+criteri[ao]n?\b/i, types: ['randomization'] },
    { pattern: /\bscreen\s+failure\s+criteri[ao]n?\b/i, types: ['screen_failure'] },
    { pattern: /\benrollment\s+criteri[ao]n?\b/i, types: ['enrollment'] },
    { pattern: /\bstopping\s+criteri[ao]n?\b/i, types: ['stopping'] },
    
    // 通用fallback（包含"criteria"但不属于上述类别）
    { pattern: /\bcriteri[ao]n?\b/i, types: ['other_criteria'] }
  ];

  for (const { pattern, types } of criteriaPatterns) {
    if (pattern.test(normalizedTitle)) {
      // 如果是多类型，返回数组；否则返回单个字符串
      return types.length > 1 ? types : types[0];
    }
  }

  return null; // 不是 criteria 类章节
}

/**
 * 规范化 Criteria 键名（转为下划线格式）
 * @param {string} type - 原始类型（如 'inclusion', 'exclusion'）
 * @returns {string} - 规范化的键名（如 'inclusion_criteria'）
 */
function normalizeCriteriaKey(type) {
  // 特殊处理：如果已经包含 _criteria 后缀，不重复添加
  if (type.endsWith('_criteria')) {
    return type.toLowerCase().replace(/\s+/g, '_');
  }
  
  // 添加 _criteria 后缀
  return `${type.toLowerCase().replace(/\s+/g, '_')}_criteria`;
}

/**
 * 🔥 新增：从 sectionedText 中提取 Study Design 章节及其所有子章节
 * @param {Array} sectionedText - 解析后的章节数组
 * @returns {Object|null} studyDesign - Study Design主章节及其children，若无则返回null
 * 
 * 返回结构示例:
 * {
 *   title: "STUDY DESIGN",
 *   level: 1,
 *   sectionIndex: 5,
 *   content: "This is a Phase III study...",
 *   number: "3",
 *   source: "pattern",
 *   children: [
 *     { title: "Study Design Overview", level: 2, sectionIndex: 6, content: "...", number: "3.1" },
 *     { title: "Study Population", level: 2, sectionIndex: 7, content: "...", number: "3.2" },
 *     ...
 *   ]
 * }
 * 
 * 若有多个Study Design块（罕见），返回：{ blocks: [...] }
 */
function extractStudyDesign(sectionedText) {
  if (!Array.isArray(sectionedText) || sectionedText.length === 0) {
    console.log('⚠️ sectionedText 为空或无效，跳过 Study Design 提取');
    return null;
  }

  console.log(`🔍 开始从 ${sectionedText.length} 个章节中提取 Study Design...`);

  const results = []; // 支持多个Study Design块（虽然罕见）

  for (let i = 0; i < sectionedText.length; i++) {
    const section = sectionedText[i];
    
    if (!section || !section.title) {
      continue; // 跳过无效章节
    }

    const originalTitle = section.title;
    const normalizedTitle = normalizeTitle(originalTitle);

    // 检测是否为 Study Design 主标题
    if (isStudyDesignTitle(normalizedTitle)) {
      const baseLevel = section.level;
      
      console.log(`  ✅ 找到 Study Design 主标题: "${originalTitle}" (索引 ${i}, level ${baseLevel})`);

      const designBlock = {
        title: section.title,
        level: baseLevel,
        sectionIndex: i,
        content: section.content || null,
        number: section.number || null,
        source: section.source,
        children: []
      };

      // 向后扫描收集所有子章节（level > baseLevel）
      let j = i + 1;
      let childCount = 0;

      while (j < sectionedText.length) {
        const nextSection = sectionedText[j];
        
        if (!nextSection || !nextSection.title) {
          j++;
          continue;
        }

        // 如果遇到同级或更高级标题，停止收集
        if (nextSection.level <= baseLevel) {
          console.log(`  🛑 遇到同级/更高级标题 "${nextSection.title}" (level ${nextSection.level})，停止收集子章节`);
          break;
        }

        // 收集子章节
        designBlock.children.push({
          title: nextSection.title,
          level: nextSection.level,
          sectionIndex: j,
          content: nextSection.content || null,
          number: nextSection.number || null,
          source: nextSection.source
        });

        childCount++;
        j++;
      }

      console.log(`  📋 Study Design 块提取完成: 主标题 + ${childCount} 个子章节`);
      results.push(designBlock);

      // 如果只需要第一个Study Design块，可以在这里break
      // 目前继续扫描以支持多个Study Design块（虽然不常见）
    }
  }

  // 返回结果
  if (results.length === 0) {
    console.log('⚠️ 未找到 Study Design 章节');
    return null;
  }

  if (results.length === 1) {
    console.log(`✅ Study Design 提取完成: 1个主块，${results[0].children.length} 个子章节`);
    return results[0];
  } else {
    console.log(`✅ Study Design 提取完成: 找到 ${results.length} 个主块（罕见情况）`);
    return { blocks: results };
  }
}

/**
 * Normalize title for section detection (lowercase, remove extra spaces and trailing colon)
 * @param {string} title - Original title
 * @returns {string} - Normalized title
 */
function normalizeTitle(title) {
  return title.trim().toLowerCase().replace(/\s+/g, ' ').replace(/:$/, '');
}

/**
 * Detect if title is Study Design-related
 * @param {string} normalizedTitle - Normalized title (lowercase, no extra spaces)
 * @returns {boolean} - Whether it's a Study Design title
 */
function isStudyDesignTitle(normalizedTitle) {
  // Common Study Design keyword patterns
  const studyDesignPatterns = [
    /\bstudy\s+design\b/i,                    // "Study Design"
    /\boverall\s+study\s+design\b/i,          // "Overall Study Design"
    /\bstudy\s+design\s+overview\b/i,         // "Study Design Overview"
    /\bdesign\s+of\s+the\s+study\b/i,         // "Design of the Study"
    /\btrial\s+design\b/i,                    // "Trial Design"
    /\bexperimental\s+design\b/i              // "Experimental Design"
  ];

  for (const pattern of studyDesignPatterns) {
    if (pattern.test(normalizedTitle)) {
      return true;
    }
  }

  return false;
}

/**
 * Detect if title is Objectives-related
 * @param {string} normalizedTitle - Normalized title (lowercase, no extra spaces)
 * @returns {boolean} - Whether it's an Objectives title
 */
function isObjectivesTitle(normalizedTitle) {
  // Common Objectives keyword patterns (English and Chinese)
  const objectivesPatterns = [
    /\bobjectives?\b/i,                           // "Objective" or "Objectives"
    /\bstudy\s+objectives?\b/i,                   // "Study Objective(s)"
    /\btrial\s+objectives?\b/i,                   // "Trial Objective(s)"
    /\bprimary\s+and\s+secondary\s+objectives?\b/i, // "Primary and Secondary Objectives"
    /\baims?\s+and\s+objectives?\b/i,             // "Aims and Objectives"
    /\bpurposes?\s+and\s+objectives?\b/i,         // "Purposes and Objectives"
    /\b目[的标]\b/,                                 // Chinese: "目的" or "目标"
    /\b研究目[的标]\b/                              // Chinese: "研究目的" or "研究目标"
  ];

  for (const pattern of objectivesPatterns) {
    if (pattern.test(normalizedTitle)) {
      return true;
    }
  }

  return false;
}

/**
 * Filter out non-content top-level sections (noise) before sending to GPT
 * @param {string} normalizedTitle - Normalized title
 * @returns {boolean} - True if should exclude this section
 */
function shouldExcludeFromObjectivesCandidates(normalizedTitle) {
  const noisePatterns = [
    /\btable\s+of\s+contents?\b/i,          // "Table of Contents"
    /\blist\s+of\s+(tables|figures|abbreviations)\b/i,  // "List of Tables/Figures/Abbreviations"
    /\babbreviations?\b/i,                  // "Abbreviations"
    /\bacronyms?\b/i,                       // "Acronyms"
    /\bappendix\b/i,                        // "Appendix"
    /\breferences?\b/i,                     // "References"
    /\bbibliography\b/i,                    // "Bibliography"
    /\bsignature\s+page\b/i,                // "Signature Page"
    /\bversion\s+history\b/i,               // "Version History"
    /\bchange\s+log\b/i,                    // "Change Log"
    /\brevision\s+history\b/i,              // "Revision History"
    /\backnowledg(e)?ments?\b/i,            // "Acknowledgements"
    /\b目录\b/,                              // Chinese: "目录" (Table of Contents)
    /\b缩略语\b/,                            // Chinese: "缩略语" (Abbreviations)
    /\b附录\b/,                              // Chinese: "附录" (Appendix)
    /\b参考文献\b/                           // Chinese: "参考文献" (References)
  ];

  for (const pattern of noisePatterns) {
    if (pattern.test(normalizedTitle)) {
      return true;
    }
  }

  return false;
}

/**
 * Extract Objectives section and all its subsections from sectionedText
 * Uses regex first, falls back to GPT if no match
 * @param {Array} sectionedText - Array of section objects with {title, level, content, number, source, ...}
 * @returns {Promise<Object|null>} - Objectives block with structure identical to studyDesign, or null if not found
 */
async function extractObjectives(sectionedText) {
  if (!Array.isArray(sectionedText) || sectionedText.length === 0) {
    console.log('⚠️ sectionedText is empty or invalid, skipping Objectives extraction');
    return null;
  }

  console.log(`🔍 Starting Objectives extraction from ${sectionedText.length} sections...`);

  // ========== Step 1: Try regex matching first ==========
  const regexResults = [];

  for (let i = 0; i < sectionedText.length; i++) {
    const section = sectionedText[i];
    
    if (!section || !section.title) {
      continue;
    }

    const normalizedTitle = normalizeTitle(section.title);

    if (isObjectivesTitle(normalizedTitle)) {
      const baseLevel = section.level;
      
      console.log(`  ✅ [REGEX] Found Objectives title: "${section.title}" (index ${i}, level ${baseLevel})`);

      const objectivesBlock = {
        title: section.title,
        level: baseLevel,
        sectionIndex: i,
        content: section.content || null,
        number: section.number || null,
        source: section.source,
        extractionMethod: 'regex',  // Track how it was found
        children: []
      };

      // Collect all subsections (level > baseLevel)
      let j = i + 1;
      let childCount = 0;

      while (j < sectionedText.length) {
        const nextSection = sectionedText[j];
        
        if (!nextSection || !nextSection.title) {
          j++;
          continue;
        }

        // Stop if same-level or higher-level section encountered
        if (nextSection.level <= baseLevel) {
          console.log(`  🛑 Encountered same/higher level section "${nextSection.title}" (level ${nextSection.level}), stopping subsection collection`);
          break;
        }

        // Collect subsection
        objectivesBlock.children.push({
          title: nextSection.title,
          level: nextSection.level,
          sectionIndex: j,
          content: nextSection.content || null,
          number: nextSection.number || null,
          source: nextSection.source
        });

        childCount++;
        j++;
      }

      console.log(`  📋 Objectives block extracted: main title + ${childCount} subsections`);
      regexResults.push(objectivesBlock);
    }
  }

  // If regex found results, return
  if (regexResults.length > 0) {
    if (regexResults.length === 1) {
      console.log(`✅ [REGEX] Objectives extraction complete: 1 main block, ${regexResults[0].children.length} subsections`);
      return regexResults[0];
    } else {
      console.log(`✅ [REGEX] Objectives extraction complete: ${regexResults.length} main blocks (rare case)`);
      return { blocks: regexResults };
    }
  }

  // ========== Step 2: Regex failed, try GPT fallback ==========
  console.log('⚠️ [REGEX] No Objectives section found, trying GPT fallback...');

  // Import GPT function (lazy load to avoid circular dependency)
  const { chooseObjectivesSectionFromCandidates } = require('../services/openaiService');

  // Collect all level-1 sections as candidates
  const level1Sections = [];
  for (let i = 0; i < sectionedText.length; i++) {
    const section = sectionedText[i];
    
    if (!section || !section.title || section.level !== 1) {
      continue;
    }

    const normalizedTitle = normalizeTitle(section.title);

    // Filter out noise sections
    if (shouldExcludeFromObjectivesCandidates(normalizedTitle)) {
      console.log(`  ⏭️ Excluding noise section: "${section.title}"`);
      continue;
    }

    // Collect child titles (first 5 for preview)
    const childTitles = [];
    for (let j = i + 1; j < sectionedText.length && sectionedText[j].level > 1; j++) {
      if (sectionedText[j].title) {
        childTitles.push(sectionedText[j].title);
      }
      if (childTitles.length >= 5) break;
    }

    level1Sections.push({
      originalIndex: i,
      title: section.title,
      number: section.number || null,
      content: section.content || null,
      childTitles: childTitles
    });
  }

  if (level1Sections.length === 0) {
    console.log('⚠️ No valid level-1 sections found for GPT analysis');
    return null;
  }

  console.log(`🤖 Calling GPT with ${level1Sections.length} level-1 section candidates...`);

  // Call GPT to choose
  const gptResult = await chooseObjectivesSectionFromCandidates(level1Sections);

  if (gptResult.selectedIndex === null) {
    console.log(`⚠️ [GPT] No Objectives section identified (confidence: ${gptResult.confidence}, reason: ${gptResult.reason})`);
    return null;
  }

  // GPT selected a valid index
  const selectedCandidate = level1Sections[gptResult.selectedIndex];
  const originalSectionIndex = selectedCandidate.originalIndex;
  const selectedSection = sectionedText[originalSectionIndex];

  console.log(`✅ [GPT] Selected Objectives: "${selectedSection.title}" (index ${originalSectionIndex}, confidence ${gptResult.confidence})`);
  console.log(`  Reason: ${gptResult.reason}`);

  // Build Objectives block (same structure as regex path)
  const baseLevel = selectedSection.level;
  const objectivesBlock = {
    title: selectedSection.title,
    level: baseLevel,
    sectionIndex: originalSectionIndex,
    content: selectedSection.content || null,
    number: selectedSection.number || null,
    source: selectedSection.source,
    extractionMethod: 'gpt',  // Track GPT was used
    gptConfidence: gptResult.confidence,  // Store confidence
    gptReason: gptResult.reason,  // Store reason
    children: []
  };

  // Collect all subsections
  let j = originalSectionIndex + 1;
  let childCount = 0;

  while (j < sectionedText.length) {
    const nextSection = sectionedText[j];
    
    if (!nextSection || !nextSection.title) {
      j++;
      continue;
    }

    if (nextSection.level <= baseLevel) {
      console.log(`  🛑 Encountered same/higher level section "${nextSection.title}" (level ${nextSection.level}), stopping`);
      break;
    }

    objectivesBlock.children.push({
      title: nextSection.title,
      level: nextSection.level,
      sectionIndex: j,
      content: nextSection.content || null,
      number: nextSection.number || null,
      source: nextSection.source
    });

    childCount++;
    j++;
  }

  console.log(`✅ [GPT] Objectives block extracted: main title + ${childCount} subsections`);
  return objectivesBlock;
}


// Document upload handler (Study-level with file slots)
async function uploadDocument(req, res) {
  try {
    console.log('📥 上传请求详情:', {
      hasFile: !!req.file,
      body: req.body,
      headers: req.headers['content-type']
    });
    
    if (!req.file) {
      console.error('❌ 没有接收到文件');
      return res.status(400).json({
        success: false,
        message: '没有上传文件'
      });
    }

    const { documentType, studyNumber: explicitStudyNumber, fileType } = req.body; // fileType: protocol|crf|sap
    
    console.log('收到Clinical Protocol文件:', req.file.originalname, '类型:', req.file.mimetype);

    // 解析文档内容
    let parseResult = {
      extractedText: '',
      sectionedText: [],
      tables: [],
      parseInfo: {
        hasStructuredContent: false,
        sectionsCount: 0,
        tablesCount: 0,
        parseMethod: 'raw-text'
      }
    };
    
    try {
      // 🔥 检查文件类型，CRF/SAP使用专用解析逻辑
      const isProtocol = !fileType || fileType.toLowerCase() === 'protocol';
      
                if (req.file.mimetype === 'application/pdf') {
        console.log('📄 Starting PDF processing...');
            const pypdfResult = await processPdfWithPypdf(req.file.buffer);
        
        if (isProtocol) {
          // Protocol使用完整解析（包含AI）
            parseResult = await formatResultForDatabase(pypdfResult);
          console.log(`✅ Protocol PDF processing completed - Pages: ${pypdfResult.total_pages}, Text length: ${parseResult.extractedText.length}`);
        } else {
          // CRF/SAP使用专用解析（跳过AI）
          parseResult = await formatResultForCrfSap(pypdfResult);
          console.log(`✅ ${fileType.toUpperCase()} PDF processing completed (no AI) - Pages: ${pypdfResult.total_pages}, Text length: ${parseResult.extractedText.length}`);
        }
                    
      } else if (req.file.mimetype === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document') {
        console.log('📝 Starting Word document processing...');
        
        if (isProtocol) {
          // Protocol使用完整解析（包含AI）
        parseResult = await parseWordDocumentStructure(req.file.buffer);
          console.log(`✅ Protocol Word解析完成 - 章节: ${parseResult.parseInfo.sectionsCount}, 表格: ${parseResult.parseInfo.tablesCount}`);
        } else {
          // CRF/SAP使用专用解析（跳过AI）
          parseResult = await parseWordDocumentStructure(req.file.buffer, { skipAssessmentSchedule: true });
          console.log(`✅ ${fileType.toUpperCase()} Word解析完成 (no AI) - 章节: ${parseResult.parseInfo.sectionsCount}, 表格: ${parseResult.parseInfo.tablesCount}`);
        }
        
      } else if (req.file.mimetype === 'application/msword') {
        // 老版本Word (.doc) - 简单处理
        parseResult.extractedText = req.file.buffer.toString('utf8');
        parseResult.parseInfo.parseMethod = 'doc-simple';

        console.log('📄 老版本Word解析完成');
      }
    } catch (parseError) {
      console.warn('文档解析失败:', parseError.message);
      // parseResult 保持默认值（空内容）
    }

    // === Study upsert and file slot update ===
    const derivedStudyNumber = explicitStudyNumber || parseResult.studyNumber || null;
    const slotKey = (fileType || 'protocol').toLowerCase(); // default to protocol

    if (!derivedStudyNumber) {
      console.warn('⚠️ 未识别到studyNumber，仍将创建Study占位记录');
    }

    // Find or create study by studyNumber
    let study = await Study.findOne({ studyNumber: derivedStudyNumber });
    if (!study) {
      study = new Study({ studyNumber: derivedStudyNumber });
    }

    // Ensure files structure exists
    study.files = study.files || {};
    study.files[slotKey] = study.files[slotKey] || {};

    // Fill file slot
    study.files[slotKey].uploaded = true;
    study.files[slotKey].originalName = req.file.originalname;
    study.files[slotKey].fileSize = req.file.size;
    study.files[slotKey].mimeType = req.file.mimetype;
    study.files[slotKey].uploadedAt = new Date();
    
    // 🔥 新增：仅对 Protocol 提取 Inclusion/Exclusion Criteria
    let criterias = {};
    if (slotKey === 'protocol' && Array.isArray(parseResult.sectionedText) && parseResult.sectionedText.length > 0) {
      try {
        console.log('🔍 Protocol 上传: 开始提取 Criteria...');
        criterias = extractCriteriasFromSections(parseResult.sectionedText);
      } catch (criteriaErr) {
        console.warn('⚠️ Criteria 提取失败，将以空对象保存:', criteriaErr.message);
        criterias = {};
      }
    } else if (slotKey !== 'protocol') {
      console.log(`⏭️ ${slotKey.toUpperCase()} 文件: 跳过 Criteria 提取（仅对 Protocol 生效）`);
    }
    
    // 🔥 Extract Study Design section for Protocol only
    let studyDesign = null;
    if (slotKey === 'protocol' && Array.isArray(parseResult.sectionedText) && parseResult.sectionedText.length > 0) {
      try {
        console.log('🔍 Protocol upload: Starting Study Design extraction...');
        studyDesign = extractStudyDesign(parseResult.sectionedText);
      } catch (studyDesignErr) {
        console.warn('⚠️ Study Design extraction failed, saving as null:', studyDesignErr.message);
        studyDesign = null;
      }
    } else if (slotKey !== 'protocol') {
      console.log(`⏭️ ${slotKey.toUpperCase()} file: Skipping Study Design extraction (only for Protocol)`);
    }
    
    // 🔥 Extract Objectives section for Protocol only (with GPT fallback)
    let objectives = null;
    if (slotKey === 'protocol' && Array.isArray(parseResult.sectionedText) && parseResult.sectionedText.length > 0) {
      try {
        console.log('🔍 Protocol upload: Starting Objectives extraction...');
        objectives = await extractObjectives(parseResult.sectionedText);
      } catch (objectivesErr) {
        console.warn('⚠️ Objectives extraction failed, saving as null:', objectivesErr.message);
        objectives = null;
      }
    } else if (slotKey !== 'protocol') {
      console.log(`⏭️ ${slotKey.toUpperCase()} file: Skipping Objectives extraction (only for Protocol)`);
    }
    
    study.files[slotKey].uploadExtraction = {
      extractedText: parseResult.extractedText,
      sectionedText: parseResult.sectionedText,
      tables: parseResult.tables,
      assessmentSchedule: parseResult.assessmentSchedule,
      // Only save for Protocol
      endpoints: slotKey === 'protocol' ? (parseResult.endpoints || []) : undefined,
      // 🔥 Only save criterias for Protocol (extracted before cost estimation)
      criterias: slotKey === 'protocol' ? criterias : undefined,
      // 🔥 Only save studyDesign for Protocol (extracted before cost estimation)
      studyDesign: slotKey === 'protocol' ? studyDesign : undefined,
      // 🔥 Only save objectives for Protocol (extracted before cost estimation, with GPT fallback)
      objectives: slotKey === 'protocol' ? objectives : undefined
    };

    // Write partial sdtm procedures (PDF path) into CostEstimateDetails at study level
    if (parseResult?.sdtmAnalysis?.procedures?.length > 0) {
      study.CostEstimateDetails = study.CostEstimateDetails || {};
      const existing = study.CostEstimateDetails.sdtmAnalysis || {};
      study.CostEstimateDetails.sdtmAnalysis = {
        ...existing,
        success: Boolean(parseResult.sdtmAnalysis.success),
        procedures: parseResult.sdtmAnalysis.procedures,
        summary: parseResult.sdtmAnalysis.summary || {
          total_procedures: parseResult.sdtmAnalysis.procedures?.length || 0,
          total_sdtm_domains: 0,
          unique_domains: [],
          highComplexitySdtm: { count: 0, domains: [] },
          mediumComplexitySdtm: { count: 0, domains: [] }
        }
      };
    }

    // Save study
    const savedStudy = await study.save();

    console.log('✅ Study saved successfully, ID:', savedStudy._id);
    console.log(`📊 Saved data structure:`, {
      sections: parseResult.parseInfo.sectionsCount,
      tables: parseResult.parseInfo.tablesCount,
      hasStructuredContent: parseResult.parseInfo.hasStructuredContent,
      hasAssessmentSchedule: parseResult.parseInfo.hasAssessmentSchedule,
      method: parseResult.parseInfo.parseMethod,
      studyNumber: savedStudy.studyNumber || 'Not found'
    });
    
    // 🔥 成本估算快照（SDTM部分）
    try {
      const sdtmSummary = parseResult?.sdtmAnalysis?.summary;
      if (sdtmSummary) {
        const highCount = Number(sdtmSummary?.highComplexitySdtm?.count || 0);
        const mediumCount = Number(sdtmSummary?.mediumComplexitySdtm?.count || 0);
        const totalDomains = Number(sdtmSummary?.total_sdtm_domains || 0);

        const rates = { costPerHour: 1 };
        const hoursPerUnit = {
          annotatedCrf: 32,
          specsHigh: 3,
          specsMedium: 2,
          prodHigh: 16,
          prodMedium: 10,
          pinnacle21: 6,
          reviewersGuide: 32,
          defineXml: 32,
          xptConversion: 0.2
        };

        const units = {
          annotatedCrf: 1,
          specsHigh: highCount,
          specsMedium: mediumCount,
          prodHigh: highCount,
          prodMedium: mediumCount,
          pinnacle21: 2,
          reviewersGuide: 1,
          defineXml: 1,
          xptConversion: totalDomains
        };

        const estimatedCosts = {};
        Object.keys(units).forEach(key => {
          const unit = Number(units[key] || 0);
          const cpu = rates.costPerHour * Number(hoursPerUnit[key] || 0);
          estimatedCosts[key] = Number((unit * cpu).toFixed(2));
        });

        const subtotal = Object.values(estimatedCosts).reduce((acc, v) => acc + Number(v || 0), 0);

        // 组装目标结构（嵌套路径）
        savedStudy.CostEstimateDetails = savedStudy.CostEstimateDetails || {};
        const nestedCost = savedStudy.CostEstimateDetails.sdtmTableInput || {};
        nestedCost['SDTM Datasets Production and Validation'] = { units, estimatedCosts, subtotal };
        nestedCost.createdAt = new Date();
        savedStudy.CostEstimateDetails.sdtmTableInput = nestedCost;
        await savedStudy.save();
        console.log('💾 已保存SDTM成本估算快照');
      }
    } catch (costErr) {
      console.warn('⚠️ 生成SDTM成本估算快照失败:', costErr.message);
    }



    res.json({
      success: true,
      message: 'Study file uploaded successfully',
      uploadId: savedStudy._id,
      fileName: req.file.originalname,
      fileSize: req.file.size,
      extractedLength: parseResult.extractedText.length,
      protocolType: 'ClinicalProtocol', // kept for compatibility
      studyNumber: savedStudy.studyNumber || null,
      structuredData: {
        sectionsCount: parseResult.parseInfo.sectionsCount,
        tablesCount: parseResult.parseInfo.tablesCount,
        hasStructuredContent: parseResult.parseInfo.hasStructuredContent,
        hasAssessmentSchedule: parseResult.parseInfo.hasAssessmentSchedule,
        parseMethod: parseResult.parseInfo.parseMethod,
        totalPages: parseResult.parseInfo.totalPages || 0,
        assessmentSchedule: parseResult.assessmentSchedule ? {
          tableIndex: parseResult.assessmentSchedule.tableIndex,
          confidence: parseResult.assessmentSchedule.confidence,
          identifiedBy: parseResult.assessmentSchedule.identifiedBy
        } : null
      },
      // 为前端兼容：直接返回AI分析结果
      sdtmAnalysis: parseResult.sdtmAnalysis,
      costEstimate: (savedStudy.CostEstimateDetails && savedStudy.CostEstimateDetails.sdtmTableInput) || {}
    });

  } catch (error) {
    console.error('Clinical Protocol 上传错误:', error);
    
    res.status(500).json({
      success: false,
      message: 'Clinical Protocol 上传失败',
      error: error.message
    });
  }
}

// 获取Study列表（兼容旧名）
async function getDocuments(req, res) {
  try {
    const studies = await Study.find({}).select('studyNumber files createdAt updatedAt projectDone CostEstimateDetails.sdtmAnalysisStatus').sort({ updatedAt: -1 }).lean();

    const documentsWithSummary = studies.map(s => {
      const proto = s.files?.protocol || {};
      const ex = proto.uploadExtraction || {};
      const sections = Array.isArray(ex.sectionedText) ? ex.sectionedText.length : 0;
      const tables = Array.isArray(ex.tables) ? ex.tables.length : 0;
      return {
        _id: s._id,
        studyNumber: s.studyNumber,
        uploadedAt: proto.uploadedAt || s.createdAt,
        protocolUploaded: Boolean(proto.uploaded),
        structuredInfo: {
          hasStructuredContent: sections > 0 || tables > 0,
          sectionsCount: sections,
          tablesCount: tables,
          parseMethod: 'study-level',
          sectionTitles: (ex.sectionedText || []).map(sec => sec.title) || [],
          hasExtractedText: !!ex.extractedText,
          hasAssessmentSchedule: Boolean(ex.assessmentSchedule),
          assessmentSchedule: ex.assessmentSchedule ? {
            tableIndex: ex.assessmentSchedule.tableIndex,
            confidence: ex.assessmentSchedule.confidence,
            identifiedBy: ex.assessmentSchedule.identifiedBy
          } : null
        }
      };
    });

    res.json({
      success: true,
      message: '获取文档列表成功',
      documents: documentsWithSummary
    });

  } catch (error) {
    console.error('获取文档列表错误:', error);
    res.status(500).json({
      success: false,
      message: '获取文档列表失败',
      error: error.message
    });
  }
}

// 🔥 修改：列出未完成的成本估算（projectDone.isCostEstimate为null或false）
async function listIncompleteEstimates(req, res) {
  try {
    // 查询条件：isCostEstimate 不等于 true（包括 null, false, undefined）
    const docs = await Study.find({ 
      $or: [
        { 'projectDone.isCostEstimate': { $ne: true } },
        { 'projectDone.isCostEstimate': { $exists: false } },
        { 'projectDone': { $exists: false } }
      ]
    })
      .select('_id studyNumber files createdAt updatedAt projectDone')
      .sort({ updatedAt: -1 })
      .lean();
    res.json({ success: true, data: docs });
  } catch (error) {
    console.error('查询未完成成本估算失败:', error);
    res.status(500).json({ success: false, message: '查询失败', error: error.message });
  }
}

// 获取Study详细内容（兼容旧路径）
async function getDocumentContent(req, res) {
  try {
    const { id } = req.params;
    const study = await Study.findById(id).lean();
    if (!study) {
      return res.status(404).json({
        success: false,
        message: 'Study 不存在'
      });
    }

    const proto = study.files?.protocol || {};
    const ex = proto.uploadExtraction || {};
    const pced = study.CostEstimateDetails || {};

    res.json({
      success: true,
      message: '获取Study内容成功',
      document: {
        _id: study._id,
        studyNumber: study.studyNumber || null,
        uploadedAt: proto.uploadedAt || study.createdAt,
        // 🔥 完整的 CostEstimateDetails 结构（按你要求的顺序）
        CostEstimateDetails: {
          // 顺序：projectSelection → sdtmAnalysis → userConfirmedSdtm → sdtmAnalysisStatus → sdtmTableInput → adamAnalysis → userConfirmedAdam → adamTableInput
          projectSelection: pced.projectSelection || { success: false, selectedProjects: [], selectionDetails: {} },
          sdtmAnalysis: pced.sdtmAnalysis || null,
          userConfirmedSdtm: pced.userConfirmedSdtm || null,
          sdtmAnalysisStatus: pced.sdtmAnalysisStatus || null,
          sdtmTableInput: pced.sdtmTableInput || {},
          adamAnalysis: pced.adamAnalysis || null,
          userConfirmedAdam: pced.userConfirmedAdam || null,
          adamTableInput: pced.adamTableInput || {}
        },
        
        // 🔥 保持向后兼容的sdtmData结构
        sdtmData: { original: pced.sdtmAnalysis || null, confirmed: pced.userConfirmedSdtm || null, status: pced.sdtmAnalysisStatus || 'pending_confirmation' },
        
        // 文档内容
        content: {
          extractedText: ex.extractedText || null,
          sections: ex.sectionedText || [],
          tables: ex.tables || [],
          assessmentSchedule: ex.assessmentSchedule || null,
          endpoints: Array.isArray(ex.endpoints) ? ex.endpoints : [],
          // 🔥 新增：Inclusion/Exclusion Criteria 及其他 Criteria
          criterias: ex.criterias || {},
          // 🔥 新增：Study Design 章节及其所有子章节
          studyDesign: ex.studyDesign || null
          // Note: internalLinks removed in simplified PDF version
        },
        
        // 🔥 新增：可追溯性数据
        traceability: study.traceability || {}
      }
    });
    
  } catch (error) {
    console.error('获取文档内容错误:', error);
    res.status(500).json({
      success: false,
      message: '获取文档内容失败',
      error: error.message
    });
  }
}

// 🔥 新增：获取CRF数据（包含LabelForm/OIDForm）
async function getCrfData(req, res) {
  try {
    const { studyId } = req.params;
    
    let study = null;
    if (studyId && studyId.match(/^[0-9a-fA-F]{24}$/)) {
      study = await Study.findById(studyId).lean();
    }
    if (!study) {
      study = await Study.findOne({ studyNumber: studyId }).lean();
    }

    if (!study) {
      return res.status(404).json({
        success: false,
        message: 'Study 不存在'
      });
    }

    const crfData = study.files?.crf || {};
    if (!crfData.uploaded) {
      return res.status(404).json({
        success: false,
        message: 'CRF 文件尚未上传'
      });
    }

    return res.json({
      success: true,
      message: '获取CRF数据成功',
      data: {
        studyId: String(study._id),
        studyNumber: study.studyNumber,
        fileInfo: {
          originalName: crfData.originalName,
          fileSize: crfData.fileSize,
          uploadedAt: crfData.uploadedAt
        },
        crfUploadResult: crfData.crfUploadResult || {}
      }
    });

  } catch (error) {
    console.error('❌ Error getting CRF data:', error);
    return res.status(500).json({ 
      success: false, 
      message: 'Failed to get CRF data', 
      error: error.message 
    });
  }
}

// 🔥 新增：获取Study的Inclusion/Exclusion Criteria数据
async function getCriterias(req, res) {
  try {
    const { studyId } = req.params;
    
    let study = null;
    if (studyId && studyId.match(/^[0-9a-fA-F]{24}$/)) {
      study = await Study.findById(studyId).select('studyNumber files.protocol.uploadExtraction.criterias').lean();
    }
    if (!study) {
      study = await Study.findOne({ studyNumber: studyId }).select('studyNumber files.protocol.uploadExtraction.criterias').lean();
    }

    if (!study) {
      return res.status(404).json({
        success: false,
        message: 'Study 不存在'
      });
    }

    const criterias = study.files?.protocol?.uploadExtraction?.criterias || {};
    
    // 计算统计信息
    const stats = {
      totalTypes: Object.keys(criterias).length,
      totalSections: 0,
      types: []
    };

    Object.entries(criterias).forEach(([type, sections]) => {
      if (Array.isArray(sections)) {
        stats.totalSections += sections.length;
        stats.types.push({
          type,
          sectionCount: sections.length
        });
      }
    });

    return res.json({
      success: true,
      message: 'Criterias 获取成功',
      data: {
        studyId: String(study._id),
        studyNumber: study.studyNumber,
        criterias: criterias,
        stats: stats
      }
    });

  } catch (error) {
    console.error('❌ Error getting Criterias:', error);
    return res.status(500).json({ 
      success: false, 
      message: 'Failed to get Criterias', 
      error: error.message 
    });
  }
}

// 🔥 新增：获取Study的Study Design数据（主章节及所有子章节）
async function getStudyDesign(req, res) {
  try {
    const { studyId } = req.params;
    
    let study = null;
    if (studyId && studyId.match(/^[0-9a-fA-F]{24}$/)) {
      study = await Study.findById(studyId).select('studyNumber files.protocol.uploadExtraction.studyDesign').lean();
    }
    if (!study) {
      study = await Study.findOne({ studyNumber: studyId }).select('studyNumber files.protocol.uploadExtraction.studyDesign').lean();
    }

    if (!study) {
      return res.status(404).json({
        success: false,
        message: 'Study 不存在'
      });
    }

    const studyDesign = study.files?.protocol?.uploadExtraction?.studyDesign || null;
    
    // 计算统计信息
    const stats = {
      found: !!studyDesign,
      hasMultipleBlocks: false,
      totalChildren: 0,
      childrenByLevel: {}
    };

    if (studyDesign) {
      // 检查是否为多块结构
      if (studyDesign.blocks && Array.isArray(studyDesign.blocks)) {
        stats.hasMultipleBlocks = true;
        stats.blockCount = studyDesign.blocks.length;
        // 计算所有块的子章节总数
        studyDesign.blocks.forEach(block => {
          if (block.children) {
            stats.totalChildren += block.children.length;
            block.children.forEach(child => {
              stats.childrenByLevel[child.level] = (stats.childrenByLevel[child.level] || 0) + 1;
            });
          }
        });
      } else {
        // 单块结构
        stats.hasMultipleBlocks = false;
        if (studyDesign.children && Array.isArray(studyDesign.children)) {
          stats.totalChildren = studyDesign.children.length;
          studyDesign.children.forEach(child => {
            stats.childrenByLevel[child.level] = (stats.childrenByLevel[child.level] || 0) + 1;
          });
        }
      }
    }

    return res.json({
      success: true,
      message: studyDesign ? 'Study Design 获取成功' : '未找到 Study Design 章节',
      data: {
        studyId: String(study._id),
        studyNumber: study.studyNumber,
        studyDesign: studyDesign,
        stats: stats
      }
    });

  } catch (error) {
    console.error('❌ Error getting Study Design:', error);
    return res.status(500).json({ 
      success: false, 
      message: 'Failed to get Study Design', 
      error: error.message 
    });
  }
}

// 🔥 新增：获取Study的文档槽位状态（供前端列出CRF/SAP）
async function getStudyDocuments(req, res) {
  try {
    const { studyIdentifier } = req.params;
    // 允许传入 studyNumber 或 _id，两者择一
    // 🔥 优化：只选择必要字段，避免加载巨大的crfUploadResult
    const selectFields = 'studyNumber files.protocol files.crf.uploaded files.crf.originalName files.crf.fileSize files.crf.uploadedAt files.sap';
    
    let study = null;
    if (studyIdentifier && studyIdentifier.match(/^[0-9a-fA-F]{24}$/)) {
      study = await Study.findById(studyIdentifier).select(selectFields).lean();
    }
    if (!study) {
      study = await Study.findOne({ studyNumber: studyIdentifier }).select(selectFields).lean();
    }

    if (!study) {
      return res.json({
        success: true,
        data: {
          studyId: null,
          hasProtocol: false,
          hasCrf: false,
          hasSap: false,
          filesSummary: []
        }
      });
    }

    const files = study.files || {};
    const protocol = files.protocol || {};
    const crf = files.crf || {};
    const sap = files.sap || {};

    const filesSummary = [];
    if (protocol.uploaded) {
      filesSummary.push({
        slot: 'PROTOCOL',
        originalName: protocol.originalName || 'protocol.pdf',
        size: formatBytes(protocol.fileSize),
        uploadedAt: protocol.uploadedAt
      });
    }
    if (crf.uploaded) {
      filesSummary.push({
        slot: 'CRF',
        originalName: crf.originalName || 'crf.pdf',
        size: formatBytes(crf.fileSize),
        uploadedAt: crf.uploadedAt
      });
    }
    if (sap.uploaded) {
      filesSummary.push({
        slot: 'SAP',
        originalName: sap.originalName || 'sap.pdf',
        size: formatBytes(sap.fileSize),
        uploadedAt: sap.uploadedAt
      });
    }

    return res.json({
      success: true,
      data: {
        studyId: String(study._id),
        hasProtocol: !!protocol.uploaded,
        hasCrf: !!crf.uploaded,
        hasSap: !!sap.uploaded,
        filesSummary
      }
    });
  } catch (error) {
    console.error('❌ Error getting study documents:', error);
    return res.status(500).json({ success: false, message: 'Failed to get study documents', error: error.message });
  }
}

// 辅助：格式化文件大小
function formatBytes(bytes) {
  if (!bytes || bytes === 0) return '';
  const sizes = ['Bytes', 'KB', 'MB', 'GB'];
  const i = parseInt(Math.floor(Math.log(bytes) / Math.log(1024)), 10);
  return `${Math.round(bytes / Math.pow(1024, i), 2)} ${sizes[i]}`;
}



// 确认SDTM分析结果
async function confirmSDTMAnalysis(req, res) {
  try {
    const { id } = req.params;
    const { procedures, mappings, summary } = req.body;

    console.log(`确认Study ${id} 的SDTM分析结果`);

    const study = await Study.findById(id);
    if (!study) {
      return res.status(404).json({
        success: false,
        message: 'Study不存在'
      });
    }

    study.CostEstimateDetails = study.CostEstimateDetails || {};

    // 转换mappings为简化的 { procedure: "PE, VS" } 字符串映射（与sdtmAnalysis保持一致）
    const simplifiedMappings = new Map();
    if (mappings && typeof mappings === 'object') {
      if (mappings instanceof Map) {
        // 输入已是Map
        for (const [procedure, domains] of mappings) {
          if (Array.isArray(domains)) {
            simplifiedMappings.set(procedure, domains.join(', '));
          } else if (typeof domains === 'string') {
            simplifiedMappings.set(procedure, domains);
          } else if (domains != null) {
            simplifiedMappings.set(procedure, String(domains));
          }
        }
      } else {
        // 统一将对象/数组转换为值数组，便于处理如 {0:{...},1:{...}} 或 [{...},{...}]
        const values = Array.isArray(mappings) ? mappings : Object.values(mappings);
        const looksLikeArrayOfObjects = values.every(v => v && typeof v === 'object' && !Array.isArray(v));

        if (looksLikeArrayOfObjects) {
          // 形如 [{ procedure, sdtm_domains }] 或 {0:{...}}
          for (const item of values) {
            const procedureName = String(item.procedure || item.name || item.key || '').trim();
            let domainRaw = item.sdtm_domains; // 🔥 主要字段名
            if (domainRaw == null) domainRaw = item.domains;
            if (domainRaw == null) domainRaw = item.domain;
            if (domainRaw == null) domainRaw = item.value;
            if (domainRaw == null) domainRaw = item.values;

            let domainStr = '';
            if (Array.isArray(domainRaw)) {
              domainStr = domainRaw.join(', ');
            } else if (typeof domainRaw === 'string') {
              domainStr = domainRaw;
            } else if (domainRaw != null) {
              domainStr = String(domainRaw);
            }

            if (procedureName && domainStr) {
              simplifiedMappings.set(procedureName, domainStr);
            }
          }
        } else {
          // 形如 { 'Physical Examination': 'PE' } 的简单对象
          Object.entries(mappings).forEach(([procedure, domains]) => {
            if (!procedure) return;
            if (Array.isArray(domains)) {
              simplifiedMappings.set(procedure, domains.join(', '));
            } else if (typeof domains === 'string') {
              simplifiedMappings.set(procedure, domains);
            } else if (domains != null) {
              simplifiedMappings.set(procedure, String(domains));
            }
          });
        }
      }
    }

    // 更新用户确认的SDTM数据（嵌套路径）
    study.CostEstimateDetails.userConfirmedSdtm = {
      success: true, // 🔥 新增：设置用户确认成功标志
      procedures,
      mappings: simplifiedMappings,
      summary,
      confirmedAt: new Date()
    };
    
    // 🔥 设置状态为第3步完成：用户确认完成
    study.CostEstimateDetails.sdtmAnalysisStatus = 'user_confirmed_sdtm_done';

    // 同步生成并保存成本估算快照（基于确认后的summary）
    try {
      const sdtmSummary = summary || {};
      const highCount = Number(sdtmSummary?.highComplexitySdtm?.count || 0);
      const mediumCount = Number(sdtmSummary?.mediumComplexitySdtm?.count || 0);
      const totalDomains = Number(sdtmSummary?.total_sdtm_domains || 0);

      const rates = { costPerHour: 1 };
      const hoursPerUnit = {
        annotatedCrf: 32,
        specsHigh: 3,
        specsMedium: 2,
        prodHigh: 16,
        prodMedium: 10,
        pinnacle21: 6,
        reviewersGuide: 32,
        defineXml: 32,
        xptConversion: 0.2
      };

      const units = {
        annotatedCrf: 1,
        specsHigh: highCount,
        specsMedium: mediumCount,
        prodHigh: highCount,
        prodMedium: mediumCount,
        pinnacle21: 2,
        reviewersGuide: 1,
        defineXml: 1,
        xptConversion: totalDomains
      };

      const estimatedCosts = {};
      Object.keys(units).forEach(key => {
        const unit = Number(units[key] || 0);
        const cpu = rates.costPerHour * Number(hoursPerUnit[key] || 0);
        estimatedCosts[key] = Number((unit * cpu).toFixed(2));
      });

      const subtotal = Object.values(estimatedCosts).reduce((acc, v) => acc + Number(v || 0), 0);

      // 🔥 生成Notes信息（具体域列表）
      const highDomains = summary?.highComplexitySdtm?.domains || [];
      const mediumDomains = summary?.mediumComplexitySdtm?.domains || [];
      const allDomains = summary?.unique_domains || [];
      
      const notes = {
        specsHigh: highDomains.join('/'),
        specsMedium: mediumDomains.join('/'),
        xptConversion: allDomains.join('/')
      };

      const pced = study.CostEstimateDetails;
      const costEstimate = pced.sdtmTableInput || {};
      costEstimate['SDTM Datasets Production and Validation'] = { units, estimatedCosts, notes, subtotal };
      costEstimate.createdAt = new Date();
      pced.sdtmTableInput = costEstimate;
    } catch (calcErr) {
      console.warn('⚠️ 确认后生成成本估算失败:', calcErr.message);
    }

    await study.save();

    console.log('SDTM分析结果已确认并保存');

    res.json({
      success: true,
      message: 'SDTM分析结果已确认并保存',
      data: {
        documentId: id,
        confirmedAt: study.CostEstimateDetails.userConfirmedSdtm.confirmedAt,
        status: study.CostEstimateDetails.sdtmAnalysisStatus,
        costEstimate: study.CostEstimateDetails.sdtmTableInput || {}
      }
    });

  } catch (error) {
    console.error('确认SDTM分析结果错误:', error);
    res.status(500).json({
      success: false,
      message: '确认SDTM分析结果失败',
      error: error.message
    });
  }
}

// 确认ADaM分析结果
async function confirmADaMAnalysis(req, res) {
  try {
    const { id } = req.params;
    const { mappings, summary } = req.body;

    console.log(`确认Study ${id} 的ADaM分析结果`);

    const study = await Study.findById(id);
    if (!study) {
      return res.status(404).json({
        success: false,
        message: 'Study不存在'
      });
    }

    study.CostEstimateDetails = study.CostEstimateDetails || {};

    // 转换mappings为 Map<ADaM, [SDTM]> 存储格式
    const simplifiedMappings = new Map();
    if (mappings && typeof mappings === 'object') {
      if (mappings instanceof Map) {
        for (const [adam, sdtmList] of mappings) {
          const list = Array.isArray(sdtmList) ? sdtmList : String(sdtmList || '').split(',').map(s => s.trim()).filter(Boolean);
          simplifiedMappings.set(String(adam), list);
        }
      } else if (Array.isArray(mappings)) {
        mappings.forEach(item => {
          const adam = String(item.adam || item.adam_domain || item.name || item.key || '').trim();
          const sdtmList = Array.isArray(item.sdtm_domains) ? item.sdtm_domains : String(item.sdtm_domains || '').split(',').map(s => s.trim()).filter(Boolean);
          if (adam) simplifiedMappings.set(adam, sdtmList);
        });
      } else {
        Object.entries(mappings).forEach(([adam, sdtmList]) => {
          const list = Array.isArray(sdtmList) ? sdtmList : String(sdtmList || '').split(',').map(s => s.trim()).filter(Boolean);
          simplifiedMappings.set(String(adam), list);
        });
      }
    }

    // 更新用户确认的ADaM数据（嵌套路径）
    study.CostEstimateDetails.userConfirmedAdam = {
      success: true, // 🔥 新增：设置用户确认成功标志
      mappings: simplifiedMappings,
      summary,
      confirmedAt: new Date()
    };
    
    // 🔥 设置状态为ADaM用户确认完成
    study.CostEstimateDetails.sdtmAnalysisStatus = 'user_confirmed_adam_done';

    // 同步生成并保存ADaM成本估算快照（基于确认后的summary）
    try {
      const adamSummary = summary || {};
      const highCount = Number(adamSummary?.highComplexityAdam?.count || 0);
      const mediumCount = Number(adamSummary?.mediumComplexityAdam?.count || 0);
      const totalAdamDomains = Number(adamSummary?.total_adam_domains || 0);

      const rates = { costPerHour: 1 };
      const hoursPerUnit = {
        // ADaM任务的时间单位（基于项目需求调整）
        adamSpecsHigh: 4,           // ADaM Dataset Specs (High Complexity)
        adamSpecsMedium: 3,         // ADaM Dataset Specs (Medium Complexity)  
        adamProdHigh: 20,           // ADaM Production and Validation: Programs and Datasets (High Complexity)
        adamProdMedium: 12,         // ADaM Production and Validation: Programs and Datasets (Medium Complexity)
        adamPinnacle21: 8,          // ADaM Pinnacle 21 Report Creation and Review
        adamReviewersGuide: 40,     // ADaM Reviewer's Guide
        adamDefineXml: 40,          // ADaM Define.xml
        adamXptConversion: 0.3,     // ADaM Dataset Program xpt Conversion and Review
        adamTxtConversion: 0.2      // ADaM Program txt Conversion and Review (新增)
      };

      const units = {
        adamSpecsHigh: highCount,
        adamSpecsMedium: mediumCount,
        adamProdHigh: highCount,
        adamProdMedium: mediumCount,
        adamPinnacle21: 2,
        adamReviewersGuide: 1,
        adamDefineXml: 1,
        adamXptConversion: totalAdamDomains,
        adamTxtConversion: totalAdamDomains  // 新增：与xpt转换相同的数量
      };

      const estimatedCosts = {};
      Object.keys(units).forEach(key => {
        const unit = Number(units[key] || 0);
        const cpu = rates.costPerHour * Number(hoursPerUnit[key] || 0);
        estimatedCosts[key] = Number((unit * cpu).toFixed(2));
      });

      const subtotal = Object.values(estimatedCosts).reduce((acc, v) => acc + Number(v || 0), 0);

      // 🔥 生成ADaM Notes信息（具体域列表）
      const highDomains = summary?.highComplexityAdam?.domains || [];
      const mediumDomains = summary?.mediumComplexityAdam?.domains || [];
      const allAdamDomains = summary?.unique_adam_domains || [];
      
      const notes = {
        adamSpecsHigh: highDomains.join('/'),
        adamSpecsMedium: mediumDomains.join('/'),
        adamXptConversion: allAdamDomains.join('/'),
        adamTxtConversion: allAdamDomains.join('/')  // 新增：与xpt转换相同的域列表
      };

      const pced = study.CostEstimateDetails;
      const costEstimate = pced.adamTableInput || {};
      costEstimate['ADaM Datasets Production and Validation'] = { units, estimatedCosts, notes, subtotal };
      costEstimate.createdAt = new Date();
      pced.adamTableInput = costEstimate;
      
      console.log('💾 ADaM成本估算快照已生成并保存到adamTableInput');
    } catch (calcErr) {
      console.warn('⚠️ 确认后生成ADaM成本估算失败:', calcErr.message);
    }

    await study.save();

    console.log('ADaM分析结果已确认并保存');

    res.json({
      success: true,
      message: 'ADaM分析结果已确认并保存',
      data: {
        documentId: id,
        confirmedAt: study.CostEstimateDetails.userConfirmedAdam.confirmedAt,
        status: study.CostEstimateDetails.sdtmAnalysisStatus,
        costEstimate: study.CostEstimateDetails.adamTableInput || {}
      }
    });

  } catch (error) {
    console.error('确认ADaM分析结果错误:', error);
    res.status(500).json({
      success: false,
      message: '确认ADaM分析结果失败',
      error: error.message
    });
  }
}

// 🔥 新增：更新项目选择详细信息 (简化格式)
async function updateProjectSelection(req, res) {
  try {
    const { id } = req.params;
    const { projectSelectionDetails } = req.body;

    console.log(`更新Study ${id} 的项目选择详情`);

    const study = await Study.findById(id);
    if (!study) {
      return res.status(404).json({
        success: false,
        message: 'Study不存在'
      });
    }

    study.CostEstimateDetails = study.CostEstimateDetails || {};

    // 🔥 更新项目选择数据到新的 projectSelection 字段
    const selectedProjects = Object.keys(projectSelectionDetails).filter(
      project => {
        const value = projectSelectionDetails[project];
        // 包括有次数的项目(> 0)和无次数要求的项目(null)，排除lastUpdated字段
        return project !== 'lastUpdated' && (value === null || (typeof value === 'number' && value > 0));
      }
    );
    

    
    study.CostEstimateDetails.projectSelection = {
      success: selectedProjects.length > 0, // 判断用户是否完成了项目选择
      selectedProjects: selectedProjects,
      selectionDetails: {
        ...projectSelectionDetails,
        lastUpdated: new Date()
      },
      selectedAt: new Date()
    };
    
    // 🔥 设置状态为第1步完成：项目选择完成
    study.CostEstimateDetails.sdtmAnalysisStatus = 'project_selection_done';

    await study.save();

    console.log('项目选择详情已更新并保存');

    res.json({
      success: true,
      message: '项目选择详情已保存',
      data: {
        documentId: id,
        projectSelection: study.CostEstimateDetails.projectSelection, // 🔥 新字段
        projectSelectionDetails: study.CostEstimateDetails.projectSelection?.selectionDetails // 向后兼容
      }
    });

  } catch (error) {
    console.error('更新项目选择详情错误:', error);
    res.status(500).json({
      success: false,
      message: '保存项目选择详情失败',
      error: error.message
    });
  }
}

// 🔥 新增：标记任务开始（设置为进行中 false）
async function markTaskAsStarted(req, res) {
  try {
    const { id } = req.params;
    const { taskKey } = req.body;
    
    if (!taskKey || !['costEstimate', 'sasAnalysis'].includes(taskKey)) {
      return res.status(400).json({ success: false, message: 'Invalid taskKey, expected costEstimate or sasAnalysis' });
    }
    
    const study = await Study.findById(id);
    if (!study) {
      return res.status(404).json({ success: false, message: 'Study not found' });
    }
    
    study.projectDone = study.projectDone || {};
    
    if (taskKey === 'costEstimate') {
      study.projectDone.isCostEstimate = false;  // 设置为进行中
    } else if (taskKey === 'sasAnalysis') {
      study.projectDone.isSasAnalysis = false;   // 设置为进行中
    }
    
    await study.save();
    
    console.log(`✅ Task ${taskKey} marked as started for study ${id}`);
    res.json({ 
      success: true, 
      message: `Task ${taskKey} marked as started`, 
      data: { 
        documentId: id, 
        taskKey,
        status: 'started' 
      } 
    });
  } catch (error) {
    console.error('标记任务开始失败:', error);
    res.status(500).json({ success: false, message: '标记任务开始失败', error: error.message });
  }
}

// 🔥 新增：标记任务完成（通用）
async function markTaskAsDone(req, res) {
  try {
    const { id } = req.params;
    const { taskKey } = req.body;
    
    if (!taskKey || !['costEstimate', 'sasAnalysis'].includes(taskKey)) {
      return res.status(400).json({ success: false, message: 'Invalid taskKey, expected costEstimate or sasAnalysis' });
    }
    
    const study = await Study.findById(id);
    if (!study) {
      return res.status(404).json({ success: false, message: 'Study not found' });
    }
    
    study.projectDone = study.projectDone || {};
    
    if (taskKey === 'costEstimate') {
      study.projectDone.isCostEstimate = true;
    } else if (taskKey === 'sasAnalysis') {
      study.projectDone.isSasAnalysis = true;
    }
    
    await study.save();
    
    console.log(`✅ Task ${taskKey} marked as completed for study ${id}`);
    res.json({ 
      success: true, 
      message: `Task ${taskKey} marked as completed`, 
      data: { 
        documentId: id, 
        taskKey,
        status: 'completed' 
      } 
    });
  } catch (error) {
    console.error('标记任务完成失败:', error);
    res.status(500).json({ success: false, message: '标记任务完成失败', error: error.message });
  }
}

// 🔥 保持向后兼容：标记成本估算完成（Done）
async function markCostEstimateDone(req, res) {
  try {
    const { id } = req.params;
    const study = await Study.findById(id);
    if (!study) {
      return res.status(404).json({ success: false, message: '文档不存在' });
    }
    study.projectDone = study.projectDone || {};
    study.projectDone.isCostEstimate = true;
    await study.save();
    res.json({ success: true, message: '已标记为成本估算完成', data: { documentId: id, isCostEstimate: true } });
  } catch (error) {
    console.error('标记成本估算完成失败:', error);
    res.status(500).json({ success: false, message: '标记失败', error: error.message });
  }
}

// 新增：延迟执行SDTM分析（上传后，单独触发）
async function analyzeDocumentForSdtm(req, res) {
  try {
    const { id } = req.params;
    const study = await Study.findById(id).lean(false);
    if (!study) {
      return res.status(404).json({ success: false, message: 'Study 不存在' });
    }
    const assess = study.files?.protocol?.uploadExtraction?.assessmentSchedule || null;

    console.log('🎯 Start unified SDTM analysis for both Word and PDF...');
    
    // Step 1: Intelligently prepare procedures array
    let procedures = [];
    
    // Check if this is a PDF document with pre-extracted procedures
    if (study.CostEstimateDetails?.sdtmAnalysis?.procedures?.length > 0) {
      console.log('📄 PDF path: Using pre-extracted procedures from database...');
      procedures = study.CostEstimateDetails.sdtmAnalysis.procedures;
      // console.log(`✅ Found ${procedures.length} pre-extracted procedures for PDF`);
    }
    // Otherwise, use Word HTML extraction flow
    else if (assess && assess.htmlContent) {
      console.log('📝 Word path: Extracting procedures from HTML Assessment Schedule...');
      const { extractProceduresFromSchedule } = require('../services/sdtmAnalysisService');
      procedures = extractProceduresFromSchedule(assess);
      // console.log(`✅ Extracted ${procedures.length} procedures from Word HTML`);
    }
    else {
      return res.status(400).json({ 
        success: false, 
        message: '未找到有效的procedures来源（PDF预提取或Word HTML表格）' 
      });
    }

    // Validate procedures
    if (!procedures || procedures.length === 0) {
      return res.status(400).json({ 
        success: false, 
        message: '未能获取到有效的procedures进行分析' 
      });
    }

    // Step 2: Call unified AI analysis service (same for both Word and PDF)
    console.log(`🤖 Calling unified AI analysis with ${procedures.length} procedures...`);
    const mappingResult = await analyzeSDTMMapping(procedures);

    // Step 3: Merge results appropriately based on document type
    let sdtmAnalysis;
    if (study.CostEstimateDetails?.sdtmAnalysis?.procedures?.length > 0) {
      // PDF path: Keep existing procedures, only add mappings & summary
      // console.log('📄 PDF: Preserving existing procedures, adding AI mappings & summary');
      sdtmAnalysis = {
        ...study.CostEstimateDetails.sdtmAnalysis, // Preserve existing procedures
        ...mappingResult, // Add new mappings and summary
        analyzedAt: new Date()
      };
    } else {
      // Word path: Include procedures from extraction
      // console.log('📝 Word: Adding extracted procedures along with AI mappings & summary');
      sdtmAnalysis = {
        ...mappingResult,
        procedures: procedures, // Word needs procedures from extraction
        analyzedAt: new Date()
      };
    }

    // Save complete analysis results
    // 重新获取最新文档以避免版本冲突
    const latestStudy = await Study.findById(id);
    if (!latestStudy) {
      return res.status(404).json({ success: false, message: 'Study not found during save' });
    }
    
    latestStudy.CostEstimateDetails = latestStudy.CostEstimateDetails || {};
    latestStudy.CostEstimateDetails.sdtmAnalysis = sdtmAnalysis;

    // Generate cost estimation snapshot based on analysis results
    try {
      const sdtmSummary = sdtmAnalysis?.summary || {};
      const highCount = Number(sdtmSummary?.highComplexitySdtm?.count || 0);
      const mediumCount = Number(sdtmSummary?.mediumComplexitySdtm?.count || 0);
      const totalDomains = Number(sdtmSummary?.total_sdtm_domains || 0);
      const rates = { costPerHour: 1 };
      const hoursPerUnit = { annotatedCrf: 32, specsHigh: 3, specsMedium: 2, prodHigh: 16, prodMedium: 10, pinnacle21: 6, reviewersGuide: 32, defineXml: 32, xptConversion: 0.2 };
      const units = { annotatedCrf: 1, specsHigh: highCount, specsMedium: mediumCount, prodHigh: highCount, prodMedium: mediumCount, pinnacle21: 2, reviewersGuide: 1, defineXml: 1, xptConversion: totalDomains };
      const estimatedCosts = {};
      Object.keys(units).forEach(k => { const u = Number(units[k] || 0); const cpu = rates.costPerHour * Number(hoursPerUnit[k] || 0); estimatedCosts[k] = Number((u * cpu).toFixed(2)); });
      const subtotal = Object.values(estimatedCosts).reduce((acc, v) => acc + Number(v || 0), 0);
      
      // Generate domain notes
      const highDomains = sdtmSummary?.highComplexitySdtm?.domains || [];
      const mediumDomains = sdtmSummary?.mediumComplexitySdtm?.domains || [];
      const allDomains = sdtmSummary?.unique_domains || [];
      
      const notes = {
        specsHigh: highDomains.join('/'),
        specsMedium: mediumDomains.join('/'),
        xptConversion: allDomains.join('/')
      };
      
      const pced = latestStudy.CostEstimateDetails;
      pced.sdtmTableInput = pced.sdtmTableInput || {};
      pced.sdtmTableInput['SDTM Datasets Production and Validation'] = { units, estimatedCosts, notes, subtotal };
      pced.sdtmTableInput.createdAt = new Date();
    } catch (e) { console.warn('Cost estimation generation failed:', e.message); }

    // Set analysis status to completed
    latestStudy.CostEstimateDetails.sdtmAnalysisStatus = 'sdtm_ai_analysis_done';

    await latestStudy.save();

    console.log('✅ Unified SDTM analysis completed');
    // console.log(`📊 Analysis results: ${sdtmAnalysis.procedures?.length || 0} procedures, ${sdtmAnalysis.mappings?.size || 0} mappings`);
    res.json({ success: true, message: 'SDTM分析完成', data: { sdtmAnalysis } });
  } catch (error) {
    console.error('延迟执行SDTM分析失败:', error);
    res.status(500).json({ success: false, message: '分析失败', error: error.message });
  }
}

// ADaM分析处理函数
async function analyzeDocumentForAdam(req, res) {
  try {
    const { id } = req.params;
    const study = await Study.findById(id).lean(false);
    
    if (!study) {
      return res.status(404).json({ success: false, message: 'Study 不存在' });
    }

    console.log('🎯 开始ADaM分析，基于SDTM分析结果...');

    // 检查SDTM分析是否完成
    const sdtmAnalysis = study.CostEstimateDetails?.sdtmAnalysis;
    if (!sdtmAnalysis || !sdtmAnalysis.success) {
      return res.status(400).json({ 
        success: false, 
        message: '必须先完成SDTM分析才能进行ADaM分析' 
      });
    }

    console.log('✅ SDTM分析结果验证通过，开始ADaM分析...');

    // 🔥 新增：提取protocol endpoints信息
    const protocolEndpoints = study.files?.protocol?.uploadExtraction?.endpoints || [];
    console.log(`📋 已载入协议Endpoints用于ADaM分析: ${protocolEndpoints.length} 项`);

    // 调用ADaM分析服务
    const adamResult = await performADaMAnalysis(sdtmAnalysis, protocolEndpoints);
    
    // console.log('🔍 [DEBUG] ADaM分析结果:', { success: adamResult.success, mappingsCount: adamResult.mappings?.size || 0, totalDomains: adamResult.summary?.total_adam_domains || 0 });

    // 保存ADaM分析结果到数据库
    const latestStudy = await Study.findById(id);
    latestStudy.CostEstimateDetails = latestStudy.CostEstimateDetails || {};
    latestStudy.CostEstimateDetails.adamAnalysis = adamResult;

    // 如果ADaM分析成功，更新状态并生成成本估算快照
    if (adamResult.success) {
      latestStudy.CostEstimateDetails.sdtmAnalysisStatus = 'adam_ai_analysis_done';
      
      // 🔥 新增：生成并保存ADaM成本估算快照
      try {
        const adamSummary = adamResult.summary || {};
        const highCount = Number(adamSummary?.highComplexityAdam?.count || 0);
        const mediumCount = Number(adamSummary?.mediumComplexityAdam?.count || 0);
        const totalAdamDomains = Number(adamSummary?.total_adam_domains || 0);

        const rates = { costPerHour: 1 };
        const hoursPerUnit = {
          // ADaM任务的时间单位（基于项目需求调整）
          adamSpecsHigh: 4,           // ADaM Dataset Specs (High Complexity)
          adamSpecsMedium: 3,         // ADaM Dataset Specs (Medium Complexity)  
          adamProdHigh: 20,           // ADaM Production and Validation: Programs and Datasets (High Complexity)
          adamProdMedium: 12,         // ADaM Production and Validation: Programs and Datasets (Medium Complexity)
          adamPinnacle21: 8,          // ADaM Pinnacle 21 Report Creation and Review
          adamReviewersGuide: 40,     // ADaM Reviewer's Guide
          adamDefineXml: 40,          // ADaM Define.xml
          adamXptConversion: 0.3,     // ADaM Dataset Program xpt Conversion and Review
          adamTxtConversion: 0.2      // ADaM Program txt Conversion and Review (新增)
        };

        const units = {
          adamSpecsHigh: highCount,
          adamSpecsMedium: mediumCount,
          adamProdHigh: highCount,
          adamProdMedium: mediumCount,
          adamPinnacle21: 2,
          adamReviewersGuide: 1,
          adamDefineXml: 1,
          adamXptConversion: totalAdamDomains,
          adamTxtConversion: totalAdamDomains  // 新增：与xpt转换相同的数量
        };

        const estimatedCosts = {};
        Object.keys(units).forEach(key => {
          const unit = Number(units[key] || 0);
          const cpu = rates.costPerHour * Number(hoursPerUnit[key] || 0);
          estimatedCosts[key] = Number((unit * cpu).toFixed(2));
        });

        const subtotal = Object.values(estimatedCosts).reduce((acc, v) => acc + Number(v || 0), 0);

        // 🔥 生成ADaM Notes信息（具体域列表）
        const highDomains = adamSummary?.highComplexityAdam?.domains || [];
        const mediumDomains = adamSummary?.mediumComplexityAdam?.domains || [];
        const allAdamDomains = adamSummary?.unique_adam_domains || [];
        
        const notes = {
          adamSpecsHigh: highDomains.join('/'),
          adamSpecsMedium: mediumDomains.join('/'),
          adamXptConversion: allAdamDomains.join('/'),
          adamTxtConversion: allAdamDomains.join('/')  // 新增：与xpt转换相同的域列表
        };

        const pced = latestStudy.CostEstimateDetails;
        pced.adamTableInput = pced.adamTableInput || {};
        pced.adamTableInput['ADaM Datasets Production and Validation'] = { units, estimatedCosts, notes, subtotal };
        pced.adamTableInput.createdAt = new Date();
        console.log('💾 已生成并保存ADaM成本估算快照到adamTableInput');

      } catch (costErr) {
        console.warn('⚠️ 生成ADaM成本估算快照失败:', costErr.message);
      }
      
      console.log('✅ ADaM分析状态已更新为: adam_ai_analysis_done');
    }

    await latestStudy.save();

    console.log('✅ ADaM分析完成并保存到数据库');
    // console.log(`📊 ADaM分析结果: ${adamResult.mappings?.size || 0} 个映射, ${adamResult.summary?.unique_adam_domains?.length || 0} 个ADaM域`);

    res.json({ 
      success: true, 
      message: 'ADaM分析完成', 
      data: { adamAnalysis: adamResult } 
    });

  } catch (error) {
    console.error('❌ ADaM分析失败:', error);
    res.status(500).json({ 
      success: false, 
      message: 'ADaM分析失败', 
      error: error.message 
    });
  }
}

// 更新Excel中的Unit数据
async function updateUnits(req, res) {
  try {
    const { id } = req.params;
    const { units } = req.body;

    if (!units || typeof units !== 'object') {
      return res.status(400).json({
        success: false,
        message: 'Invalid units data provided'
      });
    }

    const study = await Study.findById(id);
    if (!study) {
      return res.status(404).json({
        success: false,
        message: 'Study not found'
      });
    }

    // 更新Unit数据到数据库
    if (!study.CostEstimateDetails) study.CostEstimateDetails = {};
    if (!study.CostEstimateDetails.sdtmTableInput) study.CostEstimateDetails.sdtmTableInput = {};
    if (!study.CostEstimateDetails.sdtmTableInput.units) study.CostEstimateDetails.sdtmTableInput.units = {};

    // 合并新的Unit数据（可更新）
    Object.assign(study.CostEstimateDetails.sdtmTableInput.units, units);

    // 🔥 同步更新 SDTM Datasets Production and Validation 部分
    const sdtmSection = study.CostEstimateDetails.sdtmTableInput['SDTM Datasets Production and Validation'];
    if (sdtmSection && sdtmSection.units) {
      // 更新SDTM section中的units
      Object.assign(sdtmSection.units, units);
      
      // 重新计算 estimatedCosts 和 subtotal
      const rates = { costPerHour: 1 };
      const hoursPerUnit = {
        annotatedCrf: 32,
        specsHigh: 3,
        specsMedium: 2,
        prodHigh: 16,
        prodMedium: 10,
        pinnacle21: 6,
        reviewersGuide: 32,
        defineXml: 32,
        xptConversion: 0.2
      };
      
      const estimatedCosts = {};
      Object.keys(sdtmSection.units).forEach(key => {
        const unit = Number(sdtmSection.units[key] || 0);
        const cpu = rates.costPerHour * Number(hoursPerUnit[key] || 0);
        estimatedCosts[key] = Number((unit * cpu).toFixed(2));
      });
      
      const subtotal = Object.values(estimatedCosts).reduce((acc, v) => acc + Number(v || 0), 0);
      
      // 更新 estimatedCosts 和 subtotal
      sdtmSection.estimatedCosts = estimatedCosts;
      sdtmSection.subtotal = subtotal;
      
      console.log('🔄 已同步更新 SDTM section:', { units: sdtmSection.units, estimatedCosts, subtotal });
    }

    // 保存到数据库
    await study.save();

    console.log(`✅ 已更新Study ${id} 的Units:`, units);

    res.json({
      success: true,
      message: 'Units updated successfully',
      data: {
        units: study.CostEstimateDetails.sdtmTableInput.units
      }
    });

  } catch (error) {
    console.error('❌ 更新Units失败:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to update units: ' + error.message
    });
  }
}

// 删除文档
async function deleteDocument(req, res) {
  try {
    const { id } = req.params;
    
    console.log('🗑️ 删除Study请求:', id);
    
    const deletedStudy = await Study.findByIdAndDelete(id);
    
    if (!deletedStudy) {
      return res.status(404).json({ 
        success: false, 
        message: 'Study not found' 
      });
    }
    
    console.log('✅ Study删除成功:', {
      id: deletedStudy._id,
      studyNumber: deletedStudy.studyNumber
    });
    
    res.json({ 
      success: true, 
      message: 'Study deleted successfully',
      data: {
        deletedDocumentId: deletedStudy._id,
        studyNumber: deletedStudy.studyNumber
      }
    });
  } catch (error) {
    console.error('❌ 文档删除失败:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Failed to delete document', 
      error: error.message 
    });
  }
}

// 🔥 新增：为现有Study上传CRF文件，解析并存储 extractedText/sectionedText/tables（跳过 assessmentSchedule）
async function uploadCrfFile(req, res) {
  try {
    const { id } = req.params; // Study ID

    if (!req.file) {
      return res.status(400).json({ success: false, message: 'No CRF file uploaded' });
    }

    const study = await Study.findById(id);
    if (!study) {
      return res.status(404).json({ success: false, message: 'Study not found' });
    }

    study.files = study.files || {};
    study.files.crf = study.files.crf || {};

    // 🔥 Step 1: 持久化原始PDF（仅在本次请求有文件时执行）
    try {
      if (req.file && req.file.mimetype === 'application/pdf') {
        const { CRF_TMP_DIR } = require('../config/crfConfig');
        const fs = require('fs');
        const path = require('path');
        const filename = `crf_${id}_${Date.now()}.pdf`;
        const fullPath = path.join(CRF_TMP_DIR, filename);
        await fs.promises.writeFile(fullPath, req.file.buffer);

        study.files.crf.sourcePath = fullPath;
        study.files.crf.originalName = req.file.originalname;
        study.files.crf.fileSize = req.file.size;
        study.files.crf.mimeType = req.file.mimetype;
        study.files.crf.uploaded = true;
        study.files.crf.uploadedAt = new Date();

        await study.save();
        // console.log('💾 已持久化CRF原始PDF到: ', fullPath);
      }
    } catch (persistErr) {
      console.warn('⚠️ 持久化原PDF失败（继续解析流程）:', persistErr.message);
    }

    // 默认解析结果（当解析失败时使用降级结构）
    let crfParseResult = {
      extractedText: '',
      sectionedText: [],
      tables: [],
      parseInfo: {
        hasStructuredContent: false,
        sectionsCount: 0,
        tablesCount: 0,
        parseMethod: 'raw-text'
      }
    };

    // 解析CRF文件内容（PDF/Word），不进行 assessmentSchedule 识别
    // 🔥 新增：初始化词和行位置变量（在外部作用域）
    let wordsWithPosition = {};
    let rowsWithPosition = {};
    let identifiedPatterns = {};
    
    try {
      if (req.file.mimetype === 'application/pdf') {
        console.log('📄 [CRF Upload Step 1/6] Starting PDF Parsing (Pypdf)...');
        const pypdfResult = await processPdfWithPypdf(req.file.buffer);
        console.log('✅ [CRF Upload Step 1/6] PDF Parsing Completed');
        
        crfParseResult = await formatResultForCrfSap(pypdfResult); // 🔥 使用CRF专用解析
        
        // 🔥 新增：提取CRF PDF的词位置信息（简化版）
        try {
          console.log('🔍 [CRF Upload Step 2/6] Starting Word Coordinate Extraction...');
          const wordsResult = await extractCrfWordsOnly(req.file.buffer, id);
          console.log('✅ [CRF Upload Step 2/6] Word Coordinate Extraction Completed');

          // 保存词位置结果
          if (wordsResult.success) {
            wordsWithPosition = wordsResult;
            
            // 🔥 新增：将词位置转换为行位置
            try {
              console.log('🔄 [CRF Upload Step 3/6] Starting Row Construction...');
              const rowsResult = processWordsToRows(wordsResult, 3.5); // 使用3.5pt的Y坐标容差
              console.log('✅ [CRF Upload Step 3/6] Row Construction Completed');
              
              if (rowsResult.success) {
                rowsWithPosition = rowsResult;

                // 🔍 新增：基于前10页行文本调用AI识别页眉/页脚/页码/Form名称pattern
                try {
                  const firstPages = (rowsResult.pages || []).slice(0, 10).map(p => ({
                    page_number: p.page_number,
                    rows: (p.rows || []).map(r => ({ row_index: r.row_index, full_text: r.full_text }))
                  }));
                  // 只有存在OPENAI_API_KEY时才调用，避免阻塞上传
                  if (process.env.OPENAI_API_KEY && firstPages.length > 0) {
                    console.log('🤖 [CRF Upload Step 4/6] Starting AI Pattern Recognition...');
                    const { identifyCrfHeaderFooterAndFormPatterns } = require('../services/openaiService');
                    const aiPatterns = await identifyCrfHeaderFooterAndFormPatterns(firstPages);
                    
                    if (aiPatterns && aiPatterns.success) {
                      console.log('✅ [CRF Upload Step 4/6] AI Pattern Recognition Completed');
                      identifiedPatterns = aiPatterns;
                      
                      // 🔥 新增：基于AI patterns和行数据提取完整的Form信息
                      try {
                        console.log('🎯 [CRF Upload Step 5/6] Starting Form Detection & Processing...');
                        const formData = processCrfForms(rowsResult, identifiedPatterns);
                        console.log('✅ [CRF Upload Step 5/6] Form Detection & Processing Completed');

                        
                        // 更新crfFormList和crfFormName（不再为空）
                        if (formData && formData.crfFormList) {
                          // console.log(`✅ 成功处理${formData.crfFormName.total_forms}个CRF Forms`);
                          
                          // 将处理结果存储到变量中，稍后保存到数据库
                          global.processedCrfFormList = formData.crfFormList;
                          global.processedCrfFormName = formData.crfFormName;
                        }
                      } catch (formErr) {
                        console.warn('⚠️ CRF Form处理失败（已忽略）:', formErr.message);
                        global.processedCrfFormList = {};
                        global.processedCrfFormName = { names: [], total_forms: 0 };
                      }
                    } else {
                      identifiedPatterns = { success: false, header_patterns: [], footer_patterns: [], page_number_patterns: [], form_name_patterns: [] };
                      global.processedCrfFormList = {};
                      global.processedCrfFormName = { names: [], total_forms: 0 };
                    }
                  } else {
                    if (!process.env.OPENAI_API_KEY) console.warn('⚠️ OPENAI_API_KEY 未设置，跳过AI pattern识别');
                    global.processedCrfFormList = {};
                    global.processedCrfFormName = { names: [], total_forms: 0 };
                  }
                } catch (aiErr) {
                  console.warn('⚠️ AI识别页眉/页脚/Form名称pattern失败（已忽略）:', aiErr.message);
                  global.processedCrfFormList = {};
                  global.processedCrfFormName = { names: [], total_forms: 0 };
                }
              }
            } catch (rowsErr) {
              console.warn('⚠️ 词到行转换失败，但不影响上传:', rowsErr.message);
            }
          }
        } catch (wordsErr) {
          console.warn('⚠️ CRF词位置提取失败，但不影响正常上传:', wordsErr.message);
          // 词位置提取失败不影响正常的文件上传流程
        }
        
      } else if (req.file.mimetype === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document') {
        // console.log('📝 开始解析CRF Word文档...');
        crfParseResult = await parseWordDocumentStructure(req.file.buffer, { skipAssessmentSchedule: true }); // 🔥 CRF跳过AI
      } else if (req.file.mimetype === 'application/msword') {
        crfParseResult.extractedText = req.file.buffer.toString('utf8');
        crfParseResult.parseInfo.parseMethod = 'doc-simple';
      }

      // 适配CRF：去除 assessmentSchedule 字段及相关标记
      if (crfParseResult) {
        const crfAdapted = {
          extractedText: crfParseResult.extractedText || '',
          sectionedText: Array.isArray(crfParseResult.sectionedText) ? crfParseResult.sectionedText : [],
          tables: Array.isArray(crfParseResult.tables) ? crfParseResult.tables : [],
          // CRF显式不保存 assessmentSchedule
          assessmentSchedule: null,
          parseInfo: {
            ...(crfParseResult.parseInfo || {}),
            hasAssessmentSchedule: false
          }
        };
        crfParseResult = crfAdapted;
      }

      console.log(`✅ CRF解析完成 - 章节: ${crfParseResult.parseInfo.sectionsCount}, 表格: ${crfParseResult.parseInfo.tablesCount}`);
    } catch (parseErr) {
      console.warn('⚠️ CRF文档解析失败，将以基础元数据保存:', parseErr.message);
      // 保持 crfParseResult 为默认值，继续正常上传
    }

    // 使用原子$set更新，避免并发保存互相覆盖
    const crfUploadedAt = new Date();
    console.log('💾 [CRF Upload Step 6/6] Saving Results to Database...');
    const updatedStudy = await Study.findByIdAndUpdate(
      id,
      {
        $set: {
          'files.crf.uploaded': true,
          'files.crf.originalName': req.file.originalname,
          'files.crf.fileSize': req.file.size,
          'files.crf.mimeType': req.file.mimetype,
          'files.crf.uploadedAt': crfUploadedAt,
          // 🔥 **修复**: 确保包含sourcePath字段
          'files.crf.sourcePath': study.files.crf.sourcePath,
          // 🔥 新增：初始化SDTM分析状态为false
          'files.crf.crf_sdtm_ready_for_annotation': false,
          'files.crf.crfUploadResult': {
            crfFormList: global.processedCrfFormList || {},
            crfFormName: global.processedCrfFormName || { names: [], total_forms: 0 },
            Extract_words_with_position: wordsWithPosition,
            Extract_rows_with_position: rowsWithPosition,
            identified_patterns: identifiedPatterns
          }
        }
      },
      { new: true }
    );
    console.log('✅ [CRF Upload Step 6/6] All CRF Upload Steps Completed Successfully');

    // 🎨 **移除自动注解**: CRF上传后不自动生成注解，等待用户手动触发
    // console.log('✅ CRF上传完成，注解生成将等待用户手动触发');
    // 注解生成现在通过 /generate-crf-annotation-rects API 手动触发

    return res.json({
      success: true,
      message: 'Uploaded CRF successfully',
      data: {
        studyId: String(study._id),
        fileType: 'crf',
        originalName: req.file.originalname,
        fileSize: req.file.size,
        uploadedAt: crfUploadedAt,
        crfUploadResult: {
          crfFormList: global.processedCrfFormList || {},
          crfFormName: global.processedCrfFormName || { names: [], total_forms: 0 },
          Extract_words_with_position: wordsWithPosition,
          Extract_rows_with_position: rowsWithPosition,
          identified_patterns: identifiedPatterns
        }
      }
    });
  } catch (error) {
    console.error('uploadCrfFile error:', error);
    return res.status(500).json({ success: false, message: 'Upload CRF file failed', error: error.message });
  } finally {
    // 清理临时全局变量
    delete global.processedCrfFormList;
    delete global.processedCrfFormName;
  }
}

// 🔥 新增：为现有Study上传SAP文件，解析并存储 extractedText/sectionedText/tables（跳过 assessmentSchedule）
async function uploadSapFile(req, res) {
  try {
    const { id } = req.params; // Study ID

    if (!req.file) {
      return res.status(400).json({ success: false, message: 'No SAP file uploaded' });
    }

    const study = await Study.findById(id);
    if (!study) {
      return res.status(404).json({ success: false, message: 'Study not found' });
    }

    study.files = study.files || {};
    study.files.sap = study.files.sap || {};

    // 默认解析结果（当解析失败时使用降级结构）
    let sapParseResult = {
      extractedText: '',
      sectionedText: [],
      tables: [],
      parseInfo: {
        hasStructuredContent: false,
        sectionsCount: 0,
        tablesCount: 0,
        parseMethod: 'raw-text'
      }
    };

    // 解析SAP文件内容（PDF/Word），不进行 assessmentSchedule 识别
    try {
      if (req.file.mimetype === 'application/pdf') {
        console.log('📄 开始解析SAP PDF文件...');
        const pypdfResult = await processPdfWithPypdf(req.file.buffer);
        sapParseResult = await formatResultForCrfSap(pypdfResult); // 🔥 使用SAP专用解析
      } else if (req.file.mimetype === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document') {
        console.log('📝 开始解析SAP Word文档...');
        sapParseResult = await parseWordDocumentStructure(req.file.buffer, { skipAssessmentSchedule: true }); // 🔥 SAP跳过AI
      } else if (req.file.mimetype === 'application/msword') {
        sapParseResult.extractedText = req.file.buffer.toString('utf8');
        sapParseResult.parseInfo.parseMethod = 'doc-simple';
      }

      // 适配SAP：去除 assessmentSchedule 字段及相关标记
      if (sapParseResult) {
        const sapAdapted = {
          extractedText: sapParseResult.extractedText || '',
          sectionedText: Array.isArray(sapParseResult.sectionedText) ? sapParseResult.sectionedText : [],
          tables: Array.isArray(sapParseResult.tables) ? sapParseResult.tables : [],
          // SAP显式不保存 assessmentSchedule
          assessmentSchedule: null,
          parseInfo: {
            ...(sapParseResult.parseInfo || {}),
            hasAssessmentSchedule: false
          }
        };
        sapParseResult = sapAdapted;
      }

      console.log(`✅ SAP解析完成 - 章节: ${sapParseResult.parseInfo.sectionsCount}, 表格: ${sapParseResult.parseInfo.tablesCount}`);
    } catch (parseErr) {
      console.warn('⚠️ SAP文档解析失败，将以基础元数据保存:', parseErr.message);
      // 保持 sapParseResult 为默认值，继续正常上传
    }

    // 使用原子$set更新，避免并发保存互相覆盖
    const sapUploadedAt = new Date();
    await Study.findByIdAndUpdate(
      id,
      {
        $set: {
          'files.sap.uploaded': true,
          'files.sap.originalName': req.file.originalname,
          'files.sap.fileSize': req.file.size,
          'files.sap.mimeType': req.file.mimetype,
          'files.sap.uploadedAt': sapUploadedAt,
          'files.sap.uploadExtraction': {
            extractedText: sapParseResult.extractedText,
            sectionedText: sapParseResult.sectionedText,
            tables: sapParseResult.tables,
            assessmentSchedule: null
          }
        }
      },
      { new: true }
    );

    return res.json({
      success: true,
      message: 'Uploaded SAP successfully',
      data: {
        studyId: String(study._id),
        fileType: 'sap',
        originalName: req.file.originalname,
        fileSize: req.file.size,
        uploadedAt: sapUploadedAt,
        parseInfo: sapParseResult.parseInfo || {
          hasStructuredContent: false,
          sectionsCount: 0,
          tablesCount: 0,
          parseMethod: 'raw-text',
          hasAssessmentSchedule: false
        }
      }
    });
  } catch (error) {
    console.error('uploadSapFile error:', error);
    return res.status(500).json({ success: false, message: 'Upload SAP file failed', error: error.message });
  }
}

// 🔥 保留向后兼容：通用额外文件上传（委托给专门函数）
async function uploadAdditionalFile(req, res) {
  const { fileType } = req.body;
  
  if (!fileType) {
    return res.status(400).json({ success: false, message: 'fileType is required' });
  }
  
  const lowerFileType = String(fileType).toLowerCase();
  
  if (lowerFileType === 'crf') {
    return uploadCrfFile(req, res);
  } else if (lowerFileType === 'sap') {
    return uploadSapFile(req, res);
  } else {
    return res.status(400).json({ success: false, message: 'Invalid fileType, expected crf or sap' });
  }
}

// 🔥 新增：根据确认的ADaM域生成TFL(Tables, Figures, Listings)清单并存储在traceability中
async function generateAdamToOutputTraceability(req, res) {
  try {
    const { id } = req.params; // Study ID
    
    console.log('🎯 开始生成ADaM到输出的可追溯性数据...');
    
    // 1. 获取Study并提取已确认的ADaM域
    const study = await Study.findById(id);
    if (!study) {
      return res.status(404).json({
        success: false,
        message: 'Study not found'
      });
    }
    
    // 🔥 调试：检查完整的数据路径
    console.log('🔍 [DEBUG] CostEstimateDetails:', study.CostEstimateDetails);
    console.log('🔍 [DEBUG] userConfirmedAdam:', study.CostEstimateDetails?.userConfirmedAdam);
    console.log('🔍 [DEBUG] userConfirmedAdam.summary:', study.CostEstimateDetails?.userConfirmedAdam?.summary);
    
    const adamDomains = study.CostEstimateDetails?.userConfirmedAdam?.summary?.unique_adam_domains;
    console.log('🔍 [DEBUG] 提取到的adamDomains:', adamDomains);
    
    if (!adamDomains || adamDomains.length === 0) {
      console.error('❌ 没有找到确认的ADaM域数据');
      return res.status(400).json({
        success: false,
        message: 'No confirmed ADaM domains found. Please complete ADaM analysis first.'
      });
    }
    
    console.log(`📊 找到 ${adamDomains.length} 个已确认的ADaM域:`, adamDomains);
    
    // 🔥 新增：提取protocol endpoints信息
    const protocolEndpoints = study.files?.protocol?.uploadExtraction?.endpoints || [];
    console.log(`📋 已载入协议Endpoints: ${protocolEndpoints.length} 项`);
    
    // 🔥 阶段1：初始化TFL生成状态为 success: false
    const initializePayload = {
      'traceability.TFL_generation_adam_to_output': {
        success: false,
        generatedAt: new Date(),
        source_domains: adamDomains,
        outputs: [],
        summary: {
          uniqueTable: 0,
          repeatTable: 0,
          uniqueFigure: 0,
          repeatFigure: 0,
          uniqueListing: 0,
          repeatListing: 0
        }
      }
    };
    
    await Study.findByIdAndUpdate(id, { $set: initializePayload }, { new: true });
    console.log('✅ 已初始化TFL生成状态 (success: false)');
    
    // 2. 调用AI服务生成TFL清单（传入endpoints信息）
    const tflResult = await generateOutputsFromDomains(adamDomains, protocolEndpoints);
    
    if (!tflResult.success) {
      return res.status(500).json({
        success: false,
        message: tflResult.message || 'TFL generation failed'
      });
    }
    
    // 3. 统计各类型的Unique/Repeating数量
    const summary = {
      uniqueTable: 0,
      repeatTable: 0,
      uniqueFigure: 0,
      repeatFigure: 0,
      uniqueListing: 0,
      repeatListing: 0
    };
    
    tflResult.outputs.forEach(output => {
      const type = output.type; // 'Table', 'Figure', 'Listing'
      const uniqueness = output.uniqueness; // 'Unique', 'Repeating'
      
      if (uniqueness === 'Unique') {
        if (type === 'Table') summary.uniqueTable++;
        else if (type === 'Figure') summary.uniqueFigure++;
        else if (type === 'Listing') summary.uniqueListing++;
      } else if (uniqueness === 'Repeating') {
        if (type === 'Table') summary.repeatTable++;
        else if (type === 'Figure') summary.repeatFigure++;
        else if (type === 'Listing') summary.repeatListing++;
      }
    });
    
    console.log('📈 TFL统计结果:', summary);
    
    // 🔥 阶段2：更新TFL生成状态为 success: true，并保存完整结果
    const finalPayload = {
      'traceability.TFL_generation_adam_to_output': {
        success: true, // 🔥 标记为成功
        generatedAt: new Date(),
        source_domains: adamDomains,
        outputs: tflResult.outputs,
        summary: summary
      }
    };
    
    await Study.findByIdAndUpdate(id, { $set: finalPayload }, { new: true });
    
    console.log('✅ TFL可追溯性数据已成功存储到数据库 (success: true)');
    
    // 5. 返回成功响应
    res.json({
      success: true,
      message: 'TFL traceability generated successfully',
      data: {
        source_domains: adamDomains,
        outputs: tflResult.outputs,
        summary: summary,
        generatedAt: new Date()
      }
    });
    
  } catch (error) {
    console.error('❌ 生成ADaM TFL可追溯性失败:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to generate TFL traceability',
      error: error.message
    });
  }
}

// 🔥 新增：保存数据流可追溯性到数据库
async function saveDataFlowTraceability(req, res) {
  try {
    const { id } = req.params; // Study ID
    const { mappings, stage, hasSDTM, hasADaM } = req.body;
    
    console.log(`🔄 保存数据流可追溯性 (${stage} 阶段)...`);
    console.log(`📊 收到 ${mappings?.length || 0} 个映射项`);
    
    // 1. 获取Study
    const study = await Study.findById(id);
    if (!study) {
      return res.status(404).json({
        success: false,
        message: 'Study not found'
      });
    }
    
    // 2. 构建数据流数据
    const dataFlowData = {
      lastUpdated: new Date(),
      hasSDTM: hasSDTM || false,
      hasADaM: hasADaM || false,
      mappings: mappings || []
    };
    
    // 3. 原子性更新数据库
    const updatePayload = {
      'traceability.dataFlow': dataFlowData
    };
    
    await Study.findByIdAndUpdate(id, { $set: updatePayload }, { new: true });
    
    console.log(`✅ 数据流可追溯性已保存 (${stage} 阶段)`);
    
    // 4. 返回成功响应
    res.json({
      success: true,
      message: `Data flow traceability saved successfully (${stage} stage)`,
      data: {
        stage: stage,
        mappingsCount: mappings?.length || 0,
        hasSDTM: hasSDTM,
        hasADaM: hasADaM,
        lastUpdated: new Date()
      }
    });
    
  } catch (error) {
    console.error('❌ 保存数据流可追溯性失败:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to save data flow traceability',
      error: error.message
    });
  }
}

// 🔥 新增：生成CRF注解矩形参数
async function generateCrfAnnotationRects(req, res) {
  try {
    const { studyId } = req.params;
    
    if (!studyId) {
      return res.status(400).json({
        success: false,
        message: '缺少studyId参数'
      });
    }

    console.log(`🚀 开始为Study ${studyId}生成CRF注解矩形参数...`);

    // 获取Study数据
    const study = await Study.findById(studyId);
    if (!study) {
      return res.status(404).json({
        success: false,
        message: 'Study not found'
      });
    }

    // 检查是否有CRF数据
    if (!study.files?.crf?.crfUploadResult) {
      return res.status(404).json({
        success: false,
        message: 'No CRF data found for this study'
      });
    }

    // 🧠 **第一步**: 生成SDTM映射
    console.log('🧠 开始生成SDTM映射...');
    const { generateSdtmMappingForAllForms } = require('../services/crf_analysis/sdtmMappingService');
    
    // 克隆crfFormList并生成SDTM映射
    let updatedCrfFormList = JSON.parse(JSON.stringify(study.files.crf.crfUploadResult.crfFormList));

    // 初始化并更新GPT阶段进度
    const totalForms = Object.keys(updatedCrfFormList || {}).length;
    updateAnnotationProgress(studyId, {
      overall: { totalForms, processedForms: 0, percentage: 0 },
      gptAnalysis: { totalForms, processedForms: 0, percentage: 0, status: 'running' },
      pdfDrawing: { totalBatches: Math.ceil((totalForms || 0) / 5), processedBatches: 0, percentage: 0, status: 'pending' },
      currentPhase: 'gpt'
    });
    
    let gptProcessedForms = 0;
    updatedCrfFormList = await generateSdtmMappingForAllForms(updatedCrfFormList, () => {
      gptProcessedForms += 1;
      updateAnnotationProgress(studyId, {
        overall: {
          processedForms: gptProcessedForms,
          percentage: totalForms ? (gptProcessedForms / totalForms) * 100 : 0
        },
        gptAnalysis: {
          processedForms: gptProcessedForms,
          percentage: totalForms ? (gptProcessedForms / totalForms) * 100 : 0,
          status: gptProcessedForms === totalForms ? 'completed' : 'running'
        }
      });
    });

    // GPT阶段完成，切换到PDF阶段
    updateAnnotationProgress(studyId, { currentPhase: 'pdf', gptAnalysis: { status: 'completed', percentage: 100 } });
    
    // 将更新后的数据写回数据库
    await Study.findByIdAndUpdate(
      studyId,
      {
        $set: {
          'files.crf.crfUploadResult.crfFormList': updatedCrfFormList
        }
      }
    );
    
    console.log('✅ SDTM映射生成并保存完成');
    
    // 🎨 **第二步**: 分批生成注解并写入PDF（每批5个表格，5分钟超时）
    const updatedStudy = await Study.findById(studyId);
    const batchResult = await annotatePdfInBatches(updatedStudy, studyId, { batchSize: 5, batchTimeoutMs: 5 * 60 * 1000 });

    res.json({
      success: true,
      message: 'CRF annotation process (batched) started and completed',
      data: batchResult
    });

  } catch (error) {
    console.error('❌ 生成CRF注解矩形参数失败:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to generate CRF annotation rectangles',
      error: error.message
    });
  }
}

// 🧠 **新增**: 只生成SDTM映射（不生成PDF）
async function generateSdtmMappingOnly(req, res) {
  try {
    const { studyId } = req.params;
    
    if (!studyId) {
      return res.status(400).json({
        success: false,
        message: 'Missing studyId parameter'
      });
    }

    console.log(`🧠 Starting SDTM mapping generation for Study ${studyId}...`);

    // Get Study data
    const study = await Study.findById(studyId);
    if (!study) {
      return res.status(404).json({
        success: false,
        message: 'Study not found'
      });
    }

    // Check if CRF data exists
    if (!study.files?.crf?.crfUploadResult) {
      return res.status(404).json({
        success: false,
        message: 'No CRF data found for this study'
      });
    }

    // 🧠 Generate SDTM mapping only
    console.log('🧠 Starting SDTM mapping generation...');
    const { generateSdtmMappingForAllForms } = require('../services/crf_analysis/sdtmMappingService');
    
    // Clone crfFormList and generate SDTM mapping
    let updatedCrfFormList = JSON.parse(JSON.stringify(study.files.crf.crfUploadResult.crfFormList));

    // Initialize GPT phase progress
    const totalForms = Object.keys(updatedCrfFormList || {}).length;
    updateAnnotationProgress(studyId, {
      overall: { totalForms, processedForms: 0, percentage: 0 },
      gptAnalysis: { totalForms, processedForms: 0, percentage: 0, status: 'running' },
      currentPhase: 'gpt'
    });
    
    let gptProcessedForms = 0;
    updatedCrfFormList = await generateSdtmMappingForAllForms(updatedCrfFormList, () => {
      gptProcessedForms += 1;
      updateAnnotationProgress(studyId, {
        overall: {
          processedForms: gptProcessedForms,
          percentage: totalForms ? (gptProcessedForms / totalForms) * 100 : 0
        },
        gptAnalysis: {
          processedForms: gptProcessedForms,
          percentage: totalForms ? (gptProcessedForms / totalForms) * 100 : 0,
          status: gptProcessedForms === totalForms ? 'completed' : 'running'
        }
      });
    });

    // GPT phase completed, mark as ready for PDF generation
    updateAnnotationProgress(studyId, { 
      currentPhase: 'gpt_completed', 
      gptAnalysis: { status: 'completed', percentage: 100 } 
    });
    
    // Save updated data to database
    await Study.findByIdAndUpdate(
      studyId,
      {
        $set: {
          'files.crf.crfUploadResult.crfFormList': updatedCrfFormList,
          // 🔥 新增：GPT分析完成后设置SDTM准备状态为true
          'files.crf.crf_sdtm_ready_for_annotation': true
        }
      }
    );
    
    console.log('✅ SDTM mapping generation and save completed');
    console.log('🔥 crf_sdtm_ready_for_annotation set to true');
    
    res.json({
      success: true,
      message: 'SDTM mapping generation completed successfully',
      data: {
        studyId,
        totalForms,
        processedForms: gptProcessedForms
      }
    });

  } catch (error) {
    console.error('❌ SDTM mapping generation failed:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to generate SDTM mapping',
      error: error.message
    });
  }
}

// 🧠 **新增**: 只处理单个表单的SDTM映射生成（逐表单处理模式）
async function generateSdtmMappingForSingleForm(req, res) {
  try {
    const { studyId } = req.params;
    const { formKey } = req.query; // 从query参数获取formKey
    
    if (!studyId || !formKey) {
      return res.status(400).json({
        success: false,
        message: 'Missing studyId or formKey parameter'
      });
    }

    console.log(`🧠 [单表单GPT] 开始处理表单: "${formKey}" (Study: ${studyId})`);

    // 获取Study数据
    const study = await Study.findById(studyId);
    if (!study) {
      return res.status(404).json({
        success: false,
        message: 'Study not found'
      });
    }

    // 检查CRF数据是否存在
    if (!study.files?.crf?.crfUploadResult?.crfFormList) {
      return res.status(404).json({
        success: false,
        message: 'No CRF data found for this study'
      });
    }

    const crfFormList = study.files.crf.crfUploadResult.crfFormList;
    const form = crfFormList[formKey];

    if (!form) {
      return res.status(404).json({
        success: false,
        message: `Form "${formKey}" not found in CRF data`
      });
    }

    if (!Array.isArray(form.Mapping)) {
      return res.status(400).json({
        success: false,
        message: `Form "${formKey}" does not have valid Mapping array`
      });
    }

    console.log(`📋 [单表单GPT] 表单 "${form.title || formKey}" 包含 ${form.Mapping.length} 个问题`);

    // 🔥 更新表单级状态为 processing
    await updateFormGptStatus(studyId, formKey, 'processing');

    try {
      // 调用SDTM映射服务处理单个表单
      const { generateSdtmMapping } = require('../services/crf_analysis/sdtmMappingService');
      
      // 构造映射列表
      const mappingList = form.Mapping.map(item => ({
        index: item.index,
        label_row: item.label_row
      }));

      console.log(`🧠 [单表单GPT] 调用GPT处理表单 "${form.title || formKey}"...`);
      
      // 调用GPT生成映射
      const sdtmMapping = await generateSdtmMapping(form.title || formKey, mappingList);
      
      console.log(`✅ [单表单GPT] GPT映射完成，返回 ${Object.keys(sdtmMapping).length} 个问题的映射结果`);

      // 将结果写回Mapping数组
      form.Mapping.forEach(item => {
        const index = item.index;
        if (index in sdtmMapping) {
          const mappingResult = sdtmMapping[index];
          
          // 写入兼容字段
          item.sdtm_dataset_ai_result = mappingResult.sdtm_dataset_ai_result;
          
          // 写入新的结构化字段
          item.sdtm_mappings = mappingResult.sdtm_mappings;
          
          console.log(`  ✅ Index ${index} 映射已写入`);
        } else {
          // 没有映射结果的情况
          item.sdtm_dataset_ai_result = null;
          item.sdtm_mappings = [];
        }
      });

      // 生成Form的唯一SDTM域列表
      const { extractUniqueDomainsFromForm } = require('../services/crf_analysis/sdtmMappingService');
      form.form_sdtm_mapping_unique = extractUniqueDomainsFromForm(form);

      console.log(`✅ [单表单GPT] 表单 "${formKey}" SDTM映射完成，唯一域: ${form.form_sdtm_mapping_unique?.length || 0} 个`);

      // 🔥 保存更新后的表单数据到数据库
      const updatePath = `files.crf.crfUploadResult.crfFormList.${formKey}`;
      await Study.findByIdAndUpdate(
        studyId,
        {
          $set: {
            [updatePath]: form
          }
        }
      );
      
      console.log(`💾 [单表单GPT] 表单数据已保存到数据库: ${updatePath}`);

      // 🔥 更新表单级状态为 done
      await updateFormGptStatus(studyId, formKey, 'done');

      // 🔥 可选：返回该表单的Excel行数据供前端直接使用
      const excelRows = buildExcelRowsForForm(formKey, form);
      
      console.log(`✅ [单表单GPT] 处理完成，返回 ${excelRows.length} 行Excel数据`);

      res.json({
        success: true,
        message: `SDTM mapping for form "${formKey}" completed successfully`,
        data: {
          studyId,
          formKey,
          formTitle: form.title,
          questionsProcessed: form.Mapping.length,
          uniqueDomains: form.form_sdtm_mapping_unique,
          excelRows: excelRows // 🔥 返回Excel行数据
        }
      });

    } catch (gptError) {
      // GPT处理失败，记录错误状态
      console.error(`❌ [单表单GPT] GPT处理失败:`, gptError);
      await updateFormGptStatus(studyId, formKey, 'error', gptError.message);
      
      throw gptError;
    }

  } catch (error) {
    console.error(`❌ [单表单GPT] 表单处理失败:`, error);
    res.status(500).json({
      success: false,
      message: `Failed to generate SDTM mapping for form "${req.query.formKey}"`,
      error: error.message
    });
  }
}

// 🔥 **辅助函数**: 更新表单级GPT状态
async function updateFormGptStatus(studyId, formKey, status, errorMessage = null) {
  try {
    const updatePath = `files.crf.crfUploadResult.crfFormList.${formKey}.gpt_status`;
    const updateErrorPath = `files.crf.crfUploadResult.crfFormList.${formKey}.gpt_error`;
    const updateTimePath = `files.crf.crfUploadResult.crfFormList.${formKey}.gpt_updated_at`;
    
    const updateFields = {
      [updatePath]: status,
      [updateTimePath]: new Date()
    };
    
    if (errorMessage) {
      updateFields[updateErrorPath] = errorMessage;
    }
    
    await Study.findByIdAndUpdate(studyId, { $set: updateFields });
    
    console.log(`📊 [单表单GPT] 表单 "${formKey}" 状态更新为: ${status}`);
    
    // 同时更新内存进度
    const currentProgress = annotationProgressMap.get(studyId) || getDefaultProgress();
    if (!Array.isArray(currentProgress.perFormStatuses)) {
      currentProgress.perFormStatuses = [];
    }
    
    // 查找或创建该表单的状态记录
    let formStatus = currentProgress.perFormStatuses.find(f => f.formKey === formKey);
    if (!formStatus) {
      formStatus = { formKey, gpt_status: status, updated_at: new Date(), error: errorMessage };
      currentProgress.perFormStatuses.push(formStatus);
    } else {
      formStatus.gpt_status = status;
      formStatus.updated_at = new Date();
      if (errorMessage) formStatus.error = errorMessage;
    }
    
    annotationProgressMap.set(studyId, currentProgress);
    
  } catch (error) {
    console.error(`❌ [单表单GPT] 更新表单状态失败:`, error);
  }
}

// 🔥 **辅助函数**: 为单个表单构建Excel行数据
function buildExcelRowsForForm(formKey, form) {
  const excelRows = [];
  
  if (!Array.isArray(form.Mapping)) {
    return excelRows;
  }
  
  // 复用现有的辅助函数逻辑
  form.Mapping.forEach((mapping, i) => {
    const pageNumber = extractPageNumber(mapping, form) || '';
    const questionNumber = mapping.index || '';
    const questionText = mapping.label_row || '';
    const questionVariables = extractQuestionVariables(mapping.sdtm_mappings);
    const questionFormMapping = extractQuestionFormMapping(mapping.sdtm_mappings);
    
    // 构建一行（6列）
    const row = [
      formKey,              // Form Name
      questionFormMapping,  // Form Mapping
      pageNumber,           // Page Number
      questionNumber,       // Question Number
      questionText,         // Question
      questionVariables     // Question Variable
    ];
    
    excelRows.push(row);
  });
  
  console.log(`📊 [单表单GPT] 表单 "${formKey}" 生成 ${excelRows.length} 行Excel数据`);
  
  return excelRows;
}

// 🔥 **辅助函数**: 提取Question的Form Mapping（从sdtm_mappings）
function extractQuestionFormMapping(sdtmMappings) {
  if (!Array.isArray(sdtmMappings) || sdtmMappings.length === 0) {
    return '';
  }
  
  const formMappings = [];
  sdtmMappings.forEach((sdtmMapping) => {
    if (sdtmMapping.mapping_type === 'supp' && sdtmMapping.variable && sdtmMapping.domain_code) {
      // SUPP 格式：QNAM in SUPP--
      const suppFormat = `${sdtmMapping.variable} in ${sdtmMapping.domain_code}`;
      formMappings.push(suppFormat);
    } else if (sdtmMapping.domain_code && sdtmMapping.domain_label) {
      // 标准格式：DOMAIN (DOMAIN_LABEL)
      const standardFormat = `${sdtmMapping.domain_code} (${sdtmMapping.domain_label})`;
      formMappings.push(standardFormat);
    } else if (sdtmMapping.domain_code === '[NOT SUBMITTED]' || sdtmMapping.variable === '[NOT SUBMITTED]') {
      // 特殊格式：[NOT SUBMITTED]
      formMappings.push('[NOT SUBMITTED]');
    } else if (sdtmMapping.domain_code && sdtmMapping.domain_code.includes(' in SUPP')) {
      formMappings.push(sdtmMapping.domain_code);
    }
  });
  
  return formMappings.length > 0 ? formMappings.join('; ') : '';
}

// 🎨 **新增**: 生成PDF注解（使用已存在的SDTM数据）
async function generatePdfAnnotationOnly(req, res) {
  try {
    const { studyId } = req.params;
    
    if (!studyId) {
      return res.status(400).json({
        success: false,
        message: 'Missing studyId parameter'
      });
    }

    console.log(`🎨 Starting PDF annotation generation for Study ${studyId}...`);

    // Get Study data
    const study = await Study.findById(studyId);
    if (!study) {
      return res.status(404).json({
        success: false,
        message: 'Study not found'
      });
    }

    // Check if CRF data exists
    if (!study.files?.crf?.crfUploadResult) {
      return res.status(404).json({
        success: false,
        message: 'No CRF data found for this study'
      });
    }

    // Check if SDTM mapping data exists
    console.log('🔍 Checking existing SDTM mapping data...');
    const crfFormList = study.files.crf.crfUploadResult.crfFormList;
    const hasExistingData = checkIfHasExistingSdtmData(crfFormList);
    
    if (!hasExistingData) {
      return res.status(400).json({
        success: false,
        message: 'No SDTM mapping data found. Please run SDTM analysis first.',
        code: 'NO_SDTM_DATA'
      });
    }
    
    console.log('✅ Found existing SDTM data, starting PDF annotation...');
    
    // Initialize PDF drawing phase progress
    const totalForms = Object.keys(crfFormList || {}).length;
    updateAnnotationProgress(studyId, {
      currentPhase: 'pdf',
      gptAnalysis: { status: 'completed', percentage: 100 },
      pdfDrawing: { totalBatches: Math.ceil((totalForms || 0) / 5), processedBatches: 0, percentage: 0, status: 'running' }
    });
    
    // Generate PDF annotation using batch processing
    const batchResult = await annotatePdfInBatches(study, studyId, { 
      batchSize: 5, 
      batchTimeoutMs: 5 * 60 * 1000 
    });
    
    console.log('🎉 PDF annotation generation completed!');
    
    res.json({
      success: true,
      message: 'PDF annotation generation completed successfully',
      data: batchResult
    });

  } catch (error) {
    console.error('❌ PDF annotation generation failed:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to generate PDF annotation',
      error: error.message
    });
  }
}

// 🎨 **辅助函数**: 生成注解PDF的输出路径
function generateAnnotatedPdfPath(sourcePath) {
  const path = require('path');
  const ext = path.extname(sourcePath);  // .pdf
  const base = path.basename(sourcePath, ext);  // filename
  const dir = path.dirname(sourcePath);  // directory
  
  // 生成带_annotated后缀的文件名
  const annotatedFileName = `${base}_annotated${ext}`;
  const outputPath = path.join(dir, annotatedFileName);
  
  console.log('📁 路径生成:', {
    source: sourcePath,
    output: outputPath,
    fileName: annotatedFileName
  });
  
  return outputPath;
}

// 🎨 **辅助函数**: 调用Python脚本（可配置超时）
async function callPdfAnnotationScriptWithTimeout(sourcePath, rectsByPage, outputPath, timeoutMs) {
  const { spawn } = require('child_process');
  const path = require('path');

  const scriptPath = path.join(__dirname, '../services/pdf_annotate.py');

  return new Promise((resolve, reject) => {
    // console.log('🐍 [Batch] 启动Python进程...');
    // console.log('📝 脚本路径:', scriptPath);
    // console.log('📄 源PDF:', sourcePath);
    // console.log('📊 本批矩形页数:', Object.keys(rectsByPage || {}).length);

    const rectsJson = JSON.stringify(rectsByPage || {});

    const pythonProcess = spawn('python3', [
      scriptPath,
      sourcePath,
      rectsJson,
      outputPath
    ], {
      stdio: ['pipe', 'pipe', 'pipe']
    });

    let stdout = '';
    let stderr = '';

    pythonProcess.stdout.on('data', (data) => {
      const output = data.toString();
      stdout += output;
      console.log(output.trim()); // 直接输出Python的打印内容
    });

    pythonProcess.stderr.on('data', (data) => {
      const error = data.toString();
      stderr += error;
      console.warn('🐍 [Batch] Python错误:', error.trim());
    });

    const killTimer = setTimeout(() => {
      console.warn(`⏰ [Batch] Python进程超时(${Math.round(timeoutMs/1000)}s)，强制终止`);
      try { pythonProcess.kill('SIGTERM'); } catch (_) {}
      reject(new Error('Python脚本执行超时'));
    }, timeoutMs);

    pythonProcess.on('close', (code) => {
      clearTimeout(killTimer);
      // console.log('🐍 [Batch] Python进程结束，退出代码:', code);
      if (code === 0) {
        resolve({ success: true, stdout: stdout.trim(), outputPath });
      } else {
        reject(new Error(`Python脚本失败，退出代码: ${code}\n标准错误: ${stderr}\n标准输出: ${stdout}`));
      }
    });

    pythonProcess.on('error', (err) => {
      clearTimeout(killTimer);
      console.error('❌ [Batch] 启动Python进程失败:', err);
      reject(new Error(`启动Python进程失败: ${err.message}`));
    });
  });
}

// 🎨 **辅助函数**: 调用Python脚本生成注解PDF
async function callPdfAnnotationScript(sourcePath, rectsByPage, outputPath) {
  const { spawn } = require('child_process');
  const path = require('path');
  
  // Python脚本路径
  const scriptPath = path.join(__dirname, '../services/pdf_annotate.py');
  
  return new Promise((resolve, reject) => {
    console.log('🐍 启动Python进程...');
    console.log('📝 脚本路径:', scriptPath);
    console.log('📄 源PDF:', sourcePath);
    console.log('📊 矩形数据页数:', Object.keys(rectsByPage).length);
    
    // 将矩形数据转换为JSON字符串
    const rectsJson = JSON.stringify(rectsByPage);
    
    // 启动Python进程
    const pythonProcess = spawn('python3', [
      scriptPath,
      sourcePath,
      rectsJson,  // 直接传递JSON字符串
      outputPath
    ], {
      stdio: ['pipe', 'pipe', 'pipe']
    });
    
    let stdout = '';
    let stderr = '';
    
    // 收集标准输出
    pythonProcess.stdout.on('data', (data) => {
      const output = data.toString();
      stdout += output;
      console.log(output.trim()); // 直接输出Python的打印内容
    });
    
    // 收集标准错误
    pythonProcess.stderr.on('data', (data) => {
      const error = data.toString();
      stderr += error;
      console.warn('🐍 Python错误:', error.trim());
    });
    
    // 进程结束处理
    pythonProcess.on('close', (code) => {
      // console.log('🐍 Python进程结束，退出代码:', code);
      
      if (code === 0) {
        console.log('✅ Python脚本执行成功');
        resolve({
          success: true,
          stdout: stdout.trim(),
          outputPath: outputPath
        });
      } else {
        console.error('❌ Python脚本执行失败');
        reject(new Error(`Python脚本失败，退出代码: ${code}\n标准错误: ${stderr}\n标准输出: ${stdout}`));
      }
    });
    
    // 进程错误处理
    pythonProcess.on('error', (err) => {
      console.error('❌ 启动Python进程失败:', err);
      reject(new Error(`启动Python进程失败: ${err.message}`));
    });
    
    // 设置超时 (20分钟) - 增加时间以支持大型CRF文件处理
    const timeout = setTimeout(() => {
      console.warn('⏰ Python进程超时，强制终止');
      pythonProcess.kill('SIGTERM');
      reject(new Error('Python脚本执行超时'));
    }, 20 * 60 * 1000);
    
    pythonProcess.on('close', () => {
      clearTimeout(timeout);
    });
  });
}

// 🎨 **新增**: 分批注解PDF（每批5个表格，单批5分钟超时）
async function annotatePdfInBatches(studyData, studyId, options = {}) {
  const fs = require('fs');
  const path = require('path');
  const { generateAnnotationRectsForForms } = require('../services/crf_analysis/annotationRectService');

  const batchSize = options.batchSize || 5;
  const batchTimeoutMs = options.batchTimeoutMs || (5 * 60 * 1000);

  const sourcePath = studyData?.files?.crf?.sourcePath;
  if (!sourcePath) throw new Error('源PDF路径不存在');

  const crfFormList = studyData?.files?.crf?.crfUploadResult?.crfFormList || {};
  const formKeys = Object.keys(crfFormList);
  const totalForms = formKeys.length;
  if (totalForms === 0) {
    console.log('⏸️ 无Form可注解');
    return { totalForms: 0, totalBatches: 0, processedForms: 0 };
  }

  console.log(`🎯 分批注解启动：共 ${totalForms} 个表格，批大小=${batchSize}，单批超时=${Math.round(batchTimeoutMs/1000)}秒`);

  // 计算输出路径与工作路径
  const finalOutputPath = generateAnnotatedPdfPath(sourcePath);
  const workPathA = finalOutputPath;
  const workPathB = finalOutputPath.replace(/\.pdf$/i, '_work.pdf');

  let currentInput = sourcePath;
  let lastOutput = null;

  let colorState = { map: new Map(), index: 0 };

  const totalBatches = Math.ceil(totalForms / batchSize);
  let processedForms = 0;
  let succeededBatches = 0;
  let failedBatches = 0;

  for (let batchIndex = 0; batchIndex < totalBatches; batchIndex++) {
    const start = batchIndex * batchSize;
    const end = Math.min(start + batchSize, totalForms);
    const batchFormKeys = formKeys.slice(start, end);

    // console.log(`\n🔄 开始处理第 ${batchIndex + 1}/${totalBatches} 批：表格索引范围 [${start + 1} - ${end}]，Keys: [${batchFormKeys.join(', ')}]`);

    // 生成本批矩形
    const { rectsByPage, colorState: updatedColorState } = generateAnnotationRectsForForms(studyData, batchFormKeys, colorState);
    colorState = updatedColorState;

    const batchRectsCount = Object.values(rectsByPage).reduce((s, arr) => s + (arr?.length || 0), 0);
    // console.log(`📦 本批矩形总数: ${batchRectsCount}`);

    if (batchRectsCount === 0) {
      console.log('⏭️ 本批无矩形，跳过Python调用');
      processedForms = end;
      console.log(`✅ 已分批注解至第 ${processedForms} 个表格 / 共 ${totalForms}`);
      continue;
    }

    // 切换输出文件以避免读写同一路径冲突
    const outputPath = (batchIndex % 2 === 0) ? workPathA : workPathB;

    try {
      await callPdfAnnotationScriptWithTimeout(currentInput, rectsByPage, outputPath, batchTimeoutMs);
      lastOutput = outputPath;
      currentInput = outputPath; // 下一批以上一批的输出作为输入
      succeededBatches++;
      processedForms = end;
      console.log(`✅ 本批完成。已分批注解至第 ${processedForms} 个表格 / 共 ${totalForms}`);

      // 更新PDF进度（每批完成一次）
      updateAnnotationProgress(studyId, {
        pdfDrawing: {
          totalBatches,
          processedBatches: batchIndex + 1,
          percentage: ((batchIndex + 1) / totalBatches) * 100,
          status: batchIndex + 1 === totalBatches ? 'completed' : 'running'
        }
      });
    } catch (err) {
      console.warn(`❌ 本批失败：${err.message}。将继续下一批。`);
      failedBatches++;
      // 失败时不更新 currentInput，继续用上一轮的有效PDF
    }
  }

  // 确保最终文件位于 finalOutputPath
  try {
    if (lastOutput && lastOutput !== finalOutputPath) {
      fs.copyFileSync(lastOutput, finalOutputPath);
      console.log('📁 已拷贝最终输出文件到:', finalOutputPath);
    }
  } catch (copyErr) {
    console.warn('⚠️ 拷贝最终输出失败:', copyErr.message);
  }

  // 更新数据库：标记完成 & 下载链接
  const downloadUrl = `/api/studies/${studyId}/crf-annotated.pdf`;
  await Study.findByIdAndUpdate(
    studyId,
    {
      $set: {
        'files.crf.annotatedPath': finalOutputPath,
        'files.crf.annotationReady': true,
        'files.crf.annotatedAt': new Date(),
        'files.crf.downloadUrl': downloadUrl
      }
    }
  );

  console.log(`🎉 分批注解完成：成功批次 ${succeededBatches}，失败批次 ${failedBatches}，最终下载链接: ${downloadUrl}`);

  // 最终完成：标记进度为completed并安排清理
  updateAnnotationProgress(studyId, {
    currentPhase: 'completed',
    pdfDrawing: { status: 'completed', percentage: 100 },
    overall: { processedForms: totalForms, percentage: 100 }
  });
  setTimeout(() => { try { annotationProgressMap.delete(studyId); } catch (_) {} }, 60 * 1000);

  return {
    studyId,
    totalForms,
    totalBatches,
    processedForms,
    succeededBatches,
    failedBatches,
    downloadUrl
  };
}

// 🎨 **新增**: 上传完成后自动生成注解PDF
async function generateAnnotatedPdfAfterUpload(studyData, studyId) {
  console.log('🎨 generateAnnotatedPdfAfterUpload 开始...');
  // console.log('📋 Study ID:', studyId);
  
  // 1. 检查是否有源PDF路径
  const sourcePath = studyData?.files?.crf?.sourcePath;
  if (!sourcePath) {
    throw new Error('源PDF路径不存在，无法生成注解');
  }
  console.log('📄 源PDF路径:', sourcePath);
  
  // 2. 检查是否有CRF数据
  if (!studyData?.files?.crf?.crfUploadResult?.crfFormList) {
    throw new Error('CRF表单数据不存在，无法生成注解');
  }
  
  const formCount = Object.keys(studyData.files.crf.crfUploadResult.crfFormList).length;
  console.log('📊 CRF表单数量:', formCount);
  
  if (formCount === 0) {
    console.log('⏸️  无CRF表单数据，跳过注解生成');
    return;
  }
  
  // 3. 生成矩形数据
  console.log('🔢 开始生成注解矩形数据...');
  const { generateAnnotationRects } = require('../services/crf_analysis/annotationRectService');
  const rectsByPage = generateAnnotationRects(studyData);
  
  const totalRects = Object.values(rectsByPage).reduce((sum, rects) => sum + rects.length, 0);
  console.log('📊 生成矩形统计:', {
    totalPages: Object.keys(rectsByPage).length,
    totalRects: totalRects
  });
  
  if (totalRects === 0) {
    console.log('⏸️  无注解矩形数据，跳过PDF生成');
    return;
  }
  
  // 4. 生成输出PDF路径
  const outputPath = generateAnnotatedPdfPath(sourcePath);
  console.log('📁 注解PDF输出路径:', outputPath);
  
  // 5. 调用Python脚本生成注解PDF
  console.log('🐍 开始调用Python脚本生成注解PDF...');
  const annotationResult = await callPdfAnnotationScript(sourcePath, rectsByPage, outputPath);
  
  console.log('✅ 注解PDF生成成功:', annotationResult);
  
  // 6. 更新数据库
  console.log('💾 更新数据库注解字段...');
  
  // 🔥 生成下载链接
  const downloadUrl = `/api/studies/${studyId}/crf-annotated.pdf`;
  console.log('🔗 生成下载链接:', downloadUrl);
  
  await Study.findByIdAndUpdate(
    studyId,
    {
      $set: {
        'files.crf.annotatedPath': outputPath,
        'files.crf.annotationReady': true,
        'files.crf.annotatedAt': new Date(),
        'files.crf.downloadUrl': downloadUrl  // 🔥 新增：保存下载链接
      }
    }
  );
  
  console.log('🎉 CRF注解PDF生成完整流程完成!');
  return {
    success: true,
    annotatedPath: outputPath,
    annotationStats: annotationResult
  };
}

// 🔥 **新增**: 获取CRF注解状态
async function getCrfAnnotationStatus(req, res) {
  try {
    const { studyId } = req.params;
    
    // console.log('📋 获取CRF注解状态...');
    // console.log('📋 Study ID:', studyId);
    
    // 查找Study文档
    const study = await Study.findById(studyId);
    if (!study) {
      return res.status(404).json({
        success: false,
        message: 'Study not found'
      });
    }
    
    // 提取CRF注解相关信息
    const crfData = study?.files?.crf;
    const annotationStatus = {
      hasUpload: !!crfData?.uploaded,
      hasCrfData: !!(crfData?.crfUploadResult?.crfFormList && Object.keys(crfData.crfUploadResult.crfFormList).length > 0),
      annotationReady: !!crfData?.annotationReady,
      downloadUrl: crfData?.downloadUrl || null,
      annotatedAt: crfData?.annotatedAt || null,
      originalName: crfData?.originalName || null,
      // 🔥 新增：SDTM分析完成状态
      crfSdtmReadyForAnnotation: !!crfData?.crf_sdtm_ready_for_annotation
    };
    
    // console.log('📊 CRF注解状态:', annotationStatus);
    
    res.json({
      success: true,
      data: {
        studyId: studyId,
        annotationStatus: annotationStatus
      }
    });
    
  } catch (error) {
    console.error('❌ 获取CRF注解状态失败:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get CRF annotation status',
      error: error.message
    });
  }
}

// 🔥 **新增**: 检查是否有现成的SDTM映射数据
async function checkExistingSdtmData(req, res) {
  try {
    const { studyId } = req.params;
    
    // console.log('🔍 开始检查Study的现成SDTM数据...');
    // console.log('📋 Study ID:', studyId);
    
    if (!studyId) {
      console.warn('❌ 缺少studyId参数');
      return res.status(400).json({
        success: false,
        message: 'Study ID is required'
      });
    }
    
    const study = await Study.findById(studyId)
      .select('files.crf.crfUploadResult.crfFormList') // 只选择必要字段
      .lean();
    
    if (!study) {
      console.warn('❌ Study未找到:', studyId);
      return res.status(404).json({
        success: false,
        message: 'Study not found'
      });
    }
    
    const crfFormList = study?.files?.crf?.crfUploadResult?.crfFormList;
    const hasExistingData = checkIfHasExistingSdtmData(crfFormList);
    
    // console.log('📊 SDTM数据检查结果:', {
    //   studyId: studyId,
    //   totalForms: crfFormList ? Object.keys(crfFormList).length : 0,
    //   hasExistingData: hasExistingData
    // });
    
    res.json({
      success: true,
      hasExistingData: hasExistingData,
      message: hasExistingData ? 'Existing SDTM data found' : 'No existing SDTM data'
    });
    
  } catch (error) {
    console.error('❌ 检查现成SDTM数据失败:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to check existing SDTM data',
      error: error.message
    });
  }
}

// 🔥 **新增**: 仅重新绘制PDF（跳过GPT步骤）
async function redrawCrfAnnotationPdf(req, res) {
  try {
    const { studyId } = req.params;
    
    // console.log('🎨 开始Re-draw PDF流程...');
    // console.log('📋 Study ID:', studyId);
    
    if (!studyId) {
      console.warn('❌ 缺少studyId参数');
      return res.status(400).json({
        success: false,
        message: '缺少studyId参数'
      });
    }

    // 获取Study数据
    const study = await Study.findById(studyId);
    if (!study) {
      console.warn('❌ Study未找到:', studyId);
      return res.status(404).json({
        success: false,
        message: 'Study not found'
      });
    }

    // 检查是否有CRF数据
    if (!study.files?.crf?.crfUploadResult) {
      console.warn('❌ Study没有CRF数据:', studyId);
      return res.status(404).json({
        success: false,
        message: 'No CRF data found for this study'
      });
    }

    console.log('🔍 检查现成的SDTM映射数据...');
    
    // 检查是否有现成的SDTM数据
    const crfFormList = study.files.crf.crfUploadResult.crfFormList;
    const hasExistingData = checkIfHasExistingSdtmData(crfFormList);
    
    if (!hasExistingData) {
      console.warn('❌ 没有找到现成的SDTM数据，无法Re-draw');
      return res.status(400).json({
        success: false,
        message: 'No existing SDTM mapping data found. Please run full annotation first.',
        code: 'NO_EXISTING_DATA'
      });
    }
    
    console.log('✅ 找到现成的SDTM数据，开始Re-draw PDF...');
    console.log('🚀 跳过GPT分析步骤，直接进行PDF绘制');
    
    // 直接调用分批PDF绘制（跳过GPT步骤）
    const batchResult = await annotatePdfInBatches(study, studyId, { 
      batchSize: 5, 
      batchTimeoutMs: 5 * 60 * 1000 
    });
    
    console.log('🎉 Re-draw PDF完成!');
    // console.log('📊 绘制结果:', {
    //   totalForms: batchResult.totalForms,
    //   processedForms: batchResult.processedForms,
    //   succeededBatches: batchResult.succeededBatches,
    //   failedBatches: batchResult.failedBatches
    // });

    res.json({
      success: true,
      message: 'PDF re-drawn successfully (skipped GPT analysis)',
      data: {
        ...batchResult,
        skippedGptAnalysis: true,
        costSaved: true
      }
    });

  } catch (error) {
    console.error('❌ Re-draw PDF失败:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to re-draw PDF',
      error: error.message
    });
  }
}

// 🔥 **辅助函数**: 检查是否有现成的SDTM数据
function checkIfHasExistingSdtmData(crfFormList) {
  if (!crfFormList || typeof crfFormList !== 'object') {
    console.log('📊 SDTM数据检查: crfFormList无效或为空');
    return false;
  }
  
  const formKeys = Object.keys(crfFormList);
  console.log(`📊 SDTM数据检查: 检查${formKeys.length}个Forms`);
  
  let formsWithData = 0;
  let totalForms = 0;
  
  const hasData = Object.values(crfFormList).some(form => {
    totalForms++;
    const hasUniqueData = Array.isArray(form.form_sdtm_mapping_unique) && form.form_sdtm_mapping_unique.length > 0;
    const hasMappingData = Array.isArray(form.Mapping) && form.Mapping.some(mapping => 
      Array.isArray(mapping.sdtm_mappings) && mapping.sdtm_mappings.length > 0
    );
    
    if (hasUniqueData || hasMappingData) {
      formsWithData++;
      console.log(`  ✅ Form "${form.title || 'Unknown'}" 有SDTM数据`);
      return true;
    } else {
      console.log(`  ❌ Form "${form.title || 'Unknown'}" 缺少SDTM数据`);
      return false;
    }
  });
  
  // console.log(`📊 SDTM数据检查结果: ${formsWithData}/${totalForms} Forms有数据，总体判断: ${hasData ? '有数据' : '无数据'}`);
  
  return hasData;
}

// 🔥 **新增**: 下载注解CRF PDF
async function downloadAnnotatedCrf(req, res) {
  try {
    const { studyId } = req.params;
    
    console.log('📥 开始下载注解CRF PDF...');
    // console.log('📋 Study ID:', studyId);
    
    // 验证Study ID格式
    if (!studyId) {
      return res.status(400).json({
        success: false,
        message: 'Study ID is required'
      });
    }
    
    // 查找Study文档
    const study = await Study.findById(studyId);
    if (!study) {
      console.warn('❌ Study not found:', studyId);
      return res.status(404).json({
        success: false,
        message: 'Study not found'
      });
    }
    
    // 检查是否有CRF注解数据
    const annotatedPath = study?.files?.crf?.annotatedPath;
    const annotationReady = study?.files?.crf?.annotationReady;
    
    if (!annotationReady) {
      console.warn('❌ CRF注解未准备就绪:', studyId);
      return res.status(404).json({
        success: false,
        message: 'CRF annotation is not ready. Please generate annotation first.'
      });
    }
    
    if (!annotatedPath) {
      console.warn('❌ 注解PDF路径不存在:', studyId);
      return res.status(404).json({
        success: false,
        message: 'Annotated PDF path not found'
      });
    }
    
    console.log('📁 注解PDF路径:', annotatedPath);
    
    // 检查文件是否存在
    const fs = require('fs');
    const path = require('path');
    
    if (!fs.existsSync(annotatedPath)) {
      console.warn('❌ 注解PDF文件不存在:', annotatedPath);
      return res.status(404).json({
        success: false,
        message: 'Annotated PDF file not found on server'
      });
    }
    
    // 获取文件统计信息
    const stats = fs.statSync(annotatedPath);
    const fileName = path.basename(annotatedPath);
    
    console.log('📊 文件信息:', {
      path: annotatedPath,
      size: stats.size,
      fileName: fileName
    });
    
    // 设置响应头
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${fileName}"`);
    res.setHeader('Content-Length', stats.size);
    // 🔧 **修复**: 允许前端访问Content-Disposition头部
    res.setHeader('Access-Control-Expose-Headers', 'Content-Disposition, Content-Length');
    
    console.log('📤 开始发送PDF文件...');
    
    // 发送文件
    res.sendFile(path.resolve(annotatedPath), (err) => {
      if (err) {
        console.error('❌ 发送文件失败:', err);
        if (!res.headersSent) {
          res.status(500).json({
            success: false,
            message: 'Failed to send annotated PDF file',
            error: err.message
          });
        }
      } else {
        console.log('✅ 注解PDF发送成功:', fileName);
      }
    });
    
  } catch (error) {
    console.error('❌ 下载注解CRF PDF失败:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to download annotated CRF PDF',
      error: error.message
    });
  }
}



// 辅助函数：提取Form映射字符串
function extractFormMappingString(formSdtmMappingUnique) {
  if (!Array.isArray(formSdtmMappingUnique) || formSdtmMappingUnique.length === 0) {
    return '';
  }
  
  // 保留完整格式: "DM (Demographics); SV (Study Visit)"
  return formSdtmMappingUnique.join('; ');
}

// 辅助函数：提取页面号
function extractPageNumber(mapping, form) {
  // 优先使用 mapping.page_number
  if (typeof mapping.page_number === 'number') {
    return mapping.page_number;
  }
  
  // 回退到从 LabelForm 中查找
  if (Array.isArray(form.LabelForm)) {
    const labelItem = form.LabelForm.find(item => item.match_index === mapping.index);
    if (labelItem?.content?.page_number) {
      return labelItem.content.page_number;
    }
  }
  
  return null;
}

// 辅助函数：提取Question Variables
function extractQuestionVariables(sdtmMappings) {
  if (!Array.isArray(sdtmMappings) || sdtmMappings.length === 0) {
    return 'null';
  }
  
  const variables = [];
  sdtmMappings.forEach(sdtmMapping => {
    if (sdtmMapping.variable) {
      // 处理 "SITEID / USUBJID" → ["SITEID", "USUBJID"]
      const vars = sdtmMapping.variable.split(' / ').map(v => v.trim());
      variables.push(...vars);
    }
  });
  
  return variables.length > 0 ? variables.join('; ') : 'null';
}


// 🔥 **新增**: 保存修正后的CRF数据到数据库（分批版本）
async function saveCrfCorrectedDataBatch(req, res) {
  try {
    const { studyId } = req.params;
    const { batchData, batchIndex, totalBatches, isLastBatch } = req.body;
    
    console.log(`💾 [Backend] Saving CRF corrected data batch for Study ${studyId}...`);
    console.log(`📊 [Backend] Batch ${batchIndex + 1}/${totalBatches}:`, {
      batchIndex,
      totalBatches,
      isLastBatch,
      rowsReceived: batchData?.rows?.length || 0
    });
    
    if (!studyId) {
      console.error('❌ [Backend] Missing studyId parameter');
      return res.status(400).json({
        success: false,
        message: 'Missing studyId parameter'
      });
    }
    
    if (!batchData || !Array.isArray(batchData.rows)) {
      console.error('❌ [Backend] Invalid batch data format');
      return res.status(400).json({
        success: false,
        message: 'Invalid batch data format'
      });
    }

    console.log(`📋 [Backend] Batch ${batchIndex + 1} data preview:`, batchData.rows.slice(0, 2));

    // Get Study data
    const study = await Study.findById(studyId);
    if (!study) {
      console.error('❌ [Backend] Study not found');
      return res.status(404).json({
        success: false,
        message: 'Study not found'
      });
    }

    // Parse current batch Excel data into Mapping_corrected_CRF_Annotation_Checklist structure
    const crfFormList = study?.files?.crf?.crfUploadResult?.crfFormList || {};
    const mappingCorrectedByForm = parseExcelDataToMappingCorrected(batchData.rows);
    const enrichedMappingByForm = enrichCorrectedMappingsWithMeta(crfFormList, mappingCorrectedByForm);
    const formsInBatch = Object.keys(enrichedMappingByForm);
    
    console.log(`🔧 [Backend] Processing ${formsInBatch.length} forms in batch ${batchIndex + 1}:`, formsInBatch);
    
    // Update database with current batch data (incremental update)
    const updateOperations = {};
    Object.keys(enrichedMappingByForm).forEach(formKey => {
      updateOperations[`files.crf.crfUploadResult.crfFormList.${formKey}.Mapping_corrected_CRF_Annotation_Checklist`] = enrichedMappingByForm[formKey];
    });
    
    await Study.findByIdAndUpdate(studyId, { $set: updateOperations });
    console.log(`✅ [Backend] Batch ${batchIndex + 1} data saved to database`);
    
    // 🔥 如果是最后一批，生成所有表格的form_sdtm_mapping_unique
    if (isLastBatch) {
      console.log('🔧 [Backend] Last batch - generating form_sdtm_mapping_unique for all forms...');
      
      // 重新获取完整的Study数据
      const updatedStudy = await Study.findById(studyId);
      const crfFormList = updatedStudy?.files?.crf?.crfUploadResult?.crfFormList;
      
      if (crfFormList) {
        const formSdtmMappingUniqueOperations = {};
        
        Object.keys(crfFormList).forEach(formKey => {
          const form = crfFormList[formKey];
          if (form?.Mapping_corrected_CRF_Annotation_Checklist) {
            const uniqueMappings = extractUniqueFormMappingsForForm(form.Mapping_corrected_CRF_Annotation_Checklist);
            formSdtmMappingUniqueOperations[`files.crf.crfUploadResult.crfFormList.${formKey}.Mapping_corrected_form_sdtm_mapping_unique`] = uniqueMappings;
          }
        });
        
        await Study.findByIdAndUpdate(studyId, { $set: formSdtmMappingUniqueOperations });
        console.log('✅ [Backend] form_sdtm_mapping_unique generated for all forms');
      }
    }
    
    res.json({
      success: true,
      message: `Corrected CRF data batch ${batchIndex + 1} saved successfully`,
      data: {
        studyId,
        batchIndex,
        totalBatches,
        isLastBatch,
        rowsProcessed: batchData.rows.length,
        formsUpdated: formsInBatch
      }
    });

  } catch (error) {
    console.error(`❌ [Backend] Failed to save corrected CRF data batch:`, {
      error: error.message,
      stack: error.stack,
      studyId,
      batchIndex,
      totalBatches
    });
    
    res.status(500).json({
      success: false,
      message: 'Failed to save corrected CRF data batch',
      error: error.message
    });
  }
}

// 🔥 **保留**: 原始的一次性保存函数（作为备用）
async function saveCrfCorrectedData(req, res) {
  try {
    const { studyId } = req.params;
    const { excelData } = req.body;
    
    if (!studyId) {
      return res.status(400).json({
        success: false,
        message: 'Missing studyId parameter'
      });
    }
    
    if (!excelData || !Array.isArray(excelData.rows)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid Excel data format'
      });
    }

    console.log(`💾 Saving corrected CRF data for Study ${studyId}...`);
    console.log(`📊 Received ${excelData.rows.length} rows from Excel`);
    console.log('📋 Excel数据预览:', excelData.rows.slice(0, 3)); // 显示前3行数据

    // Get Study data
    const study = await Study.findById(studyId);
    if (!study) {
      return res.status(404).json({
        success: false,
        message: 'Study not found'
      });
    }
    
    // Parse Excel data into Mapping_corrected_CRF_Annotation_Checklist structure
    const crfFormList = study?.files?.crf?.crfUploadResult?.crfFormList || {};
    const mappingCorrectedByForm = parseExcelDataToMappingCorrected(excelData.rows);
    const enrichedMappingByForm = enrichCorrectedMappingsWithMeta(crfFormList, mappingCorrectedByForm);
    
    // Generate Mapping_corrected_form_sdtm_mapping_unique for each form
    const formSdtmMappingUniqueByForm = {};
    Object.keys(enrichedMappingByForm).forEach(formKey => {
      const correctedMappings = enrichedMappingByForm[formKey];
      formSdtmMappingUniqueByForm[formKey] = extractUniqueFormMappingsForForm(correctedMappings);
    });
    
    // Update database with both corrected mappings and form domain mappings
    const updateOperations = {};
    Object.keys(enrichedMappingByForm).forEach(formKey => {
      updateOperations[`files.crf.crfUploadResult.crfFormList.${formKey}.Mapping_corrected_CRF_Annotation_Checklist`] = enrichedMappingByForm[formKey];
      updateOperations[`files.crf.crfUploadResult.crfFormList.${formKey}.Mapping_corrected_form_sdtm_mapping_unique`] = formSdtmMappingUniqueByForm[formKey];
    });
    
    await Study.findByIdAndUpdate(studyId, { $set: updateOperations });
    
    console.log('✅ Corrected CRF data saved to database successfully');
    
    res.json({
      success: true,
      message: 'Corrected CRF data saved successfully',
      data: {
        studyId,
        totalRows: excelData.rows.length,
        formsUpdated: Object.keys(mappingCorrectedByForm)
      }
    });

  } catch (error) {
    console.error('❌ Failed to save corrected CRF data:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to save corrected CRF data',
      error: error.message
    });
  }
}

// 辅助函数：将Excel数据解析为Mapping_corrected_CRF_Annotation_Checklist结构
function parseExcelDataToMappingCorrected(excelRows) {
  const mappingCorrectedByForm = {};
  
  excelRows.forEach(row => {
    // Excel行格式: [Form_Name, Form_Mapping, Page_Number, Question_Number, Question, Question_Variable]
    const [formName, formMapping, pageNumber, questionNumber, question, questionVariable] = row;
    
    // 🔧 Form_Name就是formKey（如 "PARTICIPANT_ENROLLMENT"）
    const formKey = formName || 'UNKNOWN';
    
    if (!mappingCorrectedByForm[formKey]) {
      mappingCorrectedByForm[formKey] = [];
    }
    
    // 创建Mapping_corrected_CRF_Annotation_Checklist条目
    mappingCorrectedByForm[formKey].push({
      Form_Name: formName,
      Form_Mapping: formMapping,
      Page_Number: pageNumber,
      Question_Number: questionNumber,
      Question: question,
      Question_Variable: questionVariable
    });
  });
  
  return mappingCorrectedByForm;
}

/**
 * Extract a short abbreviation from Form_Mapping string.
 * Example: "DM (Demographics)" -> "DM"
 * @param {string} formMapping - Original Form_Mapping string
 * @returns {string|null} Abbreviation or null
 */
function extractFormMappingAbbreviation(formMapping) {
  if (!formMapping || typeof formMapping !== 'string') {
    return null;
  }
  
  // Keep special marker as is
  const trimmed = formMapping.trim();
  if (trimmed === '[Not Submitted]') {
    return trimmed;
  }
  
  // Take first segment before ';'
  const firstSegment = trimmed.split(';')[0].trim();
  if (!firstSegment) {
    return null;
  }
  
  // Remove parentheses and content inside
  const withoutParen = firstSegment.replace(/\(.*?\)/g, '').trim();
  if (!withoutParen) {
    return null;
  }
  
  // Take first non-empty token as abbreviation
  const parts = withoutParen.split(/\s+/).filter(Boolean);
  if (parts.length === 0) {
    return null;
  }
  
  return parts[0];
}

/**
 * Enrich Mapping_corrected_CRF_Annotation_Checklist entries with
 * Form_Mapping_Abbreviation, type (from OIDForm.DataType), and value (from LabelForm.value_part).
 * @param {Object} crfFormList - Original crfFormList from database
 * @param {Object} mappingCorrectedByForm - Parsed corrected mappings keyed by formKey
 * @returns {Object} Enriched mappingCorrectedByForm
 */
function enrichCorrectedMappingsWithMeta(crfFormList, mappingCorrectedByForm) {
  const result = {};
  
  Object.keys(mappingCorrectedByForm || {}).forEach(formKey => {
    const correctedList = mappingCorrectedByForm[formKey] || [];
    const form = crfFormList && typeof crfFormList === 'object' ? crfFormList[formKey] : null;
    
    const labelByIndex = {};
    const oidByIndex = {};
    
    if (form) {
      if (Array.isArray(form.LabelForm)) {
        form.LabelForm.forEach(entry => {
          if (typeof entry?.match_index === 'number') {
            labelByIndex[entry.match_index] = entry;
          }
        });
      }
      if (Array.isArray(form.OIDForm)) {
        form.OIDForm.forEach(entry => {
          if (typeof entry?.match_index === 'number') {
            oidByIndex[entry.match_index] = entry;
          }
        });
      }
    }
    
    result[formKey] = correctedList.map(item => {
      const index = Number(item.Question_Number);
      const abbreviation = extractFormMappingAbbreviation(item.Form_Mapping);
      
      let type = null;
      let value = null;
      
      const oidEntry = oidByIndex[index];
      if (oidEntry && oidEntry.content && oidEntry.content.columns && oidEntry.content.columns.DataType && typeof oidEntry.content.columns.DataType.text === 'string') {
        type = oidEntry.content.columns.DataType.text;
      }
      
      const labelEntry = labelByIndex[index];
      if (labelEntry && labelEntry.content && labelEntry.content.value_part && typeof labelEntry.content.value_part.text === 'string') {
        value = labelEntry.content.value_part.text;
      }
      
      return {
        ...item,
        Form_Mapping_Abbreviation: abbreviation,
        type,
        value
      };
    });
  });
  
  return result;
}

// 辅助函数：从单个form的修正数据中提取唯一的Form_Mapping
function extractUniqueFormMappingsForForm(correctedMappings) {
  if (!Array.isArray(correctedMappings) || correctedMappings.length === 0) {
    return [];
  }
  
  // 收集所有Form_Mapping字符串
  const allFormMappings = correctedMappings
    .map(item => item.Form_Mapping)
    .filter(mapping => mapping && typeof mapping === 'string');
  
  // 解析每个Form_Mapping字符串，提取所有域
  const allDomains = [];
  allFormMappings.forEach(formMapping => {
    const domains = formMapping.split(';').map(d => d.trim());
    allDomains.push(...domains);
  });
  
  // 去重并返回
  return [...new Set(allDomains)];
}

// 🔥 新增：更新Spec创建状态
async function updateSpecStatus(req, res) {
  try {
    const { id } = req.params;
    const { status, completed_at } = req.body;
    
    console.log('📊 更新Spec状态，Study ID:', id, 'Status:', status);
    
    // 获取Study
    const study = await Study.findById(id);
    if (!study) {
      return res.status(404).json({
        success: false,
        message: 'Study not found'
      });
    }
    
    // 初始化Spec结构
    if (!study.Spec) {
      study.Spec = {};
    }
    
    // 更新status和时间戳
    study.Spec.status = status;
    study.Spec.last_updated = completed_at || new Date();
    
    await study.save();
    
    console.log('✅ Spec状态更新成功:', status);
    
    return res.json({
      success: true,
      message: 'Spec status updated successfully',
      data: {
        studyId: id,
        status: status,
        updated_at: study.Spec.last_updated
      }
    });
    
  } catch (error) {
    console.error('❌ 更新Spec状态失败:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to update Spec status',
      error: error.message
    });
  }
}

// 🔥 新增：更新Spec各section状态
async function updateSpecSectionStatus(req, res) {
  try {
    const { id } = req.params;
    const { section, status } = req.body;
    
    console.log('📊 更新Spec Section状态，Study ID:', id, 'Section:', section, 'Status:', status);
    
    // 验证输入
    const validStatuses = ['false', 'created', 'confirmed'];
    if (!validStatuses.includes(status)) {
      return res.status(400).json({
        success: false,
        message: `Invalid status: ${status}. Must be one of: ${validStatuses.join(', ')}`
      });
    }
    
    // 验证section名称
    const validSections = ['Study', 'Updated Tracker', 'Datasets', 'Variables', 'Methods', 'TESTCD_Details', 'SUPP_Details', 'TA_Data', 'TE_Data', 'TI_Data', 'TV_Data', 'TS_Data'];
    if (!validSections.includes(section)) {
      return res.status(400).json({
        success: false,
        message: `Invalid section: ${section}. Must be one of: ${validSections.join(', ')}`
      });
    }
    
    // 获取Study
    const study = await Study.findById(id);
    if (!study) {
      return res.status(404).json({
        success: false,
        message: 'Study not found'
      });
    }
    
    // 初始化Spec结构
    if (!study.Spec) {
      study.Spec = {};
      console.log('🔄 初始化study.Spec');
    }
    if (!study.Spec.first_version) {
      study.Spec.first_version = {};
      console.log('🔄 初始化study.Spec.first_version');
    }
    
    // 映射section名称到数据库字段名（处理空格和特殊字符）
    const sectionFieldName = section.replace(/ /g, '_'); // "Updated Tracker" → "Updated_Tracker"
    
    // 初始化section结构（如果不存在）
    if (!study.Spec.first_version[sectionFieldName]) {
      study.Spec.first_version[sectionFieldName] = {
        table_title: [],
        table_content: [],
        created_at: new Date(),
        updated_at: new Date(),
        status: status
      };
      console.log(`🔄 初始化section结构: ${sectionFieldName}`);
    } else {
      // 更新现有section的status和时间戳
      study.Spec.first_version[sectionFieldName].status = status;
      study.Spec.first_version[sectionFieldName].updated_at = new Date();
      console.log(`🔧 更新section状态: ${sectionFieldName} → ${status}`);
    }
    
    await study.save();
    
    console.log(`✅ Section状态更新成功: ${section} → ${status}`);
    
    return res.json({
      success: true,
      message: 'Section status updated successfully',
      data: {
        studyId: id,
        section: section,
        sectionField: sectionFieldName,
        status: status,
        updated_at: study.Spec.first_version[sectionFieldName].updated_at
      }
    });
    
  } catch (error) {
    console.error('❌ 更新Section状态失败:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to update section status',
      error: error.message
    });
  }
}

module.exports = {
  uploadDocument,
  getDocuments,
  listIncompleteEstimates,
  getDocumentContent,
  getStudyDocuments,
  confirmSDTMAnalysis,
  confirmADaMAnalysis,
  updateProjectSelection,
  markTaskAsStarted,
  markTaskAsDone,
  markCostEstimateDone,
  analyzeDocumentForSdtm,
  analyzeDocumentForAdam,
  updateUnits,
  deleteDocument,
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
  generateSdtmMappingOnly,          // 🧠 新增：只生成SDTM映射
  generatePdfAnnotationOnly,        // 🎨 新增：只生成PDF注解
  getCrfAnnotationStatus,           // 🔥 新增：获取CRF注解状态
  downloadAnnotatedCrf,              // 🔥 新增：下载注解CRF PDF
  checkExistingSdtmData,            // 🔥 新增：检查现成SDTM数据
  redrawCrfAnnotationPdf,           // 🔥 新增：仅重绘PDF（跳过GPT）
  generateAdamToOutputTraceability,  // 🔥 新增：TFL可追溯性生成函数
  saveDataFlowTraceability,          // 🔥 新增：数据流可追溯性保存函数
  getCrfAnnotationProgress,         // 🔥 新增：获取CRF注解进度（内存）
  resetCrfProgress,                 // 🔥 新增：重置进度（Re-annotate前）
  extractProtocolInfo,              // 🔥 新增：提取protocol信息用于Spec页面
  saveSpecStudyData,                // 🔥 新增：保存Spec Study表格数据
  importSDTMIGData,                 // 🔥 新增：导入SDTMIG参考数据（一次性操作）
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
}; 