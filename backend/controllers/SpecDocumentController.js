/**
 * Spec Document Controller - 专门处理Spec相关的数据处理逻辑
 * 功能：处理SUPP_Details表格的自动生成和数据填充
 * Author: LLX Solutions
 */

const Study = require('../models/studyModel');
const OpenAI = require('openai');

// 初始化OpenAI客户端
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
  timeout: 300000 // 5分钟超时
});

// 🔥 定义正确的SUPP表头
const SUPP_TABLE_HEADERS = [
  'Dataset', 'QNAM', 'QLABEL', 'Raw Dataset Name or External Source Name',
  'Selection Criteria', 'IDVAR', 'IDVARVAL', 'QVAL', 'QORIG', 'QEVAL'
];

// 🔥 定义正确的TESTCD表头 - 32个字段，确保与数据库Schema完全一致
const TESTCD_TABLE_HEADERS = [
  'Dataset', 
  '--TESTCD Value', 
  '--TEST Value', 
  'Raw Dataset Name or External Source Name', 
  'Selection Criteria', 
  '--CAT Value', 
  '--SCAT Value', 
  '--STAT Source/Derivation', 
  '--REASND Source/Derivation', 
  '--ORRES Source/Derivation',
  '--ORRESU Source/Derivation', 
  '--STRESC Source/Derivation', 
  '--STRESN Source/Derivation', 
  '--STRESU Source/Derivation', 
  '--DTC Source/Derivation', 
  '--CLSIG Source/Derivation', 
  '--POS Source/Derivation', 
  '--LAT Source/Derivation', 
  '--LOC Source/Derivation', 
  '--DIR Source/Derivation', 
  '--NAM Source/Derivation', 
  '--SPEC Source/Derivation', 
  '--OBJ Value', 
  '--METHOD Source/Derivation', 
  'FOCID', 
  'TSTDTL Source/Derivation', 
  '--EVLINT Source/Derivation', 
  '--EVINTX Source/Derivation', 
  '--EVAL Source/Derivation', 
  '--EVALINT Source/Derivation', 
  'RAW Variable 1', 
  'RAW Variable 2'
];

// 🔥 定义正确的TA表头 - 10个字段
const TA_TABLE_HEADERS = [
  'STUDYID', 'DOMAIN', 'ARMCD', 'ARM', 'TAETORD', 'ETCD', 'ELEMENT', 'TABRANCH', 'TATRANS', 'EPOCH'
];

// 🔥 定义正确的TE表头 - 7个字段
const TE_TABLE_HEADERS = [
  'STUDYID', 'DOMAIN', 'ETCD', 'ELEMENT', 'TESTRL', 'TEENRL', 'TEDUR'
];

// 🔥 定义正确的TI表头 - 6个字段
const TI_TABLE_HEADERS = [
  'STUDYID', 'DOMAIN', 'IETESTCD', 'IETEST', 'IECAT', 'TIVERS'
];

// 🔥 定义正确的TS表头 - 11个字段
const TS_TABLE_HEADERS = [
  'STUDYID', 'DOMAIN', 'TSSEQ', 'TSGRPID', 'TSPARMCD', 'TSPARM', 'TSVAL', 'TSVALNF', 'TSVALCD', 'TSVCDREF', 'TSVCDVER'
];

/**
 * 从CRF数据中提取Form_Name和Form_Mapping数据
 * @param {string} studyId - Study ID
 * @returns {Array} temp数据数组 [{Form_Name, Form_Mapping}]
 */
async function extractFormMappingData(studyId) {
  try {
    console.log('🔍 [Backend] 开始从form.Mapping_corrected_form_sdtm_mapping_unique提取SUPP数据...');
    console.log(`📊 [Backend] 目标studyId: ${studyId}`);
    
    const study = await Study.findById(studyId)
      .select('files.crf.crfUploadResult.crfFormList')
      .lean();
    
    if (!study?.files?.crf?.crfUploadResult?.crfFormList) {
      console.error(`❌ [Backend] CRF数据不存在，studyId: ${studyId}`);
      throw new Error('CRF数据不存在');
    }
    console.log(`✅ [Backend] CRF数据结构找到，开始遍历Form...`);
    
    const crfFormList = study.files.crf.crfUploadResult.crfFormList;
    const tempData = [];
    let totalDomainStrings = 0;
    let suppFilteredCount = 0;
    
    // 遍历所有Form
    for (const formKey in crfFormList) {
      const form = crfFormList[formKey];
      const formTitle = form.title || formKey;
      
      // 🔥 新邏輯：從Question級別的修正數據提取，而不是Form級別的唯一域列表
      const mappingChecklist = form?.Mapping_corrected_CRF_Annotation_Checklist;
      
      if (Array.isArray(mappingChecklist)) {
        console.log(`  🔍 [Backend] 检查Form "${formTitle}": ${mappingChecklist.length} 个问题记录`);
        
        // 遍历每个问题的映射记录
        mappingChecklist.forEach(item => {
          if (item && item.Form_Mapping && typeof item.Form_Mapping === 'string') {
            totalDomainStrings++;
            
            // preprocessing: 清理域字符串格式
            let cleanedDomain = item.Form_Mapping.toString().trim();
            
            // 去掉后缀 ": [FREE TEXT]" 或其他 ": ..." 格式  
            cleanedDomain = cleanedDomain.replace(/:\s*\[.*?\].*$/, '').trim();
            cleanedDomain = cleanedDomain.replace(/:\s*.*$/, '').trim();
            
            // 🔥 處理分號分隔的多域情況（如 "DM (Demographics); AETERM in SUPPAE"）
            const domains = cleanedDomain.split(';').map(d => d.trim());
            
            console.log(`    [DEBUG] 原始Form_Mapping: "${item.Form_Mapping}"`);
            console.log(`    [DEBUG] 清理後cleanedDomain: "${cleanedDomain}"`);
            console.log(`    [DEBUG] 分割後domains: [${domains.map(d => `"${d}"`).join(', ')}]`);
            
            domains.forEach((domain, domainIndex) => {
              const containsInSupp = domain.includes(' in SUPP');
              console.log(`    [DEBUG] Domain[${domainIndex}] "${domain}" → 是否包含' in SUPP': ${containsInSupp}`);
              
              if (containsInSupp) {
                const tempRecord = {
                  Form_Name: formTitle,
                  Form_Mapping: domain,
                  Question_Number: item.Question_Number || '',  // 新增：問題編號追踪
                  Question: item.Question || '',                // 新增：問題文本追踪  
                  Page_Number: item.Page_Number || ''          // 新增：頁碼追踪
                };
                tempData.push(tempRecord);
                suppFilteredCount++;
                console.log(`  📋 [Backend] 提取SUPP记录: "${domain}" from Question "${item.Question_Number}" in Form "${formTitle}"`);
                console.log(`    [DEBUG] 完整tempRecord:`, tempRecord);
              } else {
                console.log(`    [DEBUG] 跳過非SUPP域: "${domain}"`);
              }
            });
          }
        });
      } else {
        console.log(`  ⚠️ [Backend] Form "${formTitle}" 没有Mapping_corrected_CRF_Annotation_Checklist数据`);
      }
    }
    
    console.log(`✅ [Backend] 提取完成，总域字符串: ${totalDomainStrings} 条，SUPP筛选后: ${suppFilteredCount} 条，最终temp数据: ${tempData.length} 条`);
    return tempData;
    
  } catch (error) {
    console.error('❌ [Backend] 提取Form_Mapping数据失败:', error);
    console.error('📋 [Backend] 提取错误详情:', {
      studyId,
      message: error.message,
      stack: error.stack?.split('\n').slice(0, 3).join('\n')
    });
    throw error;
  }
}

/**
 * 解析SUPP映射格式字符串
 * @param {string} formMapping - 格式如 "AETERM in SUPPAE"
 * @returns {Object|null} 解析结果 {qnam, suppDomain, baseDomain} 或 null
 */
function parseSUPPMapping(formMapping) {
  if (!formMapping || typeof formMapping !== 'string') {
    return null;
  }
  
  // 放宽匹配模式: "<QNAM> in <SUPP-->" 忽略后缀
  const match = formMapping.match(/^(.+)\s+in\s+(SUPP[A-Z0-9]+)/i);
  
  if (!match) {
    return null;
  }
  
  const qnam = match[1].trim().toUpperCase();
  const suppDomain = match[2].trim().toUpperCase();
  const baseDomain = suppDomain.slice(4); // 去掉 "SUPP" 前缀

  
  return {
    qnam,
    suppDomain,
    baseDomain
  };
}

/**
 * 從 "DM (Demographics)" 格式中提取域代碼 "DM"
 * @param {string} formMapping - 格式如 "DM (Demographics)"
 * @returns {string} 域代碼如 "DM"
 */
