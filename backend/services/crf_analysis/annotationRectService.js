/**
 * Annotation Rectangle Service
 * 功能：从crfFormList中提取Label/OID坐标并生成用于PDF标注的矩形参数
 * Author: LLX Solutions
 */

const { ANNOT_GAP, ANNOT_BOX_W, ANNOT_PAD, ANNOT_MIN_WIDTH, ANNOT_MAX_WIDTH, ANNOT_TEXT_PADDING } = require('../../config/crfConfig');

/**
 * 从Form对象中提取所有相关页面
 * @param {Object} form - Form对象，包含pages、title_positions、Mapping等
 * @returns {Array} 页面号数组，排序后的唯一值
 */
function extractFormPages(form) {
  // 🆕 方案A：优先使用 title_positions（最准确，直接来自标题位置）
  if (Array.isArray(form.title_positions) && form.title_positions.length > 0) {
    const pages = form.title_positions
      .map(titlePos => titlePos.page_number)
      .filter(page => typeof page === 'number');
    if (pages.length > 0) {
      return [...new Set(pages)].sort((a, b) => a - b);
    }
  }
  
  // 方案B：回退到 form.pages（现在已简化为从标题提取）
  if (Array.isArray(form.pages) && form.pages.length > 0) {
    return form.pages.slice().sort((a, b) => a - b);
  }
  
  // 方案C：最后回退到 Mapping 中的页面（如果存在）
  if (Array.isArray(form.Mapping)) {
    const pages = [];
    form.Mapping.forEach(mapping => {
      // 从LabelForm中提取页面信息
      const labelItem = form.LabelForm?.find(item => item.match_index === mapping.index);
      if (labelItem?.content?.page_number) {
        pages.push(labelItem.content.page_number);
      }
      
      // 从OIDForm中提取页面信息
      const oidItem = form.OIDForm?.find(item => item.match_index === mapping.index);
      if (oidItem?.content?.page_number) {
        pages.push(oidItem.content.page_number);
      }
    });
    
    if (pages.length > 0) {
      return [...new Set(pages)].sort((a, b) => a - b);
    }
  }
  
  console.warn(`⚠️ 无法提取Form "${form.title || 'Unknown'}" 的页面信息`);
  return [];
}

/**
 * 从映射数据中提取所有variables用于annotation显示
 * @param {Object} mapping - Mapping对象，包含sdtm_mappings和sdtm_dataset_ai_result
 * @returns {Array} variable名称数组，用于生成多个annotation框
 */
function extractVariablesFromMapping(mapping) {
  const { index, sdtm_dataset_ai_result, sdtm_mappings } = mapping;
  
  // 优先使用新的结构化数据
  if (Array.isArray(sdtm_mappings) && sdtm_mappings.length > 0) {
    const variables = [];
    
    // 检查是否有 not_submitted 类型
    const hasNotSubmitted = sdtm_mappings.some(m => m.mapping_type === 'not_submitted');
    if (hasNotSubmitted) {
      return ['[NOT SUBMITTED]']; // 如果有不提交的，直接返回
    }
    
    // 提取其他类型的变量
    const extractedVars = sdtm_mappings
      .map(m => m.variable)                             // 提取variable
      .filter(Boolean);                                 // 过滤空值
    
    return extractedVars.length > 0 ? extractedVars : [String(index)];
  }
  
  // 回退到兼容字段
  if (sdtm_dataset_ai_result) {
    if (sdtm_dataset_ai_result.includes('[NOT SUBMITTED]')) {
      return ['[NOT SUBMITTED]']; // 如果包含不提交标记，直接返回
    }
    
    // 从兼容字段中提取变量信息（冒号后的部分）
    const parts = sdtm_dataset_ai_result.split(';'); // 处理多个映射
    const variables = parts.map(part => {
      const colonIndex = part.indexOf(':');
      if (colonIndex > 0) {
        return part.slice(colonIndex + 1).trim(); // 提取冒号后的变量部分
      }
      return part.trim();
    }).filter(Boolean);
    
    return variables.length > 0 ? variables : [String(index)];
  }
  
  // 最后回退到index
  return [String(index)];
}

