/**
 * Extract Label and OID Forms from filtered_rows
 * 功能：从每个Form的filtered_rows中提取LabelForm和OIDForm
 * Author: LLX Solutions
 */

/**
 * 检查文本是否为整数
 * @param {string} text - 要检查的文本
 * @returns {boolean} 是否为整数
 */
function isInteger(text) {
  if (!text || typeof text !== 'string') return false;
  const trimmed = text.trim();
  return /^\d+$/.test(trimmed);
}

/**
 * 检查行是否包含数字
 * @param {string} text - 行文本
 * @returns {boolean} 是否包含数字
 */
function containsNumber(text) {
  return /\d/.test(text || '');
}

/**
 * 获取行的tokens（词列表）
 * @param {Object} row - 行对象
 * @returns {Array} tokens数组
 */
function getRowTokens(row) {
  if (!row) return [];
  
  // 方法1：使用row.words如果存在
  if (row.words && Array.isArray(row.words)) {
    return row.words.map(w => (w.text || '').trim()).filter(Boolean);
  }
  
  // 方法2：从full_text分割
  if (row.full_text) {
    return row.full_text.trim().split(/\s+/).filter(Boolean);
  }
  
  return [];
}

// 提取tokens中的第一个/最后一个整数（返回number或null）
function getFirstIntegerFromTokens(tokens) {
  if (!Array.isArray(tokens)) return null;
  for (let i = 0; i < tokens.length; i++) {
    const t = String(tokens[i] || '').trim();
    if (/^\d+$/.test(t)) return Number(t);
  }
  return null;
}
function getLastIntegerFromTokens(tokens) {
  if (!Array.isArray(tokens)) return null;
  for (let i = tokens.length - 1; i >= 0; i--) {
    const t = String(tokens[i] || '').trim();
    if (/^\d+$/.test(t)) return Number(t);
  }
  return null;
}

// 文本裁剪：去掉末尾整数 / 去掉开头整数
function stripTrailingInteger(text) {
  const s = String(text || '');
  return s.replace(/\s*\d+\s*$/,'').trim();
}
function stripLeadingInteger(text) {
  const s = String(text || '');
  return s.replace(/^\s*\d+\s*/,'').trim();
}

// 基于 match_index 组合 Mapping 数组
function buildMappingArray(labelArr, oidArr) {
  const labelMap = new Map();
  (labelArr || []).forEach(it => {
    if (typeof it?.match_index === 'number') {
      const text = String(it.content?.full_text || '');
      labelMap.set(it.match_index, stripTrailingInteger(text));
    }
  });
  const oidMap = new Map();
  (oidArr || []).forEach(it => {
    if (typeof it?.match_index === 'number') {
      const text = String(it.content?.full_text || '');
      oidMap.set(it.match_index, stripLeadingInteger(text));
    }
  });

  // 取并集索引，升序；缺失一侧时以 null 填充
  const indices = Array.from(new Set([ ...labelMap.keys(), ...oidMap.keys() ])).sort((a,b) => a-b);
  const mapping = indices.map(idx => ({
    index: idx,
    label_row: labelMap.has(idx) ? labelMap.get(idx) : null,
    oid_row_content: oidMap.has(idx) ? oidMap.get(idx) : null
  }));

  // 日志：缺失的索引
  const missingLabel = Array.from(oidMap.keys()).filter(k => !labelMap.has(k));
  const missingOid = Array.from(labelMap.keys()).filter(k => !oidMap.has(k));
  if (missingLabel.length) console.warn(`⚠️ OID存在但Label缺失的index: ${missingLabel.join(', ')}`);
  if (missingOid.length) console.warn(`⚠️ Label存在但OID缺失的index: ${missingOid.join(', ')}`);

  return mapping;
}

/**
 * 计算Form的坐标极值和容差
 * @param {Array} filteredRows - Form的filtered_rows
 * @returns {Object} 坐标信息和容差
 */
