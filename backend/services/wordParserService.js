const mammoth = require('mammoth');
const cheerio = require('cheerio');
const { identifyAssessmentScheduleWithAI, extractStudyNumber } = require('./openaiService');
// const { performSDTMAnalysis } = require('./sdtmAnalysisService');

// Word文档结构化解析函数 - 优化版（仅解析与存储，不进行SDTM分析）
async function parseWordDocumentStructure(fileBuffer, options = {}) {
  const { skipAssessmentSchedule = false, skipEndpoints = false } = options;
  try {
    // // console.log('🔍 开始从内存Buffer解析Word文档...');
    
    // 第1步：使用样式映射的HTML转换
    const styleMap = [
      "p[style-name='Heading 1'] => h1:fresh",
      "p[style-name='Heading 2'] => h2:fresh", 
      "p[style-name='Heading 3'] => h3:fresh",
      "p[style-name='标题 1'] => h1:fresh",
      "p[style-name='标题 2'] => h2:fresh",
      "p[style-name='标题 3'] => h3:fresh",
      "p[style-name='Heading1'] => h1:fresh",
      "p[style-name='Heading2'] => h2:fresh",
      "p[style-name='Heading3'] => h3:fresh"
    ];
    
    const htmlResult = await mammoth.convertToHtml({ 
      buffer: fileBuffer,
      styleMap: styleMap
    });
    let htmlContent = htmlResult.value;
    
    // // console.log('✅ Word -> HTML 转换完成 (使用样式映射)');
    
    // 第2步：同时获取原始文本用于模式匹配
    const rawTextResult = await mammoth.extractRawText({ buffer: fileBuffer });
    const extractedText = rawTextResult.value;

    // 提取Study Number（AI + 兜底）
    const aiResult = await extractStudyNumber(extractedText);
    const studyNumber = aiResult.studyNumber;
    // if (studyNumber) console.log('🔎 识别到 Study Number:', studyNumber);
    
    // 使用cheerio解析HTML
    const $ = cheerio.load(htmlContent);
    
    // 第3步：提取所有表格
    const tables = [];
    let tableIndex = 0;
    
    $('table').each(function() {
      const tableHtml = $.html($(this));
      tables.push({
        htmlContent: tableHtml,
        source: 'word', // Required for mixed Word/PDF schema
        tableIndex: tableIndex++,
        extractedAt: new Date()
      });
      
      // 从HTML中移除这个表格，避免影响后续的章节解析
      $(this).remove();
    });
    
    // // console.log(`📊 提取到 ${tables.length} 个表格`);
    
    // 第4步：多层标题识别算法
    const sections = await extractSectionsWithAdvancedDetection($, extractedText);
    
    // // console.log(`📝 优化算法解析到 ${sections.length} 个章节`);
    
    // 识别评估时间表（供后续分析使用）
    let assessmentSchedule = null;
    if (skipAssessmentSchedule) {
      // console.log('🚫 Word CRF/SAP: Skipping Assessment Schedule identification');
      assessmentSchedule = null;
    } else {
      // console.log('🔍 开始AI识别评估时间表...');
      assessmentSchedule = await identifyAssessmentScheduleWithAI(tables);
    }
    
    // 识别 Endpoints（仅 Protocol 使用；CRF/SAP 跳过）
    let endpoints = [];
    if (!skipEndpoints) {
      try {
        const titles = sections.map(s => s.title || '');
        const ident = await require('./openaiService').identifyEndpoints(titles);
        endpoints = (ident || []).map(it => ({
          category: it.category,
          title: sections[it.index]?.title || titles[it.index] || '',
          cleanedTitle: it.cleaned_title,
          content: sections[it.index]?.content || '',
          level: sections[it.index]?.level || null,
          sectionIndex: it.index,
          extractMethod: 'ai'
        }));
      } catch (e) {
        console.warn('⚠️ Endpoint identification failed (Word):', e.message);
      }
    }

    // 不在此处执行 SDTM 分析；延后到显式的分析步骤
    const sdtmAnalysis = null;
    
    return {
      extractedText,
      sectionedText: sections,
      tables,
      assessmentSchedule,
      endpoints,
      sdtmAnalysis,
      studyNumber,
      parseInfo: {
        hasStructuredContent: true,
        sectionsCount: sections.length,
        tablesCount: tables.length,
        parseMethod: 'advanced-multi-layer',
        hasAssessmentSchedule: assessmentSchedule !== null
      }
    };
    
  } catch (error) {
    console.warn('⚠️ 优化解析失败，回退到基础文本提取:', error.message);
    
    // 回退到基础的文本提取
    try {
      const rawTextResult = await mammoth.extractRawText({ path: filePath });
      const fallbackAiResult = await extractStudyNumber(rawTextResult.value);
      const fallbackStudyNumber = fallbackAiResult.studyNumber;
      return {
        extractedText: rawTextResult.value,
        sectionedText: [],
        tables: [],
        assessmentSchedule: null,
        sdtmAnalysis: null, // 不在上传阶段进行分析
        studyNumber: fallbackStudyNumber,
        parseInfo: {
          hasStructuredContent: false,
          sectionsCount: 0,
          tablesCount: 0,
          parseMethod: 'raw-text-fallback',
          hasAssessmentSchedule: false
        }
      };
    } catch (fallbackError) {
      throw new Error(`Word文档解析完全失败: ${fallbackError.message}`);
    }
  }
}