/**
 * 生成单个Form域标注矩形参数（左上角位置）
 * @param {string} domain - 域名称，如 "DM (Demographics)"
 * @param {number} pageNumber - 页面号
 * @param {number} domainIndex - 域索引，用于水平偏移计算
 * @param {string} formKey - Form键名
 * @param {Map} pageDimensions - 页面尺寸信息
 * @param {Array} allDomains - 所有域的数组，用于计算总偏移
 * @returns {Object|null} 矩形参数对象或null
 */
function generateFormDomainRect(domain, pageNumber, domainIndex, formKey, pageDimensions, allDomains) {
  try {
    const pageDim = pageDimensions.get(pageNumber);
    if (!pageDim) {
      console.warn(`⚠️ 找不到页面 ${pageNumber} 的尺寸信息`);
      return null;
    }
    
    // 🎯 左上角固定位置参数
    const LEFT_MARGIN = 50;           // 距左边距
    const TOP_MARGIN = 30;            // 距顶部边距
    const DOMAIN_GAP = 5;             // 域框间隙（与问题标注保持一致）
    const DOMAIN_FONT_SIZE = 13;      // 域标注字体大小（与PDF显示一致）
    
    // 🔧 使用与问题标注相同的尺寸规则
    const DOMAIN_HEIGHT = ANNOT_BOX_W; // 高度使用相同的配置
    
    // 计算当前域的文本宽度（Form域通常更长，放宽最大宽度）
    const DOMAIN_MAX_WIDTH = 260; // 允许更长的域标签完全显示
    const dynamicWidth = calculateTextWidth(
      domain,
      DOMAIN_FONT_SIZE,
      { minWidth: ANNOT_MIN_WIDTH, maxWidth: DOMAIN_MAX_WIDTH, padding: ANNOT_TEXT_PADDING }
    );
    
    // 基础位置计算（第一个框）
    const baseX = LEFT_MARGIN;
    const baseY = pageDim.height - TOP_MARGIN; // pypdf坐标系：底部原点
    
    // 计算水平偏移（前面所有域框的总宽度 + 间隙）
    let previousDomainsWidth = 0;
    for (let i = 0; i < domainIndex; i++) {
      const prevDomainWidth = calculateTextWidth(
        allDomains[i],
        DOMAIN_FONT_SIZE,
        { minWidth: ANNOT_MIN_WIDTH, maxWidth: DOMAIN_MAX_WIDTH, padding: ANNOT_TEXT_PADDING }
      );
      previousDomainsWidth += prevDomainWidth + DOMAIN_GAP;
    }
    
    const annotX = baseX + previousDomainsWidth;
    const annotY = baseY;
    
    // 生成矩形参数 [x0, y0, x1, y1] (pypdf坐标系)
    const rectX0 = annotX;
    const rectY0 = annotY - (DOMAIN_HEIGHT / 2);
    const rectX1 = annotX + dynamicWidth;
    const rectY1 = annotY + (DOMAIN_HEIGHT / 2);
    
    // console.log(`    ✅ 页面${pageNumber} 域框${domainIndex}: "${domain}" at [${rectX0.toFixed(1)}, ${rectY0.toFixed(1)}, ${rectX1.toFixed(1)}, ${rectY1.toFixed(1)}], 宽度: ${dynamicWidth}px`);
    
    return {
      page_number: pageNumber,
      x: rectX0,
      y: rectY0,
      width: dynamicWidth,
      height: DOMAIN_HEIGHT,
      text: domain,
      type: 'FormDomain',
      rect: [rectX0, rectY0, rectX1, rectY1],
      // 唯一字段标识信息
      form_name: formKey,
      domain_index: domainIndex,
      // 调试信息
      _debug: {
        domain_text: domain,
        page_height: pageDim.height,
        base_position: { x: baseX, y: baseY },
        offset: previousDomainsWidth,
        font_size: DOMAIN_FONT_SIZE
      }
    };
    
  } catch (error) {
    console.error(`❌ 生成Form域标注矩形失败: "${domain}" on page ${pageNumber}:`, error);
    return null;
  }
}