function calculateFormCoordinates(filteredRows) {
  if (!Array.isArray(filteredRows) || filteredRows.length === 0) {
    return null;
  }

  let x0_min = Infinity;
  let x1_max = -Infinity;
  
  // 统计所有行的x坐标范围
  filteredRows.forEach(row => {
    if (row.x_min !== undefined) x0_min = Math.min(x0_min, row.x_min);
    if (row.x_max !== undefined) x1_max = Math.max(x1_max, row.x_max);
    
    // 如果没有行级坐标，从words中计算
    if (row.words && Array.isArray(row.words)) {
      row.words.forEach(word => {
        if (word.x0 !== undefined) x0_min = Math.min(x0_min, word.x0);
        if (word.x1 !== undefined) x1_max = Math.max(x1_max, word.x1);
      });
    }
  });

  // 统一容差
  const epsilon = 8;

  console.log(`📐 Form坐标统计: x0_min=${x0_min.toFixed(1)}, x1_max=${x1_max.toFixed(1)}, epsilon=${epsilon}`);

  return {
    x0_min,
    x1_max,
    epsilon
  };
}

/**
 * 判断行是否为Label候选
 * @param {Object} row - 行对象
 * @param {Object} coords - 坐标信息
 * @returns {boolean} 是否为Label候选
 */
function isLabelCandidate(row, coords) {
  const { x0_min, x1_max, epsilon } = coords;
  
  // 获取行的x坐标
  let rowX0 = row.x_min;
  let rowX1 = row.x_max;
  
  // 如果没有行级坐标，从第一个和最后一个词计算
  if (rowX0 === undefined && row.words && row.words.length > 0) {
    rowX0 = row.words[0].x0;
    rowX1 = row.words[row.words.length - 1].x1;
  }
  
  if (rowX0 === undefined || rowX1 === undefined) return false;

  // Label：左接近x0_min，右接近x1_max
  const x0InRange = Math.abs(rowX0 - x0_min) <= epsilon;
  const x1InRange = Math.abs(rowX1 - x1_max) <= epsilon;
  
  return x0InRange && x1InRange;
}

/**
 * 判断行是否为OID候选
 * @param {Object} row - 行对象
 * @param {Object} coords - 坐标信息
 * @returns {boolean} 是否为OID候选
 */
function isOidCandidate(row, coords) {
  const { x0_min, epsilon } = coords;
  
  // 获取行的x坐标
  let rowX0 = row.x_min;
  
  // 如果没有行级坐标，从第一个词计算
  if (rowX0 === undefined && row.words && row.words.length > 0) {
    rowX0 = row.words[0].x0;
  }
  
  if (rowX0 === undefined) return false;

  // OID：只检查左边起点接近x0_min
  const x0InRange = Math.abs(rowX0 - x0_min) <= epsilon;
  
  return x0InRange;
}

/**
 * 检查Label行的文本规则
 * @param {Object} row - 行对象
 * @returns {boolean} 是否满足Label文本规则
 */
function checkLabelTextRules(row) {
  const tokens = getRowTokens(row);
  const fullText = row.full_text || '';
  
  // 1. 行最后一个token是整数
  const lastToken = tokens[tokens.length - 1];
  if (!isInteger(lastToken)) return false;
  
  // 2. 行内不含"="
  if (fullText.includes('=')) return false;
  
  // 3. 行内必须包含数字
  if (!containsNumber(fullText)) return false;
  
  return true;
}

/**
 * 检查OID行的文本规则
 * @param {Object} row - 行对象
 * @returns {boolean} 是否满足OID文本规则
 */
function checkOidTextRules(row) {
  const tokens = getRowTokens(row);
  const fullText = row.full_text || '';
  
  // 1. 行首token是整数
  const firstToken = tokens[0];
  if (!isInteger(firstToken)) return false;
  
  // 2. 行内不含"="
  if (fullText.includes('=')) return false;
  
  // 3. 行内必须包含数字
  if (!containsNumber(fullText)) return false;
  
  return true;
}

/**
 * 从单个Form提取LabelForm和OIDForm
 * @param {Object} form - Form对象，包含filtered_rows
 * @param {string} formKey - Form的键名
 * @returns {Object} 包含LabelForm和OIDForm的对象
 */