// 多层标题识别算法
async function extractSectionsWithAdvancedDetection($, extractedText) {
  const sections = [];
  
  // // console.log('🔍 启动多层标题识别算法...');
  
  // 第1层：HTML标题标签识别
  const htmlSections = extractSectionsFromHTML($);
  // // console.log(`📋 HTML标题识别: ${htmlSections.length} 个章节`);
  
  // 第2层：编号模式识别 
  const patternSections = extractSectionsFromPatterns(extractedText);
  // // console.log(`🔢 编号模式识别: ${patternSections.length} 个章节`);
  
  // 第3层：内容特征识别
  const contentSections = extractSectionsFromContent(extractedText);
  // // console.log(`📝 内容特征识别: ${contentSections.length} 个章节`);
  
  // 第4层：合并和去重
  const mergedSections = mergeSectionResults(htmlSections, patternSections, contentSections, extractedText);
  // // console.log(`🔗 合并后章节: ${mergedSections.length} 个`);
  
  // 第5层：AI辅助优化 (可选)
  const finalSections = await optimizeSectionsWithAI(mergedSections);
  // // console.log(`🤖 AI优化后: ${finalSections.length} 个章节`);
  
  return finalSections;
}

// 第1层：从HTML标签提取章节
function extractSectionsFromHTML($) {
  const sections = [];
  let currentSection = null;
  
  $('body').children().each(function() {
    const element = $(this);
    const tagName = element.prop('tagName');
    
    if (tagName && tagName.match(/^h[1-6]$/i)) {
      // 保存前一个章节
      if (currentSection && currentSection.content.trim()) {
        sections.push(currentSection);
      }
      
      currentSection = {
        title: element.text().trim(),
        level: parseInt(tagName.charAt(1)),
        content: '',
        source: 'html'
      };
    } else if (currentSection && element.text().trim()) {
      const paragraphText = element.text().trim();
      if (paragraphText) {
        currentSection.content += paragraphText + '\n\n';
      }
    }
  });
  
  // 添加最后一个章节
  if (currentSection && currentSection.content.trim()) {
    sections.push(currentSection);
  }
  
  return sections;
}

/**
 * 🔥 辅助函数：解析编号字符串为路径数组
 * @param {string} numberStr - 编号字符串，如 "5.2.1"
 * @returns {Array<number>} 路径数组，如 [5, 2, 1]
 */
function parseNumberPath(numberStr) {
  return numberStr.split('.').map(n => parseInt(n, 10));
}

/**
 * 🔥 辅助函数：检查新编号是否是合法的下一个编号（符合继承约束）
 * @param {Array<number>} currentPath - 当前路径，如 [5, 2]
 * @param {Array<number>} newPath - 新候选路径，如 [5, 3]
 * @returns {boolean} 是否合法
 */
function isValidNextNumber(currentPath, newPath) {
  const m = newPath.length;     // 新路径深度
  const n = currentPath.length; // 当前路径深度
  
  // ========== 规则1：同级兄弟 (next sibling) ==========
  if (m === n) {
    for (let i = 0; i < n - 1; i++) {
      if (newPath[i] !== currentPath[i]) {
        return false;
      }
    }
    return newPath[m - 1] === currentPath[n - 1] + 1;
  }
  
  // ========== 规则2：首个子节点 (first child) ==========
  if (m === n + 1) {
    for (let i = 0; i < n; i++) {
      if (newPath[i] !== currentPath[i]) {
        return false;
      }
    }
    return newPath[m - 1] === 1;
  }
  
  // ========== 规则3：跳回祖先级 (ancestor sibling) ==========
  if (m < n) {
    for (let i = 0; i < m - 1; i++) {
      if (newPath[i] !== currentPath[i]) {
        return false;
      }
    }

    const ancestorIndex = m - 1;
    return newPath[ancestorIndex] === currentPath[ancestorIndex] + 1;
  }
  
  return false;
}

