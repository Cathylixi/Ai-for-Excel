/**
 * Extract Label and OID Forms from filtered_rows
 * 功能：从每个Form的filtered_rows中提取LabelForm和OIDForm
 * Author: LLX Solutions
 */

const { 
  QUESTION_GAP_THRESHOLD, 
  WORD_GAP_THRESHOLD, 
  LINE_HEIGHT_THRESHOLD, 
  VISUAL_LINE_Y_GAP,
  OID_COLUMN_TOLERANCE,
  OID_HEADER_KEYWORDS 
} = require('../../config/crfConfig');

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
 * 检测question文本的结束位置（基于相邻words的间隙）
 * @param {Array} words - words数组
 * @param {number} gapThreshold - 间隙阈值，默认30px
 * @returns {number} question部分的结束索引，-1表示没有找到大间隙
 */
function findQuestionEndIndex(words, gapThreshold = 30) {
  if (!Array.isArray(words) || words.length <= 1) return -1;
  
  for (let i = 0; i < words.length - 1; i++) {
    const currentWord = words[i];
    const nextWord = words[i + 1];
    
    // 计算相邻words的间隙
    const gap = nextWord.x0 - currentWord.x1;
    
    if (gap > gapThreshold) {
      // 发现大间隙，返回question部分的结束索引
      return i;
    }
  }
  
  // 没有找到大间隙，返回-1
  return -1;
}

/**
 * 获取question部分的words数组（基于间隙检测）
 * @param {Array} words - 原始words数组
 * @param {number} gapThreshold - 间隙阈值，默认30px
 * @returns {Array} question部分的words数组
 */
function getQuestionWords(words, gapThreshold = 30) {
  if (!Array.isArray(words) || words.length === 0) return words;
  
  const questionEndIndex = findQuestionEndIndex(words, gapThreshold);
  
  if (questionEndIndex === -1) {
    // 没有找到大间隙，返回所有words
    return words;
  } else {
    // 返回question部分的words（从0到questionEndIndex）
    return words.slice(0, questionEndIndex + 1);
  }
}

/**
 * 计算question部分的坐标范围
 * @param {Array} questionWords - question部分的words数组
 * @returns {Object|null} 重新计算的坐标信息
 */
function calculateQuestionCoordinates(questionWords) {
  if (!Array.isArray(questionWords) || questionWords.length === 0) {
    return null;
  }
  
  const x_min = Math.min(...questionWords.map(w => w.x0));
  const x_max = Math.max(...questionWords.map(w => w.x1));
  const y_min = Math.min(...questionWords.map(w => w.y0));
  const y_max = Math.max(...questionWords.map(w => w.y1));
  const y_center = (y_min + y_max) / 2;
  const width = x_max - x_min;
  
  return { x_min, x_max, y_min, y_max, y_center, width };
}

/**
 * 获取question部分的文本内容
 * @param {Array} words - 原始words数组
 * @param {number} gapThreshold - 间隙阈值，默认30px
 * @returns {string} question部分的文本
 */
function getQuestionText(words, gapThreshold = 30) {
  const questionWords = getQuestionWords(words, gapThreshold);
  return questionWords.map(w => w.text).join(' ');
}

/**
 * 🆕 从单行数据中解析出 Question / Value / Index 三部分
 * 升级版逻辑：支持处理"被压扁"的多行数据 (Squashed Rows)
 * @param {Object} row - 行对象，包含 words 数组
 * @returns {Object} 包含 question、value、index 三部分的对象
 */
