/**
 * SDTM Mapping Service
 * 功能：使用GPT-4识别CRF问题到SDTM域的映射
 * Author: LLX Solutions
 */

const { getChatCompletion } = require('../openaiService');

/**
 * 为单个Form生成SDTM域映射
 * @param {string} formTitle - Form标题，如 "VISIT INFORMATION"
 * @param {Array} mappingList - [{index: 1, label_row: "Site Number"}, ...]
 * @returns {Promise<Object>} {1: "DM", 2: "DM", ...} 或 {}
 */
async function generateSdtmMapping(formTitle, mappingList) {
  try {
    console.log(`🧠 开始为Form "${formTitle}" 生成SDTM映射...`);
    console.log(`📋 问题数量: ${mappingList.length}`);

    // 1. 数据校验
    if (!Array.isArray(mappingList) || mappingList.length === 0) {
      console.warn('⚠️ mappingList为空，跳过SDTM映射');
      return {};
    }

    // 2. 构造输入数据结构：{formTitle: {index: question_text}}
    const validQuestions = mappingList.filter(item => item.index && item.label_row);
    
    if (validQuestions.length === 0) {
      console.warn('⚠️ 没有有效的问题文本，跳过SDTM映射');
      return {};
    }

    // 构造新的输入JSON格式
    const inputJsonObj = {
      [formTitle]: Object.fromEntries(
        validQuestions.map(item => [String(item.index), item.label_row])
      )
    };

    // 🟦 调试：打印输入给GPT的数据结构
    console.log('🟦 GPT 输入数据结构 >>>');
    console.dir(inputJsonObj, { depth: null, colors: true });

    // 提取实际的index列表用于prompt中的示例
    const actualIndices = validQuestions
      .map(item => item.index)
      .sort((a, b) => a - b);
    
    const prompt = `You are an SDTM (Study Data Tabulation Model) expert with deep knowledge of CDISC standards.

### INPUT
I will give you ONE JSON object that contains the questions from a single CRF form in the following shape:

{
  "<FORM_NAME>": {
    "<index 1>": "<question text 1>",
    "<index 2>": "<question text 2>",
    ...
  }
}

• The keys inside the inner object are the EXACT question indices shown on the CRF (they are NOT sequential in some cases – keep them as-is).
• The values are the literal wording of the CRF question / field label.
• You MUST preserve every index that appears in the input – do not drop, renumber or merge them.

### TASK
For every question index, determine the appropriate SDTM mapping according to the rules below and return a JSON object whose TOP-LEVEL KEYS ARE THE SAME INDICES.
Each index maps to ONE OR MORE annotation blocks. Each block has the shape:

{
  "<SDTM DOMAIN CODE> (<SDTM DOMAIN LABEL>)": "<VARIABLE / QNAM / [NOT SUBMITTED] / WHEN-THEN EXPRESSION>"
}

If a single question maps to multiple domains or multiple variables, output multiple blocks, **separated by semicolons ";"** for that index.

### MAPPING RULES
1. **Questions from one Single form could be mapped to multiple SDTM domains. One single question can also be mapped to multiple SDTM domains if applicable.**
2. **The domain mapping should be in the EXACT format of "<domain name> (<domain label>)" example: DM (Demographics).**
3. **For the question mapped to standard variables in main domain, ONLY give me the variable name.**
4. **If you think the question cannot be mapped to main domain, please think twice, if you still cannot find the variables in main domain, it can be mapped to supplemental qualifier domain (SUPP--), annotate to QNAM in the EXACT format of "<QNAM> in <SUPP-->" (e.g., "RACEOTH in SUPPDM"), the QNAM length must be equal or less than 8 characters.**
5. **Variables and dataset codes MUST be capitalized.**
6. **Instruction text and comments should be sentence case, excluding variables and dataset.**
7. **When multiple variables are annotated within the same annotation, use the forward slash "/" to separate the variables.**
8. **Annotations for collected data which will not be in the SDTM domain (e.g., prompt questions, database system questions) should be annotated as "[NOT SUBMITTED]".**
9. **When referencing an explicit value pertaining to a variable annotation, DO NOT USE the quotes (e.g., expressed as DSCAT = PROTOCOL MILESTONE instead of DSCAT = "PROTOCOL MILESTONE").**
10. **For the SDTM findings domains, when constructing a when/then annotation statement, use the format of "<variable> when <variable>=<value>" (e.g., expressed as VSORRES when VSTESTCD = TEMP). Try the best to find if the --TESTCD can be aligned with the CDISC Controlled Terminology, if not, customized it with length equal or less than 8 characters.**
11. **When a form indicates a relationship between collected data, the annotations should indicate the collection as well as the RELREC relationship. Use the convention "RELREC when <collected variable> = <related domain variable>" to indicate that relationship.**
12. **When meet the questions similar to "Other, Specify", please check the previous question to find the type of variables it mapped to, if it is topic variable, then map the current "Other" question to the same variable as previous; if it is result qualifier variable, then map the current "Other" question to the same variable as previous; if it is non-result qualifier variable, then map the current "Other" question to supplemental qualifier domain.**

### OUTPUT FORMAT (STRICT)
Return ONLY a JSON object that mirrors this template:

{
  "1": {
    "DM (Demographics)": "USUBJID"
  },
  "2": {
    "VS (Vital Signs)": "VSTESTCD / VSORRES"
  },
  "3": {
    "CM (Concomitant Meds)": "CMTRT";
    "CM (Concomitant Meds)": "CMDOSFRQ"
  },
  "5": {
    "RACEOTH in SUPPDM": "[FREE TEXT]"
  },
  "6": {
    "[NOT SUBMITTED]": "[NOT SUBMITTED]"
  }
}

• **Top-level keys** = original indices (${actualIndices.join(', ')}).
• Within each index, use **one or more blocks** separated by semicolons if needed.
• No additional keys, commentary, markdown or prose outside the JSON.

INPUT:
\`\`\`json
${JSON.stringify(inputJsonObj, null, 2)}
\`\`\``;

    console.log('📤 发送GPT请求...');
    
    // 3. 调用GPT
    const dynamicMaxTokens = Math.max(1000, mappingList.length * 40);
    console.log(`🔧 动态设置max_tokens: ${dynamicMaxTokens} (基于${mappingList.length}个问题)`);
    
    const gptResponse = await getChatCompletion([
      {
        role: 'user',
        content: prompt
      }
    ], {
      temperature: 0.2, // 低温度确保一致性
      max_tokens: dynamicMaxTokens,
      model: 'gpt-4' // 确保使用GPT-4
    });

    // 🟥 调试：打印GPT原始输出
    console.log('🟥 GPT 原始输出 <<<');
    console.log(gptResponse);
    console.log('🟥 GPT 输出结束 <<<');

    // 4. 解析GPT响应
    const mapping = parseGptResponseNew(gptResponse, validQuestions);
    
    console.log('✅ SDTM映射生成完成');
    console.log('🎯 映射结果:', mapping);
    
    return mapping;

  } catch (error) {
    console.error('❌ SDTM映射生成失败:', error);
    // 返回空对象，让调用方决定如何处理
    return {};
  }
}