function extractDomainCodeFromMapping(formMapping) {
  if (!formMapping || typeof formMapping !== 'string') {
    return 'UNKNOWN';
  }
  
  // 匹配 "DM (Demographics)" 格式，提取 "DM"
  const match = formMapping.match(/^([A-Z0-9]+)\s*\(/);
  if (match) {
    console.log(`🔧 [Backend] 提取域代碼: "${formMapping}" → "${match[1]}"`);
    return match[1];
  }
  
  // 如果不匹配標準格式，返回原字符串（容錯）
  console.log(`⚠️ [Backend] 無法從 "${formMapping}" 提取域代碼，使用原值`);
  return formMapping.trim();
}

/**
 * 解析 TESTCD 條件格式字符串
 * @param {string} variable - 格式如 "LBORRES when LBTESTCD = ADA" 或 "LBORRES"
 * @returns {Object} 解析結果 {variable, testcd_field, testcd_value}
 */
function parseTESTCDCondition(variable) {
  if (!variable || typeof variable !== 'string') {
    return { variable: '', testcd_field: null, testcd_value: null };
  }
  
  // 檢查是否包含 when 條件
  if (variable.includes(' when ')) {
    const [varPart, conditionPart] = variable.split(' when ', 2);
    const testcdMatch = conditionPart.match(/(\w+)\s*=\s*(.+)/);
    
    if (testcdMatch) {
      const result = {
        variable: varPart.trim(),
        testcd_field: testcdMatch[1].trim(),
        testcd_value: testcdMatch[2].trim()
      };
      console.log(`🔧 [Backend] 解析條件變量: "${variable}" → ${JSON.stringify(result)}`);
      return result;
    }
  }
  
  // 沒有條件的情況
  return { 
    variable: variable.trim(), 
    testcd_field: null, 
    testcd_value: null 
  };
}

/**
 * 构建SUPP_table数据，实现去重合并逻辑
 * @param {Array} tempData - temp数据数组
 * @returns {Array} SUPP_table数据数组
 */
function buildSUPPTable(tempData) {
  console.log('🔄 [Backend] 开始构建SUPP_table...');
  console.log(`📊 [Backend] 输入tempData数量: ${tempData.length}`);
  
  const suppTable = [];
  
  tempData.forEach((tempRow, index) => {
    const suppParsed = parseSUPPMapping(tempRow.Form_Mapping);
    
    if (!suppParsed) {
      // 不是SUPP格式，跳过
      return;
    }
    
    const { qnam, suppDomain, baseDomain } = suppParsed;
    
    // 查找是否已存在相同的Dataset和QNAM组合
    const existingIndex = suppTable.findIndex(row => 
      row.Dataset === suppDomain && row.QNAM === qnam
    );
    
    if (existingIndex === -1) {
      // 不存在，创建新记录
      const newRecord = {
        Dataset: suppDomain,
        QNAM: qnam,
        QLABEL: '', // 空字段
        'Raw Dataset Name or External Source Name': baseDomain,
        'Selection Criteria': '', // 空字段
        IDVAR: `${baseDomain}SEQ`, // 如 AESEQ (存储原始值)
        IDVARVAL: `Value of ${baseDomain}.${baseDomain}SEQ`, // 如 Value of AE.AESEQ (存储原始值)
        QVAL: `Map to RAW.${tempRow.Form_Name}.${qnam}`, // 🔥 构建QVAL字段：Map to RAW.FORM_NAME.QNAM
        QORIG: 'CRF',
        QEVAL: '', // 空字段
        // 🔥 新增追踪信息（內部使用，不顯示在Excel中）
        _source_questions: [{
          form_name: tempRow.Form_Name,
          question_number: tempRow.Question_Number,
          question: tempRow.Question,
          page_number: tempRow.Page_Number
        }]
      };
      
      suppTable.push(newRecord);
      console.log(`  ✅ [Backend] 新建记录: ${suppDomain}.${qnam} from Question "${tempRow.Question_Number}" in "${tempRow.Form_Name}", QVAL: ${newRecord.QVAL}`);
      
    } else {
      // 已存在，合并记录
      const existing = suppTable[existingIndex];
      
      // 🔥 添加源問題追踪
      if (!existing._source_questions) {
        existing._source_questions = [];
      }
      
      // 檢查是否已經有相同的問題記錄
      const isDuplicate = existing._source_questions.some(q => 
        q.form_name === tempRow.Form_Name && 
        q.question_number === tempRow.Question_Number
      );
      
      if (!isDuplicate) {
        existing._source_questions.push({
          form_name: tempRow.Form_Name,
          question_number: tempRow.Question_Number,
          question: tempRow.Question,
          page_number: tempRow.Page_Number
        });
        
        // 🔥 更新 QVAL：追加新的 Form 映射
        const newQvalEntry = `Map to RAW.${tempRow.Form_Name}.${qnam}`;
        
        if (!existing.QVAL.includes(newQvalEntry)) {
          if (existing.QVAL && existing.QVAL.trim() !== '') {
            existing.QVAL += `; ${newQvalEntry}`;
          } else {
            existing.QVAL = newQvalEntry;
          }
          console.log(`  🔄 [Backend] 合并记录: ${suppDomain}.${qnam} + Question "${tempRow.Question_Number}" from "${tempRow.Form_Name}", 更新QVAL: ${existing.QVAL}`);
        } else {
          console.log(`  🔄 [Backend] 合并记录: ${suppDomain}.${qnam} + Question "${tempRow.Question_Number}" from "${tempRow.Form_Name}", QVAL已包含此Form`);
        }
      } else {
        console.log(`  ⏭️ [Backend] 跳过重复记录: ${suppDomain}.${qnam} Question "${tempRow.Question_Number}"`);
      }
      
      // 仅合并Raw Dataset Name字段（如果不同）
      const existingRawDataset = existing['Raw Dataset Name or External Source Name'];
      if (existingRawDataset && !existingRawDataset.includes(baseDomain)) {
        existing['Raw Dataset Name or External Source Name'] += `, ${baseDomain}`;
        
        // 更新IDVARVAL以包含多个base domain
        const existingIdvarval = existing.IDVARVAL;
        if (!existingIdvarval.includes(`${baseDomain}.${baseDomain}SEQ`)) {
          existing.IDVARVAL += `, Value of ${baseDomain}.${baseDomain}SEQ`;
        }
      }
    }
  });
  
  console.log(`✅ [Backend] SUPP_table构建完成，共 ${suppTable.length} 条记录`);
  if (suppTable.length > 0) {
    console.log(`📋 [Backend] 构建结果预览: ${suppTable.slice(0, 2).map(row => `${row.Dataset}.${row.QNAM}`).join(', ')}`);
    console.log(`📋 [Backend] QVAL格式预览: ${suppTable.slice(0, 2).map(row => row.QVAL).join(' || ')}`);
  }
  return suppTable;
}

// ====================== TESTCD_Details 相关函数 ======================

/**
 * 構建TESTCD_table數據，實現去重合併邏輯
 * @param {Array} tempData - temp數據數組
 * @returns {Array} TESTCD_table數據數組
 */
function buildTESTCDTable(tempData) {
  console.log('🔄 [Backend] 开始构建TESTCD_table...');
  console.log(`📊 [Backend] 输入tempData数量: ${tempData.length}`);
  
  const testcdTable = [];
  
  tempData.forEach((tempRow, index) => {
    const { parsed_condition, domain_code, form_name } = tempRow;
    
    if (!parsed_condition || !parsed_condition.testcd_value) {
      console.log(`    [DEBUG] 跳過沒有TESTCD值的記錄: ${tempRow.variable}`);
      return;
    }
    
    // 查找是否已存在相同的Dataset和--TESTCD Value組合
    const existingIndex = testcdTable.findIndex(row => 
      row.Dataset === domain_code && row['--TESTCD Value'] === parsed_condition.testcd_value
    );
    
    if (existingIndex === -1) {
      // 不存在，創建新記錄
      const newRecord = {
        'Dataset': domain_code,
        '--TESTCD Value': parsed_condition.testcd_value,
        '--TEST Value': '',
        'Raw Dataset Name or External Source Name': form_name,
        'Selection Criteria': '',
        '--CAT Value': '',
        '--SCAT Value': '',
        '--STAT Source/Derivation': '',
        '--REASND Source/Derivation': '',
        '--ORRES Source/Derivation': `Map to RAW.${form_name}.${parsed_condition.variable}`,
        '--ORRESU Source/Derivation': '',
        '--STRESC Source/Derivation': '',
        '--STRESN Source/Derivation': '',
        '--STRESU Source/Derivation': '',
        '--DTC Source/Derivation': '',
        '--CLSIG Source/Derivation': '',
        '--POS Source/Derivation': '',
        '--LAT Source/Derivation': '',
        '--LOC Source/Derivation': '',
        '--DIR Source/Derivation': '',
        '--NAM Source/Derivation': '',
        '--SPEC Source/Derivation': '',
        '--OBJ Value': '',
        '--METHOD Source/Derivation': '',
        'FOCID': '',
        'TSTDTL Source/Derivation': '',
        '--EVLINT Source/Derivation': '',
        '--EVINTX Source/Derivation': '',
        '--EVAL Source/Derivation': '',
        '--EVALINT Source/Derivation': '',
        'RAW Variable 1': parsed_condition.variable,
        'RAW Variable 2': '',
        // 🔥 內部追踪信息
        _source_questions: [{
          form_name: form_name,
          question_number: tempRow.question_number,
          question: tempRow.question,
          page_number: tempRow.page_number,
          variable: tempRow.variable
        }]
      };
      
      testcdTable.push(newRecord);
      console.log(`  ✅ [Backend] 新建TESTCD记录: ${domain_code}.${parsed_condition.testcd_value} from Question "${tempRow.question_number}" in "${form_name}"`);
      
    } else {
      // 已存在，合併記錄
      const existing = testcdTable[existingIndex];
      
      // 🔥 添加源問題追踪
      if (!existing._source_questions) {
        existing._source_questions = [];
      }
      
      // 檢查是否已經有相同的問題記錄
      const isDuplicate = existing._source_questions.some(q => 
        q.form_name === form_name && 
        q.question_number === tempRow.question_number && 
        q.variable === tempRow.variable
      );
      
      if (!isDuplicate) {
        existing._source_questions.push({
          form_name: form_name,
          question_number: tempRow.question_number,
          question: tempRow.question,
          page_number: tempRow.page_number,
          variable: tempRow.variable
        });
        
        // 🔥 更新 --ORRES Source/Derivation：追加新的 Form 映射
        const newOrresEntry = `Map to RAW.${form_name}.${parsed_condition.variable}`;
        
        if (!existing['--ORRES Source/Derivation'].includes(newOrresEntry)) {
          if (existing['--ORRES Source/Derivation'] && existing['--ORRES Source/Derivation'].trim() !== '') {
            existing['--ORRES Source/Derivation'] += `; ${newOrresEntry}`;
          } else {
            existing['--ORRES Source/Derivation'] = newOrresEntry;
          }
        }
        
        // 合併 Raw Dataset Name
        const existingRawDataset = existing['Raw Dataset Name or External Source Name'];
        if (existingRawDataset && !existingRawDataset.includes(form_name)) {
          existing['Raw Dataset Name or External Source Name'] += `, ${form_name}`;
        }
        
        console.log(`  🔄 [Backend] 合并TESTCD记录: ${domain_code}.${parsed_condition.testcd_value} + Question "${tempRow.question_number}" from "${form_name}"`);
      } else {
        console.log(`  ⏭️ [Backend] 跳过重复TESTCD记录: ${domain_code}.${parsed_condition.testcd_value} Question "${tempRow.question_number}"`);
      }
    }
  });
  
  console.log(`✅ [Backend] TESTCD_table构建完成，共 ${testcdTable.length} 条记录`);
  if (testcdTable.length > 0) {
    console.log(`📋 [Backend] 构建结果预览: ${testcdTable.slice(0, 2).map(row => `${row.Dataset}.${row['--TESTCD Value']}`).join(', ')}`);
    console.log(`📋 [Backend] --ORRES格式预览: ${testcdTable.slice(0, 2).map(row => row['--ORRES Source/Derivation']).join(' || ')}`);
  }
  return testcdTable;
}

/**
 * 從CRF數據中提取TESTCD相關的變量數據
 * @param {string} studyId - Study ID
 * @returns {Array} temp數據數組 [{form_name, form_mapping, variable, parsed_condition}]
 */
async function extractTESTCDMappingData(studyId) {
  try {
    console.log('🔍 [Backend] 开始从CRF数据中提取TESTCD相关变量...');
    console.log(`📊 [Backend] 目标studyId: ${studyId}`);
    
    const study = await Study.findById(studyId)
      .select('files.crf.crfUploadResult.crfFormList')
      .lean();
    
    if (!study?.files?.crf?.crfUploadResult?.crfFormList) {
      console.error(`❌ [Backend] CRF数据不存在，studyId: ${studyId}`);
      throw new Error('CRF数据不存在');
    }
    console.log(`✅ [Backend] CRF数据结构找到，开始遍历Form...`);
    
    const crfFormList = study.files.crf.crfUploadResult.crfFormList;
    const tempData = [];
    let totalVariableStrings = 0;
    let testcdFilteredCount = 0;
    
    // 遍历所有Form
    for (const formKey in crfFormList) {
      const form = crfFormList[formKey];
      const formTitle = form.title || formKey;
      
      // 從Question級別的修正數據提取
      const mappingChecklist = form?.Mapping_corrected_CRF_Annotation_Checklist;
      
      if (Array.isArray(mappingChecklist)) {
        console.log(`  🔍 [Backend] 检查Form "${formTitle}": ${mappingChecklist.length} 个问题记录`);
        
        // 遍历每个问题的映射记录
        mappingChecklist.forEach(item => {
          if (item && item.Question_Variable && typeof item.Question_Variable === 'string') {
            totalVariableStrings++;
            
            // 🔥 按分號分割處理多變量：e.g. "LBTESTCD; LBORRES when LBTESTCD = ADA"
            const variables = item.Question_Variable.split(';').map(v => v.trim());
            
            console.log(`    [DEBUG] 原始Question_Variable: "${item.Question_Variable}"`);
            console.log(`    [DEBUG] 分割後variables: [${variables.map(v => `"${v}"`).join(', ')}]`);
            
            variables.forEach((variable, varIndex) => {
              // 檢查是否包含 when 條件（TESTCD相關變量的標識）
              if (variable.includes(' when ')) {
                const parsedCondition = parseTESTCDCondition(variable);
                const domainCode = extractDomainCodeFromMapping(item.Form_Mapping || '');
                
                const tempRecord = {
                  form_name: formTitle,
                  form_mapping: item.Form_Mapping || '',
                  domain_code: domainCode,
                  variable: variable,
                  parsed_condition: parsedCondition,
                  question_number: item.Question_Number || '',
                  question: item.Question || '',
                  page_number: item.Page_Number || ''
                };
                
                tempData.push(tempRecord);
                testcdFilteredCount++;
                console.log(`  📋 [Backend] 提取TESTCD记录: "${variable}" from Question "${item.Question_Number}" in Form "${formTitle}"`);
                console.log(`    [DEBUG] 完整tempRecord:`, tempRecord);
              } else {
                console.log(`    [DEBUG] 跳過非TESTCD變量: "${variable}"`);
              }
            });
          }
        });
      } else {
        console.log(`  ⚠️ [Backend] Form "${formTitle}" 没有Mapping_corrected_CRF_Annotation_Checklist数据`);
      }
    }
    
    console.log(`✅ [Backend] TESTCD提取完成，总变量字符串: ${totalVariableStrings} 条，TESTCD筛选后: ${testcdFilteredCount} 条，最终temp数据: ${tempData.length} 条`);
    return tempData;
    
  } catch (error) {
    console.error('❌ [Backend] 提取TESTCD数据失败:', error);
    console.error('📋 [Backend] TESTCD提取错误详情:', {
      studyId,
      message: error.message,
      stack: error.stack?.split('\n').slice(0, 3).join('\n')
    });
    throw error;
  }
}

/**
 * 分批生成SUPP_Details数据
 * @param {Object} req - Express请求对象
 * @param {Object} res - Express响应对象
 */
async function generateSUPPDetailsData(req, res) {
  try {
    const { studyId } = req.params;
    console.log(`🚀 [Backend] 开始生成SUPP_Details数据，studyId: ${studyId}`);
    console.log(`📊 [Backend] API端点调用: POST /api/studies/${studyId}/generate-supp-details`);
    
    // 提取Form_Mapping数据
    console.log(`🔍 [Backend] 开始提取Form_Mapping数据...`);
    const tempData = await extractFormMappingData(studyId);
    console.log(`📊 [Backend] SUPP数据提取统计: 共提取到 ${tempData.length} 条SUPP相关记录`);
    
    if (tempData.length > 0) {
      console.log('📋 [Backend] SUPP记录预览:', tempData.slice(0, 3));
    } else {
      console.log('⚠️ [Backend] 未找到任何SUPP相关记录，将返回空数据');
    }
    
    // 构建SUPP_table
    console.log(`🔧 [Backend] 开始构建SUPP_table...`);
    const suppTableData = buildSUPPTable(tempData);
    console.log(`📊 [Backend] SUPP_table构建统计: 去重合并后共 ${suppTableData.length} 条最终记录`);
    
    if (suppTableData.length > 0) {
      console.log('📋 [Backend] SUPP_table记录预览:', suppTableData.slice(0, 2));
    } else {
      console.log('⚠️ [Backend] SUPP_table构建结果为空，将返回空批次');
    }
    
    // 按批次返回数据（每批最多50条记录）
    const batchSize = 50;
    const batches = [];
    
    for (let i = 0; i < suppTableData.length; i += batchSize) {
      const batch = suppTableData.slice(i, i + batchSize);
      batches.push({
        batchIndex: Math.floor(i / batchSize),
        batchData: batch,
        isLastBatch: i + batchSize >= suppTableData.length
      });
    }
    
    console.log(`✅ [Backend] SUPP数据生成完成，共 ${batches.length} 批，总计 ${suppTableData.length} 条记录`);
    console.log(`📊 [Backend] 批次详情: ${batches.map((b, i) => `批次${i+1}: ${b.batchData.length}条`).join(', ')}`);
    console.log(`🚀 [Backend] 即将返回数据给前端...`);
    
    res.json({
      success: true,
      data: {
        totalRecords: suppTableData.length,
        totalBatches: batches.length,
        batches: batches
      }
    });
    
  } catch (error) {
    console.error('❌ [Backend] 生成SUPP_Details数据失败:', error);
    console.error('📋 [Backend] 错误详情:', {
      message: error.message,
      stack: error.stack?.split('\n').slice(0, 5).join('\n')
    });
    res.status(500).json({
      success: false,
      message: error.message || 'SUPP数据生成失败'
    });
  }
}

/**
 * 分批保存SUPP_Details数据到数据库
 * @param {Object} req - Express请求对象
 * @param {Object} res - Express响应对象
 */
async function saveSpecSUPPDetailsData(req, res) {
  try {
    const { studyId } = req.params;
    const { batchData, isLastBatch = false, replaceAll = false } = req.body;
    
    console.log(`💾 [Backend] 开始保存SUPP_Details数据 (User Confirmed整表覆盖模式)`);
    console.log(`📊 [Backend] 请求参数: studyId=${studyId}, 批次大小=${batchData?.length || 0}, isLastBatch=${isLastBatch}, replaceAll=${replaceAll}`);
    console.log(`📊 [Backend] API端点调用: POST /api/studies/${studyId}/spec-supp-details-data`);
    console.log(`🔄 [Backend] 覆盖模式: ${replaceAll ? '第一批-清空并重建' : '后续批次-追加数据'}`);
    
    if (!Array.isArray(batchData)) {
      return res.status(400).json({
        success: false,
        message: 'batchData必须是数组'
      });
    }
    
    console.log(`🔍 [Backend] 查找Study文档: ${studyId}`);
    const study = await Study.findById(studyId);
    if (!study) {
      console.error(`❌ [Backend] Study不存在: ${studyId}`);
      return res.status(404).json({
        success: false,
        message: 'Study不存在'
      });
    }
    console.log(`✅ [Backend] Study文档找到，开始处理数据结构...`);
    
    // 确保数据结构存在
    console.log(`🔧 [Backend] 检查并初始化SUPP_Details数据结构...`);
    if (!study.Spec) {
      study.Spec = {};
      console.log(`🔄 [Backend] 初始化study.Spec`);
    }
    if (!study.Spec.first_version) {
      study.Spec.first_version = {};
      console.log(`🔄 [Backend] 初始化study.Spec.first_version`);
    }
    
    
    if (!study.Spec.first_version.SUPP_Details) {
      study.Spec.first_version.SUPP_Details = {
        table_title: SUPP_TABLE_HEADERS,
        table_content: [],
        created_at: new Date(),
        updated_at: new Date()
      };
      console.log(`🔄 [Backend] 初始化study.Spec.first_version.SUPP_Details结构`);
    } else {
      // 🔥 每次都确保table_title正确（防止丢失或不一致）
      study.Spec.first_version.SUPP_Details.table_title = SUPP_TABLE_HEADERS;
      console.log(`🔧 [Backend] 确保table_title正确设置`);
    }
    
    // 🔥 验证table_title是否正确设置
    console.log(`📋 [Backend] 当前table_title:`, study.Spec.first_version.SUPP_Details.table_title);
    
    // 如果是第一批或者要求替换全部，清空现有数据
    if (replaceAll || !study.Spec.first_version.SUPP_Details.table_content) {
      const previousCount = study.Spec.first_version.SUPP_Details.table_content?.length || 0;
      study.Spec.first_version.SUPP_Details.table_content = [];
      console.log(`🗑️ [Backend] 清空现有数据 (replaceAll=${replaceAll})，之前有 ${previousCount} 条记录`);
    }
    
    // 🔥 新增：防御性过滤 - 跳过关键列全空的记录
    const SUPP_KEY_COLUMNS = ['Dataset', 'QNAM', 'QVAL', 'Raw Dataset Name or External Source Name', 'IDVAR'];
    const hasValue = (value) => value !== null && value !== undefined && String(value).trim() !== '';
    
    const filteredBatchData = batchData.filter(record => {
      return SUPP_KEY_COLUMNS.some(keyCol => hasValue(record[keyCol]));
    });
    
    console.log(`🔍 [Backend] 后端防御性过滤: ${batchData.length} 条 → ${filteredBatchData.length} 条 (跳过 ${batchData.length - filteredBatchData.length} 个空记录)`);
    
    // 追加新数据 (使用过滤后的数据)
    const beforeCount = study.Spec.first_version.SUPP_Details.table_content.length;
    study.Spec.first_version.SUPP_Details.table_content.push(...filteredBatchData);
    study.Spec.first_version.SUPP_Details.updated_at = new Date();
    const afterCount = study.Spec.first_version.SUPP_Details.table_content.length;
    console.log(`🔄 [Backend] 数据追加完成: ${beforeCount} + ${filteredBatchData.length} = ${afterCount}`);
    
    // 🔥 保存前最终确认table_title
    study.Spec.first_version.SUPP_Details.table_title = SUPP_TABLE_HEADERS;
    console.log(`🔧 [Backend] 保存前最终确认table_title设置`);
    
    // 保存到数据库
    console.log(`💾 [Backend] 开始保存到MongoDB...`);
    await study.save();
    console.log(`✅ [Backend] MongoDB保存成功`);
    
    // 🔥 保存后验证table_title
    const savedStudy = await Study.findById(studyId).select('Spec.first_version.SUPP_Details.table_title').lean();
    const savedTableTitle = savedStudy?.Spec?.first_version?.SUPP_Details?.table_title;
    console.log(`🔍 [Backend] 保存后验证table_title:`, savedTableTitle);
    console.log(`📋 [Backend] table_title长度: ${savedTableTitle?.length || 0}, 期望长度: ${SUPP_TABLE_HEADERS.length}`);
    
    console.log(`✅ [Backend] SUPP_Details数据保存成功`);
    console.log(`📊 [Backend] 保存统计: 当前批次=${batchData.length}条, 数据库总计=${study.Spec.first_version.SUPP_Details.table_content.length}条, 是否最后一批=${isLastBatch}`);
    console.log(`🚀 [Backend] 即将返回成功响应给前端...`);
    
    res.json({
      success: true,
      data: {
        totalCount: study.Spec.first_version.SUPP_Details.table_content.length,
        isLastBatch: isLastBatch,
        // 🔥 返回table_title信息供前端验证
        tableTitle: study.Spec.first_version.SUPP_Details.table_title,
        tableTitleLength: study.Spec.first_version.SUPP_Details.table_title?.length || 0
      }
    });
    
  } catch (error) {
    console.error('❌ [Backend] 保存SUPP_Details数据失败:', error);
    console.error('📋 [Backend] 错误详情:', {
      message: error.message,
      stack: error.stack?.split('\n').slice(0, 5).join('\n'),
      studyId: req.params.studyId,
      batchSize: req.body.batchData?.length
    });
    res.status(500).json({
      success: false,
      message: error.message || 'SUPP数据保存失败'
    });
  }
}

/**
 * 分批生成TESTCD_Details數據
 * @param {Object} req - Express請求對象
 * @param {Object} res - Express響應對象
 */
async function generateTESTCDDetailsData(req, res) {
  try {
    const { studyId } = req.params;
    console.log(`🚀 [Backend] 开始生成TESTCD_Details数据，studyId: ${studyId}`);
    console.log(`📊 [Backend] API端点调用: POST /api/studies/${studyId}/generate-testcd-details`);
    
    // 提取TESTCD數據
    console.log(`🔍 [Backend] 开始提取TESTCD变量数据...`);
    const tempData = await extractTESTCDMappingData(studyId);
    console.log(`📊 [Backend] TESTCD数据提取统计: 共提取到 ${tempData.length} 条TESTCD相关记录`);
    
    if (tempData.length > 0) {
      console.log('📋 [Backend] TESTCD记录预览:', tempData.slice(0, 3));
    } else {
      console.log('⚠️ [Backend] 未找到任何TESTCD相关记录，将返回空数据');
    }
    
    // 構建TESTCD_table
    console.log(`🔧 [Backend] 开始构建TESTCD_table...`);
    const testcdTableData = buildTESTCDTable(tempData);
    console.log(`📊 [Backend] TESTCD_table构建统计: 去重合并后共 ${testcdTableData.length} 条最终记录`);
    
    if (testcdTableData.length > 0) {
      console.log('📋 [Backend] TESTCD_table记录预览:', testcdTableData.slice(0, 2));
    } else {
      console.log('⚠️ [Backend] TESTCD_table构建结果为空，将返回空批次');
    }
    
    // 按批次返回數據（每批最多50條記錄）
    const batchSize = 50;
    const batches = [];
    
    for (let i = 0; i < testcdTableData.length; i += batchSize) {
      const batch = testcdTableData.slice(i, i + batchSize);
      batches.push({
        batchIndex: Math.floor(i / batchSize),
        batchData: batch,
        isLastBatch: i + batchSize >= testcdTableData.length
      });
    }
    
    console.log(`✅ [Backend] TESTCD数据生成完成，共 ${batches.length} 批，总计 ${testcdTableData.length} 条记录`);
    console.log(`📊 [Backend] 批次详情: ${batches.map((b, i) => `批次${i+1}: ${b.batchData.length}条`).join(', ')}`);
    console.log(`🚀 [Backend] 即将返回数据给前端...`);
    
    res.json({
      success: true,
      data: {
        totalRecords: testcdTableData.length,
        totalBatches: batches.length,
        batches: batches
      }
    });
    
  } catch (error) {
    console.error('❌ [Backend] 生成TESTCD_Details数据失败:', error);
    console.error('📋 [Backend] 错误详情:', {
      message: error.message,
      stack: error.stack?.split('\n').slice(0, 5).join('\n')
    });
    res.status(500).json({
      success: false,
      message: error.message || 'TESTCD数据生成失败'
    });
  }
}

/**
 * 分批保存TESTCD_Details數據到數據庫
 * @param {Object} req - Express請求對象
 * @param {Object} res - Express響應對象
 */
async function saveSpecTESTCDDetailsData(req, res) {
  try {
    const { studyId } = req.params;
    const { batchData, isLastBatch = false, replaceAll = false } = req.body;
    
    console.log(`💾 [Backend] 开始保存TESTCD_Details数据 (User Confirmed整表覆盖模式)`);
    console.log(`📊 [Backend] 请求参数: studyId=${studyId}, 批次大小=${batchData?.length || 0}, isLastBatch=${isLastBatch}, replaceAll=${replaceAll}`);
    console.log(`📊 [Backend] API端点调用: POST /api/studies/${studyId}/spec-testcd-details-data`);
    console.log(`🔄 [Backend] 覆盖模式: ${replaceAll ? '第一批-清空并重建' : '后续批次-追加数据'}`);
    
    if (!Array.isArray(batchData)) {
      return res.status(400).json({
        success: false,
        message: 'batchData必须是数组'
      });
    }
    
    console.log(`🔍 [Backend] 查找Study文档: ${studyId}`);
    const study = await Study.findById(studyId);
    if (!study) {
      console.error(`❌ [Backend] Study不存在: ${studyId}`);
      return res.status(404).json({
        success: false,
        message: 'Study不存在'
      });
    }
    console.log(`✅ [Backend] Study文档找到，开始处理数据结构...`);
    
    // 確保數據結構存在
    console.log(`🔧 [Backend] 检查并初始化TESTCD_Details数据结构...`);
    if (!study.Spec) {
      study.Spec = {};
      console.log(`🔄 [Backend] 初始化study.Spec`);
    }
    if (!study.Spec.first_version) {
      study.Spec.first_version = {};
      console.log(`🔄 [Backend] 初始化study.Spec.first_version`);
    }
    
    if (!study.Spec.first_version.TESTCD_Details) {
      study.Spec.first_version.TESTCD_Details = {
        table_title: TESTCD_TABLE_HEADERS,
        table_content: [],
        created_at: new Date(),
        updated_at: new Date()
      };
      console.log(`🔄 [Backend] 初始化study.Spec.first_version.TESTCD_Details结构`);
    } else {
      // 🔥 每次都確保table_title正確（防止丟失或不一致）
      study.Spec.first_version.TESTCD_Details.table_title = TESTCD_TABLE_HEADERS;
      console.log(`🔧 [Backend] 确保TESTCD table_title正确设置`);
    }
    
    // 🔥 驗證table_title是否正確設置
    console.log(`📋 [Backend] 当前TESTCD table_title长度: ${study.Spec.first_version.TESTCD_Details.table_title?.length}, 期望: ${TESTCD_TABLE_HEADERS.length}`);
    
    // 如果是第一批或者要求替換全部，清空現有數據
    if (replaceAll || !study.Spec.first_version.TESTCD_Details.table_content) {
      const previousCount = study.Spec.first_version.TESTCD_Details.table_content?.length || 0;
      study.Spec.first_version.TESTCD_Details.table_content = [];
      console.log(`🗑️ [Backend] 清空TESTCD现有数据 (replaceAll=${replaceAll})，之前有 ${previousCount} 条记录`);
    }
    
    // 🔥 新增：防御性过滤 - 跳过关键列全空的记录
    const TESTCD_KEY_COLUMNS = ['Dataset', '--TESTCD Value', '--ORRES Source/Derivation', 'Raw Dataset Name or External Source Name', 'Selection Criteria'];
    const hasValue = (value) => value !== null && value !== undefined && String(value).trim() !== '';
    
    const filteredBatchData = batchData.filter(record => {
      return TESTCD_KEY_COLUMNS.some(keyCol => hasValue(record[keyCol]));
    });
    
    console.log(`🔍 [Backend] TESTCD后端防御性过滤: ${batchData.length} 条 → ${filteredBatchData.length} 条 (跳过 ${batchData.length - filteredBatchData.length} 个空记录)`);
    
    // 追加新數據 (使用过滤后的数据)
    const beforeCount = study.Spec.first_version.TESTCD_Details.table_content.length;
    study.Spec.first_version.TESTCD_Details.table_content.push(...filteredBatchData);
    study.Spec.first_version.TESTCD_Details.updated_at = new Date();
    const afterCount = study.Spec.first_version.TESTCD_Details.table_content.length;
    console.log(`🔄 [Backend] TESTCD数据追加完成: ${beforeCount} + ${filteredBatchData.length} = ${afterCount}`);
    
    // 🔥 保存前最終確認table_title
    study.Spec.first_version.TESTCD_Details.table_title = TESTCD_TABLE_HEADERS;
    console.log(`🔧 [Backend] 保存前最终确认TESTCD table_title设置`);
    
    // 保存到數據庫
    console.log(`💾 [Backend] 开始保存TESTCD到MongoDB...`);
    await study.save();
    console.log(`✅ [Backend] TESTCD MongoDB保存成功`);
    
    // 🔥 保存後驗證table_title
    const savedStudy = await Study.findById(studyId).select('Spec.first_version.TESTCD_Details.table_title').lean();
    const savedTableTitle = savedStudy?.Spec?.first_version?.TESTCD_Details?.table_title;
    console.log(`🔍 [Backend] 保存后验证TESTCD table_title长度: ${savedTableTitle?.length || 0}, 期望长度: ${TESTCD_TABLE_HEADERS.length}`);
    
    console.log(`✅ [Backend] TESTCD_Details数据保存成功`);
    console.log(`📊 [Backend] 保存统计: 当前批次=${batchData.length}条, 数据库总计=${study.Spec.first_version.TESTCD_Details.table_content.length}条, 是否最后一批=${isLastBatch}`);
    console.log(`🚀 [Backend] 即将返回TESTCD成功响应给前端...`);
    
    res.json({
      success: true,
      data: {
        totalCount: study.Spec.first_version.TESTCD_Details.table_content.length,
        isLastBatch: isLastBatch,
        // 🔥 返回table_title信息供前端驗證
        tableTitle: study.Spec.first_version.TESTCD_Details.table_title,
        tableTitleLength: study.Spec.first_version.TESTCD_Details.table_title?.length || 0
      }
    });
    
  } catch (error) {
    console.error('❌ [Backend] 保存TESTCD_Details数据失败:', error);
    console.error('📋 [Backend] 错误详情:', {
      message: error.message,
      stack: error.stack?.split('\n').slice(0, 5).join('\n'),
      studyId: req.params.studyId,
      batchSize: req.body.batchData?.length
    });
    res.status(500).json({
      success: false,
      message: error.message || 'TESTCD数据保存失败'
    });
  }
}

/**
 * 生成TA_Details数据（使用OpenAI基于Study Design生成）
 * @param {Object} req - Express请求对象
 * @param {Object} res - Express响应对象
 */
async function generateTADetailsData(req, res) {
  try {
    const { studyId } = req.params;
    console.log(`🚀 [Backend] 开始生成TA_Details数据，studyId: ${studyId}`);
    console.log(`📊 [Backend] API端点调用: POST /api/studies/${studyId}/generate-ta-details`);
    
    // 1. 获取Study Design数据
    console.log(`🔍 [Backend] 开始提取Study Design数据...`);
    const study = await Study.findById(studyId)
      .select('studyNumber files.protocol.uploadExtraction.studyDesign')
      .lean();
    
    if (!study) {
      console.error(`❌ [Backend] Study不存在，studyId: ${studyId}`);
      return res.status(404).json({
        success: false,
        message: 'Study不存在'
      });
    }
    
    const studyDesign = study.files?.protocol?.uploadExtraction?.studyDesign;
    
    if (!studyDesign) {
      console.error(`❌ [Backend] Study Design数据不存在，studyId: ${studyId}`);
      return res.status(404).json({
        success: false,
        message: 'Study Design数据不存在，请先上传Protocol并完成解析'
      });
    }
    
    console.log(`✅ [Backend] Study Design数据找到`);
    console.log(`📋 [Backend] Study Design主标题: ${studyDesign.title}, 子章节数量: ${studyDesign.children?.length || 0}`);
    
    // 2. 聚合Study Design全文
    let fullText = `${studyDesign.title || ''}\n${studyDesign.content || ''}`;
    
    if (Array.isArray(studyDesign.children) && studyDesign.children.length > 0) {
      studyDesign.children.forEach(child => {
        fullText += `\n\n${child.title || ''}\n${child.content || ''}`;
      });
    }
    
    console.log(`📄 [Backend] Study Design文本聚合完成，总长度: ${fullText.length} 字符`);
    
    if (fullText.trim().length === 0) {
      console.error(`❌ [Backend] Study Design内容为空`);
      return res.status(400).json({
        success: false,
        message: 'Study Design内容为空'
      });
    }
    
    // 3. 构造OpenAI Prompt（严格按照用户提供的格式）
    const prompt = `TA_DATA Prompt:
<identity>
You are an experienced statistical programmer who is expertized in CDISC rules, please generate the SDTM.TA domain based on the input from protocol of the study design and MUST meet all the requirements.
</identity>
<input>
Study Number: ${study.studyNumber || 'UNKNOWN'}

The study design section from protocol:

${fullText}
</input>
<requirement>
1.	Build it based on SDTMIG v3.4.
2.	Only includes the variables STUDYID, DOMAIN, ARMCD, ARM, TAETORD, ETCD, ELEMENT, TABRANCH, TATRANS, EPOCH.
3.	STUDYID must be "${study.studyNumber || 'UNKNOWN'}" for ALL records.
4.	DOMAIN must be "TA" for ALL records.
5.	EPOCH should follow controlled terminology.
6.	ARMCD is limited to 20 characters, ETCD is limited to 8 characters. All capitalized, CANNOT contain characters OTHER THAN letters, numbers, or underscores.
7.	Do not put too complex langrage algorithm, special symbol and punctuation in the ARM, ELEMENT, make it as a single refine and meaningful phrase.
8.	Do not put any special symbols in the TATRANS, like arrow, hyphen, etc, make it as a readable, clear text.
9.	For each arm of the trial, the TA dataset contains 1 record for each occurrence of an element in the path of the arm.
10.	An arm is a planned path through the trial. This path covers the entire time of the trial.
11.	TABRANCH and TATRANS both contain rules, but the 2 columns represent 2 different types of rules. TABRANCH rules represent forks in the trial flowchart, giving rise to separate arms. The rule underlying a branch in the trial design appears in multiple records, once for each "fork" of the branch. Within any one record, there is no choice (no "if" clause) in the value of the branch condition. For example, the value of TABRANCH for a record in arm A is "Randomized to Arm A" because a subject in arm A must have been randomized to arm A. TATRANS rules are used for choices within an arm. The value for TATRANS does contain a choice (an "if" clause). For example, subjects who receive 1, 2, 3, or 4 cycles of treatment A are all considered to belong to arm A.
12.	Only populate the TABRANCH and TATRANS in the necessary, corresponding ELEMENT, do not repeat if across all records.
</requirement>
<format>
1. Output JSON ONLY, no code fences, no commentary.
2. JSON format must be a list of records. Each record must contain EXACTLY these 10 variables: STUDYID, DOMAIN, ARMCD, ARM, TAETORD, ETCD, ELEMENT, TABRANCH, TATRANS, EPOCH
3. Remember: STUDYID="${study.studyNumber || 'UNKNOWN'}" and DOMAIN="TA" for every single record.
</format>`;
    
    console.log(`🤖 [Backend] 开始调用OpenAI API生成TA数据...`);
    console.log(`📝 [Backend] Prompt长度: ${prompt.length} 字符`);
    console.log(`🔑 [Backend] 使用的STUDYID: ${study.studyNumber || 'UNKNOWN'}`);
    
    // 4. 调用OpenAI API
    let taDataArray = [];
    try {
      const completion = await openai.chat.completions.create({
        model: 'gpt-4o',
        messages: [
          {
            role: 'system',
            content: 'You are an expert statistical programmer specialized in CDISC SDTM standards. You always output valid JSON without code fences or commentary.'
          },
          {
            role: 'user',
            content: prompt
          }
        ],
        temperature: 0.3,
        max_tokens: 4000
      });
      
      const aiResponse = completion.choices[0]?.message?.content?.trim() || '';
      console.log(`✅ [Backend] OpenAI响应接收成功，长度: ${aiResponse.length} 字符`);
      console.log(`📋 [Backend] AI响应预览（前500字符）: ${aiResponse.substring(0, 500)}`);
      
      // 5. 解析JSON响应
      try {
        // 清理可能的代码块标记
        let cleanedResponse = aiResponse.replace(/```json\s*/g, '').replace(/```\s*/g, '').trim();
        taDataArray = JSON.parse(cleanedResponse);
        
        console.log(`✅ [Backend] JSON解析成功，记录数: ${taDataArray.length}`);
        
        // 6. 验证数据结构
        const requiredFields = ['STUDYID', 'DOMAIN', 'ARMCD', 'ARM', 'TAETORD', 'ETCD', 'ELEMENT', 'TABRANCH', 'TATRANS', 'EPOCH'];
        
        if (!Array.isArray(taDataArray)) {
          throw new Error('AI返回的数据不是数组格式');
        }
        
        // 验证每条记录
        taDataArray = taDataArray.map((record, index) => {
          const validatedRecord = {};
          
          requiredFields.forEach(field => {
            // 确保所有必需字段都存在（即使为空字符串）
            validatedRecord[field] = record[field] !== undefined && record[field] !== null 
              ? String(record[field]).trim() 
              : '';
          });
          
          return validatedRecord;
        });
        
        console.log(`✅ [Backend] 数据验证完成，有效记录数: ${taDataArray.length}`);
        
        // 🔥 验证STUDYID和DOMAIN是否正确
        const expectedStudyId = study.studyNumber || 'UNKNOWN';
        const incorrectStudyIds = taDataArray.filter(r => r.STUDYID !== expectedStudyId);
        const incorrectDomains = taDataArray.filter(r => r.DOMAIN !== 'TA');
        
        if (incorrectStudyIds.length > 0) {
          console.warn(`⚠️ [Backend] 发现 ${incorrectStudyIds.length} 条记录的STUDYID不正确，将自动修正`);
          taDataArray.forEach(record => {
            record.STUDYID = expectedStudyId;
          });
        }
        
        if (incorrectDomains.length > 0) {
          console.warn(`⚠️ [Backend] 发现 ${incorrectDomains.length} 条记录的DOMAIN不正确，将自动修正为TA`);
          taDataArray.forEach(record => {
            record.DOMAIN = 'TA';
          });
        }
        
        if (taDataArray.length > 0) {
          console.log(`📋 [Backend] TA数据预览（前2条）:`, taDataArray.slice(0, 2));
        }
        
      } catch (parseError) {
        console.error(`❌ [Backend] JSON解析失败:`, parseError.message);
        console.error(`📋 [Backend] AI原始响应:`, aiResponse.substring(0, 1000));
        throw new Error(`AI响应JSON解析失败: ${parseError.message}`);
      }
      
    } catch (openaiError) {
      console.error(`❌ [Backend] OpenAI API调用失败:`, openaiError.message);
      throw new Error(`OpenAI API调用失败: ${openaiError.message}`);
    }
    
    // 7. 返回生成的数据（一次性返回所有数据，无需分批）
    console.log(`✅ [Backend] TA_Details数据生成完成，总计 ${taDataArray.length} 条记录`);
    
    res.json({
      success: true,
      data: {
        taData: taDataArray,
        totalRecords: taDataArray.length,
        studyNumber: study.studyNumber
      }
    });
    
  } catch (error) {
    console.error('❌ [Backend] 生成TA_Details数据失败:', error);
    console.error('📋 [Backend] 错误详情:', {
      message: error.message,
      stack: error.stack?.split('\n').slice(0, 5).join('\n'),
      studyId: req.params.studyId
    });
    res.status(500).json({
      success: false,
      message: error.message || 'TA数据生成失败'
    });
  }
}

/**
 * 保存TA_Details数据到数据库
 * @param {Object} req - Express请求对象
 * @param {Object} res - Express响应对象
 */
async function saveSpecTADetailsData(req, res) {
  try {
    const { studyId } = req.params;
    const { taData } = req.body;
    
    console.log(`💾 [Backend] 开始保存TA_Details数据`);
    console.log(`📊 [Backend] studyId: ${studyId}, 记录数: ${taData?.length || 0}`);
    
    if (!Array.isArray(taData)) {
      return res.status(400).json({
        success: false,
        message: 'taData必须是数组格式'
      });
    }
    
    // 查找Study
    const study = await Study.findById(studyId);
    
    if (!study) {
      return res.status(404).json({
        success: false,
        message: 'Study不存在'
      });
    }
    
    // 初始化Spec结构（如果不存在）
    if (!study.Spec) {
      study.Spec = { first_version: {} };
    }
    if (!study.Spec.first_version) {
      study.Spec.first_version = {};
    }
    if (!study.Spec.first_version.TA_Data) {
      study.Spec.first_version.TA_Data = {
        table_title: [],
        table_content: [],
        status: 'false'
      };
    }
    
    console.log(`🔧 [Backend] 初始化TA_Data结构`);
    
    // 设置table_title
    study.Spec.first_version.TA_Data.table_title = TA_TABLE_HEADERS;
    console.log(`📋 [Backend] table_title设置: ${TA_TABLE_HEADERS.join(', ')}`);
    
    // 🔥 防御性过滤 - 至少要有ARM或ELEMENT有值
    const hasValue = (value) => value !== null && value !== undefined && String(value).trim() !== '';
    
    const filteredTaData = taData.filter(record => {
      return hasValue(record.ARM) || hasValue(record.ELEMENT) || hasValue(record.ARMCD);
    });
    
    console.log(`🔍 [Backend] 数据过滤: ${taData.length} 条 → ${filteredTaData.length} 条 (跳过 ${taData.length - filteredTaData.length} 个无效记录)`);
    
    // 替换全部数据
    study.Spec.first_version.TA_Data.table_content = filteredTaData;
    study.Spec.first_version.TA_Data.updated_at = new Date();
    study.Spec.first_version.TA_Data.status = 'created';
    
    console.log(`✅ [Backend] TA_Data数据已设置，总计 ${filteredTaData.length} 条记录`);
    
    // 保存到数据库
    console.log(`💾 [Backend] 开始保存到MongoDB...`);
    await study.save();
    console.log(`✅ [Backend] MongoDB保存成功`);
    
    // 保存后验证
    const savedStudy = await Study.findById(studyId).select('Spec.first_version.TA_Data.table_title Spec.first_version.TA_Data.table_content').lean();
    const savedTableTitle = savedStudy?.Spec?.first_version?.TA_Data?.table_title;
    const savedContentCount = savedStudy?.Spec?.first_version?.TA_Data?.table_content?.length || 0;
    
    console.log(`🔍 [Backend] 保存后验证: table_title长度=${savedTableTitle?.length || 0}, content条数=${savedContentCount}`);
    
    res.json({
      success: true,
      data: {
        totalCount: savedContentCount,
        tableTitle: savedTableTitle,
        tableTitleLength: savedTableTitle?.length || 0
      }
    });
    
  } catch (error) {
    console.error('❌ [Backend] 保存TA_Details数据失败:', error);
    console.error('📋 [Backend] 错误详情:', {
      message: error.message,
      stack: error.stack?.split('\n').slice(0, 5).join('\n'),
      studyId: req.params.studyId,
      dataSize: req.body.taData?.length
    });
    res.status(500).json({
      success: false,
      message: error.message || 'TA数据保存失败'
    });
  }
}

/**
 * 生成TE_Details数据（使用OpenAI基于Study Design和TA_Data生成）
 * @param {Object} req - Express请求对象
 * @param {Object} res - Express响应对象
 */
async function generateTEDetailsData(req, res) {
  try {
    const { studyId } = req.params;
    console.log(`🚀 [Backend] 开始生成TE_Details数据，studyId: ${studyId}`);
    console.log(`📊 [Backend] API端点调用: POST /api/studies/${studyId}/generate-te-details`);
    
    // 1. 获取Study Design和TA_Data
    console.log(`🔍 [Backend] 开始提取Study Design和TA_Data...`);
    const study = await Study.findById(studyId)
      .select('studyNumber files.protocol.uploadExtraction.studyDesign Spec.first_version.TA_Data.table_content')
      .lean();
    
    if (!study) {
      console.error(`❌ [Backend] Study不存在，studyId: ${studyId}`);
      return res.status(404).json({
        success: false,
        message: 'Study不存在'
      });
    }
    
    const studyDesign = study.files?.protocol?.uploadExtraction?.studyDesign;
    const taData = study.Spec?.first_version?.TA_Data?.table_content;
    
    if (!studyDesign) {
      console.error(`❌ [Backend] Study Design数据不存在，studyId: ${studyId}`);
      return res.status(404).json({
        success: false,
        message: 'Study Design数据不存在，请先上传Protocol并完成解析'
      });
    }
    
    if (!taData || taData.length === 0) {
      console.error(`❌ [Backend] TA_Data不存在或为空，studyId: ${studyId}`);
      return res.status(404).json({
        success: false,
        message: 'TA_Data不存在或为空，请先生成TA_Data'
      });
    }
    
    console.log(`✅ [Backend] Study Design和TA_Data找到`);
    console.log(`📋 [Backend] Study Design主标题: ${studyDesign.title}, 子章节数量: ${studyDesign.children?.length || 0}`);
    console.log(`📋 [Backend] TA_Data记录数: ${taData.length}`);
    
    // 2. 聚合Study Design全文
    let fullText = `${studyDesign.title || ''}\n${studyDesign.content || ''}`;
    
    if (Array.isArray(studyDesign.children) && studyDesign.children.length > 0) {
      studyDesign.children.forEach(child => {
        fullText += `\n\n${child.title || ''}\n${child.content || ''}`;
      });
    }
    
    console.log(`📄 [Backend] Study Design文本聚合完成，总长度: ${fullText.length} 字符`);
    
    if (fullText.trim().length === 0) {
      console.error(`❌ [Backend] Study Design内容为空`);
      return res.status(400).json({
        success: false,
        message: 'Study Design内容为空'
      });
    }
    
    // 3. 构造OpenAI Prompt
    const prompt = `TE_DATA Prompt:
<identity>
You are an experienced statistical programmer who is expertized in CDISC rules, please generate the SDTM.TE domain based on the TA domain; input from protocol of the study design and MUST meet all the requirements.
</identity>
<tadomain>
${JSON.stringify(taData, null, 2)}
</tadomain>
<input>
Study Number: ${study.studyNumber || 'UNKNOWN'}

The study design section from protocol:

${fullText}
</input>
<requirement>
1. Build it based on SDTMIG v3.4.
2. Only includes the variables STUDYID, DOMAIN, ETCD, ELEMENT, TESTRL, TEENRL, TEDUR.
3. STUDYID must be "${study.studyNumber || 'UNKNOWN'}" for ALL records.
4. DOMAIN must be "TE" for ALL records.
5. ETCD, ELEMENT must be exact the same as which in the TA domain.
6. An element may appear multiple times in the TA domain but must appear only once in the TE domain.
7. TEDUR must in Planned duration of element in ISO 8601 format. Used when the rule for ending the element is applied after a fixed duration.
8. TESTRL should be expressed without referring to arm. If the element appears in more than 1 arm in the TA domain, then the element description (ELEMENT) must not refer to any arms.
9. TESTRL should be expressed without referring to epoch. If the element appears in more than 1 epoch in the TA domain, then the Element description (ELEMENT) must not refer to any EPOCHs.
10. At least 1 of TEENRL and TEDUR must be populated. Both may be populated.
</requirement>
<format>
1. Output JSON ONLY, no code fences, no commentary.
2. JSON format must be a list of records. Each record must contain EXACTLY these 7 variables: STUDYID, DOMAIN, ETCD, ELEMENT, TESTRL, TEENRL, TEDUR
3. Remember: STUDYID="${study.studyNumber || 'UNKNOWN'}" and DOMAIN="TE" for every single record.
</format>`;
    
    console.log(`🤖 [Backend] 开始调用OpenAI API生成TE数据...`);
    console.log(`📝 [Backend] Prompt长度: ${prompt.length} 字符`);
    console.log(`🔑 [Backend] 使用的STUDYID: ${study.studyNumber || 'UNKNOWN'}`);
    console.log(`📊 [Backend] TA_Data记录数: ${taData.length}`);
    
    // 4. 调用OpenAI API
    let teDataArray = [];
    try {
      const completion = await openai.chat.completions.create({
        model: 'gpt-4o',
        messages: [
          {
            role: 'system',
            content: 'You are an expert statistical programmer specialized in CDISC SDTM standards. You always output valid JSON without code fences or commentary.'
          },
          {
            role: 'user',
            content: prompt
          }
        ],
        temperature: 0.3,
        max_tokens: 4000
      });
      
      const aiResponse = completion.choices[0]?.message?.content?.trim() || '';
      console.log(`✅ [Backend] OpenAI响应接收成功，长度: ${aiResponse.length} 字符`);
      console.log(`📋 [Backend] AI响应预览（前500字符）: ${aiResponse.substring(0, 500)}`);
      
      // 5. 解析JSON响应
      try {
        let cleanedResponse = aiResponse.replace(/```json\s*/g, '').replace(/```\s*/g, '').trim();
        teDataArray = JSON.parse(cleanedResponse);
        
        console.log(`✅ [Backend] JSON解析成功，记录数: ${teDataArray.length}`);
        
        // 6. 验证数据结构
        const requiredFields = ['STUDYID', 'DOMAIN', 'ETCD', 'ELEMENT', 'TESTRL', 'TEENRL', 'TEDUR'];
        
        if (!Array.isArray(teDataArray)) {
          throw new Error('AI返回的数据不是数组格式');
        }
        
        // 构建TA的(ETCD,ELEMENT)集合
        const taElementsSet = new Set();
        taData.forEach(ta => {
          const key = `${ta.ETCD}|${ta.ELEMENT}`;
          taElementsSet.add(key);
        });
        console.log(`📊 [Backend] TA中唯一(ETCD,ELEMENT)组合数: ${taElementsSet.size}`);
        
        // 验证每条记录并强制修正
        teDataArray = teDataArray.map((record, index) => {
          const validatedRecord = {};
          
          requiredFields.forEach(field => {
            validatedRecord[field] = record[field] !== undefined && record[field] !== null 
              ? String(record[field]).trim() 
              : '';
          });
          
          return validatedRecord;
        });
        
        console.log(`✅ [Backend] 数据基础验证完成，记录数: ${teDataArray.length}`);
        
        // 🔥 强制修正STUDYID和DOMAIN
        const expectedStudyId = study.studyNumber || 'UNKNOWN';
        teDataArray.forEach(record => {
          record.STUDYID = expectedStudyId;
          record.DOMAIN = 'TE';
          // ETCD规范化：大写、限制8字符
          record.ETCD = (record.ETCD || '').toUpperCase().replace(/[^A-Z0-9_]/g, '').substring(0, 8);
        });
        
        console.log(`✅ [Backend] STUDYID和DOMAIN强制修正完成`);
        
        // 🔥 过滤：只保留在TA中存在的(ETCD,ELEMENT)
        const beforeFilter = teDataArray.length;
        teDataArray = teDataArray.filter(record => {
          const key = `${record.ETCD}|${record.ELEMENT}`;
          return taElementsSet.has(key);
        });
        console.log(`🔍 [Backend] TA对齐过滤: ${beforeFilter} → ${teDataArray.length} (移除 ${beforeFilter - teDataArray.length} 个不在TA中的元素)`);
        
        // 🔥 去重：按(ETCD,ELEMENT)去重
        const teMap = new Map();
        teDataArray.forEach(record => {
          const key = `${record.ETCD}|${record.ELEMENT}`;
          if (!teMap.has(key)) {
            teMap.set(key, record);
          } else {
            // 如果已存在，优先保留有TEENRL或TEDUR的记录
            const existing = teMap.get(key);
            const hasValue = (v) => v && String(v).trim() !== '';
            const existingHasDuration = hasValue(existing.TEENRL) || hasValue(existing.TEDUR);
            const currentHasDuration = hasValue(record.TEENRL) || hasValue(record.TEDUR);
            
            if (!existingHasDuration && currentHasDuration) {
              teMap.set(key, record);
            }
          }
        });
        
        const beforeDedup = teDataArray.length;
        teDataArray = Array.from(teMap.values());
        console.log(`🔍 [Backend] (ETCD,ELEMENT)去重: ${beforeDedup} → ${teDataArray.length} (移除 ${beforeDedup - teDataArray.length} 个重复元素)`);
        
        // 🔥 过滤：TEENRL和TEDUR至少一个非空
        const hasValue = (v) => v && String(v).trim() !== '';
        const beforeDurationFilter = teDataArray.length;
        teDataArray = teDataArray.filter(record => {
          return hasValue(record.TEENRL) || hasValue(record.TEDUR);
        });
        console.log(`🔍 [Backend] 持续时间字段过滤: ${beforeDurationFilter} → ${teDataArray.length} (移除 ${beforeDurationFilter - teDataArray.length} 个TEENRL和TEDUR都为空的记录)`);
        
        if (teDataArray.length > 0) {
          console.log(`📋 [Backend] TE数据预览（前2条）:`, teDataArray.slice(0, 2));
        }
        
      } catch (parseError) {
        console.error(`❌ [Backend] JSON解析失败:`, parseError.message);
        console.error(`📋 [Backend] AI原始响应:`, aiResponse.substring(0, 1000));
        throw new Error(`AI响应JSON解析失败: ${parseError.message}`);
      }
      
    } catch (openaiError) {
      console.error(`❌ [Backend] OpenAI API调用失败:`, openaiError.message);
      throw new Error(`OpenAI API调用失败: ${openaiError.message}`);
    }
    
    // 7. 返回生成的数据
    console.log(`✅ [Backend] TE_Details数据生成完成，总计 ${teDataArray.length} 条记录`);
    
    res.json({
      success: true,
      data: {
        teData: teDataArray,
        totalRecords: teDataArray.length,
        studyNumber: study.studyNumber
      }
    });
    
  } catch (error) {
    console.error('❌ [Backend] 生成TE_Details数据失败:', error);
    console.error('📋 [Backend] 错误详情:', {
      message: error.message,
      stack: error.stack?.split('\n').slice(0, 5).join('\n'),
      studyId: req.params.studyId
    });
    res.status(500).json({
      success: false,
      message: error.message || 'TE数据生成失败'
    });
  }
}

/**
 * 保存TE_Details数据到数据库
 * @param {Object} req - Express请求对象
 * @param {Object} res - Express响应对象
 */
async function saveSpecTEDetailsData(req, res) {
  try {
    const { studyId } = req.params;
    const { teData } = req.body;
    
    console.log(`💾 [Backend] 开始保存TE_Details数据`);
    console.log(`📊 [Backend] studyId: ${studyId}, 记录数: ${teData?.length || 0}`);
    
    if (!Array.isArray(teData)) {
      return res.status(400).json({
        success: false,
        message: 'teData必须是数组格式'
      });
    }
    
    // 查找Study
    const study = await Study.findById(studyId);
    
    if (!study) {
      return res.status(404).json({
        success: false,
        message: 'Study不存在'
      });
    }
    
    // 初始化Spec结构（如果不存在）
    if (!study.Spec) {
      study.Spec = { first_version: {} };
    }
    if (!study.Spec.first_version) {
      study.Spec.first_version = {};
    }
    if (!study.Spec.first_version.TE_Data) {
      study.Spec.first_version.TE_Data = {
        table_title: [],
        table_content: [],
        status: 'false'
      };
    }
    
    console.log(`🔧 [Backend] 初始化TE_Data结构`);
    
    // 设置table_title
    study.Spec.first_version.TE_Data.table_title = TE_TABLE_HEADERS;
    console.log(`📋 [Backend] table_title设置: ${TE_TABLE_HEADERS.join(', ')}`);
    
    // 🔥 防御性过滤 - 至少要有ETCD或ELEMENT有值
    const hasValue = (value) => value !== null && value !== undefined && String(value).trim() !== '';
    
    const filteredTeData = teData.filter(record => {
      return hasValue(record.ETCD) || hasValue(record.ELEMENT);
    });
    
    console.log(`🔍 [Backend] 数据过滤: ${teData.length} 条 → ${filteredTeData.length} 条 (跳过 ${teData.length - filteredTeData.length} 个无效记录)`);
    
    // 替换全部数据
    study.Spec.first_version.TE_Data.table_content = filteredTeData;
    study.Spec.first_version.TE_Data.updated_at = new Date();
    study.Spec.first_version.TE_Data.status = 'created';
    
    console.log(`✅ [Backend] TE_Data数据已设置，总计 ${filteredTeData.length} 条记录`);
    
    // 保存到数据库
    console.log(`💾 [Backend] 开始保存到MongoDB...`);
    await study.save();
    console.log(`✅ [Backend] MongoDB保存成功`);
    
    // 保存后验证
    const savedStudy = await Study.findById(studyId).select('Spec.first_version.TE_Data.table_title Spec.first_version.TE_Data.table_content').lean();
    const savedTableTitle = savedStudy?.Spec?.first_version?.TE_Data?.table_title;
    const savedContentCount = savedStudy?.Spec?.first_version?.TE_Data?.table_content?.length || 0;
    
    console.log(`🔍 [Backend] 保存后验证: table_title长度=${savedTableTitle?.length || 0}, content条数=${savedContentCount}`);
    
    res.json({
      success: true,
      data: {
        totalCount: savedContentCount,
        tableTitle: savedTableTitle,
        tableTitleLength: savedTableTitle?.length || 0
      }
    });
    
  } catch (error) {
    console.error('❌ [Backend] 保存TE_Details数据失败:', error);
    console.error('📋 [Backend] 错误详情:', {
      message: error.message,
      stack: error.stack?.split('\n').slice(0, 5).join('\n'),
      studyId: req.params.studyId,
      dataSize: req.body.teData?.length
    });
    res.status(500).json({
      success: false,
      message: error.message || 'TE数据保存失败'
    });
  }
}

/**
 * 生成TI_Details数据（使用OpenAI基于Inclusion/Exclusion Criteria生成）
 * @param {Object} req - Express请求对象
 * @param {Object} res - Express响应对象
 */
async function generateTIDetailsData(req, res) {
  try {
    const { studyId } = req.params;
    console.log(`🚀 [Backend] 开始生成TI_Details数据，studyId: ${studyId}`);
    console.log(`📊 [Backend] API端点调用: POST /api/studies/${studyId}/generate-ti-details`);
    
    // 1. 获取Criterias数据
    console.log(`🔍 [Backend] 开始提取Inclusion/Exclusion Criterias...`);
    const study = await Study.findById(studyId)
      .select('studyNumber files.protocol.uploadExtraction.criterias')
      .lean();
    
    if (!study) {
      console.error(`❌ [Backend] Study不存在，studyId: ${studyId}`);
      return res.status(404).json({
        success: false,
        message: 'Study不存在'
      });
    }
    
    const criterias = study.files?.protocol?.uploadExtraction?.criterias;
    
    if (!criterias || Object.keys(criterias).length === 0) {
      console.error(`❌ [Backend] Criterias数据不存在，studyId: ${studyId}`);
      return res.status(404).json({
        success: false,
        message: 'Criterias数据不存在，请先上传Protocol并完成解析'
      });
    }
    
    console.log(`✅ [Backend] Criterias找到，包含字段: ${Object.keys(criterias).join(', ')}`);
    
    // 2. 聚合并规范化Criterias内容
    const inclusionCriteria = [];
    const exclusionCriteria = [];
    
    // 🔥 修正：criterias[key]是数组，需要遍历提取每个section的content
    Object.keys(criterias).forEach(key => {
      const normalizedKey = key.toLowerCase().replace(/[_\s-]+/g, ' ').trim();
      const sections = criterias[key] || [];  // criterias[key] 是一个对象数组
      
      if (normalizedKey.includes('inclusion')) {
        // 遍历所有inclusion sections，提取content
        sections.forEach(section => {
          if (section && section.content && section.content.trim()) {
            inclusionCriteria.push(section.content.trim());
            console.log(`  ✅ 提取 Inclusion: "${section.title}" (${section.content.length} 字符)`);
          }
        });
      } else if (normalizedKey.includes('exclusion')) {
        // 遍历所有exclusion sections，提取content
        sections.forEach(section => {
          if (section && section.content && section.content.trim()) {
            exclusionCriteria.push(section.content.trim());
            console.log(`  ✅ 提取 Exclusion: "${section.title}" (${section.content.length} 字符)`);
          }
        });
      } else {
        console.log(`⚠️ [Backend] 跳过非inclusion/exclusion字段: ${key}`);
      }
    });
    
    console.log(`📋 [Backend] Inclusion Criteria数量: ${inclusionCriteria.length}`);
    console.log(`📋 [Backend] Exclusion Criteria数量: ${exclusionCriteria.length}`);
    
    if (inclusionCriteria.length === 0 && exclusionCriteria.length === 0) {
      console.error(`❌ [Backend] 未找到有效的inclusion或exclusion criteria`);
      return res.status(400).json({
        success: false,
        message: '未找到有效的inclusion或exclusion criteria'
      });
    }
    
    // 3. 构造OpenAI Prompt
    let inputText = `Study Number: ${study.studyNumber || 'UNKNOWN'}\n\n`;
    
    if (inclusionCriteria.length > 0) {
      inputText += `Inclusion Criteria:\n`;
      inclusionCriteria.forEach((criterion, index) => {
        inputText += `${index + 1}. ${criterion}\n`;
      });
      inputText += '\n';
    }
    
    if (exclusionCriteria.length > 0) {
      inputText += `Exclusion Criteria:\n`;
      exclusionCriteria.forEach((criterion, index) => {
        inputText += `${index + 1}. ${criterion}\n`;
      });
    }
    
    const prompt = `TI_DATA Prompt:
<identity>
You are an experienced statistical programmer, please generate the SDTM.TI domain based on the input from protocol of the study design and MUST meet all the requirements.
</identity>
<input>
${inputText}
</input>
<requirement>
1. Build it based on SDTMIG v3.4.
2. Only includes the variables STUDYID, DOMAIN, IETESTCD, IETEST, IECAT, TIVERS
3. STUDYID must be "${study.studyNumber || 'UNKNOWN'}" for ALL records.
4. DOMAIN must be "TI" for ALL records.
5. IECAT should follow controlled terminology: "INCLUSION CRITERIA" or "EXCLUSION CRITERIA".
6. IETESTCD for exclusion criteria should start with EXCL01 and be limited to 8 characters.
7. IETESTCD for inclusion criteria should start with INCL01 and be limited to 8 characters.
8. If the criterion text is <200 characters, it goes in IETEST; if the text is >200 characters, put meaningful text in IETEST.
9. Please note some criteria may contain several sub-criteria, they are listed clearly as a, b, c, or i, ii, iii., from the context, they should be listed as different IETESTCD. If they are presented as one criterion, just give me one IETESTCD, do not need to analyze the text logic.
10. TIVERS should default to "1.0" unless version information is explicitly mentioned in the criteria.
</requirement>
<format>
1. Output JSON ONLY, no code fences, no commentary.
2. JSON format must be a list of records. Each record must contain EXACTLY these 6 variables: STUDYID, DOMAIN, IETESTCD, IETEST, IECAT, TIVERS
3. Remember: STUDYID="${study.studyNumber || 'UNKNOWN'}" and DOMAIN="TI" for every single record.
</format>`;
    
    console.log(`🤖 [Backend] 开始调用OpenAI API生成TI数据...`);
    console.log(`📝 [Backend] Prompt长度: ${prompt.length} 字符`);
    console.log(`🔑 [Backend] 使用的STUDYID: ${study.studyNumber || 'UNKNOWN'}`);
    
    // 4. 调用OpenAI API
    let tiDataArray = [];
    try {
      const completion = await openai.chat.completions.create({
        model: 'gpt-4o',
        messages: [
          {
            role: 'system',
            content: 'You are an expert statistical programmer specialized in CDISC SDTM standards. You always output valid JSON without code fences or commentary.'
          },
          {
            role: 'user',
            content: prompt
          }
        ],
        temperature: 0.3,
        max_tokens: 4000
      });
      
      const aiResponse = completion.choices[0]?.message?.content?.trim() || '';
      console.log(`✅ [Backend] OpenAI响应接收成功，长度: ${aiResponse.length} 字符`);
      console.log(`📋 [Backend] AI响应预览（前500字符）: ${aiResponse.substring(0, 500)}`);
      
      // 5. 解析JSON响应
      try {
        let cleanedResponse = aiResponse.replace(/```json\s*/g, '').replace(/```\s*/g, '').trim();
        tiDataArray = JSON.parse(cleanedResponse);
        
        console.log(`✅ [Backend] JSON解析成功，记录数: ${tiDataArray.length}`);
        
        // 6. 验证数据结构
        const requiredFields = ['STUDYID', 'DOMAIN', 'IETESTCD', 'IETEST', 'IECAT', 'TIVERS'];
        
        if (!Array.isArray(tiDataArray)) {
          throw new Error('AI返回的数据不是数组格式');
        }
        
        // 验证每条记录并强制修正
        tiDataArray = tiDataArray.map((record, index) => {
          const validatedRecord = {};
          
          requiredFields.forEach(field => {
            validatedRecord[field] = record[field] !== undefined && record[field] !== null 
              ? String(record[field]).trim() 
              : '';
          });
          
          return validatedRecord;
        });
        
        console.log(`✅ [Backend] 数据基础验证完成，记录数: ${tiDataArray.length}`);
        
        // 🔥 强制修正STUDYID和DOMAIN
        const expectedStudyId = study.studyNumber || 'UNKNOWN';
        tiDataArray.forEach(record => {
          record.STUDYID = expectedStudyId;
          record.DOMAIN = 'TI';
        });
        
        console.log(`✅ [Backend] STUDYID和DOMAIN强制修正完成`);
        
        // 🔥 规范化IECAT
        tiDataArray.forEach(record => {
          const iecat = (record.IECAT || '').toUpperCase();
          if (iecat.includes('INCLUSION')) {
            record.IECAT = 'INCLUSION CRITERIA';
          } else if (iecat.includes('EXCLUSION')) {
            record.IECAT = 'EXCLUSION CRITERIA';
          } else {
            // 默认根据IETESTCD判断
            const ietestcd = (record.IETESTCD || '').toUpperCase();
            if (ietestcd.startsWith('INCL')) {
              record.IECAT = 'INCLUSION CRITERIA';
            } else if (ietestcd.startsWith('EXCL')) {
              record.IECAT = 'EXCLUSION CRITERIA';
            } else {
              record.IECAT = 'INCLUSION CRITERIA'; // 默认
            }
          }
        });
        
        console.log(`✅ [Backend] IECAT规范化完成`);
        
        // 🔥 规范化和验证IETESTCD
        const inclCount = tiDataArray.filter(r => r.IECAT === 'INCLUSION CRITERIA').length;
        const exclCount = tiDataArray.filter(r => r.IECAT === 'EXCLUSION CRITERIA').length;
        
        console.log(`📊 [Backend] INCLUSION条目: ${inclCount}, EXCLUSION条目: ${exclCount}`);
        
        // 按IECAT分组并重新编号
        let inclIndex = 1;
        let exclIndex = 1;
        
        tiDataArray.forEach(record => {
          let ietestcd = (record.IETESTCD || '').toUpperCase().replace(/[^A-Z0-9_]/g, '');
          
          // 强制符合规范
          if (record.IECAT === 'INCLUSION CRITERIA') {
            if (!ietestcd.startsWith('INCL') || ietestcd.length > 8) {
              ietestcd = `INCL${String(inclIndex).padStart(2, '0')}`;
            }
            inclIndex++;
          } else if (record.IECAT === 'EXCLUSION CRITERIA') {
            if (!ietestcd.startsWith('EXCL') || ietestcd.length > 8) {
              ietestcd = `EXCL${String(exclIndex).padStart(2, '0')}`;
            }
            exclIndex++;
          }
          
          record.IETESTCD = ietestcd.substring(0, 8);
        });
        
        console.log(`✅ [Backend] IETESTCD规范化完成`);
        
        // 🔥 设置默认TIVERS
        tiDataArray.forEach(record => {
          if (!record.TIVERS || record.TIVERS.trim() === '') {
            record.TIVERS = '1.0';
          }
        });
        
        console.log(`✅ [Backend] TIVERS默认值设置完成`);
        
        // 🔥 去重：按(IECAT, 清理后的IETEST文本)去重
        const tiMap = new Map();
        tiDataArray.forEach(record => {
          // 清理IETEST的前缀编号 (a., i., 1., (a), etc.)
          const cleanedIetest = (record.IETEST || '')
            .replace(/^[\s]*[\(]?[a-z0-9]+[\).][\s]*/i, '')
            .trim();
          
          const key = `${record.IECAT}|${cleanedIetest.toLowerCase()}`;
          
          if (!tiMap.has(key)) {
            tiMap.set(key, record);
          } else {
            console.log(`🔍 [Backend] 去重: 跳过重复条目 ${record.IETESTCD}`);
          }
        });
        
        const beforeDedup = tiDataArray.length;
        tiDataArray = Array.from(tiMap.values());
        console.log(`🔍 [Backend] 去重: ${beforeDedup} → ${tiDataArray.length} (移除 ${beforeDedup - tiDataArray.length} 个重复条目)`);
        
        // 🔥 过滤：IETEST必须非空
        const hasValue = (v) => v && String(v).trim() !== '';
        const beforeFilter = tiDataArray.length;
        tiDataArray = tiDataArray.filter(record => hasValue(record.IETEST));
        console.log(`🔍 [Backend] IETEST过滤: ${beforeFilter} → ${tiDataArray.length} (移除 ${beforeFilter - tiDataArray.length} 个IETEST为空的记录)`);
        
        if (tiDataArray.length > 0) {
          console.log(`📋 [Backend] TI数据预览（前2条）:`, tiDataArray.slice(0, 2));
        }
        
      } catch (parseError) {
        console.error(`❌ [Backend] JSON解析失败:`, parseError.message);
        console.error(`📋 [Backend] AI原始响应:`, aiResponse.substring(0, 1000));
        throw new Error(`AI响应JSON解析失败: ${parseError.message}`);
      }
      
    } catch (openaiError) {
      console.error(`❌ [Backend] OpenAI API调用失败:`, openaiError.message);
      throw new Error(`OpenAI API调用失败: ${openaiError.message}`);
    }
    
    // 7. 返回生成的数据
    console.log(`✅ [Backend] TI_Details数据生成完成，总计 ${tiDataArray.length} 条记录`);
    
    res.json({
      success: true,
      data: {
        tiData: tiDataArray,
        totalRecords: tiDataArray.length,
        studyNumber: study.studyNumber,
        inclusionCount: tiDataArray.filter(r => r.IECAT === 'INCLUSION CRITERIA').length,
        exclusionCount: tiDataArray.filter(r => r.IECAT === 'EXCLUSION CRITERIA').length
      }
    });
    
  } catch (error) {
    console.error('❌ [Backend] 生成TI_Details数据失败:', error);
    console.error('📋 [Backend] 错误详情:', {
      message: error.message,
      stack: error.stack?.split('\n').slice(0, 5).join('\n'),
      studyId: req.params.studyId
    });
    res.status(500).json({
      success: false,
      message: error.message || 'TI数据生成失败'
    });
  }
}

/**
 * 🔥 辅助函数：使用GPT精简过长的IETEST文本到≤200字符
 * @param {string} originalText - 原始IETEST文本
 * @param {string} iecat - IECAT分类（INCLUSION CRITERIA或EXCLUSION CRITERIA）
 * @returns {Promise<string>} 精简后的文本（≤200字符）
 */
async function shortenIETESTWithGPT(originalText, iecat = '') {
  try {
    console.log(`🤖 [GPT精简] 开始精简IETEST，原长度: ${originalText.length} 字符`);
    
    const prompt = `<identity>
You are a precise technical editor. Condense the input criterion text to <=200 characters without changing its meaning. Keep it clear, factual, and readable. Do not invent or remove critical information. Keep the original language and terminology. Output plain text only.
</identity>
<input>
Criterion Category: ${iecat || 'Not specified'}
Original Text (may be long):
${originalText}
</input>
<rules>
1. Output must be one line of plain text (no quotes, no list markers, no numbering, no code fences).
2. <= 200 characters. Do not cut words in the middle; compress wording, merge clauses, and remove redundancy.
3. Preserve medical/clinical terms and logical qualifiers essential to the criterion (e.g., thresholds, conditions, time windows).
4. Do not modify classification or category; do not add new facts.
</rules>
<format>
Plain text only.
</format>`;
    
    const completion = await openai.chat.completions.create({
      model: 'gpt-4o',
      messages: [
        {
          role: 'system',
          content: 'You are a technical editor who condenses text while preserving meaning. Always output plain text without quotes or formatting.'
        },
        {
          role: 'user',
          content: prompt
        }
      ],
      temperature: 0.2,
      max_tokens: 300
    });
    
    let condensedText = completion.choices[0]?.message?.content?.trim() || '';
    
    // 清理可能的格式问题（去掉代码围栏、引号等）
    condensedText = condensedText
      .replace(/```[a-z]*\s*/gi, '')  // 去掉代码围栏
      .replace(/```\s*/g, '')
      .replace(/^["']|["']$/g, '')     // 去掉首尾引号
      .replace(/\n+/g, ' ')            // 换行替换为空格
      .replace(/\s+/g, ' ')            // 多个空格合并
      .trim();
    
    console.log(`✅ [GPT精简] 精简成功，新长度: ${condensedText.length} 字符`);
    
    // 验证结果的合理性
    if (!condensedText || condensedText.length === 0) {
      throw new Error('GPT返回空文本');
    }
    
    if (condensedText.length > 200) {
      console.warn(`⚠️ [GPT精简] GPT返回的文本仍超过200字符 (${condensedText.length})，将进行截断`);
      condensedText = safeWordBoundaryTruncate(condensedText, 200);
    }
    
    return condensedText;
    
  } catch (error) {
    console.error(`❌ [GPT精简] 精简失败:`, error.message);
    throw error;
  }
}

/**
 * 🔥 辅助函数：在词边界安全截断文本（fallback方案）
 * @param {string} text - 要截断的文本
 * @param {number} maxLength - 最大长度
 * @returns {string} 截断后的文本（≤maxLength）
 */
function safeWordBoundaryTruncate(text, maxLength) {
  if (!text || text.length <= maxLength) {
    return text;
  }
  
  // 在maxLength位置往前找最近的空格
  let truncatePos = maxLength;
  
  // 从maxLength-1开始往前找空格
  for (let i = maxLength - 1; i >= Math.max(0, maxLength - 50); i--) {
    if (text[i] === ' ' || text[i] === ',' || text[i] === ';' || text[i] === '.') {
      truncatePos = i;
      break;
    }
  }
  
  // 如果找不到合适的断点（前50个字符内没有空格），就强制在maxLength截断
  if (truncatePos === maxLength && maxLength > 0) {
    // 至少保证不在单词中间截断
    while (truncatePos > 0 && /[a-zA-Z0-9]/.test(text[truncatePos])) {
      truncatePos--;
    }
  }
  
  const truncated = text.substring(0, truncatePos).trim();
  console.log(`✂️ [安全截断] 原长度: ${text.length}, 截断后: ${truncated.length}`);
  
  return truncated;
}

/**
 * 保存TI_Details数据到数据库
 * @param {Object} req - Express请求对象
 * @param {Object} res - Express响应对象
 */
async function saveSpecTIDetailsData(req, res) {
  try {
    const { studyId } = req.params;
    const { tiData } = req.body;
    
    console.log(`💾 [Backend] 开始保存TI_Details数据`);
    console.log(`📊 [Backend] studyId: ${studyId}, 记录数: ${tiData?.length || 0}`);
    
    if (!Array.isArray(tiData)) {
      return res.status(400).json({
        success: false,
        message: 'tiData必须是数组格式'
      });
    }
    
    // 查找Study
    const study = await Study.findById(studyId);
    
    if (!study) {
      return res.status(404).json({
        success: false,
        message: 'Study不存在'
      });
    }
    
    // 初始化Spec结构（如果不存在）
    if (!study.Spec) {
      study.Spec = { first_version: {} };
    }
    if (!study.Spec.first_version) {
      study.Spec.first_version = {};
    }
    if (!study.Spec.first_version.TI_Data) {
      study.Spec.first_version.TI_Data = {
        table_title: [],
        table_content: [],
        status: 'false'
      };
    }
    
    console.log(`🔧 [Backend] 初始化TI_Data结构`);
    
    // 设置table_title
    study.Spec.first_version.TI_Data.table_title = TI_TABLE_HEADERS;
    console.log(`📋 [Backend] table_title设置: ${TI_TABLE_HEADERS.join(', ')}`);
    
    // 🔥 防御性过滤 - IETEST必须有值
    const hasValue = (value) => value !== null && value !== undefined && String(value).trim() !== '';
    
    const filteredTiData = tiData.filter(record => {
      return hasValue(record.IETEST);
    });
    
    console.log(`🔍 [Backend] 数据过滤: ${tiData.length} 条 → ${filteredTiData.length} 条 (跳过 ${tiData.length - filteredTiData.length} 个无效记录)`);
    
    // 🔥 新增：检查并精简过长的IETEST（>200字符）
    console.log(`\n📏 [Backend] 开始检查IETEST长度并精简超长文本...`);
    let shortenedCount = 0;
    let failedCount = 0;
    const maxLengthAllowed = 200;
    
    for (let i = 0; i < filteredTiData.length; i++) {
      const record = filteredTiData[i];
      const originalIETEST = (record.IETEST || '').trim();
      
      if (originalIETEST.length <= maxLengthAllowed) {
        continue; // 长度合格，跳过
      }
      
      console.log(`\n⚠️ [Backend] 记录 ${i + 1}/${filteredTiData.length}: IETEST超长 (${originalIETEST.length} > ${maxLengthAllowed})`);
      console.log(`   IETESTCD: ${record.IETESTCD}`);
      console.log(`   IECAT: ${record.IECAT}`);
      console.log(`   原文预览: ${originalIETEST.substring(0, 100)}...`);
      
      try {
        // 尝试使用GPT精简
        console.log(`   🤖 调用GPT进行精简...`);
        const shortenedText = await shortenIETESTWithGPT(originalIETEST, record.IECAT || '');
        
        // 验证精简结果
        if (shortenedText && shortenedText.length > 0 && shortenedText.length <= maxLengthAllowed) {
          record.IETEST = shortenedText;
          shortenedCount++;
          console.log(`   ✅ GPT精简成功: ${originalIETEST.length} → ${shortenedText.length} 字符`);
          console.log(`   精简后: ${shortenedText}`);
        } else {
          // GPT返回结果不合格，使用fallback
          console.warn(`   ⚠️ GPT返回结果不合格，使用fallback截断`);
          record.IETEST = safeWordBoundaryTruncate(originalIETEST, maxLengthAllowed);
          shortenedCount++;
        }
        
      } catch (gptError) {
        // GPT调用失败，使用fallback
        console.error(`   ❌ GPT精简失败: ${gptError.message}`);
        console.log(`   🔄 使用fallback安全截断...`);
        
        try {
          record.IETEST = safeWordBoundaryTruncate(originalIETEST, maxLengthAllowed);
          shortenedCount++;
          console.log(`   ✅ Fallback截断成功: ${originalIETEST.length} → ${record.IETEST.length} 字符`);
        } catch (truncateError) {
          console.error(`   ❌ Fallback截断也失败: ${truncateError.message}`);
          failedCount++;
          // 保持原文本，但记录警告
          console.warn(`   ⚠️ 保持原文本（超长），记录ID: ${record.IETESTCD}`);
        }
      }
      
      // 添加短暂延迟，避免API速率限制（仅在使用GPT时）
      if (i < filteredTiData.length - 1) {
        await new Promise(resolve => setTimeout(resolve, 200)); // 200ms延迟
      }
    }
    
    console.log(`\n✅ [Backend] IETEST长度检查完成`);
    console.log(`   📊 总记录数: ${filteredTiData.length}`);
    console.log(`   ✂️ 精简记录数: ${shortenedCount}`);
    console.log(`   ❌ 失败记录数: ${failedCount}`);
    
    // 最终验证：确保所有IETEST都≤200字符（排除失败的）
    const stillOverLength = filteredTiData.filter(r => r.IETEST && r.IETEST.length > maxLengthAllowed);
    if (stillOverLength.length > 0) {
      console.warn(`⚠️ [Backend] 仍有 ${stillOverLength.length} 条记录的IETEST超过${maxLengthAllowed}字符`);
      stillOverLength.forEach(r => {
        console.warn(`   - ${r.IETESTCD}: ${r.IETEST.length} 字符`);
      });
    }
    
    // 替换全部数据
    study.Spec.first_version.TI_Data.table_content = filteredTiData;
    study.Spec.first_version.TI_Data.updated_at = new Date();
    study.Spec.first_version.TI_Data.status = 'created';
    
    console.log(`✅ [Backend] TI_Data数据已设置，总计 ${filteredTiData.length} 条记录`);
    
    // 保存到数据库
    console.log(`💾 [Backend] 开始保存到MongoDB...`);
    await study.save();
    console.log(`✅ [Backend] MongoDB保存成功`);
    
    // 保存后验证
    const savedStudy = await Study.findById(studyId).select('Spec.first_version.TI_Data.table_title Spec.first_version.TI_Data.table_content').lean();
    const savedTableTitle = savedStudy?.Spec?.first_version?.TI_Data?.table_title;
    const savedContentCount = savedStudy?.Spec?.first_version?.TI_Data?.table_content?.length || 0;
    
    console.log(`🔍 [Backend] 保存后验证: table_title长度=${savedTableTitle?.length || 0}, content条数=${savedContentCount}`);
    
    res.json({
      success: true,
      data: {
        totalCount: savedContentCount,
        tableTitle: savedTableTitle,
        tableTitleLength: savedTableTitle?.length || 0
      }
    });
    
  } catch (error) {
    console.error('❌ [Backend] 保存TI_Details数据失败:', error);
    console.error('📋 [Backend] 错误详情:', {
      message: error.message,
      stack: error.stack?.split('\n').slice(0, 5).join('\n'),
      studyId: req.params.studyId,
      dataSize: req.body.tiData?.length
    });
    res.status(500).json({
      success: false,
      message: error.message || 'TI数据保存失败'
    });
  }
}

// ===================== TS Data 辅助函数 =====================

/**
 * CDISC短码到codelist.name的映射表
 */
const CDISC_CODELIST_MAPPING = {
  'NY': 'No Yes Response',
  'INTTYPE': 'Intervention Type',
  'INTMODEL': 'Intervention Model',
  'TBLIND': 'Trial Blinding Schema',
  'TPHASE': 'Trial Phase Response',  // 🔥 修正：Excel中实际名称是"Trial Phase Response"（Extensible=Yes），不是"Trial Phase Classification"
  'ACN': 'Action Taken with Study Treatment',
  'STENRF': 'Reason Not Collected or Provided',
  'TRIALSP': 'Trial Sponsor',
  // 可根据实际需要扩展
};

/**
 * 从CDISC短码获取完整的codelist name
 * @param {string} shortCode - 短码（如 NY, INTTYPE）
 * @returns {string|null} - codelist name 或 null
 */
function getCodelistNameFromShortCode(shortCode) {
  if (!shortCode || typeof shortCode !== 'string') return null;
  const normalized = shortCode.trim().toUpperCase();
  return CDISC_CODELIST_MAPPING[normalized] || null;
}

/**
 * 从References.sdtm_terminology查询CDISC受控术语
 * @param {string} codelistName - codelist name（如 "No Yes Response"）
 * @param {string} submissionValue - TSVAL值（如 "N"）
 * @returns {Object|null} - { code, version } 或 null
 */
async function lookupCDISCTerminology(codelistName, submissionValue) {
  try {
    if (!codelistName || !submissionValue) return null;
    
    // 查询MongoDB: References.sdtm_terminology
    // 🔥 切换到References数据库
    const referencesDb = Study.db.db.client.db('References');
    const doc = await referencesDb.collection('sdtm_terminology').findOne({
      'File_Function': 'CDISC',
      'codelist.name': codelistName
    });
    
    if (!doc || !doc.items) {
      console.warn(`⚠️ [Terminology] 未找到codelist: ${codelistName}`);
      return null;
    }
    
    // 在items中查找匹配的submission_value或synonyms（大小写不敏感）
    const normalizedValue = String(submissionValue).trim().toUpperCase();
    const item = doc.items.find(i => {
      // 匹配submission_value
      if (i.submission_value && String(i.submission_value).trim().toUpperCase() === normalizedValue) {
        return true;
      }
      // 🔥 新增：也匹配synonyms数组
      if (i.synonyms && Array.isArray(i.synonyms)) {
        return i.synonyms.some(syn => 
          syn && String(syn).trim().toUpperCase() === normalizedValue
        );
      }
      return false;
    });
    
    if (!item) {
      console.warn(`⚠️ [Terminology] 未找到submission_value或synonym: ${submissionValue} in ${codelistName}`);
      return null;
    }
    
    console.log(`✅ [Terminology] 匹配成功: ${submissionValue} → ${item.code} (codelist: ${codelistName})`);
    
    return {
      code: item.code || null,
      version: doc.version || null
    };
    
  } catch (error) {
    console.error(`❌ [Terminology] 查询失败:`, error.message);
    return null;
  }
}

/**
 * 构造TS Prompt（逐参数）
 * @param {Object} params
 * @returns {string}
 */
function buildTSPrompt({ studyNumber, tsparmcd, tsparm, inputText, codelist, multipleRecord, codelistItems }) {
  // 处理codelist部分
  let codelistSection = 'null';
  if (codelist) {
    const upper = codelist.trim().toUpperCase();
    if (upper === 'ISO 8601' || upper === 'ISO 3166') {
      codelistSection = upper;
    } else {
      // CDISC codelist - 列出所有可能的值
      if (codelistItems && codelistItems.length > 0) {
        const values = codelistItems.map(item => item.submission_value).filter(Boolean).join(', ');
        codelistSection = `CDISC: ${codelist} (Possible values: ${values})`;
      } else {
        codelistSection = `CDISC: ${codelist}`;
      }
    }
  }
  
  const multipleRecordText = multipleRecord === 1 ? 'Yes' : 'No';
  
  const prompt = `TS_DATA Prompt:
<identity>
You are an experienced statistical programmer, please generate a single record or multiple records for the parameter in SDTM.TS domain based on the input from protocol, the codelist from controlled terminology.
</identity>

<parameter>
TSPARMCD = ${tsparmcd}, TSPARM = ${tsparm}
</parameter>

<input>
${inputText}
</input>

<codelist>${codelistSection}</codelist>

<multiplerecord>${multipleRecordText}</multiplerecord>

<request>
1. Build it based on SDTMIG v3.4.
2. Include variables STUDYID, DOMAIN, TSSEQ, TSPARMCD, TSPARM, TSVAL, TSVALNF, TSVALCD, TSVCDREF, TSVCDVER. TSVAL1 – TSVALn are needed for TSVAL > 200 character results, refer to #3 for the detail.
3. If TSVAL is >200 characters, then it should be split into multiple variables, TSVAL1-TSVALn. Each of these variable lengths should be within 200 characters. Do not cut a word in the middle, use the space to split. Only keep the variables with results.
4. If there is CDISC codelist for the parameter, MUST find the most appropriate one, put the CDISC Submission Value in TSVAL, if >200 characters, refer to #3, put the Code in TSVALCD. If the codelist is ISO 8601, MUST put the TSVAL result in ISO 8601 format.
5. The TSSEQ is the sequence number given to ensure uniqueness within a parameter. If the multiple record tag is No, TSSEQ = 1, if the multiple record tag is Yes, it means there should be multiple records for that TSPARMCD, the TSSEQ starts from 1 and increment by 1.
6. STUDYID must be "${studyNumber}" for ALL records.
7. DOMAIN must be "TS" for ALL records.
</request>

<format>
Output JSON ONLY, no code fences, no commentary. JSON format must be a list of records.
Each record must contain: STUDYID, DOMAIN, TSSEQ, TSPARMCD, TSPARM, TSVAL, TSVALNF, TSVALCD, TSVCDREF, TSVCDVER
If TSVAL is split, you may include TSVAL1, TSVAL2, etc. as additional fields.
</format>`;

  return prompt;
}

/**
 * 归一化AI返回的记录 + 受控术语映射
 * @param {Array} aiRecords - AI返回的记录数组
 * @param {Object} context - { studyNumber, rowCodelist, tsparmcd, protocolSource, tsparm }
 * @returns {Array} - 归一化后的记录
 */
async function normalizeAIRecordsWithTerminology(aiRecords, context) {
  const { studyNumber, rowCodelist, tsparmcd, protocolSource, tsparm } = context;
  const normalized = [];
  
  for (let i = 0; i < aiRecords.length; i++) {
    const record = aiRecords[i];
    
    // 处理TSVAL1-n字段（如果AI返回了多个TSVAL字段）
    // 将其合并为多条记录，每条TSVAL≤200
    const tsvalFields = [];
    if (record.TSVAL && String(record.TSVAL).trim()) {
      tsvalFields.push(String(record.TSVAL).trim());
    }
    
    // 检查是否有TSVAL1, TSVAL2等
    let idx = 1;
    while (record[`TSVAL${idx}`]) {
      tsvalFields.push(String(record[`TSVAL${idx}`]).trim());
      idx++;
    }
    
    // 如果没有任何TSVAL，跳过
    if (tsvalFields.length === 0) {
      continue;
    }
    
    // 为每个TSVAL创建一条记录
    for (let j = 0; j < tsvalFields.length; j++) {
      const tsval = tsvalFields[j];
      
      const newRecord = {
        STUDYID: studyNumber,
        DOMAIN: 'TS',
        TSSEQ: String(j + 1),
        TSPARMCD: tsparmcd,
        TSPARM: record.TSPARM || '',
        TSVAL: tsval,
        TSVALNF: record.TSVALNF || '',
        TSVALCD: '',
        TSVCDREF: '',
        TSVCDVER: '',
        TSGRPID: 'PROTOCOL_DERIVED' // 默认分组
      };
      
      // 🔥 特殊规则：Study Design的Age参数强制使用ISO 8601
      const isStudyDesignAge = protocolSource === 'Study Design' && 
        tsparm && (
          tsparm.includes('Planned Maximum Age') || 
          tsparm.includes('Planned Minimum Age') ||
          tsparm === 'Planned Maximum Age of Subjects' ||
          tsparm === 'Planned Minimum Age of Subjects'
        );
      
      if (isStudyDesignAge) {
        // Age参数强制设置为ISO 8601
        newRecord.TSVCDREF = 'ISO 8601';
        newRecord.TSVALCD = '';
        newRecord.TSVCDVER = '';
        console.log(`✅ [Special Rule] ${tsparmcd} (${tsparm}) → TSVCDREF="ISO 8601" (Study Design Age)`);
      } else if (rowCodelist) {
        // 受控术语映射（原有逻辑）
        const upper = rowCodelist.trim().toUpperCase();
        
        if (upper === 'ISO 8601' || upper === 'ISO 3166') {
          // ISO标准，不查术语
          newRecord.TSVCDREF = upper;
          newRecord.TSVALCD = '';
          newRecord.TSVCDVER = '';
        } else {
          // CDISC术语查询
          const codelistName = getCodelistNameFromShortCode(rowCodelist);
          if (codelistName) {
            const terminology = await lookupCDISCTerminology(codelistName, tsval);
            if (terminology) {
              newRecord.TSVALCD = terminology.code || '';
              newRecord.TSVCDREF = 'CDISC';
              newRecord.TSVCDVER = terminology.version || '';
              console.log(`✅ [Terminology] ${tsparmcd} - ${tsval} → ${terminology.code}`);
            } else {
              console.warn(`⚠️ [Terminology] 未找到匹配: ${tsparmcd} - ${tsval}`);
            }
          }
        }
      }
      
      normalized.push(newRecord);
    }
  }
  
  return normalized;
}

// ===================== 旧版TS生成函数（已注释） =====================

/*
// 旧版：直接用Cover Page生成全量TS数据
async function generateTSDetailsData_OLD(req, res) {
  // ... 旧代码已移除，见Git历史 ...
}
*/

// ===================== 新版TS生成函数（逐行驱动+SSE流式） =====================

/**
 * 🔥 SSE流式生成TS_Details数据（实时进度推送）
 * @param {Object} req - Express请求对象
 * @param {Object} res - Express响应对象
 */
async function generateTSDetailsDataStream(req, res) {
  try {
    const { studyId } = req.params;
    console.log(`🚀 [Backend SSE] 开始TS_Details流式生成，studyId: ${studyId}`);
    
    // 设置SSE headers
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no'); // 禁用nginx缓冲
    
    // 发送事件的辅助函数
    const sendEvent = (eventType, data) => {
      res.write(`event: ${eventType}\n`);
      res.write(`data: ${JSON.stringify(data)}\n\n`);
    };
    
    // ========== 步骤1: 读取References.TS（参考表） ==========
    console.log(`\n📋 [Step 1] 读取References.TS参考表...`);
    const referencesDb = Study.db.db.client.db('References');
    const tsReferenceDoc = await referencesDb.collection('TS').findOne();
    
    if (!tsReferenceDoc || !tsReferenceDoc.data || !Array.isArray(tsReferenceDoc.data)) {
      console.error(`❌ [Backend] References.TS数据不存在或格式错误`);
      sendEvent('error', { message: 'References.TS参考表不存在，请先导入TS_example.xlsx' });
      res.end();
      return;
    }
    
    const tsRows = tsReferenceDoc.data;
    console.log(`✅ [Step 1] References.TS读取成功，总行数: ${tsRows.length}`);
    
    // ========== 步骤2: 提取Protocol文本源 ==========
    console.log(`\n📋 [Step 2] 提取Protocol文本源...`);
    const study = await Study.findById(studyId)
      .select('studyNumber files.protocol.uploadExtraction Spec.first_version.Study')
      .lean();
    
    if (!study) {
      sendEvent('error', { message: 'Study不存在' });
      res.end();
      return;
    }
    
    const studyNumber = study.studyNumber || 'UNKNOWN';
    const extraction = study.files?.protocol?.uploadExtraction || {};
    const sectionedText = extraction.sectionedText || [];
    
    const sources = {
      'Cover Page': sectionedText[0]?.content || '',
      'Study Design': extraction.studyDesign ? JSON.stringify(extraction.studyDesign) : '',
      'Endpoints': extraction.endpoints ? JSON.stringify(extraction.endpoints) : '',
      'Endpoint': extraction.endpoints ? JSON.stringify(extraction.endpoints) : '', // 兼容拼写
      'Objectives': '', // 暂时为空
      'Spec': study.Spec?.first_version?.Study ? JSON.stringify(study.Spec.first_version.Study) : ''
    };
    
    console.log(`✅ [Step 2] Study找到，studyNumber: ${studyNumber}`);
    
    // ========== 步骤3: 逐行处理（串行）+ 实时推送进度 ==========
    console.log(`\n📋 [Step 3] 开始逐行处理TS参数...`);
    
    let processedCount = 0;
    let skippedCount = 0;
    let errorCount = 0;
    
    for (let rowIdx = 0; rowIdx < tsRows.length; rowIdx++) {
      const row = tsRows[rowIdx];
      const rowNum = rowIdx + 1;
      
      // 检查AI列
      const aiFlag = parseInt(row.AI) || 0;
      if (aiFlag !== 1) {
        console.log(`⏭️  [Row ${rowNum}] 跳过（AI=0）: ${row.TSPARMCD}`);
        skippedCount++;
        continue;
      }
      
      // 获取参数信息
      const tsparmcd = row.TSPARMCD || '';
      const tsparm = row.TSPARM || '';
      const protocolSource = row.Protocol || '';
      const codelist = row.Codelist || '';
      const multiple = parseInt(row.Multiple) || 0;
      
      if (!tsparmcd || !protocolSource) {
        console.log(`⏭️  [Row ${rowNum}] 跳过（参数不完整）`);
        skippedCount++;
        continue;
      }
      
      console.log(`\n🔄 [Row ${rowNum}/${tsRows.length}] 处理参数: ${tsparmcd}`);
      
      // 选择输入文本
      const inputText = sources[protocolSource];
      if (!inputText || inputText.trim() === '') {
        console.warn(`⚠️  [Row ${rowNum}] 跳过（来源文本为空）: ${protocolSource}`);
        skippedCount++;
        sendEvent('progress', {
          current: rowIdx + 1,
          total: tsRows.length,
          parmcd: tsparmcd,
          status: 'skipped',
          reason: `来源文本为空: ${protocolSource}`
        });
        continue;
      }
      
      // 查询CDISC术语items（如果有）
      let codelistItems = null;
      if (codelist && codelist.trim() !== '' && !['ISO 8601', 'ISO 3166'].includes(codelist.trim().toUpperCase())) {
        const codelistName = getCodelistNameFromShortCode(codelist);
        if (codelistName) {
          try {
            const referencesDbLocal = Study.db.db.client.db('References');
            const doc = await referencesDbLocal.collection('sdtm_terminology').findOne({
              'File_Function': 'CDISC',
              'codelist.name': codelistName
            });
            if (doc && doc.items) {
              codelistItems = doc.items;
            }
          } catch (err) {
            console.warn(`   ⚠️ 查询codelist失败: ${err.message}`);
          }
        }
      }
      
      // 构造Prompt
      const prompt = buildTSPrompt({
        studyNumber,
        tsparmcd,
        tsparm,
        inputText: inputText.substring(0, 4000),
        codelist,
        multipleRecord: multiple,
        codelistItems
      });
      
      // 调用OpenAI
      try {
        console.log(`   🤖 调用OpenAI...`);
        const completion = await openai.chat.completions.create({
          model: 'gpt-4o',
          messages: [
            {
              role: 'system',
              content: 'You are an expert statistical programmer specialized in CDISC SDTM standards. You always output valid JSON without code fences or commentary.'
            },
            {
              role: 'user',
              content: prompt
            }
          ],
          temperature: 0.3,
          max_tokens: 2000
        });
        
        const aiResponse = completion.choices[0]?.message?.content?.trim() || '';
        console.log(`   ✅ AI响应接收，长度: ${aiResponse.length} 字符`);
        
        // 解析JSON
        let cleanedResponse = aiResponse.replace(/```json\s*/g, '').replace(/```\s*/g, '').trim();
        let aiRecords = JSON.parse(cleanedResponse);
        
        if (!Array.isArray(aiRecords)) {
          aiRecords = [aiRecords];
        }
        
        console.log(`   ✅ 解析成功，AI生成 ${aiRecords.length} 条记录`);
        
        // 归一化 + 受控术语映射
        const normalized = await normalizeAIRecordsWithTerminology(aiRecords, {
          studyNumber,
          rowCodelist: codelist,
          tsparmcd,
          protocolSource,  // 🔥 传递Protocol来源
          tsparm           // 🔥 传递TSPARM名称
        });
        
        console.log(`   ✅ 归一化完成，最终 ${normalized.length} 条记录`);
        
        if (normalized.length > 0) {
          processedCount++;
          
          // 🔥 发送progress事件（含生成的记录）
          sendEvent('progress', {
            current: rowIdx + 1,
            total: tsRows.length,
            parmcd: tsparmcd,
            status: 'success',
            rows: normalized,
            processed: processedCount,
            skipped: skippedCount,
            errors: errorCount
          });
        } else {
          console.warn(`   ⚠️ 归一化后无有效记录`);
          skippedCount++;
          sendEvent('progress', {
            current: rowIdx + 1,
            total: tsRows.length,
            parmcd: tsparmcd,
            status: 'skipped',
            reason: '归一化后无有效记录'
          });
        }
        
      } catch (error) {
        console.error(`   ❌ 处理失败: ${error.message}`);
        errorCount++;
        sendEvent('progress', {
          current: rowIdx + 1,
          total: tsRows.length,
          parmcd: tsparmcd,
          status: 'error',
          error: error.message
        });
      }
    }
    
    // ========== 步骤4: 发送完成事件 ==========
    console.log(`\n✅ [Backend SSE] TS_Details流式生成完成`);
    console.log(`📊 统计: 总计${tsRows.length}行, 成功${processedCount}条, 跳过${skippedCount}条, 失败${errorCount}条`);
    
    sendEvent('done', {
      total: tsRows.length,
      processed: processedCount,
      skipped: skippedCount,
      errors: errorCount,
      message: '所有参数处理完成'
    });
    
    // 🔥 延迟关闭连接，确保done事件完全发送到客户端
    setTimeout(() => {
      res.end();
      console.log('✅ [Backend SSE] 连接已关闭');
    }, 1000);
    
  } catch (error) {
    console.error('❌ [Backend SSE] 流式生成失败:', error);
    try {
      res.write(`event: error\n`);
      res.write(`data: ${JSON.stringify({ message: error.message })}\n\n`);
      res.end();
    } catch (_) {
      res.end();
    }
  }
}

/**
 * 生成TS_Details数据（旧版：一次性返回，保留用于兼容）
 * @param {Object} req - Express请求对象
 * @param {Object} res - Express响应对象
 */
async function generateTSDetailsData(req, res) {
  try {
    const { studyId } = req.params;
    console.log(`🚀 [Backend] 开始生成TS_Details数据（新版逐行驱动），studyId: ${studyId}`);
    console.log(`📊 [Backend] API端点调用: POST /api/studies/${studyId}/generate-ts-details`);
    
    // ========== 步骤1: 读取References.TS（参考表） ==========
    console.log(`\n📋 [Step 1] 读取References.TS参考表...`);
    // 🔥 切换到References数据库
    const referencesDb = Study.db.db.client.db('References');
    const tsReferenceDoc = await referencesDb.collection('TS').findOne();
    
    if (!tsReferenceDoc || !tsReferenceDoc.data || !Array.isArray(tsReferenceDoc.data)) {
      console.error(`❌ [Backend] References.TS数据不存在或格式错误`);
      return res.status(404).json({
        success: false,
        message: 'References.TS参考表不存在，请先导入TS_example.xlsx'
      });
    }
    
    const tsColumns = tsReferenceDoc.columns || [];
    const tsData = tsReferenceDoc.data || [];
    
    console.log(`✅ [Step 1] References.TS读取成功`);
    console.log(`   📊 总行数: ${tsData.length}`);
    console.log(`   📋 列名: ${tsColumns.slice(0, 8).join(', ')}...`);
    
    // 🔥 data已经是对象数组，无需转换（Python导入时已处理）
    const tsRows = tsData;
    
    // 输出前2条数据验证
    if (tsRows.length > 1) {
      console.log(`   📋 数据示例 [0]: AI=${tsRows[0].AI}, TSPARMCD=${tsRows[0].TSPARMCD}`);
      console.log(`   📋 数据示例 [1]: AI=${tsRows[1].AI}, Protocol=${tsRows[1].Protocol}, TSPARMCD=${tsRows[1].TSPARMCD}`);
    }
    
    // ========== 步骤2: 提取Protocol文本源 ==========
    console.log(`\n📋 [Step 2] 提取Protocol文本源...`);
    const study = await Study.findById(studyId)
      .select('studyNumber files.protocol.uploadExtraction Spec.first_version.Study')
      .lean();
    
    if (!study) {
      console.error(`❌ [Backend] Study不存在，studyId: ${studyId}`);
      return res.status(404).json({
        success: false,
        message: 'Study不存在'
      });
    }
    
    const studyNumber = study.studyNumber || 'UNKNOWN';
    console.log(`✅ [Step 2] Study找到，studyNumber: ${studyNumber}`);
    
    // 提取四个文本源
    const extraction = study.files?.protocol?.uploadExtraction || {};
    const sectionedText = extraction.sectionedText || [];
    
    const sources = {
      'Cover Page': sectionedText[0]?.content || '',
      'Study Design': extraction.studyDesign ? JSON.stringify(extraction.studyDesign) : '',
      'Endpoints': extraction.endpoints ? JSON.stringify(extraction.endpoints) : '',
      'Spec': study.Spec?.first_version?.Study ? JSON.stringify(study.Spec.first_version.Study) : ''
    };
    
    // 输出文本源状态
    Object.keys(sources).forEach(key => {
      const length = sources[key]?.length || 0;
      const status = length > 0 ? '✅' : '⚠️';
      console.log(`   ${status} ${key}: ${length} 字符`);
    });
    
    if (!sources['Cover Page']) {
      console.warn(`⚠️ [Backend] Cover Page为空，部分参数可能无法生成`);
    }
    
    // ========== 步骤3: 逐行处理（串行） ==========
    console.log(`\n📋 [Step 3] 开始逐行处理TS参数...`);
    
    const allResults = [];
    let processedCount = 0;
    let skippedCount = 0;
    let errorCount = 0;
    
    for (let rowIdx = 0; rowIdx < tsRows.length; rowIdx++) {
      const row = tsRows[rowIdx];
      const rowNum = rowIdx + 1;
      
      // 检查AI列
      const aiFlag = parseInt(row.AI) || 0;
      if (aiFlag !== 1) {
        console.log(`⏭️  [Row ${rowNum}] 跳过（AI=0）: ${row.TSPARMCD}`);
        skippedCount++;
        continue;
      }
      
      // 获取参数信息
      const tsparmcd = row.TSPARMCD || '';
      const tsparm = row.TSPARM || '';
      const protocolSource = row.Protocol || '';
      const codelist = row.Codelist || '';
      const multiple = parseInt(row.Multiple) || 0;
      
      if (!tsparmcd || !protocolSource) {
        console.log(`⏭️  [Row ${rowNum}] 跳过（参数不完整）`);
        skippedCount++;
        continue;
      }
      
      console.log(`\n🔄 [Row ${rowNum}/${tsRows.length}] 处理参数: ${tsparmcd}`);
      console.log(`   Protocol来源: ${protocolSource}`);
      console.log(`   Codelist: ${codelist || 'null'}`);
      console.log(`   Multiple: ${multiple === 1 ? 'Yes' : 'No'}`);
      
      // 选择输入文本
      const inputText = sources[protocolSource];
      if (!inputText || inputText.trim() === '') {
        console.warn(`⚠️  [Row ${rowNum}] 跳过（来源文本为空）: ${protocolSource}`);
        skippedCount++;
        continue;
      }
      
      console.log(`   输入文本长度: ${inputText.length} 字符`);
      
      // 查询CDISC术语items（如果有）
      let codelistItems = null;
      if (codelist && codelist.trim() !== '' && !['ISO 8601', 'ISO 3166'].includes(codelist.trim().toUpperCase())) {
        const codelistName = getCodelistNameFromShortCode(codelist);
        if (codelistName) {
          try {
            // 🔥 切换到References数据库
            const referencesDbLocal = Study.db.db.client.db('References');
            const doc = await referencesDbLocal.collection('sdtm_terminology').findOne({
              'File_Function': 'CDISC',
              'codelist.name': codelistName
            });
            if (doc && doc.items) {
              codelistItems = doc.items;
              console.log(`   ✅ 查询到codelist items: ${codelistItems.length} 项`);
            }
          } catch (err) {
            console.warn(`   ⚠️ 查询codelist失败: ${err.message}`);
          }
        }
      }
      
      // 构造Prompt
      const prompt = buildTSPrompt({
        studyNumber,
        tsparmcd,
        tsparm,
        inputText: inputText.substring(0, 4000), // 限制长度避免token超限
        codelist,
        multipleRecord: multiple,
        codelistItems
      });
      
      console.log(`   📝 Prompt长度: ${prompt.length} 字符`);
      
      // 调用OpenAI
      try {
        console.log(`   🤖 调用OpenAI...`);
        const completion = await openai.chat.completions.create({
          model: 'gpt-4o',
          messages: [
            {
              role: 'system',
              content: 'You are an expert statistical programmer specialized in CDISC SDTM standards. You always output valid JSON without code fences or commentary.'
            },
            {
              role: 'user',
              content: prompt
            }
          ],
          temperature: 0.3,
          max_tokens: 2000
        });
        
        const aiResponse = completion.choices[0]?.message?.content?.trim() || '';
        console.log(`   ✅ AI响应接收，长度: ${aiResponse.length} 字符`);
        
        // 解析JSON
        let cleanedResponse = aiResponse.replace(/```json\s*/g, '').replace(/```\s*/g, '').trim();
        let aiRecords = JSON.parse(cleanedResponse);
        
        if (!Array.isArray(aiRecords)) {
          aiRecords = [aiRecords];
        }
        
        console.log(`   ✅ 解析成功，AI生成 ${aiRecords.length} 条记录`);
        
        // 归一化 + 受控术语映射
        const normalized = await normalizeAIRecordsWithTerminology(aiRecords, {
          studyNumber,
          rowCodelist: codelist,
          tsparmcd,
          protocolSource,  // 🔥 传递Protocol来源
          tsparm           // 🔥 传递TSPARM名称
        });
        
        console.log(`   ✅ 归一化完成，最终 ${normalized.length} 条记录`);
        
        if (normalized.length > 0) {
          allResults.push(...normalized);
          processedCount++;
        } else {
          console.warn(`   ⚠️ 归一化后无有效记录`);
          skippedCount++;
        }
        
      } catch (error) {
        console.error(`   ❌ 处理失败: ${error.message}`);
        errorCount++;
      }
    }
    
    // ========== 步骤4: 最终规范化TSSEQ ==========
    console.log(`\n📋 [Step 4] 最终规范化TSSEQ...`);
    const tsparmcdGroups = {};
    allResults.forEach(record => {
      const parmcd = record.TSPARMCD;
      if (!tsparmcdGroups[parmcd]) {
        tsparmcdGroups[parmcd] = [];
      }
      tsparmcdGroups[parmcd].push(record);
    });
    
    Object.keys(tsparmcdGroups).forEach(parmcd => {
      tsparmcdGroups[parmcd].forEach((record, index) => {
        record.TSSEQ = String(index + 1);
      });
    });
    
    console.log(`✅ [Step 4] TSSEQ规范化完成`);
    
    // ========== 步骤5: 统计与返回 ==========
    console.log(`\n📊 [汇总统计]`);
    console.log(`   总行数: ${tsRows.length}`);
    console.log(`   ✅ 处理成功: ${processedCount}`);
    console.log(`   ⏭️  跳过: ${skippedCount}`);
    console.log(`   ❌ 失败: ${errorCount}`);
    console.log(`   📋 生成记录总数: ${allResults.length}`);
    
    // 参数统计
    const paramStats = {};
    allResults.forEach(record => {
      const parmcd = record.TSPARMCD;
      paramStats[parmcd] = (paramStats[parmcd] || 0) + 1;
    });
    console.log(`   📊 各参数统计:`, paramStats);
    
    console.log(`\n✅ [Backend] TS_Details数据生成完成，总计 ${allResults.length} 条记录`);
    
    res.json({
      success: true,
      data: {
        tsData: allResults,
        totalRecords: allResults.length,
        studyNumber: studyNumber
      }
    });
    
  } catch (error) {
    console.error('❌ [Backend] 生成TS_Details数据失败:', error);
    console.error('📋 [Backend] 错误详情:', {
      message: error.message,
      stack: error.stack?.split('\n').slice(0, 5).join('\n'),
      studyId: req.params.studyId
    });
    res.status(500).json({
      success: false,
      message: error.message || 'TS数据生成失败'
    });
  }
}

/**
 * 保存TS_Details数据到数据库
 * @param {Object} req - Express请求对象
 * @param {Object} res - Express响应对象
 */
async function saveSpecTSDetailsData(req, res) {
  try {
    const { studyId } = req.params;
    const { tsData } = req.body;
    
    console.log(`💾 [Backend] 开始保存TS_Details数据`);
    console.log(`📊 [Backend] studyId: ${studyId}, 记录数: ${tsData?.length || 0}`);
    
    if (!Array.isArray(tsData)) {
      return res.status(400).json({
        success: false,
        message: 'tsData必须是数组格式'
      });
    }
    
    // 查找Study
    const study = await Study.findById(studyId);
    
    if (!study) {
      return res.status(404).json({
        success: false,
        message: 'Study不存在'
      });
    }
    
    // 初始化Spec结构（如果不存在）
    if (!study.Spec) {
      study.Spec = { first_version: {} };
    }
    if (!study.Spec.first_version) {
      study.Spec.first_version = {};
    }
    if (!study.Spec.first_version.TS_Data) {
      study.Spec.first_version.TS_Data = {
        table_title: [],
        table_content: [],
        status: 'false'
      };
    }
    
    console.log(`🔧 [Backend] 初始化TS_Data结构`);
    
    // 设置table_title
    study.Spec.first_version.TS_Data.table_title = TS_TABLE_HEADERS;
    console.log(`📋 [Backend] table_title设置: ${TS_TABLE_HEADERS.join(', ')}`);
    
    // 🔥 防御性过滤 - 至少要有TSPARMCD和（TSVAL或TSVALCD或TSVALNF）有值
    const hasValue = (value) => value !== null && value !== undefined && String(value).trim() !== '';
    
    const filteredTsData = tsData.filter(record => {
      return hasValue(record.TSPARMCD) && (hasValue(record.TSVAL) || hasValue(record.TSVALCD) || hasValue(record.TSVALNF));
    });
    
    console.log(`🔍 [Backend] 数据过滤: ${tsData.length} 条 → ${filteredTsData.length} 条 (跳过 ${tsData.length - filteredTsData.length} 个无效记录)`);
    
    // 替换全部数据
    study.Spec.first_version.TS_Data.table_content = filteredTsData;
    study.Spec.first_version.TS_Data.updated_at = new Date();
    study.Spec.first_version.TS_Data.status = 'created';
    
    console.log(`✅ [Backend] TS_Data数据已设置，总计 ${filteredTsData.length} 条记录`);
    
    // 保存到数据库
    console.log(`💾 [Backend] 开始保存到MongoDB...`);
    await study.save();
    console.log(`✅ [Backend] MongoDB保存成功`);
    
    // 保存后验证
    const savedStudy = await Study.findById(studyId).select('Spec.first_version.TS_Data.table_title Spec.first_version.TS_Data.table_content').lean();
    const savedTableTitle = savedStudy?.Spec?.first_version?.TS_Data?.table_title;
    const savedContentCount = savedStudy?.Spec?.first_version?.TS_Data?.table_content?.length || 0;
    
    console.log(`🔍 [Backend] 保存后验证: table_title长度=${savedTableTitle?.length || 0}, content条数=${savedContentCount}`);
    
    res.json({
      success: true,
      data: {
        totalCount: savedContentCount,
        tableTitle: savedTableTitle,
        tableTitleLength: savedTableTitle?.length || 0
      }
    });
    
  } catch (error) {
    console.error('❌ [Backend] 保存TS_Details数据失败:', error);
    console.error('📋 [Backend] 错误详情:', {
      message: error.message,
      stack: error.stack?.split('\n').slice(0, 5).join('\n'),
      studyId: req.params.studyId,
      dataSize: req.body.tsData?.length
    });
    res.status(500).json({
      success: false,
      message: error.message || 'TS数据保存失败'
    });
  }
}

module.exports = {
  generateSUPPDetailsData,
  saveSpecSUPPDetailsData,
  generateTESTCDDetailsData,
  saveSpecTESTCDDetailsData,
  generateTADetailsData,
  saveSpecTADetailsData,
  generateTEDetailsData,
  saveSpecTEDetailsData,
  generateTIDetailsData,
  saveSpecTIDetailsData,
  generateTSDetailsData,
  generateTSDetailsDataStream, // 🔥 新增：SSE流式生成
  saveSpecTSDetailsData
};