function parseRowSegments(row) {
  const result = {
    question: null,
    value: null,
    index: null,
    unclassified: null
  };

  if (!row || !Array.isArray(row.words) || row.words.length === 0) {
    return result;
  }

  const page_number = row.page_number;

  // ========== Step 0: 视觉解压 ==========
  // 将 words 按 Y 轴拆分成视觉行（处理被压扁的情况）
  const visualLines = groupWordsIntoVisualLines(row.words);
  if (visualLines.length === 0) return result;

  // ========== Step 1: 分析第一行 (Anchor Line) ==========
  const anchorLineWords = visualLines[0];
  let indexWords = [];
  let remainingWords = [...anchorLineWords];

  // 1.1 在第一行末尾找 Index
  for (let i = anchorLineWords.length - 1; i >= 0; i--) {
    const word = anchorLineWords[i];
    const text = (word.text || '').trim();
    if (/^\d+$/.test(text)) {
      indexWords = [word];
      remainingWords = anchorLineWords.slice(0, i);
      break;
    } else if (text.length > 0) {
      break;
    }
  }

  // 构建 Index Part
  if (indexWords.length > 0) {
    result.index = {
      text: indexWords.map(w => w.text).join(' '),
      bbox: calculateBboxFromWords(indexWords),
      page_number: page_number,
      words: indexWords
    };
  }

  // 1.2 在第一行剩余部分找 Gap 切分 Question / Value
  let questionWords = [];
  let valueWords = [];
  
  if (remainingWords.length > 0) {
    const gaps = [];
    for (let i = 0; i < remainingWords.length - 1; i++) {
      const curr = remainingWords[i];
      const next = remainingWords[i + 1];
      const gap = next.x0 - curr.x1;
      if (gap > WORD_GAP_THRESHOLD) {
        gaps.push({ afterIndex: i, gapSize: gap });
      }
    }

    if (gaps.length > 0) {
      const firstGap = gaps[0];
      questionWords = remainingWords.slice(0, firstGap.afterIndex + 1);
      valueWords = remainingWords.slice(firstGap.afterIndex + 1);
    } else {
      // 没有间隙：如果有 Index，默认归为 Question；否则暂不分类
      if (result.index) {
        questionWords = remainingWords;
      } else {
        // 对于单行未分类的情况，默认归入Question以便后续作为Header
        questionWords = remainingWords; 
      }
    }
  }

  // 辅助函数：更新或初始化 Part
  const updatePart = (key, newWords) => {
    if (newWords.length === 0) return;
    const text = newWords.map(w => w.text).join(' ');
    const bbox = calculateBboxFromWords(newWords);
    if (!result[key]) {
      result[key] = { text, bbox, page_number, words: [...newWords] };
    } else {
      result[key].text += ' ' + text;
      result[key].words.push(...newWords);
      result[key].bbox.x_min = Math.min(result[key].bbox.x_min, bbox.x_min);
      result[key].bbox.x_max = Math.max(result[key].bbox.x_max, bbox.x_max);
      result[key].bbox.y_min = Math.min(result[key].bbox.y_min, bbox.y_min);
      result[key].bbox.y_max = Math.max(result[key].bbox.y_max, bbox.y_max);
    }
  };

  // 初始化第一行的 Question 和 Value
  updatePart('question', questionWords);
  updatePart('value', valueWords);

  // ========== Step 2: 递归处理剩余视觉行 (Recursive Classification) ==========
  const questionZone = result.question ? result.question.bbox : null;
  let valueZone = result.value ? result.value.bbox : null;

  for (let i = 1; i < visualLines.length; i++) {
    const lineWords = visualLines[i];
    const lineBbox = calculateBboxFromWords(lineWords);
    const center = (lineBbox.x_min + lineBbox.x_max) / 2;

    let assigned = false;

    // 2.1 优先尝试归入 Value Zone
    if (valueZone) {
      if (center >= valueZone.x_min && center <= valueZone.x_max) {
        updatePart('value', lineWords);
        valueZone = result.value.bbox; // 更新 Zone
        assigned = true;
      }
    }

    // 2.2 如果还没有 Value Zone，但位置明显在 Question 右侧，创建 Value
    if (!assigned && !valueZone && questionZone) {
      if (center > questionZone.x_max + 40) {
        updatePart('value', lineWords);
        valueZone = result.value.bbox;
        assigned = true;
      }
    }

    // 2.3 尝试归入 Question Zone
    if (!assigned && questionZone) {
      if (center >= questionZone.x_min && center <= questionZone.x_max) {
        updatePart('question', lineWords);
        assigned = true;
      }
    }

    // 2.4 兜底：如果已有 Value，剩余不明物体通常也是 Value 的延续
    if (!assigned) {
      if (result.value) {
        updatePart('value', lineWords);
      } else {
        updatePart('question', lineWords);
      }
    }
  }

  // 如果最后没有任何归类（非 Anchor 行的情况）
  if (!result.question && !result.value && !result.index) {
    const allText = row.words.map(w => w.text).join(' ');
    result.unclassified = {
      text: allText,
      bbox: calculateBboxFromWords(row.words),
      page_number,
      words: row.words
    };
  }

  return result;
}

/**
 * 🆕 从 words 数组计算包围盒 (bounding box)
 * @param {Array} words - words 数组
 * @returns {Object} bbox 对象 {x_min, x_max, y_min, y_max}
 */