/**
 * 新版解析GPT响应，提取SDTM映射
 * 处理新格式：{index: {domain(label): variable}} 并生成结构化映射
 * @param {string} gptResponse - GPT原始响应
 * @param {Array} validQuestions - 有效问题列表 [{index, label_row}, ...]
 * @returns {Object} 映射对象 {index: {sdtm_dataset_ai_result: string, sdtm_mappings: array}}
 */
function parseGptResponseNew(gptResponse, validQuestions) {
  try {
    console.log('🔍 开始解析新格式GPT响应...');
    
    // 1. 提取JSON部分
    let jsonText = gptResponse.trim();
    
    // 移除markdown代码块标记
    jsonText = jsonText.replace(/```json/g, '').replace(/```/g, '');
    
    // 尝试找到JSON块
    const jsonMatch = jsonText.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      jsonText = jsonMatch[0];
    }

    // 2. 解析JSON
    const rawMapping = JSON.parse(jsonText);
    console.log('🔍 解析的原始新格式映射:', JSON.stringify(rawMapping, null, 2));

    // 3. 数据清洗和验证
    const cleanMapping = {};
    const originalIndices = new Set(validQuestions.map(item => item.index));

    for (const [indexKey, mappingObj] of Object.entries(rawMapping)) {
      const index = parseInt(indexKey);
      
      // 验证index是否在原始列表中
      if (!originalIndices.has(index)) {
        console.warn(`⚠️ GPT返回了不存在的index: ${index}`);
        continue;
      }

      // 处理映射对象并生成结构化数据
      if (typeof mappingObj === 'object' && mappingObj !== null) {
        const structuredMappings = convertToStructuredMappings(mappingObj);
        const compatibilityString = generateCompatibilityString(structuredMappings);
        
        cleanMapping[index] = {
          sdtm_dataset_ai_result: compatibilityString,  // 兼容字段
          sdtm_mappings: structuredMappings              // 新结构化字段
        };
      } else if (typeof mappingObj === 'string') {
        // 旧格式兼容
        const fallbackMapping = [{
          domain_code: mappingObj.trim().toUpperCase(),
          domain_label: null,
          variable: null,
          mapping_type: "standard"
        }];
        
        cleanMapping[index] = {
          sdtm_dataset_ai_result: mappingObj.trim().toUpperCase(),
          sdtm_mappings: fallbackMapping
        };
      } else {
        console.warn(`⚠️ Index ${index} 的映射格式无效:`, mappingObj);
        cleanMapping[index] = {
          sdtm_dataset_ai_result: null,
          sdtm_mappings: []
        };
      }
    }

    // 4. 检查遗漏的index
    const mappedIndices = new Set(Object.keys(cleanMapping).map(k => parseInt(k)));
    const missingIndices = Array.from(originalIndices).filter(idx => !mappedIndices.has(idx));
    
    if (missingIndices.length > 0) {
      console.warn(`⚠️ 以下index未获得SDTM映射: ${missingIndices.join(', ')}`);
      // 为遗漏的index设置为null
      missingIndices.forEach(idx => {
        cleanMapping[idx] = {
          sdtm_dataset_ai_result: null,
          sdtm_mappings: []
        };
      });
    }

    console.log('✅ 新格式映射解析完成:', cleanMapping);
    return cleanMapping;

  } catch (parseError) {
    console.error('❌ 解析新格式GPT响应失败:', parseError);
    console.error('📄 原始响应:', gptResponse);
    
    // 返回空映射，但为所有index设置null
    const fallbackMapping = {};
    validQuestions.forEach(item => {
      if (item.index) {
        fallbackMapping[item.index] = {
          sdtm_dataset_ai_result: null,
          sdtm_mappings: []
        };
      }
    });
    
    return fallbackMapping;
  }
}