/**
 * 🔧 计算文字的显示宽度（基于Helvetica-Bold字体）
 * @param {string} text - 要显示的文字
 * @param {number} fontSize - 字体大小，默认18pt
 * @returns {number} 计算出的宽度（像素）
 */
function calculateTextWidth(text, fontSize = 18, options = {}) {
  const minWidth = options.minWidth !== undefined ? options.minWidth : ANNOT_MIN_WIDTH;
  const maxWidth = options.maxWidth !== undefined ? options.maxWidth : ANNOT_MAX_WIDTH;
  const padding = options.padding !== undefined ? options.padding : ANNOT_TEXT_PADDING;
  // Helvetica-Bold字体的字符宽度比例（相对于fontSize）
  const charWidthMap = {
    'A': 0.72, 'B': 0.67, 'C': 0.72, 'D': 0.72, 'E': 0.61, 'F': 0.56,
    'G': 0.78, 'H': 0.72, 'I': 0.28, 'J': 0.50, 'K': 0.67, 'L': 0.56,
    'M': 0.83, 'N': 0.72, 'O': 0.78, 'P': 0.67, 'Q': 0.78, 'R': 0.72,
    'S': 0.67, 'T': 0.61, 'U': 0.72, 'V': 0.67, 'W': 0.94, 'X': 0.67,
    'Y': 0.67, 'Z': 0.61,
    '0': 0.56, '1': 0.56, '2': 0.56, '3': 0.56, '4': 0.56, '5': 0.56,
    '6': 0.56, '7': 0.56, '8': 0.56, '9': 0.56,
    ' ': 0.28, '-': 0.33, '_': 0.50, '.': 0.28, ',': 0.28
  };

  let totalWidth = 0;
  const textStr = String(text || '').toUpperCase();
  
  for (let i = 0; i < textStr.length; i++) {
    const char = textStr[i];
    const charWidth = charWidthMap[char] || 0.6; // 默认宽度
    totalWidth += charWidth * fontSize;
  }
  
  // 添加文字左右边距
  const widthWithPadding = totalWidth + padding;
  
  // 限制在最小/最大宽度范围内
  const finalWidth = Math.max(minWidth, Math.min(maxWidth, widthWithPadding));
  
  // console.log(`📏 文字: "${text}" -> 计算宽度: ${totalWidth.toFixed(1)}px, 加边距: ${widthWithPadding.toFixed(1)}px, 最终: ${finalWidth.toFixed(1)}px`);
  
  return Math.round(finalWidth);
}

/**
 * 为单个Form生成所有域标注矩形
 * @param {Object} form - Form对象，包含form_sdtm_mapping_unique等
 * @param {string} formKey - Form键名
 * @param {Map} pageDimensions - 页面尺寸信息
 * @returns {Array} 域标注矩形参数数组
 */