function calculateBboxFromWords(words) {
  if (!Array.isArray(words) || words.length === 0) {
    return { x_min: 0, x_max: 0, y_min: 0, y_max: 0 };
  }

  const x_min = Math.min(...words.map(w => w.x0));
  const x_max = Math.max(...words.map(w => w.x1));
  const y_min = Math.min(...words.map(w => w.y0));
  const y_max = Math.max(...words.map(w => w.y1));

  return { x_min, x_max, y_min, y_max };
}

/**
 * 🆕 辅助函数：将 words 按 Y 轴坐标分组为视觉行
 * 用于处理被压扁的多行数据
 * @param {Array} words - words 数组
 * @returns {Array<Array>} 二维数组，每一项是一行的 words
 */
function groupWordsIntoVisualLines(words) {
  if (!words || words.length === 0) return [];
  
  // 1. 按 Y 坐标排序，Y 接近的按 X 排序
  const sorted = [...words].sort((a, b) => {
    const yDiff = Math.abs(a.y0 - b.y0);
    if (yDiff > VISUAL_LINE_Y_GAP) return a.y0 - b.y0;
    return a.x0 - b.x0;
  });

  const lines = [];
  let currentLine = [sorted[0]];
  let currentLineYCenter = sorted[0].y0;

  for (let i = 1; i < sorted.length; i++) {
    const word = sorted[i];
    
    // 2. 如果当前词的 Y 与当前行的 Y 基准差异太大，开新行
    if (Math.abs(word.y0 - currentLineYCenter) > VISUAL_LINE_Y_GAP) {
      lines.push(currentLine);
      currentLine = [word];
      currentLineYCenter = word.y0;
    } else {
      currentLine.push(word);
      // 更新 Y 基准为当前行所有词的平均 Y
      currentLineYCenter = currentLine.reduce((sum, w) => sum + w.y0, 0) / currentLine.length;
    }
  }
  lines.push(currentLine);
  
  // 3. 每一行内部再按 X 排序（确保从左到右）
  lines.forEach(line => line.sort((a, b) => a.x0 - b.x0));
  
  return lines;
}

/**
 * 🆕 探测 OID 表头行
 * @param {Array} rows - filtered_rows 数组
 * @returns {Object|null} 表头行对象，或 null
 */
function detectOidHeaderRow(rows) {
  if (!rows || rows.length === 0) return null;
  
  const scanLimit = Math.min(30, rows.length);
  
  for (let i = 0; i < scanLimit; i++) {
    const row = rows[i];
    const text = (row.full_text || '').toLowerCase();
    
    // 计算匹配的关键字数量
    let matchCount = 0;
    for (const keyword of OID_HEADER_KEYWORDS) {
      if (text.includes(keyword.toLowerCase())) {
        matchCount++;
      }
    }
    
    // 至少匹配 3 个关键字才认为是表头
    if (matchCount >= 3) {
      return {
        row_index: i,
        row: row
      };
    }
  }
  
  return null;
}

/**
 * 🆕 基于表头行构建列 Zone 映射
 * @param {Object} headerRow - 表头行对象
 * @param {Number} pageRightEdge - 页面右边界 (x1_max)
 * @returns {Array} 列 Zone 数组
 */