/**
 * 将GPT响应的映射对象转换为结构化映射数组
 * @param {Object} mappingObj - GPT返回的映射对象，格式：{domain(label): variable}
 * @returns {Array} 结构化映射数组
 */
function convertToStructuredMappings(mappingObj) {
  const structuredMappings = [];
  
  for (const [domainLabel, variable] of Object.entries(mappingObj)) {
    const mapping = parseDomainLabel(domainLabel, variable);
    if (mapping) {
      structuredMappings.push(mapping);
    }
  }
  
  return structuredMappings;
}

/**
 * 解析域标签和变量，生成结构化映射对象
 * @param {string} domainLabel - 域标签，格式："DM (Demographics)" 或 "[NOT SUBMITTED]"
 * @param {string} variable - 变量名或特殊值
 * @returns {Object|null} 结构化映射对象
 */
function parseDomainLabel(domainLabel, variable) {
  try {
    // 处理 [NOT SUBMITTED] 情况
    if (domainLabel.includes('[NOT SUBMITTED]')) {
      return {
        domain_code: null,
        domain_label: null,
        variable: "[NOT SUBMITTED]",
        mapping_type: "not_submitted"
      };
    }
    
    // 处理 SUPP 域情况：格式 "RACEOTH in SUPPDM"
    // 🔥 修復：檢查 domainLabel 而不是 variable
    if (domainLabel && domainLabel.includes(' in SUPP')) {
      const parts = domainLabel.split(' in ');
      const qnam = parts[0]?.trim();
      const suppDomain = parts[1]?.trim(); // SUPPDM
      
      console.log(`🔧 [GPT解析] SUPP域检测成功: "${domainLabel}" → QNAM="${qnam}", Domain="${suppDomain}"`);
      
      return {
        domain_code: suppDomain,
        domain_label: `Supplemental ${suppDomain.replace('SUPP', '')}`,
        variable: qnam,
        mapping_type: "supp"
      };
    }
    
    // 处理标准域情况：格式 "DM (Demographics)"
    const domainMatch = domainLabel.match(/^([A-Z]+)\s*\(([^)]+)\)$/);
    if (domainMatch) {
      const [, domainCode, domainLabelText] = domainMatch;
      
      return {
        domain_code: domainCode,
        domain_label: domainLabelText,
        variable: variable || null,
        mapping_type: "standard"
      };
    }
    
    // 如果解析失败，返回基础格式
    console.warn(`⚠️ 无法解析域标签: "${domainLabel}"`);
    return {
      domain_code: domainLabel,
      domain_label: null,
      variable: variable || null,
      mapping_type: "standard"
    };
    
  } catch (error) {
    console.error(`❌ 解析域标签失败: "${domainLabel}"`, error);
    return null;
  }
}