function generateFormDomainRects(form, formKey, pageDimensions) {
  const domainRects = [];
  
  // 检查Form是否有域信息
  const formDomains = form.form_sdtm_mapping_unique || [];
  if (formDomains.length === 0) {
    return domainRects; // 没有域信息，返回空数组
  }
  
  // 提取Form涉及的所有页面
  const formPages = extractFormPages(form);
  if (formPages.length === 0) {
    console.warn(`⚠️ Form "${form.title || formKey}" 无法确定页面信息，跳过域标注`);
    return domainRects;
  }
  
  // console.log(`  📊 Form域信息: [${formDomains.join(', ')}] 在页面 [${formPages.join(', ')}]`);

  // 🎨 颜色调色盘（循环使用，不更改布局，仅背景色）
  const COLOR_PALETTE = [
    [0.70, 0.80, 1.00], // 淡蓝
    [1.00, 1.00, 0.70], // 淡黄
    [0.80, 1.00, 0.80], // 淡绿
    [1.00, 0.90, 0.80]  // 淡橙
  ];
  // 为本Form内的每个唯一域分配颜色（按照出现顺序循环使用）
  const domainToColor = new Map();
  formDomains.forEach((domain, idx) => {
    const color = COLOR_PALETTE[idx % COLOR_PALETTE.length];
    domainToColor.set(domain, color);
  });
  
  // 为每个页面生成所有域的标注框
  formPages.forEach(pageNum => {
    formDomains.forEach((domain, domainIndex) => {
      const domainRect = generateFormDomainRect(
        domain, 
        pageNum, 
        domainIndex, 
        formKey, 
        pageDimensions,
        formDomains  // 传递所有域数组以计算偏移
      );
      
      if (domainRect) {
        // 仅增加背景颜色信息，避免改动布局
        domainRect.background_color = domainToColor.get(domain);
        domainRects.push(domainRect);
      }
    });
  });
  
  return domainRects;
}

/**
 * 主函数：为所有Forms生成标注矩形
 * @param {Object} studyData - 包含crfFormList和页面尺寸信息的Study数据
 * @returns {Object} 按页码组织的矩形坐标列表 { page_number: [[x0, y0, x1, y1], ...] }
 */