function buildOidColumnZones(headerRow, pageRightEdge) {
  if (!headerRow || !headerRow.words || headerRow.words.length === 0) {
    return [];
  }
  
  const words = [...headerRow.words].sort((a, b) => a.x0 - b.x0);
  
  // 定义可能的列名模式（支持多词列名）
  const columnPatterns = [
    { pattern: /^field\s*name$/i, name: 'FieldName' },
    { pattern: /^data\s*type$/i, name: 'DataType' },
    { pattern: /^units?$/i, name: 'Units' },
    { pattern: /^values?$/i, name: 'Values' },
    { pattern: /^pre[-\s]*filled\s*values?$/i, name: 'PreFilledValues' },
    { pattern: /^include\s*field\s*oid$/i, name: 'IncludeFieldOID' },
    // 简化匹配（单词）
    { pattern: /^field$/i, name: '_field' },
    { pattern: /^name$/i, name: '_name' },
    { pattern: /^data$/i, name: '_data' },
    { pattern: /^type$/i, name: '_type' },
    { pattern: /^include$/i, name: '_include' },
    { pattern: /^oid$/i, name: '_oid' }
  ];
  
  // 先尝试合并相邻词形成完整列名
  const mergedColumns = [];
  let i = 0;
  
  while (i < words.length) {
    const word = words[i];
    const text = word.text.trim();
    const nextWord = words[i + 1];
    const nextNextWord = words[i + 2];
    
    // 尝试三词合并（如 "Include Field OID"）
    if (nextWord && nextNextWord) {
      const threeWordText = `${text} ${nextWord.text} ${nextNextWord.text}`.trim();
      const threeWordMatch = columnPatterns.find(p => p.pattern.test(threeWordText) && !p.name.startsWith('_'));
      if (threeWordMatch) {
        mergedColumns.push({
          name: threeWordMatch.name,
          x_start: word.x0,
          x_end: nextNextWord.x1
        });
        i += 3;
        continue;
      }
    }
    
    // 尝试两词合并（如 "Field Name", "Data Type"）
    if (nextWord) {
      const twoWordText = `${text} ${nextWord.text}`.trim();
      const twoWordMatch = columnPatterns.find(p => p.pattern.test(twoWordText) && !p.name.startsWith('_'));
      if (twoWordMatch) {
        mergedColumns.push({
          name: twoWordMatch.name,
          x_start: word.x0,
          x_end: nextWord.x1
        });
        i += 2;
        continue;
      }
    }
    
    // 单词匹配（如 "Units", "Values"）
    const singleMatch = columnPatterns.find(p => p.pattern.test(text) && !p.name.startsWith('_'));
    if (singleMatch) {
      mergedColumns.push({
        name: singleMatch.name,
        x_start: word.x0,
        x_end: word.x1
      });
    }
    
    i++;
  }
  
  // 构建 Zone（每个列的 x 范围）
  const zones = [];
  for (let j = 0; j < mergedColumns.length; j++) {
    const col = mergedColumns[j];
    const nextCol = mergedColumns[j + 1];
    
    zones.push({
      name: col.name,
      x_min: col.x_start - OID_COLUMN_TOLERANCE,
      x_max: nextCol ? (nextCol.x_start - 1) : (pageRightEdge + OID_COLUMN_TOLERANCE),
      header_x_center: (col.x_start + col.x_end) / 2
    });
  }
  
  return zones;
}

/**
 * 🆕 解析单行 OID 数据（支持视觉解压 + 列归类）
 * @param {Object} row - 行对象
 * @param {Array} columnZones - 列 Zone 数组
 * @returns {Object} 结构化的 OID 数据
 */
function parseOidRowSegments(row, columnZones) {
  const result = {
    index: null,
    columns: {},  // { FieldName: {...}, DataType: {...}, ... }
    unclassified: null
  };
  
  if (!row || !Array.isArray(row.words) || row.words.length === 0) {
    return result;
  }
  
  const page_number = row.page_number;
  
  // Step 0: 视觉解压
  const visualLines = groupWordsIntoVisualLines(row.words);
  if (visualLines.length === 0) return result;
  
  // 初始化列容器
  columnZones.forEach(zone => {
    result.columns[zone.name] = {
      text: '',
      words: [],
      bbox: null,
      page_number: page_number
    };
  });
  
  // Step 1: 提取 Index（行首整数）
  const firstLineWords = visualLines[0];
  let indexWord = null;
  let remainingFirstLineWords = [...firstLineWords];
  
  // 找行首的整数
  if (firstLineWords.length > 0) {
    const firstWord = firstLineWords[0];
    const text = (firstWord.text || '').trim();
    if (/^\d+$/.test(text)) {
      indexWord = firstWord;
      remainingFirstLineWords = firstLineWords.slice(1);
    }
  }
  
  if (indexWord) {
    result.index = {
      text: indexWord.text,
      bbox: { x_min: indexWord.x0, x_max: indexWord.x1, y_min: indexWord.y0, y_max: indexWord.y1 },
      page_number: page_number,
      words: [indexWord]
    };
  }
  
  // Step 2: 将所有词投递到对应的列
  const allRemainingWords = [
    ...remainingFirstLineWords,
    ...visualLines.slice(1).flat()
  ];
  
  const assignWordToColumn = (word) => {
    const center = (word.x0 + word.x1) / 2;
    
    for (const zone of columnZones) {
      if (center >= zone.x_min && center <= zone.x_max) {
        const col = result.columns[zone.name];
        if (col.text.length > 0) {
          col.text += ' ';
        }
        col.text += word.text;
        col.words.push(word);
        
        // 更新 bbox
        if (!col.bbox) {
          col.bbox = { x_min: word.x0, x_max: word.x1, y_min: word.y0, y_max: word.y1 };
        } else {
          col.bbox.x_min = Math.min(col.bbox.x_min, word.x0);
          col.bbox.x_max = Math.max(col.bbox.x_max, word.x1);
          col.bbox.y_min = Math.min(col.bbox.y_min, word.y0);
          col.bbox.y_max = Math.max(col.bbox.y_max, word.y1);
        }
        return true;
      }
    }
    return false;
  };
  
  const unclassifiedWords = [];
  allRemainingWords.forEach(word => {
    if (!assignWordToColumn(word)) {
      unclassifiedWords.push(word);
    }
  });
  
  // 处理未分类的词
  if (unclassifiedWords.length > 0) {
    result.unclassified = {
      text: unclassifiedWords.map(w => w.text).join(' '),
      words: unclassifiedWords,
      bbox: calculateBboxFromWords(unclassifiedWords),
      page_number: page_number
    };
  }
  
  // 清理空列（text 为空的列设为 null）
  Object.keys(result.columns).forEach(key => {
    if (result.columns[key].text === '') {
      result.columns[key] = null;
    }
  });
  
  return result;
}

