/**
 * CRF Form Processor - 基于行数据和AI patterns处理CRF表格
 * 功能：从Extract_rows_with_position和identified_patterns中提取完整的Form数据
 * Author: LLX Solutions
 */

const { addLabelOidToAllForms } = require('./extractLabelOidForms');

/**
 * 从行数据中提取Form标题行
 * @param {Object} rowsData - Extract_rows_with_position数据
 * @param {Array} formNamePatterns - AI识别的Form名称patterns
 * @returns {Array} Form标题信息数组
 */
function extractFormTitleRows(rowsData, formNamePatterns) {
  const formTitles = [];
  
  if (!rowsData.success || !Array.isArray(formNamePatterns) || formNamePatterns.length === 0) {
    console.warn('⚠️ 无效的输入数据，跳过Form标题提取');
    return formTitles;
  }
  
  rowsData.pages.forEach(page => {
    page.rows.forEach(row => {
      const text = row.full_text.trim();
      
      // 用AI识别的patterns匹配Form名称
      for (const pattern of formNamePatterns) {
        try {
          const regex = new RegExp(pattern, 'i');
          const match = text.match(regex);
          
          if (match) {
            const formName = match[1] ? match[1].trim() : text.replace(/^form:\s*/i, '').trim();
            const normalizedName = formName.toUpperCase().replace(/\s+/g, '_');
            
            formTitles.push({
              page_number: page.page_number,
              row_index: row.row_index,
              form_name: formName,
              normalized_name: normalizedName,
              title_row: row, // 保存完整的标题行数据
              original_text: text
            });
            
            // console.log(`📋 发现Form: "${formName}" 在第${page.page_number}页第${row.row_index}行`);
            break;
          }
        } catch (e) {
          console.warn(`⚠️ 无效的Form pattern: ${pattern}`, e.message);
        }
      }
    });
  });
  
  // 按页码和行号排序
  return formTitles.sort((a, b) => 
    a.page_number !== b.page_number ? 
    a.page_number - b.page_number : 
    a.row_index - b.row_index
  );
}

/**
 * 为每个Form分配内容行（过滤页眉页脚）
 * @param {Object} rowsData - Extract_rows_with_position数据
 * @param {Array} formTitles - Form标题信息
 * @param {Array} unwantedPatterns - 不需要的行patterns（页眉页脚页码）
 * @returns {Object} Forms对象
 */