function generateAnnotationRects(studyData) {
  console.log('🚀 开始生成PDF标注矩形参数...');

  // 1. 数据校验
  const crfFormList = studyData?.files?.crf?.crfUploadResult?.crfFormList;
  const pagesMetadata = studyData?.files?.crf?.crfUploadResult?.Extract_words_with_position?.pages;

  if (!crfFormList || typeof crfFormList !== 'object' || Object.keys(crfFormList).length === 0) {
    console.warn('⚠️ crfFormList无效或为空，无法生成标注');
    return {};
  }
  if (!Array.isArray(pagesMetadata) || pagesMetadata.length === 0) {
    console.warn('⚠️ 页面尺寸信息缺失，无法进行坐标转换');
    return {};
  }

  // 预处理页面尺寸信息，方便快速查找
  const pageDimensions = new Map();
  pagesMetadata.forEach(p => {
    // 修复字段名：实际数据使用 page_width/page_height 而不是 width/height
    if (p.page_number && p.page_height) {
      pageDimensions.set(p.page_number, { width: p.page_width, height: p.page_height });
    }
  });

  console.log(`📊 已加载 ${pageDimensions.size} 个页面的尺寸信息`);

  const allRectsByPage = {};

  // 🎨 全局颜色循环控制：跨Form循环分配颜色，不在每个Form重置
  const GLOBAL_COLOR_PALETTE = [
    [0.70, 0.80, 1.00], // 淡蓝
    [1.00, 1.00, 0.70], // 淡黄
    [0.80, 1.00, 0.80], // 淡绿
    [1.00, 0.90, 0.80]  // 淡橙
  ];
  // 不为 NOT SUBMITTED 设背景色，由Python端省略填充
  const NOT_SUBMITTED_COLOR = null;
  const globalDomainToColor = new Map();
  let globalColorIndex = 0;

  // 2. 遍历所有Form
  for (const formKey in crfFormList) {
    const form = crfFormList[formKey];
    if (!form) continue;

    console.log(`🔍 正在处理Form: "${form.title}" (${form.Mapping?.length || 0}个映射)`);

  // 🆕 生成Form域标注（左上角）
  // 在生成前确保为本Form涉及的每个域分配全局颜色（按出现顺序，循环使用4色）
  const formDomains = Array.isArray(form.form_sdtm_mapping_unique) ? form.form_sdtm_mapping_unique : [];
  formDomains.forEach(domainStr => {
    if (!globalDomainToColor.has(domainStr)) {
      const color = GLOBAL_COLOR_PALETTE[globalColorIndex % GLOBAL_COLOR_PALETTE.length];
      globalDomainToColor.set(domainStr, color);
      globalColorIndex++;
    }
  });

  // 🔍 调试信息：输出Form页面分配
  console.log(`🔍 调试Form页面: "${form.title}" (${formKey})`);
  console.log(`  - 域列表: [${formDomains.join(', ')}]`);
  console.log(`  - 分配页面: [${form.pages ? form.pages.join(', ') : '无'}]`);
  console.log(`  - title_positions页面: [${form.title_positions ? form.title_positions.map(t => t.page_number).join(', ') : '无'}]`);

  const formDomainRects = generateFormDomainRects(form, formKey, pageDimensions).map(r => {
    if (r && typeof r.text === 'string' && globalDomainToColor.has(r.text)) {
      r.background_color = globalDomainToColor.get(r.text);
    }
    return r;
  });
  formDomainRects.forEach(rect => addRectToPage(allRectsByPage, rect));

    // 3. 遍历Form中的所有Mapping（问题标注）
    if (!Array.isArray(form.Mapping)) continue;
    // 变量着色时直接使用全局 domain->color 映射
    form.Mapping.forEach(mapping => {
      const { index, sdtm_dataset_ai_result, sdtm_mappings } = mapping;
      if (typeof index !== 'number') return;

      // 🆕 提取所有variables用于生成多个annotation框
      const variables = extractVariablesFromMapping(mapping);
      
      console.log(`  📍 处理mapping index: ${index}, 提取到 ${variables.length} 个variables: [${variables.join(', ')}]`);

      // 根据mapping解析其所属域字符串，用于着色
      let mappingDomainString = null;
      if (Array.isArray(sdtm_mappings) && sdtm_mappings.length > 0) {
        const valid = sdtm_mappings.find(m => m && m.mapping_type !== 'not_submitted' && m.domain_code);
        if (valid) {
          const code = valid.domain_code || '';
          const label = valid.domain_label || '';
          mappingDomainString = label ? `${code} (${label})` : code;
        }
      } else if (typeof sdtm_dataset_ai_result === 'string') {
        const colon = sdtm_dataset_ai_result.indexOf(':');
        if (colon > 0) mappingDomainString = sdtm_dataset_ai_result.slice(0, colon).trim();
      }
      // not submitted 单独灰色
      const hasNotSubmitted = Array.isArray(sdtm_mappings) && sdtm_mappings.some(m => m && m.mapping_type === 'not_submitted');
      let bgColor = undefined;
      if (hasNotSubmitted || (typeof sdtm_dataset_ai_result === 'string' && sdtm_dataset_ai_result.includes('[NOT SUBMITTED]'))) {
        bgColor = undefined; // 不设置背景色
      } else if (mappingDomainString) {
        // 若该域尚未在全局映射中，分配下一种颜色
        if (!globalDomainToColor.has(mappingDomainString)) {
          const color = GLOBAL_COLOR_PALETTE[globalColorIndex % GLOBAL_COLOR_PALETTE.length];
          globalDomainToColor.set(mappingDomainString, color);
          globalColorIndex++;
        }
        bgColor = globalDomainToColor.get(mappingDomainString);
      }

      // 4. 为每个variable生成Label框
      const labelItem = form.LabelForm?.find(item => item.match_index === index);
      if (labelItem && labelItem.content) {
        variables.forEach((variable, variableIndex) => {
          const labelRect = generateRectFromContent(
            labelItem.content, 
            variable,           // 显示variable名称
            'Label', 
            pageDimensions, 
            index, 
            formKey,
            variableIndex       // 水平偏移索引
          );
          if (labelRect && bgColor) labelRect.background_color = bgColor;
        if (labelRect) addRectToPage(allRectsByPage, labelRect);
        });
      }

      // 5. 为每个variable生成OID框
      const oidItem = form.OIDForm?.find(item => item.match_index === index);
      if (oidItem && oidItem.content) {
        variables.forEach((variable, variableIndex) => {
          const oidRect = generateRectFromContent(
            oidItem.content, 
            variable,           // 显示variable名称
            'OID', 
            pageDimensions, 
            index, 
            formKey,
            variableIndex       // 水平偏移索引
          );
          if (oidRect && bgColor) oidRect.background_color = bgColor;
        if (oidRect) addRectToPage(allRectsByPage, oidRect);
        });
      }
    });
  }

  console.log('🎉 标注矩形参数生成完成');
  console.log('📊 生成结果统计:', Object.entries(allRectsByPage).map(([page, rects]) => `Page ${page}: ${rects.length} rects`).join(', '));
  return allRectsByPage;
}