/**
 * 🆕 合并属于同一 Index 的多行 OID 数据
 * @param {Array} rows - 所有行
 * @param {Number} startIndex - 锚点行索引
 * @param {Object} anchorSegments - 锚点行的解析结果
 * @param {Array} columnZones - 列 Zone 数组
 * @returns {Object} 合并后的结果
 */
function mergeConsecutiveOidRows(rows, startIndex, anchorSegments, columnZones) {
  const result = {
    mergedIndex: anchorSegments.index ? { ...anchorSegments.index } : null,
    mergedColumns: {},
    consumedRowCount: 1,
    consumedRows: [rows[startIndex]],
    mergedWords: [...(rows[startIndex].words || [])]
  };
  
  // 深拷贝锚点行的列数据
  Object.keys(anchorSegments.columns).forEach(key => {
    if (anchorSegments.columns[key]) {
      result.mergedColumns[key] = {
        text: anchorSegments.columns[key].text,
        words: [...(anchorSegments.columns[key].words || [])],
        bbox: anchorSegments.columns[key].bbox ? { ...anchorSegments.columns[key].bbox } : null,
        page_number: anchorSegments.columns[key].page_number
      };
    } else {
      result.mergedColumns[key] = null;
    }
  });
  
  if (!anchorSegments.index) {
    // 没有 Index 的行不进行合并
    return result;
  }
  
  const anchorRow = rows[startIndex];
  const anchorPage = anchorRow.page_number;
  let previousRow = anchorRow;
  let j = startIndex + 1;
  
  while (j < rows.length) {
    const nextRow = rows[j];
    
    // Rule 1: 页面守卫
    if (nextRow.page_number !== anchorPage) {
      break;
    }
    
    // Rule 2: 垂直守卫（使用 LINE_HEIGHT_THRESHOLD = 15px）
    const yGap = nextRow.y_min - previousRow.y_max;
    if (yGap > LINE_HEIGHT_THRESHOLD) {
      break;
    }
    
    // Rule 3: Index 守卫 - 检查下一行是否有新的 Index
    const nextSegments = parseOidRowSegments(nextRow, columnZones);
    if (nextSegments.index) {
      // 下一行有新的 Index，停止合并
      break;
    }
    
    // 合并列数据
    Object.keys(nextSegments.columns).forEach(key => {
      const nextCol = nextSegments.columns[key];
      if (!nextCol) return;
      
      if (!result.mergedColumns[key]) {
        result.mergedColumns[key] = {
          text: nextCol.text,
          words: [...nextCol.words],
          bbox: nextCol.bbox ? { ...nextCol.bbox } : null,
          page_number: nextCol.page_number
        };
      } else {
        // 追加文本
        if (nextCol.text) {
          result.mergedColumns[key].text += ' ' + nextCol.text;
        }
        // 追加 words
        if (nextCol.words) {
          result.mergedColumns[key].words.push(...nextCol.words);
        }
        // 扩展 bbox
        if (nextCol.bbox && result.mergedColumns[key].bbox) {
          result.mergedColumns[key].bbox.x_min = Math.min(result.mergedColumns[key].bbox.x_min, nextCol.bbox.x_min);
          result.mergedColumns[key].bbox.x_max = Math.max(result.mergedColumns[key].bbox.x_max, nextCol.bbox.x_max);
          result.mergedColumns[key].bbox.y_min = Math.min(result.mergedColumns[key].bbox.y_min, nextCol.bbox.y_min);
          result.mergedColumns[key].bbox.y_max = Math.max(result.mergedColumns[key].bbox.y_max, nextCol.bbox.y_max);
        } else if (nextCol.bbox) {
          result.mergedColumns[key].bbox = { ...nextCol.bbox };
        }
      }
    });
    
    result.consumedRowCount++;
    result.consumedRows.push(nextRow);
    if (nextRow.words) {
      result.mergedWords.push(...nextRow.words);
    }
    previousRow = nextRow;
    j++;
  }
  
  return result;
}