function extractLabelOidFromForm(form, formKey) {
  console.log(`🔍 处理Form "${formKey}": ${form.filtered_rows?.length || 0}行`);
  
  if (!form.filtered_rows || !Array.isArray(form.filtered_rows)) {
    console.warn(`⚠️ Form "${formKey}" 无有效的filtered_rows`);
    return { LabelForm: [], OIDForm: [] };
  }

  // 1. 计算坐标极值和容差
  const coords = calculateFormCoordinates(form.filtered_rows);
  if (!coords) {
    console.warn(`⚠️ Form "${formKey}" 无法计算坐标信息`);
    return { LabelForm: [], OIDForm: [] };
  }

  const labelCandidates = [];
  const oidCandidates = [];

  // 2. 遍历所有行，进行分类
  form.filtered_rows.forEach((row, idx) => {
    const tokens = getRowTokens(row);
    const rowX0 = row.x_min || (row.words && row.words[0] ? row.words[0].x0 : undefined);
    const rowX1 = row.x_max || (row.words && row.words.length > 0 ? row.words[row.words.length - 1].x1 : undefined);
    
    // 🔍 调试：打印每行的详细信息
    console.log(`🔍 行分析: "${(row.full_text || '').substring(0, 30)}..." | tokens=[${tokens.join(',')}] | x0=${rowX0?.toFixed(1)} x1=${rowX1?.toFixed(1)}`);
    
    // Label候选检查
    const labelCoordOk = isLabelCandidate(row, coords);
    const labelTextOk = checkLabelTextRules(row);
    console.log(`  📋 Label: 坐标${labelCoordOk ? '✅' : '❌'} 文本${labelTextOk ? '✅' : '❌'}`);
    
    if (labelCoordOk && labelTextOk) {
      const matchIndex = getLastIntegerFromTokens(tokens);
      labelCandidates.push({
        match_index: matchIndex,
        content: { ...row } // 复制整行对象
      });
      console.log(`📋 Label行: "${(row.full_text || '').substring(0, 50)}..." → match_index=${matchIndex}`);
    }
    
    // OID候选检查
    const oidCoordOk = isOidCandidate(row, coords);
    const oidTextOk = checkOidTextRules(row);
    console.log(`  🆔 OID: 坐标${oidCoordOk ? '✅' : '❌'} 文本${oidTextOk ? '✅' : '❌'}`);
    
    if (oidCoordOk && oidTextOk) {
      const matchIndex = getFirstIntegerFromTokens(tokens);
      oidCandidates.push({
        match_index: matchIndex,
        content: { ...row } // 复制整行对象
      });
      console.log(`🆔 OID行: "${(row.full_text || '').substring(0, 50)}..." → match_index=${matchIndex}`);
    }
  });

  console.log(`✅ Form "${formKey}": ${labelCandidates.length}个Label行, ${oidCandidates.length}个OID行`);

  return {
    LabelForm: labelCandidates,
    OIDForm: oidCandidates
  };
}

/**
 * 为所有Forms添加LabelForm和OIDForm
 * @param {Object} crfFormList - 包含所有Forms的对象
 * @returns {Object} 更新后的crfFormList
 */
function addLabelOidToAllForms(crfFormList) {
  if (!crfFormList || typeof crfFormList !== 'object') {
    console.warn('⚠️ crfFormList无效，跳过Label/OID提取');
    return crfFormList;
  }

  console.log('🚀 开始为所有Forms添加LabelForm和OIDForm...');
  
  const formKeys = Object.keys(crfFormList);
  console.log(`📊 共${formKeys.length}个Forms需要处理: ${formKeys.join(', ')}`);

  formKeys.forEach(formKey => {
    const form = crfFormList[formKey];
    const { LabelForm, OIDForm } = extractLabelOidFromForm(form, formKey);
    
    // 添加到Form对象中
    form.LabelForm = LabelForm;
    form.OIDForm = OIDForm;

    // 生成并挂载Mapping
    const mapping = buildMappingArray(LabelForm, OIDForm);
    form.Mapping = mapping;
  });

  console.log('🎉 所有Forms的Label/OID提取完成');
  return crfFormList;
}

module.exports = {
  addLabelOidToAllForms,
  extractLabelOidFromForm,
  calculateFormCoordinates,
  isInteger,
  containsNumber,
  getRowTokens
};