function assignRowsToForms(rowsData, formTitles, unwantedPatterns = []) {
  // 新实现：基于“同名连续出现”构建段（segment），并聚合到同一个表键下
  const formsByTitle = {};

  // 1) 先把标题事件按顺序分组成 segments（相邻、同名 → 同一段）
  const segments = [];
  let current = null;
  (formTitles || []).forEach(evt => {
    if (!current || current.normalized_name !== evt.normalized_name) {
      if (current) segments.push(current);
      current = { 
        form_name: evt.form_name,
        normalized_name: evt.normalized_name,
        titles: [evt]
      };
    } else {
      current.titles.push(evt);
    }
  });
  if (current) segments.push(current);

  // 辅助：把本段所有标题按页号映射，便于“本页从标题下一行开始”
  function mapPageTitleIndex(seg) {
    const m = new Map();
    (seg.titles || []).forEach(t => m.set(t.page_number, t.row_index));
    return m;
  }

  // 2) 遍历每个段，计算起止边界并收集内容行
  segments.forEach((seg, idx) => {
    const nextSeg = segments[idx + 1] || null;
    const firstTitle = seg.titles[0];
    const startPage = firstTitle.page_number;
    const pageToTitleRow = mapPageTitleIndex(seg);

    let endPage = Infinity;
    let endRowIndex = Infinity;
    if (nextSeg && nextSeg.titles && nextSeg.titles.length > 0) {
      endPage = nextSeg.titles[0].page_number;
      endRowIndex = nextSeg.titles[0].row_index - 1; // 直到“下一个不同标题”的前一行
    }

    // console.log(`🔍 段处理: "${seg.form_name}" 从第${startPage}页到第${endPage}页(前一行)`);

    const collectedRows = [];
    const collectedPages = new Set();

    (rowsData.pages || []).forEach(page => {
      if (page.page_number < startPage || page.page_number > endPage) return;

      // 确定本页的起止行
      let pageStartRow = 1;
      if (page.page_number === startPage) {
        pageStartRow = (pageToTitleRow.get(page.page_number) || firstTitle.row_index) + 1;
      } else if (pageToTitleRow.has(page.page_number)) {
        // 同段内该页也有标题 → 从该页标题下一行开始
        pageStartRow = pageToTitleRow.get(page.page_number) + 1;
      }

      let pageEndRow = Infinity;
      if (nextSeg && page.page_number === endPage) {
        pageEndRow = endRowIndex;
      }

      (page.rows || []).forEach(row => {
        if (row.row_index < pageStartRow) return;
        if (row.row_index > pageEndRow) return;

        // 过滤不需要的行（页眉、页脚、页码、表标题等）
        let isUnwanted = false;
        let matchedPattern = null;
        for (const pattern of unwantedPatterns) {
          try {
            const regex = new RegExp(pattern, 'i');
            if (regex.test(row.full_text)) { isUnwanted = true; matchedPattern = pattern; break; }
          } catch (e) { /* console.warn(`⚠️ Invalid pattern: ${pattern}`, e.message); */ }
        }
        if (isUnwanted) {
          // console.log(`🗑️ 过滤行: "${row.full_text.substring(0, 80)}..." (匹配pattern: ${matchedPattern})`);
          return;
        }

        collectedRows.push({ ...row, page_number: page.page_number });
        collectedPages.add(page.page_number);
      });
    });

    const formKey = seg.normalized_name;
    if (!formsByTitle[formKey]) {
      formsByTitle[formKey] = {
        title: seg.form_name,
        normalized_title: seg.normalized_name,
        title_positions: seg.titles.map(t => ({
          ...(t.title_row || t),           // 保留原有的行数据
          page_number: t.page_number       // 🆕 添加页面号
        })),
        segments: [],
        pages: seg.titles.map(t => t.page_number).filter(Boolean), // 🆕 简化逻辑：直接从标题页面提取
        extracted: true,
        is_multi_page: false,
        row_count: 0,
        word_count: 0,
        full_text: ''
      };
    }

    const segmentRecord = {
      start_page: startPage,
      end_page: nextSeg ? endPage : null,
      pages: Array.from(collectedPages).sort((a, b) => a - b),
      filtered_rows: collectedRows,
      row_count: collectedRows.length,
      word_count: collectedRows.reduce((s, r) => s + (r.words?.length || 0), 0),
      full_text: collectedRows.map(r => r.full_text).join(' ')
    };
    formsByTitle[formKey].segments.push(segmentRecord);

    // 🔥 删除复杂的页面聚合逻辑，使用简化的标题页面逻辑
    formsByTitle[formKey].is_multi_page = formsByTitle[formKey].pages.length > 1;
    formsByTitle[formKey].row_count += segmentRecord.row_count;
    formsByTitle[formKey].word_count += segmentRecord.word_count;
    formsByTitle[formKey].full_text = [formsByTitle[formKey].full_text, segmentRecord.full_text].filter(Boolean).join(' ');

    // console.log(`✅ 段完成: "${seg.form_name}" 收集${segmentRecord.row_count}行, ${segmentRecord.word_count}词, 页: ${segmentRecord.pages.join(', ')}`);
  });
  
  // 3) 输出扁平化：直接使用首段的 filtered_rows，移除 segments
  Object.values(formsByTitle).forEach(form => {
    const firstSeg = (form.segments || [])[0];
    form.filtered_rows = firstSeg ? firstSeg.filtered_rows : [];
    delete form.segments;
  });

  // 4) 为所有Forms添加LabelForm和OIDForm
  console.log('   🎯 [Sub-step 5.3] Extracting Label/OID Forms...');
  const formsWithLabelOid = addLabelOidToAllForms(formsByTitle);
  console.log('   ✅ [Sub-step 5.3] Label/OID Extraction Completed');
  
  return formsWithLabelOid;
}

/**
 * 跨页合并同名Forms
 * @param {Object} forms - Forms对象
 * @returns {Object} 合并后的Forms对象
 */