// 第2层：编号模式识别
function extractSectionsFromPatterns(extractedText) {
  const sections = [];
  const lines = extractedText.split('\n');
  
  // 🔥 新增：维护当前已接受的编号路径
  let currentPath = null;
  
  const numericHeadingRegex = /^(\d+(?:\.\d+)*)(?:[.)])?\s+(.+?)(?:\.{2,}\s*(\d+))?$/;
  const appendixHeadingRegex = /^(Appendix\s+[A-Z](?:\.\d+)*)(?:[.)])?\s+(.+?)(?:\.{2,}\s*(\d+))?$/i;
  
  let currentSection = null;
  
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;
    
    let matched = false;
    
    let match = line.match(numericHeadingRegex);
    let headingType = null;

    if (match) {
      headingType = 'numeric-heading';
    } else {
      match = line.match(appendixHeadingRegex);
      if (match) {
        headingType = 'appendix-heading';
      }
    }

    if (match) {
      const numberPart = match[1];
      const rawTitle = match[2] ? match[2].trim() : '';
      const pagePart = match[3] ? parseInt(match[3], 10) : null;

      const cleanTitle = rawTitle
        .replace(/\.{3,}.*$/, '')
        .replace(/\s+\d+\s*$/, '')
        .trim();

      if (cleanTitle.length > 2) {
        let level = 1;
        let newPath = null;
        let isValidHeading = true;
        const isNumericHeading = headingType === 'numeric-heading';

        if (isNumericHeading) {
          level = numberPart.split('.').length;
          newPath = parseNumberPath(numberPart);

          if (currentPath !== null && !isValidNextNumber(currentPath, newPath)) {
            isValidHeading = false;
          }
        } else {
          const appendixId = numberPart.replace(/^Appendix\s+/i, '');
          level = appendixId.split('.').length;
        }

        if (isValidHeading) {
          if (currentSection && currentSection.content.trim()) {
            sections.push(currentSection);
          }

          currentSection = {
            title: cleanTitle,
            level,
            content: '',
            source: 'pattern',
            patternType: headingType,
            originalLine: line,
            number: numberPart,
            page: pagePart || null
          };

          if (isNumericHeading) {
            currentPath = newPath;
          }

          matched = true;
        }
      }
    }
    
    // 如果没有匹配到标题模式，作为内容添加
    if (!matched && currentSection) {
      // 检查是否是内容行（不是空行，不是过短）
      if (line.length > 5 && !line.match(/^[\d\.\s]+$/)) {
        currentSection.content += line + '\n';
      }
    }
  }
  
  // 添加最后一个章节
  if (currentSection && currentSection.content.trim()) {
    sections.push(currentSection);
  }
  
  return sections;
}