/**
 * 根据结构化映射数组生成兼容性字符串
 * @param {Array} structuredMappings - 结构化映射数组
 * @returns {string} 兼容性字符串，用于sdtm_dataset_ai_result字段
 */
function generateCompatibilityString(structuredMappings) {
  if (!Array.isArray(structuredMappings) || structuredMappings.length === 0) {
    return null;
  }
  
  const mappingStrings = structuredMappings.map(mapping => {
    if (mapping.mapping_type === 'not_submitted') {
      return '[NOT SUBMITTED]: [NOT SUBMITTED]';
    } else if (mapping.mapping_type === 'supp') {
      return `${mapping.variable} in ${mapping.domain_code}`;
    } else {
      // 标准格式
      const domainPart = mapping.domain_label 
        ? `${mapping.domain_code} (${mapping.domain_label})`
        : mapping.domain_code;
      return `${domainPart}: ${mapping.variable || ''}`;
    }
  });
  
  return mappingStrings.join('; ');
}

/**
 * 旧版解析GPT响应，提取SDTM映射（保留兼容性）
 * @param {string} gptResponse - GPT原始响应
 * @param {Array} originalList - 原始问题列表
 * @returns {Object} 清洗后的映射对象
 */
function parseGptResponse(gptResponse, originalList) {
  try {
    // 1. 提取JSON部分
    let jsonText = gptResponse.trim();
    
    // 尝试找到JSON块
    const jsonMatch = jsonText.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      jsonText = jsonMatch[0];
    }

    // 2. 解析JSON
    const rawMapping = JSON.parse(jsonText);
    console.log('🔍 解析的原始映射:', rawMapping);

    // 3. 数据清洗和验证
    const cleanMapping = {};
    const originalIndices = new Set(originalList.map(item => item.index));

    for (const [key, value] of Object.entries(rawMapping)) {
      const index = parseInt(key);
      
      // 验证index是否在原始列表中
      if (originalIndices.has(index)) {
        // 清洗域名：转大写，去空格
        const cleanDomain = String(value).trim().toUpperCase();
        if (cleanDomain && cleanDomain !== 'NULL') {
          cleanMapping[index] = cleanDomain;
        }
      } else {
        console.warn(`⚠️ GPT返回了不存在的index: ${index}`);
      }
    }

    // 4. 检查遗漏的index
    const mappedIndices = new Set(Object.keys(cleanMapping).map(k => parseInt(k)));
    const missingIndices = Array.from(originalIndices).filter(idx => !mappedIndices.has(idx));
    
    if (missingIndices.length > 0) {
      console.warn(`⚠️ 以下index未获得SDTM映射: ${missingIndices.join(', ')}`);
      // 为遗漏的index设置为null，让调用方知道
      missingIndices.forEach(idx => {
        cleanMapping[idx] = null;
      });
    }

    return cleanMapping;

  } catch (parseError) {
    console.error('❌ 解析GPT响应失败:', parseError);
    console.error('📄 原始响应:', gptResponse);
    
    // 返回空映射，但为所有index设置null
    const fallbackMapping = {};
    originalList.forEach(item => {
      if (item.index) {
        fallbackMapping[item.index] = null;
      }
    });
    
    return fallbackMapping;
  }
}