/**
 * 从content对象中提取坐标并生成矩形参数（支持水平偏移）
 * @param {Object} content - LabelForm或OIDForm的content对象，包含坐标信息
 * @param {String} displayText - 要显示在标注框中的文本（variable名称）
 * @param {String} type - 'Label' 或 'OID'，用于确定标注位置
 * @param {Map} pageDimensions - 页面尺寸信息
 * @param {Number} index - mapping的index值，用于日志记录
 * @param {String} formName - 表单名称，用于生成唯一字段名
 * @param {Number} variableIndex - 第几个variable（用于计算水平偏移），默认0
 * @returns {Object|null} 矩形参数对象或null
 */
function generateRectFromContent(content, displayText, type, pageDimensions, index, formName, variableIndex = 0) {
  try {
    // 🔧 计算动态宽度
    const dynamicWidth = calculateTextWidth(displayText);
    
    // 提取坐标信息
    const x_max = content.x_max;
    const y_center = content.y_center || ((content.y_min + content.y_max) / 2);
    const page_number = content.page_number;

    if (typeof x_max !== 'number' || typeof y_center !== 'number' || typeof page_number !== 'number') {
      console.warn(`⚠️ ${type} index ${index}(显示文本:"${displayText}"): 坐标信息不完整`, { x_max, y_center, page_number });
      return null;
    }

    // 获取页面尺寸
    const pageDim = pageDimensions.get(page_number);
    if (!pageDim) {
      console.warn(`⚠️ ${type} index ${index}(显示文本:"${displayText}"): 找不到页面 ${page_number} 的尺寸信息`);
      return null;
    }

    // 计算基础注解框位置
    let baseAnnotX;
    
    if (type === 'Label') {
      // Label: 在行的右侧添加注解框
      baseAnnotX = x_max + ANNOT_GAP;
    } else if (type === 'OID') {
      // OID: 在行的左侧添加注解框
      const x_min = content.x_min || x_max - 100; // 如果没有x_min，用估算值
      baseAnnotX = x_min - ANNOT_GAP - dynamicWidth; // 🔧 使用动态宽度
    } else {
      console.warn(`⚠️ 未知的类型: ${type}, index ${index}(显示文本:"${displayText}")`);
      return null;
    }
    
    // 🆕 计算水平偏移（支持多个variable框）
    const GAP_BETWEEN_BOXES = 5; // 框与框之间的间隙
    const horizontalOffset = variableIndex * (dynamicWidth + GAP_BETWEEN_BOXES);
    const annotX = baseAnnotX + horizontalOffset;

    // 坐标系转换: pdfplumber (top-left origin, Y-down) → pypdf (bottom-left origin, Y-up)
    const pdfplumberY = y_center;
    const pypdfY = pageDim.height - pdfplumberY;

    // 生成矩形参数 [x0, y0, x1, y1] (pypdf坐标系)
    const rectX0 = annotX;
    const rectY0 = pypdfY - (ANNOT_BOX_W / 2); // 高度仍然使用固定值，只有宽度动态
    const rectX1 = annotX + dynamicWidth; // 🔧 使用动态宽度
    const rectY1 = pypdfY + (ANNOT_BOX_W / 2);

    // console.log(`    ✅ ${type} index ${index}: 生成矩形 [${rectX0.toFixed(1)}, ${rectY0.toFixed(1)}, ${rectX1.toFixed(1)}, ${rectY1.toFixed(1)}] on page ${page_number}, 显示文本: "${displayText}", 动态宽度: ${dynamicWidth}px`);

    return {
      page_number,
      x: rectX0,
      y: rectY0,
      width: dynamicWidth, // 🔧 使用动态宽度
      height: ANNOT_BOX_W, // 高度保持固定
      text: displayText,
      type: type,
      rect: [rectX0, rectY0, rectX1, rectY1], // 完整的矩形坐标
      // 🔥 新增：用于生成唯一字段名的标识信息
      form_name: formName,
      original_index: index,
      variable_index: variableIndex, // 🆕 新增：variable索引用于区分同一问题的多个框
      // 保留原始坐标供调试
      _debug: {
        original_x_max: x_max,
        original_y_center: y_center,
        page_height: pageDim.height,
        pdfplumber_y: pdfplumberY,
        pypdf_y: pypdfY
      }
    };

  } catch (error) {
    console.error(`❌ 生成${type} index ${index}(显示文本:"${displayText}")的矩形参数失败:`, error);
    return null;
  }
}