function mergeCrossPageForms(forms) {
  const formGroups = {};
  
  // 按normalized_title分组
  Object.values(forms).forEach(form => {
    const title = form.normalized_title;
    if (!formGroups[title]) {
      formGroups[title] = [];
    }
    formGroups[title].push(form);
  });
  
  const mergedForms = {};
  
  Object.entries(formGroups).forEach(([title, formList]) => {
    if (formList.length === 1) {
      // 单页Form
      mergedForms[title] = formList[0];
    } else {
      // 检查是否需要合并
      formList.sort((a, b) => a.page_number - b.page_number);
      const pages = formList.map(f => f.page_number);
      const maxGap = Math.max(...pages.slice(1).map((p, i) => p - pages[i]));
      
      if (maxGap <= 2) {
        // 页码连续，合并
        const baseForm = formList[0];
        
        mergedForms[title] = {
          ...baseForm,
          pages: pages, // 更新为所有页面
          is_multi_page: true,
          page_count: pages.length,
          
          // 🔥 合并所有Form实例的行数据
          filtered_rows: formList.flatMap(f => f.filtered_rows),
          
          // 🔥 重新计算汇总
          row_count: formList.reduce((sum, f) => sum + f.row_count, 0),
          word_count: formList.reduce((sum, f) => sum + f.word_count, 0),
          full_text: formList.map(f => f.full_text).join(' ')
        };
        
        // console.log(`🔗 合并Form "${title}" 跨页: ${pages.join(', ')} (${mergedForms[title].row_count}行`);
      } else {
        // 页码不连续，分别保存
        formList.forEach(form => {
          const key = `${title}_PAGE_${form.page_number}`;
          mergedForms[key] = form;
          // console.log(`📄 保留独立Form "${key}" 在第${form.page_number}页`);
        });
      }
    }
  });
  
  return mergedForms;
}

/**
 * 主处理函数：从行数据和AI patterns中提取完整的CRF Form数据
 * @param {Object} rowsData - Extract_rows_with_position数据
 * @param {Object} identifiedPatterns - AI识别的patterns
 * @returns {Object} 包含crfFormList和crfFormName的结果
 */
function processCrfForms(rowsData, identifiedPatterns) {
  try {
    // console.log('🚀 开始处理CRF Forms...');
    
    // 检查输入数据
    if (!rowsData.success || !identifiedPatterns.success) {
      console.warn('⚠️ 输入数据无效，跳过Form处理');
      return { 
        crfFormList: {}, 
        crfFormName: { names: [], total_forms: 0 } 
      };
    }
    
    // 1. 提取Form标题行
    console.log('   📋 [Sub-step 5.1] Extracting Form Title Rows...');
    const formTitles = extractFormTitleRows(rowsData, identifiedPatterns.form_name_patterns || []);
    console.log(`   ✅ [Sub-step 5.1] Found ${formTitles.length} Form Titles`);
    
    if (formTitles.length === 0) {
      console.warn('⚠️ 未发现任何Form标题');
      return { 
        crfFormList: {}, 
        crfFormName: { names: [], total_forms: 0 } 
      };
    }
    
    // console.log(`✅ 发现${formTitles.length}个Form标题`);
    
    // 2. 为每个Form分配内容行
    console.log('   📝 [Sub-step 5.2] Assigning Rows to Forms...');
    const unwantedPatterns = [
      ...(identifiedPatterns.header_patterns || []),
      ...(identifiedPatterns.footer_patterns || []),
      ...(identifiedPatterns.page_number_patterns || []),
      ...(identifiedPatterns.form_name_patterns || []), // 🔥 添加Form名称patterns，这样Form标题行也会被过滤
      // 🔥 添加常见的时间戳patterns作为backup（以防AI没识别到）
      'Generated On:.*\\(GMT\\)',
      'Created On:.*\\(UTC\\)',
      'Document Generated:.*EST'
    ];
    
    // 🔍 调试：打印所有unwanted patterns
    // console.log(`🔍 Unwanted patterns (${unwantedPatterns.length} total):`);
    // unwantedPatterns.forEach((pattern, index) => {
    //   console.log(`  ${index + 1}. "${pattern}"`);
    // });
    
    const formContents = assignRowsToForms(rowsData, formTitles, unwantedPatterns);
    console.log('   ✅ [Sub-step 5.2] Rows Assigned to Forms');
    
    // 3. 已改为Segments聚合：不再进行旧的跨页合并
    // console.log('🔗 第3步：Segments聚合完成（已替代跨页合并）');
    
    // 4. 生成crfFormName数据
    const formNames = Object.keys(formContents);
    const crfFormName = {
      names: formNames,
      total_forms: formNames.length,
      // 🔥 新增：提供原始标题列表（用于显示）
      original_titles: formTitles.map(t => t.form_name),
      unique_titles: [...new Set(formTitles.map(t => t.form_name))]
    };
    
    // console.log(`🎉 CRF Form处理完成: ${formNames.length}个Forms (Segments聚合)`);
    // console.log(`📋 Form列表: ${formNames.join(', ')}`);
    
    return {
      crfFormList: formContents,
      crfFormName: crfFormName
    };
    
  } catch (error) {
    console.error('❌ CRF Form处理失败:', error);
    return { 
      crfFormList: {}, 
      crfFormName: { names: [], total_forms: 0 } 
    };
  }
}

module.exports = {
  processCrfForms,
  extractFormTitleRows,
  assignRowsToForms,
  mergeCrossPageForms
};