/**
 * 为Study中的所有Forms生成SDTM映射
 * @param {Object} crfFormList - crfFormList对象
 * @returns {Promise<Object>} 更新后的crfFormList
 */
async function generateSdtmMappingForAllForms(crfFormList, progressHook) {
  try {
    console.log('🚀 开始为所有Forms生成SDTM映射...');
    
    if (!crfFormList || typeof crfFormList !== 'object') {
      console.warn('⚠️ crfFormList无效，跳过SDTM映射');
      return crfFormList;
    }

    const formKeys = Object.keys(crfFormList);
    console.log(`📊 总共 ${formKeys.length} 个Forms需要处理`);

    // 🔥 **批量处理配置**
    const BATCH_SIZE = 12; // 每批处理12个Forms
    const batches = [];
    
    // 将Forms分批
    for (let i = 0; i < formKeys.length; i += BATCH_SIZE) {
      batches.push(formKeys.slice(i, i + BATCH_SIZE));
    }
    
    console.log(`🔧 分为 ${batches.length} 批处理，每批最多 ${BATCH_SIZE} 个Forms`);

    // 逐批处理
    for (let batchIndex = 0; batchIndex < batches.length; batchIndex++) {
      const currentBatch = batches[batchIndex];
      console.log(`📦 开始处理第 ${batchIndex + 1}/${batches.length} 批 (${currentBatch.length} 个Forms)`);
      
      const batchStartTime = Date.now();
      
      // 处理当前批次的所有Forms
      for (const formKey of currentBatch) {
        const form = crfFormList[formKey];
        
        if (!form || !Array.isArray(form.Mapping)) {
          console.warn(`⚠️ Form "${formKey}" 没有有效的Mapping数组，跳过`);
          continue;
        }

        console.log(`🔍 处理Form: "${form.title || formKey}" (${form.Mapping.length}个问题)`);

        // 构造映射列表
        const mappingList = form.Mapping.map(item => ({
          index: item.index,
          label_row: item.label_row
        }));

        // 调用GPT生成映射
        const sdtmMapping = await generateSdtmMapping(form.title || formKey, mappingList);

        // 将结果写回Mapping数组
        form.Mapping.forEach(item => {
          const index = item.index;
          if (index in sdtmMapping) {
            const mappingResult = sdtmMapping[index];
            
            // 写入兼容字段
            item.sdtm_dataset_ai_result = mappingResult.sdtm_dataset_ai_result;
            
            // 写入新的结构化字段
            item.sdtm_mappings = mappingResult.sdtm_mappings;
            
            console.log(`  ✅ Index ${index} 映射已写入:`, {
              compatibility: item.sdtm_dataset_ai_result,
              structured: item.sdtm_mappings
            });
          } else {
            // 没有映射结果的情况
            item.sdtm_dataset_ai_result = null;
            item.sdtm_mappings = [];
          }
        });

        // 🆕 生成Form的唯一SDTM域列表
        form.form_sdtm_mapping_unique = extractUniqueDomainsFromForm(form);

        console.log(`✅ Form "${form.title || formKey}" SDTM映射完成`);

        // 进度回调（每处理一个Form触发）
        if (typeof progressHook === 'function') {
          try { progressHook({ type: 'gpt_form_done' }); } catch (_) {}
        }
      }
      
      const batchTime = Date.now() - batchStartTime;
      console.log(`🎯 第 ${batchIndex + 1} 批处理完成，耗时: ${Math.round(batchTime / 1000)}秒`);
      
      // 批次间短暂休息，避免API过载
      if (batchIndex < batches.length - 1) {
        console.log(`⏸️  批次间休息 2 秒...`);
        await new Promise(resolve => setTimeout(resolve, 2000));
      }
    }

    console.log('🎉 所有Forms的SDTM映射生成完成！');
    
    // 📊 统计所有Forms的唯一域信息
    const totalUniqueDomainsAcrossAllForms = new Set();
    let formsWithDomains = 0;
    
    Object.keys(crfFormList).forEach(formKey => {
      const form = crfFormList[formKey];
      if (Array.isArray(form.form_sdtm_mapping_unique) && form.form_sdtm_mapping_unique.length > 0) {
        formsWithDomains++;
        form.form_sdtm_mapping_unique.forEach(domain => totalUniqueDomainsAcrossAllForms.add(domain));
      }
    });
    
    console.log(`📈 统计结果: ${formsWithDomains}个Forms包含SDTM域映射，总计${totalUniqueDomainsAcrossAllForms.size}个唯一域`);
    console.log(`🎯 整个CRF涉及的SDTM域: [${[...totalUniqueDomainsAcrossAllForms].sort().join(', ')}]`);
    
    return crfFormList;

  } catch (error) {
    console.error('❌ 生成所有Forms的SDTM映射失败:', error);
    // 即使失败也返回原始数据，不影响后续流程
    return crfFormList;
  }
}