/**
 * 将矩形添加到按页分组的结果中
 * @param {Object} allRectsByPage - 结果对象
 * @param {Object} rectData - 矩形数据
 */
function addRectToPage(allRectsByPage, rectData) {
  const { page_number } = rectData;
  
  if (!allRectsByPage[page_number]) {
    allRectsByPage[page_number] = [];
  }
  
  allRectsByPage[page_number].push(rectData);
}

module.exports = {
  generateAnnotationRects,
  /**
   * 为指定的Form子集生成标注矩形（支持跨批次颜色状态传递）
   * @param {Object} studyData - Study数据（包含crfFormList与页面尺寸）
   * @param {Array<string>} targetFormKeys - 仅处理这些Form键；空数组则返回{}
   * @param {Object|null} colorState - 可选的全局颜色状态 { map: Map, index: number }
   * @returns {{ rectsByPage: Object, colorState: { map: Map, index: number } }}
   */
  generateAnnotationRectsForForms: function(studyData, targetFormKeys = [], colorState = null) {
    // console.log('🚀 [Batch] 开始为指定Forms生成标注矩形...', { count: targetFormKeys?.length || 0 });

    const crfFormList = studyData?.files?.crf?.crfUploadResult?.crfFormList;
    const pagesMetadata = studyData?.files?.crf?.crfUploadResult?.Extract_words_with_position?.pages;

    if (!crfFormList || typeof crfFormList !== 'object' || Object.keys(crfFormList).length === 0) {
      console.warn('⚠️ [Batch] crfFormList无效或为空，无法生成标注');
      return { rectsByPage: {}, colorState: colorState || { map: new Map(), index: 0 } };
    }
    if (!Array.isArray(pagesMetadata) || pagesMetadata.length === 0) {
      console.warn('⚠️ [Batch] 页面尺寸信息缺失，无法进行坐标转换');
      return { rectsByPage: {}, colorState: colorState || { map: new Map(), index: 0 } };
    }

    // 预处理页面尺寸
    const pageDimensions = new Map();
    pagesMetadata.forEach(p => {
      if (p.page_number && p.page_height) {
        pageDimensions.set(p.page_number, { width: p.page_width, height: p.page_height });
      }
    });

    const allRectsByPage = {};

    // 全局颜色循环控制（跨批次传递）
    const GLOBAL_COLOR_PALETTE = [
      [0.70, 0.80, 1.00],
      [1.00, 1.00, 0.70],
      [0.80, 1.00, 0.80],
      [1.00, 0.90, 0.80]
    ];
    const NOT_SUBMITTED_COLOR = [0.98, 0.98, 0.98];
    const globalDomainToColor = (colorState && colorState.map) ? colorState.map : new Map();
    let globalColorIndex = (colorState && typeof colorState.index === 'number') ? colorState.index : 0;

    // 仅处理目标forms
    const formKeys = Array.isArray(targetFormKeys) && targetFormKeys.length > 0
      ? targetFormKeys
      : [];

    formKeys.forEach(formKey => {
      const form = crfFormList[formKey];
      if (!form) return;

      // console.log(`🔍 [Batch] 处理Form: "${form.title}" (${form.Mapping?.length || 0}个映射)`);

      // 为本Form涉及的域分配（或复用）全局颜色
      const formDomains = Array.isArray(form.form_sdtm_mapping_unique) ? form.form_sdtm_mapping_unique : [];
      formDomains.forEach(domainStr => {
        if (!globalDomainToColor.has(domainStr)) {
          const color = GLOBAL_COLOR_PALETTE[globalColorIndex % GLOBAL_COLOR_PALETTE.length];
          globalDomainToColor.set(domainStr, color);
          globalColorIndex++;
        }
      });

      // 域框（左上角）
      const formDomainRects = generateFormDomainRects(form, formKey, pageDimensions).map(r => {
        if (r && typeof r.text === 'string' && globalDomainToColor.has(r.text)) {
          r.background_color = globalDomainToColor.get(r.text);
        }
        return r;
      });
      formDomainRects.forEach(rect => addRectToPage(allRectsByPage, rect));

      // 问题标注
      if (!Array.isArray(form.Mapping)) return;
      form.Mapping.forEach(mapping => {
        const { index, sdtm_dataset_ai_result, sdtm_mappings } = mapping;
        if (typeof index !== 'number') return;

        const variables = extractVariablesFromMapping(mapping);

        // 根据mapping解析域字符串，用于着色
        let mappingDomainString = null;
        if (Array.isArray(sdtm_mappings) && sdtm_mappings.length > 0) {
          const valid = sdtm_mappings.find(m => m && m.mapping_type !== 'not_submitted' && m.domain_code);
          if (valid) {
            const code = valid.domain_code || '';
            const label = valid.domain_label || '';
            mappingDomainString = label ? `${code} (${label})` : code;
          }
        } else if (typeof sdtm_dataset_ai_result === 'string') {
          const colon = sdtm_dataset_ai_result.indexOf(':');
          if (colon > 0) mappingDomainString = sdtm_dataset_ai_result.slice(0, colon).trim();
        }
        const hasNotSubmitted = Array.isArray(sdtm_mappings) && sdtm_mappings.some(m => m && m.mapping_type === 'not_submitted');
        let bgColor = undefined;
        if (hasNotSubmitted || (typeof sdtm_dataset_ai_result === 'string' && sdtm_dataset_ai_result.includes('[NOT SUBMITTED]'))) {
          bgColor = undefined; // 不设置背景色
        } else if (mappingDomainString) {
          if (!globalDomainToColor.has(mappingDomainString)) {
            const color = GLOBAL_COLOR_PALETTE[globalColorIndex % GLOBAL_COLOR_PALETTE.length];
            globalDomainToColor.set(mappingDomainString, color);
            globalColorIndex++;
          }
          bgColor = globalDomainToColor.get(mappingDomainString);
        }

        // Label & OID 框
        const labelItem = form.LabelForm?.find(item => item.match_index === index);
        if (labelItem && labelItem.content) {
          variables.forEach((variable, variableIndex) => {
            const labelRect = generateRectFromContent(labelItem.content, variable, 'Label', pageDimensions, index, formKey, variableIndex);
            if (labelRect && bgColor) labelRect.background_color = bgColor;
            if (labelRect) addRectToPage(allRectsByPage, labelRect);
          });
        }
        const oidItem = form.OIDForm?.find(item => item.match_index === index);
        if (oidItem && oidItem.content) {
          variables.forEach((variable, variableIndex) => {
            const oidRect = generateRectFromContent(oidItem.content, variable, 'OID', pageDimensions, index, formKey, variableIndex);
            if (oidRect && bgColor) oidRect.background_color = bgColor;
            if (oidRect) addRectToPage(allRectsByPage, oidRect);
          });
        }
      });
    });

    // console.log('🎉 [Batch] 指定Forms标注矩形生成完成');
    return { rectsByPage: allRectsByPage, colorState: { map: globalDomainToColor, index: globalColorIndex } };
  }
};