/**
 * 🆕 合并连续的换行行（贪婪消费逻辑 + 智能归并）
 * @param {Array} rows - 所有行的数组
 * @param {Number} startIndex - 锚点行的索引
 * @param {Object} anchorSegments - 锚点行的 segments（由 parseRowSegments 返回）
 * @returns {Object} 合并后的结果
 */
function mergeConsecutiveRows(rows, startIndex, anchorSegments) {
  const VALUE_ZONE_OFFSET = 40;

  const result = {
    mergedQuestion: anchorSegments.question ? { ...anchorSegments.question } : null,
    mergedValue: anchorSegments.value ? { ...anchorSegments.value } : null,
    mergedIndex: anchorSegments.index ? { ...anchorSegments.index } : null,
    consumedRowCount: 1, // 至少消费了锚点行自己
    consumedRows: [rows[startIndex]], // 🔥 新增：收集所有被消费的行
    mergedWords: [...(rows[startIndex].words || [])] // 🔥 新增：收集所有 words
  };

  if (!anchorSegments.question) {
    // 如果锚点行连 Question 都没有，不继续合并
    return result;
  }

  const anchorRow = rows[startIndex];
  const anchorPage = anchorRow.page_number;
  const questionXRange = anchorSegments.question.bbox;
  let valueXRange = anchorSegments.value ? { ...anchorSegments.value.bbox } : null;

  let j = startIndex + 1;
  let previousRow = anchorRow;

  while (j < rows.length) {
    const nextRow = rows[j];

    // Rule 1: 页面守卫 - 必须在同一页
    if (nextRow.page_number !== anchorPage) {
      break;
    }

    // Rule 2: 垂直守卫 - Y 轴距离不能太大
    const yGap = nextRow.y_min - previousRow.y_max;
    if (yGap > LINE_HEIGHT_THRESHOLD) {
      break;
    }

    // 🔥 智能归并：先切分下一行
    const nextSegments = parseRowSegments(nextRow);

    // Rule 3: Index 守卫 - 如果下一行有 Index，说明是新问题，停止合并！
    if (nextSegments.index) {
      break;
    }

    let isMerged = false;

    const mergeInto = (key, segment) => {
      if (!segment) return;
      if (!result[key]) {
        result[key] = { ...segment };
      } else {
        result[key].text += ' ' + segment.text;
        if (segment.words) {
          if (!result[key].words) result[key].words = [];
          result[key].words.push(...segment.words);
        }
        const bbox = result[key].bbox;
        bbox.x_min = Math.min(bbox.x_min, segment.bbox.x_min);
        bbox.x_max = Math.max(bbox.x_max, segment.bbox.x_max);
        bbox.y_min = Math.min(bbox.y_min, segment.bbox.y_min);
        bbox.y_max = Math.max(bbox.y_max, segment.bbox.y_max);
      }
    };

    const isInZone = (segmentBbox, zone) => {
      if (!zone) return false;
      const overlap = Math.min(segmentBbox.x_max, zone.x_max) - Math.max(segmentBbox.x_min, zone.x_min);
      const segWidth = segmentBbox.x_max - segmentBbox.x_min;
      if (segWidth <= 0) return false;
      const overlapRatio = overlap / segWidth;
      const center = (segmentBbox.x_min + segmentBbox.x_max) / 2;
      return overlapRatio >= 0.3 || (center >= zone.x_min && center <= zone.x_max);
    };

    const classifyAndMerge = (segment, preferValueFallback = false) => {
      if (!segment) return false;
      const bbox = segment.bbox;
      const center = (bbox.x_min + bbox.x_max) / 2;
      const inQuestion = isInZone(bbox, questionXRange);
      const inValue = isInZone(bbox, valueXRange);

      if (inQuestion && !preferValueFallback) {
        mergeInto('mergedQuestion', segment);
        return true;
      }

      if (inValue || preferValueFallback) {
        mergeInto('mergedValue', segment);
        valueXRange = result.mergedValue?.bbox ? { ...result.mergedValue.bbox } : valueXRange;
        return true;
      }

      if (!valueXRange) {
        const fallsRightOfQuestion = bbox.x_min >= questionXRange.x_max + VALUE_ZONE_OFFSET;
        if (fallsRightOfQuestion) {
          mergeInto('mergedValue', segment);
          valueXRange = result.mergedValue?.bbox ? { ...result.mergedValue.bbox } : {
            x_min: bbox.x_min,
            x_max: bbox.x_max,
            y_min: bbox.y_min,
            y_max: bbox.y_max
          };
          return true;
        }
      }

      return false;
    };

    // 尝试归并 Question 部分
    if (nextSegments.question) {
      const merged = classifyAndMerge(nextSegments.question);
      if (!merged && valueXRange) {
        // 强制作为Value
        const fallbackMerged = classifyAndMerge(nextSegments.question, true);
        isMerged = isMerged || fallbackMerged;
      } else {
        isMerged = isMerged || merged;
      }
    }

    // 尝试归并 Value 部分
    if (nextSegments.value) {
      if (classifyAndMerge(nextSegments.value, true)) {
        isMerged = true;
      }
    }

    // 尝试处理未分类部分
    if (nextSegments.unclassified) {
      if (classifyAndMerge(nextSegments.unclassified)) {
        isMerged = true;
      } else if (classifyAndMerge(nextSegments.unclassified, true)) {
        isMerged = true;
      }
    }

    // 如果这一行被部分或全部归并了
    if (isMerged) {
      result.consumedRowCount++;
      result.consumedRows.push(nextRow); // 🔥 记录行
      if (nextRow.words) {
        result.mergedWords.push(...nextRow.words); // 🔥 记录 words
      }
      previousRow = nextRow;
      j++;
    } else {
      // 既不属于 Question 也不属于 Value，停止合并
      break;
    }
  }

  return result;
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
      // 🔥 新逻辑：直接使用 question_part.text（如果没有则回退到 full_text）
      let text = '';
      if (it.content?.question_part?.text) {
        text = it.content.question_part.text; // 只包含 Question，不需要 strip
      } else {
        // 回退到旧逻辑（向后兼容）
        text = String(it.content?.full_text || '');
        text = stripTrailingInteger(text);
      }
      labelMap.set(it.match_index, text);
    }
  });
  const oidMap = new Map();
  (oidArr || []).forEach(it => {
    if (typeof it?.match_index === 'number') {
      // 🆕 优先使用结构化的 FieldName 列
      let text = '';
      if (it.content?.columns?.FieldName?.text) {
        text = it.content.columns.FieldName.text;
      } else {
        // 回退到旧逻辑
        text = String(it.content?.full_text || '');
        text = stripLeadingInteger(text);
      }
      oidMap.set(it.match_index, text);
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
  const epsilon = 17;

  // console.log(`📐 Form坐标统计: x0_min=${x0_min.toFixed(1)}, x1_max=${x1_max.toFixed(1)}, epsilon=${epsilon}`);

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
  
  // 2. 行内不含"=" - 🔥 已移除此规则
  // if (fullText.includes('=')) return false;
  
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
  
  // 2. 行内不含"=" - 🔥 已移除此规则
  // if (fullText.includes('=')) return false;
  
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
  // console.log(`🔍 处理Form "${formKey}": ${form.filtered_rows?.length || 0}行`);
  
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
  const rows = form.filtered_rows;

  // 🆕 探测 OID 表头并构建列 Zone
  const oidHeaderResult = detectOidHeaderRow(rows);
  let oidColumnZones = [];
  if (oidHeaderResult) {
    oidColumnZones = buildOidColumnZones(oidHeaderResult.row, coords.x1_max);
    // console.log(`🆔 检测到 OID 表头在第 ${oidHeaderResult.row_index} 行，共 ${oidColumnZones.length} 列`);
  }

  // 2. 使用 while 循环遍历所有行（支持跳过已合并的行）
  let i = 0;
  while (i < rows.length) {
    const currentRow = rows[i];
    
    // Label 候选检查
    const labelCoordOk = isLabelCandidate(currentRow, coords);
    const labelTextOk = checkLabelTextRules(currentRow);
    
    if (labelCoordOk && labelTextOk) {
      // 这是一个 Label 候选行
      // Step A: 解析单行的 segments
      const segments = parseRowSegments(currentRow);
      
      if (!segments.index) {
        // 没有 index，不是有效的 Label，跳过
        i++;
        continue;
      }

      // Step B: 尝试合并后续的换行行
      const mergedResult = mergeConsecutiveRows(rows, i, segments);
      
      // Step C: 构建最终的 content 对象
      const matchIndex = Number(segments.index.text);
      
      // 🔥 重建完整的 full_text（包含所有合并行的文本）
      const mergedFullText = mergedResult.consumedRows
        .map(row => row.full_text || row.words.map(w => w.text).join(' '))
        .join(' '); // 用空格拼接

      // 🔥 重建完整的 words（包含所有合并行的 words）
      const mergedWords = mergedResult.mergedWords;

      // 保留旧字段以兼容现有逻辑（full_text_without_number）
      let fullTextWithoutNumber = null;
      if (mergedResult.mergedQuestion) {
        fullTextWithoutNumber = {
          text: mergedResult.mergedQuestion.text,
          y_center: (mergedResult.mergedQuestion.bbox.y_min + mergedResult.mergedQuestion.bbox.y_max) / 2,
          x_min: mergedResult.mergedQuestion.bbox.x_min,
          x_max: mergedResult.mergedQuestion.bbox.x_max,
          y_min: mergedResult.mergedQuestion.bbox.y_min,
          y_max: mergedResult.mergedQuestion.bbox.y_max,
          width: mergedResult.mergedQuestion.bbox.x_max - mergedResult.mergedQuestion.bbox.x_min
        };
      }

      labelCandidates.push({
        match_index: matchIndex,
        content: {
          ...currentRow, // 保留原始行数据（兼容性）
          full_text: mergedFullText, // 🔥 更新：覆盖为完整的合并文本
          words: mergedWords, // 🔥 更新：覆盖为完整的 words 列表
          full_text_without_number: fullTextWithoutNumber, // 旧字段（兼容性）
          // 🔥 新增字段：结构化的三部分
          question_part: mergedResult.mergedQuestion,
          value_part: mergedResult.mergedValue,
          index_part: mergedResult.mergedIndex
        }
      });

      // console.log(`📋 Label行: "${mergedResult.mergedQuestion?.text?.substring(0, 50)}..." → match_index=${matchIndex}, 消费了${mergedResult.consumedRowCount}行`);

      // Step D: 跳过已消费的行
      i += mergedResult.consumedRowCount;
      continue;
    }
    
    // OID 候选检查（升级版逻辑）
    const oidCoordOk = isOidCandidate(currentRow, coords);
    const oidTextOk = checkOidTextRules(currentRow);
    
    if (oidCoordOk && oidTextOk) {
      // 🆕 如果有列 Zone，使用新的解析逻辑
      if (oidColumnZones.length > 0) {
        const oidSegments = parseOidRowSegments(currentRow, oidColumnZones);
        
        if (!oidSegments.index) {
          // 没有 Index，跳过
          i++;
          continue;
        }
        
        // 🆕 尝试合并后续行
        const mergedOidResult = mergeConsecutiveOidRows(rows, i, oidSegments, oidColumnZones);
        
        const matchIndex = Number(oidSegments.index.text);
        
        // 构建完整的 full_text
        const mergedFullText = mergedOidResult.consumedRows
          .map(r => r.full_text || r.words.map(w => w.text).join(' '))
          .join(' ');
        
        oidCandidates.push({
          match_index: matchIndex,
          content: {
            ...currentRow,
            full_text: mergedFullText,
            words: mergedOidResult.mergedWords,
            // 🆕 结构化字段
            index_part: mergedOidResult.mergedIndex,
            columns: mergedOidResult.mergedColumns
          }
        });
        
        // 跳过已消费的行
        i += mergedOidResult.consumedRowCount;
        continue;
        
      } else {
        // 回退到旧逻辑（没有表头的情况）
        const matchIndex = getFirstIntegerFromTokens(getRowTokens(currentRow));
        oidCandidates.push({
          match_index: matchIndex,
          content: { ...currentRow }
        });
      }
    }

    i++;
  }

  // console.log(`✅ Form "${formKey}": ${labelCandidates.length}个Label行, ${oidCandidates.length}个OID行`);

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

  // console.log('🚀 开始为所有Forms添加LabelForm和OIDForm...');
  
  const formKeys = Object.keys(crfFormList);
  // console.log(`📊 共${formKeys.length}个Forms需要处理: ${formKeys.join(', ')}`);

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

  // console.log('🎉 所有Forms的Label/OID提取完成');
  return crfFormList;
}

module.exports = {
  addLabelOidToAllForms,
  extractLabelOidFromForm,
  calculateFormCoordinates,
  isInteger,
  containsNumber,
  getRowTokens,
  // 🆕 新增的函数（可供测试使用）
  parseRowSegments,
  calculateBboxFromWords,
  mergeConsecutiveRows,
  // 🆕 新增的 OID 函数
  detectOidHeaderRow,
  buildOidColumnZones,
  parseOidRowSegments,
  mergeConsecutiveOidRows
};