/**
 * 从Form中提取所有唯一的SDTM域信息
 * @param {Object} form - Form对象，包含Mapping数组
 * @returns {Array} 唯一的域字符串数组，格式："DM (Demographics)"
 */
function extractUniqueDomainsFromForm(form) {
  const uniqueDomains = new Set();
  
  // 遍历Form中的所有Mapping
  if (Array.isArray(form.Mapping)) {
    form.Mapping.forEach(mappingItem => {
      const { sdtm_mappings, sdtm_dataset_ai_result } = mappingItem;
      
      // 优先处理新的结构化映射
      if (Array.isArray(sdtm_mappings) && sdtm_mappings.length > 0) {
        sdtm_mappings.forEach(mapping => {
          const domainString = generateDomainStringFromMapping(mapping);
          if (domainString) {
            uniqueDomains.add(domainString);
          }
        });
      }
      // 兼容处理：从sdtm_dataset_ai_result提取域信息
      else if (sdtm_dataset_ai_result) {
        const domainStrings = extractDomainFromCompatibilityString(sdtm_dataset_ai_result);
        if (Array.isArray(domainStrings)) {
          domainStrings.forEach(domain => uniqueDomains.add(domain));
        } else if (domainStrings) {
          uniqueDomains.add(domainStrings);
        }
      }
    });
  }
  
  // 转换为排序后的数组
  const result = [...uniqueDomains].sort();
  console.log(`  📊 Form "${form.title || 'Unknown'}" 包含唯一SDTM域: [${result.join(', ')}]`);
  return result;
}

/**
 * 从单个映射对象生成域字符串
 * @param {Object} mapping - 映射对象 {domain_code, domain_label, mapping_type}
 * @returns {string|null} 域字符串或null
 */
function generateDomainStringFromMapping(mapping) {
  const { domain_code, domain_label, mapping_type } = mapping;
  
  // 🚫 跳过 not_submitted 类型
  if (mapping_type === 'not_submitted') {
    return null;
  } 
  
  // 处理SUPP域
  if (mapping_type === 'supp' && domain_code) {
    return domain_label ? `${domain_code} (${domain_label})` : domain_code;
  } 
  
  // 处理标准域
  if (domain_code) {
    return domain_label ? `${domain_code} (${domain_label})` : domain_code;
  }
  
  return null;
}

/**
 * 从兼容性字符串中提取域信息
 * @param {string} compatibilityString - sdtm_dataset_ai_result字符串
 * @returns {string|null} 域字符串或null
 */
function extractDomainFromCompatibilityString(compatibilityString) {
  // 跳过 [NOT SUBMITTED] 类型
  if (!compatibilityString || compatibilityString.includes('[NOT SUBMITTED]')) {
    return null;
  }
  
  // 处理多个映射的情况，用分号分隔
  const mappingParts = compatibilityString.split(';');
  const uniqueDomains = new Set();
  
  mappingParts.forEach(part => {
    const trimmedPart = part.trim();
    if (trimmedPart && !trimmedPart.includes('[NOT SUBMITTED]')) {
      // 提取冒号前的域部分："DM (Demographics): SITEID" -> "DM (Demographics)"
      const colonIndex = trimmedPart.indexOf(':');
      const domainPart = colonIndex > 0 ? trimmedPart.slice(0, colonIndex).trim() : trimmedPart;
      
      if (domainPart) {
        uniqueDomains.add(domainPart);
      }
    }
  });
  
  return uniqueDomains.size > 0 ? [...uniqueDomains] : null;
}

module.exports = {
  generateSdtmMapping,
  generateSdtmMappingForAllForms,
  extractUniqueDomainsFromForm
};