// 第3层：内容特征识别
function extractSectionsFromContent(extractedText) {
  const sections = [];
  const lines = extractedText.split('\n');
  
  // 内容特征检测器
  const titleIndicators = {
    isAllCaps: text => {
      const alphaText = text.replace(/[^A-Za-z]/g, '');
      return alphaText.length > 0 && (text.match(/[A-Z]/g) || []).length / alphaText.length > 0.8;
    },
    isAppropriateLength: text => text.length >= 5 && text.length <= 150,
    endsWithColon: text => text.endsWith(':'),
    hasKeywords: text => /^(STUDY|PATIENT|INVESTIGATIONAL|SAFETY|STATISTICAL|ADMINISTRATIVE|BACKGROUND|INTRODUCTION|OBJECTIVES|PROCEDURES|METHODS|RESULTS|DISCUSSION|CONCLUSIONS)/i.test(text),
    noSentenceEnding: text => !text.includes('.') || text.endsWith(':'),
    startsWithCapital: text => /^[A-Z]/.test(text)
  };
  
  let currentSection = null;
  
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;
    
    // 计算标题分数
    let titleScore = 0;
    
    if (titleIndicators.isAllCaps(line)) titleScore += 3;
    if (titleIndicators.isAppropriateLength(line)) titleScore += 2;
    if (titleIndicators.endsWithColon(line)) titleScore += 2;
    if (titleIndicators.hasKeywords(line)) titleScore += 3;
    if (titleIndicators.noSentenceEnding(line)) titleScore += 1;
    if (titleIndicators.startsWithCapital(line)) titleScore += 1;
    
    // 如果分数足够高，认为是标题
    if (titleScore >= 4) {
      // 保存前一个章节
      if (currentSection && currentSection.content.trim()) {
        sections.push(currentSection);
      }
      
      // 估算层级（基于大写比例和关键词）
      let estimatedLevel = 1;
      if (titleIndicators.isAllCaps(line) && titleIndicators.hasKeywords(line)) {
        estimatedLevel = 1;
      } else if (line.length < 50) {
        estimatedLevel = 2;
      } else {
        estimatedLevel = 3;
      }
      
      currentSection = {
        title: line,
        level: estimatedLevel,
        content: '',
        source: 'content',
        titleScore: titleScore
      };
    } else if (currentSection) {
      // 作为内容添加
      if (line.length > 10) {
        currentSection.content += line + '\n';
      }
    }
  }
  
  // 添加最后一个章节
  if (currentSection && currentSection.content.trim()) {
    sections.push(currentSection);
  }
  
  return sections;
}

// 第4层：合并和去重
function mergeSectionResults(htmlSections, patternSections, contentSections, extractedText) {
  const allSections = [];
  
  // 首先添加模式识别的结果（最可靠）
  allSections.push(...patternSections);
  
  // 添加HTML识别的结果，避免重复
  for (const htmlSection of htmlSections) {
    const isDuplicate = allSections.some(existing => 
      existing.title.toLowerCase().trim() === htmlSection.title.toLowerCase().trim() ||
      (existing.title.length > 10 && htmlSection.title.length > 10 && 
       (existing.title.includes(htmlSection.title) || htmlSection.title.includes(existing.title)))
    );
    
    if (!isDuplicate) {
      allSections.push(htmlSection);
    }
  }
  
  // 添加内容特征识别的结果，避免重复
  for (const contentSection of contentSections) {
    const isDuplicate = allSections.some(existing => 
      existing.title.toLowerCase().trim() === contentSection.title.toLowerCase().trim() ||
      (existing.title.length > 10 && contentSection.title.length > 10 && 
       (existing.title.includes(contentSection.title) || contentSection.title.includes(existing.title)))
    );
    
    if (!isDuplicate && contentSection.titleScore >= 6) { // 只添加高分的内容特征标题
      allSections.push(contentSection);
    }
  }
  
  // 按在原文中的出现顺序排序
  allSections.sort((a, b) => {
    const posA = extractedText.indexOf(a.title);
    const posB = extractedText.indexOf(b.title);
    return posA - posB;
  });
  
  return allSections;
}

// 第5层：AI辅助优化（简化版）
async function optimizeSectionsWithAI(sections) {
  // 当前简化实现：基本清理和验证
  const cleanedSections = sections.filter(section => {
    // 过滤掉过短或无效的标题
    if (!section.title || section.title.length < 3) return false;
    
    // 过滤掉纯数字或纯符号的标题
    if (section.title.match(/^[\d\.\s\-_]+$/)) return false;
    
    // 过滤掉明显的内容行（包含句号且较长）
    if (section.title.includes('.') && section.title.length > 80) return false;
    
    return true;
  });
  
  // 规范化层级
  for (let i = 0; i < cleanedSections.length; i++) {
    const section = cleanedSections[i];
    
    // 根据标题特征调整层级
    if (section.source === 'pattern') {
      // 保持模式识别的层级
      continue;
    } else if (section.title.match(/^[A-Z\s]{10,}$/)) {
      // 全大写长标题通常是主标题
      section.level = 1;
    } else if (section.title.includes('Appendix')) {
      section.level = 1;
    } else if (section.title.startsWith('List of')) {
      section.level = 2;
    }
  }
  
  return cleanedSections;
}

module.exports = {
  parseWordDocumentStructure,
  // 导出可复用的函数供PDF解析使用
  extractSectionsFromPatterns,
  extractSectionsFromContent,
  mergeSectionResults,
  optimizeSectionsWithAI
}; 