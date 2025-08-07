const pdfParse = require('pdf-parse');
const fs = require('fs');
const path = require('path');
const pdf2image = require('pdf2image');
const { identifyAssessmentScheduleWithAI } = require('./openaiService');
const OpenAI = require('openai');

// 导入Word解析中可复用的函数
const {
  extractSectionsFromPatterns,
  extractSectionsFromContent, 
  mergeSectionResults,
  optimizeSectionsWithAI
} = require('./wordParserService');

// 初始化OpenAI客户端
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

/**
 * 🎯 新的AI表格识别+混合处理策略
 * 
 * 第1步：PDF转图片准备工作
 * 第2步：逐页AI表格识别（低成本）
 * 第3步：分流处理（AI视觉 vs 本地算法）
 * 第4步：结果合并与Schedule识别
 */
async function parsePdfDocumentStructure(filePath) {
  try {
    console.log('🎯 启动AI表格识别+混合处理策略...');
    
    // ==================== 第1步：PDF转图片准备工作 ====================
    console.log('📋 第1步：PDF转图片准备工作');
    
    // 1.1 获取PDF基本信息
    const fileBuffer = fs.readFileSync(filePath);
    const pdfData = await pdfParse(fileBuffer);
    const totalPages = pdfData.numpages;
    
    console.log(`📄 PDF基本信息:`);
    console.log(`   - 总页数: ${totalPages}`);
    console.log(`   - 总文本长度: ${pdfData.text.length}`);
    console.log(`   - 文件大小: ${(fileBuffer.length / 1024 / 1024).toFixed(2)} MB`);
    
    // 1.2 准备临时目录
    const tempDir = path.join(__dirname, '../temp');
    if (!fs.existsSync(tempDir)) {
      fs.mkdirSync(tempDir, { recursive: true });
      console.log(`📁 创建临时目录: ${tempDir}`);
    }
    
    // 1.3 批量转换所有页面为图片
    console.log('🔄 开始批量转换PDF页面为图片...');
    const pageImages = await convertAllPagesToImages(filePath, totalPages, tempDir);
    console.log(`✅ 成功转换 ${pageImages.length} 页为图片`);
    
    // 1.4 按页分割文本内容
    const pageTexts = splitPdfTextByPages(pdfData.text);
    console.log(`📖 成功分割为 ${pageTexts.length} 页文本`);
    
    // 1.5 验证图片和文本页数匹配
    if (pageImages.length !== pageTexts.length) {
      console.warn(`⚠️ 警告: 图片页数(${pageImages.length}) 与文本页数(${pageTexts.length}) 不匹配`);
    }
    
    // 准备工作完成，返回准备好的数据
    const preparationResult = {
      totalPages,
      pageImages,
      pageTexts,
      tempDir,
      pdfInfo: {
        pages: totalPages,
        textLength: pdfData.text.length,
        fileSize: fileBuffer.length
      }
    };
    
    console.log('✅ 第1步完成：PDF转图片准备工作已就绪');
    console.log(`📊 准备完成统计:`);
    console.log(`   - 图片文件: ${pageImages.length} 个`);
    console.log(`   - 文本分页: ${pageTexts.length} 个`);
    console.log(`   - 临时目录: ${tempDir}`);
    
    // TODO: 接下来将实现第2步：逐页AI表格识别
    // TODO: 接下来将实现第3步：分流处理 
    // TODO: 接下来将实现第4步：结果合并
    
    // 暂时返回一个简单的结果，待后续步骤实现
    return {
      parseInfo: {
        hasStructuredContent: true,
        sectionsCount: 0, // 待实现
        tablesCount: 0, // 待实现
        parseMethod: 'pdf-hybrid-ai-vision-v2',
        hasAssessmentSchedule: false, // 待实现
        originalPages: totalPages,
        textParsingPages: 0, // 待统计
        aiVisualPages: 0 // 待统计
      },
      sectionedText: [], // 待实现
      tables: [], // 待实现
      assessmentSchedule: null // 待实现
    };
    
  } catch (error) {
    console.error('❌ PDF解析失败:', error);
    return {
      parseInfo: {
        hasStructuredContent: false,
        sectionsCount: 0,
        tablesCount: 0,
        parseMethod: 'pdf-fallback',
        hasAssessmentSchedule: false,
        originalPages: 0,
        textParsingPages: 0,
        aiVisualPages: 0
      },
      sectionedText: [],
      tables: [],
      assessmentSchedule: null
    };
  }
}

/**
 * 🔄 批量转换PDF所有页面为图片
 * 这是第1步的核心函数，负责将PDF的每一页都转换为高质量图片
 */
async function convertAllPagesToImages(pdfPath, totalPages, outputDir) {
  const pageImages = [];
  const timestamp = Date.now();
  
  try {
    console.log(`🔄 开始转换 ${totalPages} 页PDF为图片...`);
    
    // 使用pdf2image批量转换所有页面
    const options = {
      format: 'png',
      out_dir: outputDir,
      out_prefix: `pdf_${timestamp}_page`,
      width: 1500,   // 中等分辨率：平衡质量和文件大小
      height: 1500,  // 足够AI识别表格，但不会太大导致处理缓慢
      quality: 80    // 适中的图片质量
    };
    
    console.log(`📋 图片转换参数:`);
    console.log(`   - 输出格式: ${options.format}`);
    console.log(`   - 分辨率: ${options.width}x${options.height}`);
    console.log(`   - 质量: ${options.quality}`);
    console.log(`   - 输出目录: ${outputDir}`);
    
    // 调用pdf2image进行批量转换
    const convertedFiles = await pdf2image.convertPDF(pdfPath, options);
    
    if (!convertedFiles || convertedFiles.length === 0) {
      throw new Error('PDF转图片失败：没有生成任何图片文件');
    }
    
    // 处理转换结果
    for (let i = 0; i < convertedFiles.length; i++) {
      const file = convertedFiles[i];
      if (file && file.path && fs.existsSync(file.path)) {
        pageImages.push({
          pageNumber: i + 1,
          imagePath: file.path,
          fileName: path.basename(file.path),
          fileSize: fs.statSync(file.path).size
        });
        console.log(`   ✅ 第${i + 1}页: ${path.basename(file.path)} (${(fs.statSync(file.path).size / 1024).toFixed(1)} KB)`);
      } else {
        console.warn(`   ⚠️ 第${i + 1}页转换失败`);
      }
    }
    
    console.log(`✅ 图片转换完成: ${pageImages.length}/${totalPages} 页成功`);
    
    // 计算总的图片大小
    const totalImageSize = pageImages.reduce((sum, img) => sum + img.fileSize, 0);
    console.log(`📊 图片文件统计:`);
    console.log(`   - 成功转换: ${pageImages.length} 页`);
    console.log(`   - 总大小: ${(totalImageSize / 1024 / 1024).toFixed(2)} MB`);
    console.log(`   - 平均大小: ${(totalImageSize / pageImages.length / 1024).toFixed(1)} KB/页`);
    
    return pageImages;
    
  } catch (error) {
    console.error('❌ PDF转图片过程中发生错误:', error);
    
    // 尝试清理可能生成的部分文件
    try {
      const files = fs.readdirSync(outputDir).filter(f => f.includes(`pdf_${timestamp}_page`));
      for (const file of files) {
        fs.unlinkSync(path.join(outputDir, file));
      }
      console.log(`🧹 已清理 ${files.length} 个临时图片文件`);
    } catch (cleanupError) {
      console.warn('清理临时文件时出错:', cleanupError.message);
    }
    
    throw new Error(`PDF转图片失败: ${error.message}`);
  }
}

// **新函数：按页分割PDF文本**
function splitPdfTextByPages(fullText) {
  // 使用常见的分页符分割
  let pages = fullText.split(/\f|\n\s*Page\s+\d+/i);
  
  // 如果没有明显的分页符，尝试按内容长度估算分页
  if (pages.length === 1 && fullText.length > 5000) {
    const avgPageLength = Math.floor(fullText.length / Math.max(1, Math.floor(fullText.length / 2000)));
    pages = [];
    for (let i = 0; i < fullText.length; i += avgPageLength) {
      pages.push(fullText.substring(i, i + avgPageLength));
    }
  }
  
  return pages.filter(page => page.trim().length > 50); // 过滤过短的页面
}

// **新函数：检测页面是否包含表格**
function detectTableInPage(pageText) {
  const tableIndicators = [
    /Table\s+\d+/i,
    /Schedule\s+of\s+(Assessments?|Events?|Activities?)/i,
    /Assessment\s+Schedule/i,
    /Figure\s+\d+/i,
    /Visit\s+Schedule/i,
    /Study\s+Schedule/i,
    /Timeline/i,
    /(Visit|Day)\s+\d+.*(?:Visit|Day)\s+\d+/i,
    /Screening.*Baseline.*Follow/i,
    // 表格特征模式
    /[\|\+\-]{3,}/,  // ASCII表格边框
    /(\s{2,}\S+){3,}/g,  // 多列对齐
    /^\s*[\w\s]+\s{2,}[\w\s]+\s{2,}[\w\s]+$/m  // 列对齐行
  ];
  
  // 检查时间词汇密度
  const timeWords = ['visit', 'day', 'week', 'screen', 'baseline', 'follow', 'month'];
  const timeWordCount = timeWords.filter(word => pageText.toLowerCase().includes(word)).length;
  
  // 如果有明确的表格指示符，或者时间词汇密度高，认为有表格
  return tableIndicators.some(pattern => pattern.test(pageText)) || timeWordCount >= 3;
}

// **新函数：AI视觉解析单页**
async function processPageWithAIVision(pdfPath, pageNumber) {
  try {
    console.log(`🖼️ 将第${pageNumber}页转换为图片...`);
    
    // 第1步：将PDF页面转换为图片
    const pageImage = await convertPageToImage(pdfPath, pageNumber);
    
    console.log(`🤖 调用AI视觉分析第${pageNumber}页...`);
    
    // 第2步：调用视觉AI分析图片
    const aiResponse = await analyzePageWithAI(pageImage);
    
    // 第3步：清理临时图片
    if (fs.existsSync(pageImage)) {
      fs.unlinkSync(pageImage);
    }
    
    return aiResponse;
    
  } catch (error) {
    console.error(`❌ 第${pageNumber}页AI视觉分析失败:`, error.message);
    throw error;
  }
}

// **新函数：将PDF页面转换为图片**
async function convertPageToImage(pdfPath, pageNumber) {
  try {
    const outputDir = path.join(__dirname, '../temp');
    if (!fs.existsSync(outputDir)) {
      fs.mkdirSync(outputDir, { recursive: true });
    }
    
    const options = {
      format: 'png',
      out_dir: outputDir,
      out_prefix: `page_${pageNumber}_${Date.now()}`,
      page: pageNumber,
      width: 2000,  // 高分辨率以确保表格清晰
      height: 2000
    };
    
    // 修正API调用：使用 convertPDF 而不是 convert
    const result = await pdf2image.convertPDF(pdfPath, options);
    
    if (result && result.length > 0) {
      return result[0].path; // 返回生成的图片路径
    } else {
      throw new Error('图片转换失败');
    }
    
  } catch (error) {
    console.error('PDF页面转图片失败:', error);
    throw error;
  }
}

// **新函数：使用AI分析页面图片**
async function analyzePageWithAI(imagePath) {
  try {
    const imageBuffer = fs.readFileSync(imagePath);
    const base64Image = imageBuffer.toString('base64');
    
    const prompt = `你是一个顶级的临床文档分析专家。请仔细分析这个PDF页面图片，提取所有的结构化内容。

**主要任务：**
1. 识别页面中的所有章节标题和内容
2. 特别关注并详细解析所有表格，尤其是：
   - 评估时间表 (Schedule of Assessments/Events)
   - 访视时间表 (Visit Schedule)  
   - 任何包含时间点和相应活动的矩阵式表格

**对于表格，请：**
1. 保持原始的HTML结构，包括合并单元格 (colspan, rowspan)
2. 准确识别表头和数据行
3. 特别注意时间点 (Visit 1, Day 1, Week 2, Month 4等) 和评估项目的对应关系

**返回格式 (严格JSON)：**
{
  "sections": [
    {
      "title": "章节标题",
      "content": "章节内容",
      "level": 1-6,
      "extractionMethod": "ai-vision"
    }
  ],
  "tables": [
    {
      "title": "表格标题",
      "htmlContent": "<table>...</table>",
      "extractionMethod": "ai-vision",
      "tableType": "assessment-schedule" // 如果是评估时间表
    }
  ]
}`;

    const response = await openai.chat.completions.create({
      model: "gpt-4o",
      messages: [
        {
          role: "user",
          content: [
            {
              type: "text",
              text: prompt
            },
            {
              type: "image_url",
              image_url: {
                url: `data:image/png;base64,${base64Image}`
              }
            }
          ]
        }
      ],
      max_tokens: 4096
    });
    
    const aiResult = JSON.parse(response.choices[0].message.content);
    
    console.log(`✅ AI视觉分析成功: ${aiResult.sections?.length || 0}个章节, ${aiResult.tables?.length || 0}个表格`);
    
    return {
      sections: aiResult.sections || [],
      tables: aiResult.tables || []
    };
    
  } catch (error) {
    console.error('❌ AI视觉分析失败:', error);
    return { sections: [], tables: [] };
  }
}

// **新函数：文本解析单页内容 (从现有逻辑提取)**
function extractSectionsFromSinglePage(pageText, pageNumber) {
  try {
    const cleanedText = cleanPdfText(pageText);
    
    // 使用现有的模式识别和内容识别
    const patternSections = extractSectionsFromPatterns(cleanedText);
    const contentSections = extractSectionsFromContent(cleanedText);
    
    // 简单合并 (无需AI优化，单页内容相对简单)
    const mergedSections = mergeSectionResults([], patternSections, contentSections, cleanedText);
    
    // 为每个章节添加页面号
    return mergedSections.map(section => ({
      ...section,
      pageNumber,
      extractionMethod: 'text-parsing'
    }));
    
  } catch (error) {
    console.warn(`⚠️ 第${pageNumber}页文本解析失败:`, error.message);
    return [];
  }
}

// PDF文本清理和预处理
function cleanPdfText(rawText) {
  let cleanedText = rawText;
  
  // 清理常见的PDF文本问题
  cleanedText = cleanedText
    // 移除过多的空白行
    .replace(/\n{3,}/g, '\n\n')
    // 修复可能的分页符问题
    .replace(/(\w)-\s*\n\s*(\w)/g, '$1$2')
    // 规范化空格
    .replace(/[ \t]+/g, ' ')
    // 清理页眉页脚常见模式
    .replace(/^Page \d+ of \d+.*$/gm, '')
    .replace(/^Confidential.*$/gm, '')
    .replace(/^Protocol.*Version.*$/gm, '');
  
  return cleanedText.trim();
}

// 从PDF文本中提取简单的表格区域 - 改进版，更加宽松
function extractSimpleTablesFromPdf(text) {
  const tables = [];
  const lines = text.split('\n');
  
  // 扩展的表格指示符 - 更加宽松的匹配
  const tableIndicators = [
    /Table\s+\d+/i,
    /Schedule\s+of\s+(Assessments?|Events?|Activities?)/i,
    /Assessment\s+Schedule/i,
    /Figure\s+\d+/i,
    /Visit\s+Schedule/i,
    /Study\s+Schedule/i,
    /Timeline/i,
    /(Visit|Day)\s+\d+.*(?:Visit|Day)\s+\d+/i, // 包含多个访问/天数的行
    /Screening.*Baseline.*Follow/i // 包含研究阶段的行
  ];
  
  // 还要查找看起来像表格的段落（包含多个制表符或对齐的文本）
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    
    // 方法1: 检查明确的表格指示符
    for (const indicator of tableIndicators) {
      if (indicator.test(line)) {
        const tableContent = extractTableContent(lines, i);
        // 更严格的表格内容验证
        if (tableContent && tableContent.length > 200 && 
            (tableContent.includes('Visit') || tableContent.includes('Day') || 
             tableContent.includes('Week') || tableContent.includes('Screening') ||
             tableContent.includes('Baseline'))) {
          tables.push({
            htmlContent: convertTextTableToHtml(tableContent),
            tableIndex: tables.length,
            extractedAt: new Date(),
            title: line,
            startLine: i,
            extractionMethod: 'indicator-based'
          });
          console.log(`📊 发现表格 (指示符): "${line}" (第${i+1}行)`);
        } else {
          console.log(`⚠️ 跳过无效表格内容: "${line}" (第${i+1}行) - 长度:${tableContent?.length || 0}`);
        }
        break;
      }
    }
    
    // 方法2: 查找包含多个时间点的行（可能是表格行）
    const timeWords = ['visit', 'day', 'week', 'screen', 'baseline', 'follow', 'month'];
    const timeWordCount = timeWords.filter(word => line.toLowerCase().includes(word)).length;
    
    if (timeWordCount >= 2 && line.length > 20) {
      // 检查这一行前后是否有更多相似的行（表格模式）
      let contextScore = 0;
      for (let j = Math.max(0, i-2); j <= Math.min(i+5, lines.length-1); j++) {
        const contextLine = lines[j].toLowerCase();
        const contextTimeWords = timeWords.filter(word => contextLine.includes(word)).length;
        if (contextTimeWords >= 1) contextScore++;
      }
      
      if (contextScore >= 3) { // 如果周围行也包含时间词汇
        const tableContent = extractTableContent(lines, Math.max(0, i-2));
        if (tableContent && tableContent.length > 100) {
          tables.push({
            htmlContent: convertTextTableToHtml(tableContent),
            tableIndex: tables.length,
            extractedAt: new Date(),
            title: `Potential Schedule Table (Line ${i+1})`,
            startLine: i,
            extractionMethod: 'pattern-based'
          });
          console.log(`📊 发现表格 (模式): 第${i+1}行附近`);
        }
      }
    }
  }
  
  return tables;
}

// 提取表格内容（从表格标题开始向下查找）
function extractTableContent(lines, startIndex) {
  let content = '';
  let contentLines = 0;
  const maxLines = 50; // 最多向下查找50行
  
  // 如果是引用性的表格标题，尝试查找实际的表格
  const title = lines[startIndex].toLowerCase();
  if (title.includes('schedule of events') && title.includes('section')) {
    // 这是对表格的引用，尝试找到实际的表格内容
    console.log(`🔍 检测到表格引用，搜索实际表格内容...`);
    
    // 搜索更大范围，寻找包含多个时间点的内容
    for (let i = startIndex; i < Math.min(lines.length, startIndex + 500); i++) {
      const line = lines[i].trim();
      const lowerLine = line.toLowerCase();
      
      // 查找可能的表格开始标志
      if ((lowerLine.includes('visit') && lowerLine.includes('screening')) ||
          (lowerLine.includes('day') && lowerLine.includes('baseline')) ||
          (lowerLine.includes('week') && lowerLine.includes('month')) ||
          (line.match(/Visit\s+\d+.*Visit\s+\d+/i))) {
        
        console.log(`📋 找到可能的表格开始: "${line}" (第${i+1}行)`);
        
        // 从这里开始提取更大的内容块
        let tableContent = '';
        for (let j = i; j < Math.min(lines.length, i + 150); j++) {
          const tableLine = lines[j].trim();
          
          // 如果遇到新的主要章节，停止
          if (j > i + 10 && tableLine.match(/^\d+\.\s+[A-Z]/)) {
            break;
          }
          
          tableContent += tableLine + '\n';
        }
        
        // 验证这个内容是否像一个表格
        const timeWords = ['visit', 'day', 'week', 'screening', 'baseline', 'follow'];
        const timeWordCount = timeWords.filter(word => tableContent.toLowerCase().includes(word)).length;
        
        if (timeWordCount >= 3 && tableContent.length > 300) {
          console.log(`✅ 找到有效表格内容，时间词汇数: ${timeWordCount}, 长度: ${tableContent.length}`);
          return tableContent.trim();
        }
      }
    }
  }
  
  // 原有的提取逻辑作为备选
  for (let i = startIndex; i < lines.length && i < startIndex + maxLines; i++) {
    const line = lines[i].trim();
    
    // 如果遇到新的章节标题，停止提取
    if (i > startIndex && isLikelyNewSection(line)) {
      break;
    }
    
    content += line + '\n';
    contentLines++;
    
    // 如果连续多行为空，可能表格已结束
    if (line === '' && i > startIndex + 5) {
      let emptyLines = 0;
      for (let j = i; j < Math.min(i + 3, lines.length); j++) {
        if (lines[j].trim() === '') emptyLines++;
      }
      if (emptyLines >= 2) break;
    }
  }
  
  return content;
}

// 判断是否像新章节的开始
function isLikelyNewSection(line) {
  return (
    /^\d+\.\s+[A-Z]/.test(line) ||           // "1. INTRODUCTION"
    /^[A-Z][A-Z\s]{10,}$/.test(line) ||      // "STUDY OBJECTIVES"
    /^Appendix\s+\d+/i.test(line) ||         // "Appendix 1"
    /^Table\s+\d+/i.test(line)               // "Table 2"
  );
}

// 将纯文本表格转换为简单的HTML格式 - 改进版
function convertTextTableToHtml(textContent) {
  const lines = textContent.split('\n').filter(line => line.trim());
  if (lines.length === 0) return '';
  
  console.log(`🔍 转换文本表格，行数: ${lines.length}`);
  
  // 专门处理Schedule of Assessments类型的表格
  let isAssessmentTable = false;
  let headerRows = [];
  let dataRows = [];
  
  // 检查是否是评估时间表 - 更严格的检测
  const fullText = textContent.toLowerCase();
  
  // 必须包含关键的表格特征
  const hasVisitNumbers = /visit\s+\d+.*visit\s+\d+/i.test(textContent);
  const hasTimePoints = /month\s+\d+|week\s+\d+|day\s+\d+/i.test(textContent);
  const hasAssessmentTerms = /procedure|assessment|examination|screening|baseline/i.test(textContent);
  const hasMarkingSystem = textContent.includes('X') || textContent.includes('x');
  
  // 排除明显不是表格的内容
  const isTreatmentDescription = fullText.includes('randomized') && fullText.includes('treatment arms');
  const isNarrativeText = fullText.includes('patients will') && fullText.length > 500;
  
  if ((hasVisitNumbers || hasTimePoints) && hasAssessmentTerms && hasMarkingSystem && 
      !isTreatmentDescription && !isNarrativeText) {
    isAssessmentTable = true;
    console.log('🎯 检测到评估时间表格式');
    console.log(`✓ 访问编号: ${hasVisitNumbers}, ✓ 时间点: ${hasTimePoints}, ✓ 评估术语: ${hasAssessmentTerms}, ✓ 标记系统: ${hasMarkingSystem}`);
  } else {
    console.log('❌ 不是评估时间表:');
    console.log(`访问编号: ${hasVisitNumbers}, 时间点: ${hasTimePoints}, 评估术语: ${hasAssessmentTerms}, 标记: ${hasMarkingSystem}`);
    console.log(`排除: 治疗描述: ${isTreatmentDescription}, 叙述文本: ${isNarrativeText}`);
  }
  
  if (isAssessmentTable) {
    // 改进的表格结构分析
    let foundTimeRow = false;
    let foundVisitRow = false;
    let foundProcedureColumn = false;
    
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim();
      if (!line) continue;
      
      // 识别表格标题行 (如: "Table 1 Schedule of Study Assessments and Procedures")
      if (line.toLowerCase().includes('table') && line.toLowerCase().includes('schedule')) {
        console.log(`📋 找到表格标题: ${line}`);
        continue;
      }
      
      // 识别时间范围行 (如: "Wk² Month⁴")
      if (line.match(/week|month|wk\d+/i) && !foundTimeRow) {
        console.log(`📅 找到时间范围行: ${line}`);
        // 基于空格和数字分割
        const columns = line.split(/\s+/).filter(col => col.trim());
        if (columns.length > 1) {
          headerRows.push(['Assessments'].concat(columns));
          foundTimeRow = true;
        }
      }
      
      // 识别具体时间点行 (如: "0 3 3 6 9 12 15 18 21 24")
      else if (line.match(/^\s*\d+\s+\d+\s+\d+/) && foundTimeRow && !foundVisitRow) {
        console.log(`📅 找到时间点行: ${line}`);
        const columns = line.split(/\s+/).filter(col => col.trim());
        if (columns.length > 3) {
          headerRows.push(['Time Points'].concat(columns));
        }
      }
      
      // 识别访问编号行 (如: "Visit 0 Visit 1 Visit 2")
      else if (line.match(/visit\s+\d+/i) && foundTimeRow) {
        console.log(`🏥 找到访问行: ${line}`);
        const columns = line.split(/\s+/).filter(col => col.trim());
        headerRows.push(['Visit Number'].concat(columns));
        foundVisitRow = true;
      }
      
      // 识别程序列标题 (如: "Procedure Scr 1 2 Add Rx³")
      else if (line.toLowerCase().includes('procedure') && foundTimeRow) {
        console.log(`📝 找到程序列标题: ${line}`);
        const columns = line.split(/\s+/).filter(col => col.trim());
        headerRows.push(columns);
        foundProcedureColumn = true;
      }
      
      // 识别评估项目行 (包含X标记)
      else if ((line.includes('X') || line.includes('x')) && foundProcedureColumn) {
        console.log(`✅ 找到评估行: ${line}`);
        
        // 解析评估行：procedure名称 + X标记
        const parts = line.split(/\s+/);
        let procedureName = '';
        let markers = [];
        
        // 找到第一个X或x的位置
        let firstXIndex = -1;
        for (let j = 0; j < parts.length; j++) {
          if (parts[j].toLowerCase() === 'x') {
            firstXIndex = j;
            break;
          }
        }
        
        if (firstXIndex > 0) {
          // 程序名称是X之前的所有部分
          procedureName = parts.slice(0, firstXIndex).join(' ');
          markers = [procedureName];
          
          // 从X位置开始，逐个检查标记
          const expectedCols = Math.max(...headerRows.map(row => row.length)) - 1; // 减去procedure列
          for (let j = 0; j < expectedCols; j++) {
            const partIndex = firstXIndex + j;
            if (partIndex < parts.length && parts[partIndex].toLowerCase() === 'x') {
              markers.push('X');
            } else {
              markers.push('');
            }
          }
        } else {
          // 如果没找到X，按原方式分割
          markers = parts;
        }
        
        if (markers.length > 1) {
          dataRows.push(markers);
        }
      }
    }
  }
  
  // 如果成功解析了评估表格结构
  if (headerRows.length > 0 || dataRows.length > 0) {
    console.log(`✅ 成功解析表格结构: ${headerRows.length}行表头, ${dataRows.length}行数据`);
    
    let html = '<table border="1">';
    
    // 添加表头
    if (headerRows.length > 0) {
      html += '<thead>';
      headerRows.forEach(row => {
        html += '<tr>';
        row.forEach(col => {
          html += `<th>${col.trim()}</th>`;
        });
        html += '</tr>';
      });
      html += '</thead>';
    }
    
    // 添加数据行
    if (dataRows.length > 0) {
      html += '<tbody>';
      dataRows.forEach(row => {
        html += '<tr>';
        row.forEach(col => {
          html += `<td>${col.trim()}</td>`;
        });
        html += '</tr>';
      });
      html += '</tbody>';
    }
    
    html += '</table>';
    return html;
  }
  
  // 原有的通用表格识别逻辑
  const tableRows = [];
  for (const line of lines) {
    const words = line.trim().split(/\s{2,}|\t+/);
    if (words.length >= 2 && !line.match(/^[A-Z][a-z\s]+\./) && words.some(w => w.length > 1)) {
      tableRows.push(words);
    }
  }
  
  if (tableRows.length === 0) {
    // 最后的回退：创建一个单行单列的表格，但不使用<pre>
    console.log('⚠️ 无法识别表格结构，创建简单表格');
    const singleRow = lines.join(' ').split(/\s+/).filter(word => word.trim());
    if (singleRow.length > 10) {
      // 尝试按固定列数分割
      const cols = 5;
      let html = '<table border="1"><tbody>';
      for (let i = 0; i < singleRow.length; i += cols) {
        html += '<tr>';
        for (let j = 0; j < cols; j++) {
          html += `<td>${singleRow[i + j] || ''}</td>`;
        }
        html += '</tr>';
      }
      html += '</tbody></table>';
      return html;
    } else {
      return `<table border="1"><tr><td>${textContent}</td></tr></table>`;
    }
  }
  
  // 构建HTML表格
  let html = '<table border="1">';
  
  // 第一行作为表头
  if (tableRows.length > 0) {
    html += '<thead><tr>';
    for (const cell of tableRows[0]) {
      html += `<th>${cell.trim()}</th>`;
    }
    html += '</tr></thead>';
  }
  
  // 其余行作为数据行
  if (tableRows.length > 1) {
    html += '<tbody>';
    for (let i = 1; i < tableRows.length; i++) {
      html += '<tr>';
      for (const cell of tableRows[i]) {
        html += `<td>${cell.trim()}</td>`;
      }
      html += '</tr>';
    }
    html += '</tbody>';
  }
  
  html += '</table>';
  return html;
}

// PDF专用的章节提取函数 - 复用Word解析的算法
async function extractSectionsForPdf(extractedText) {
  console.log('🔍 启动PDF多层标题识别算法...');
  
  // 第1层：跳过HTML标题识别（PDF没有HTML结构）
  const htmlSections = []; // PDF没有HTML，直接为空
  
  // 第2层：编号模式识别（直接复用Word的函数）
  const patternSections = extractSectionsFromPatterns(extractedText);
  console.log(`🔢 编号模式识别: ${patternSections.length} 个章节`);
  
  // 第3层：内容特征识别（直接复用Word的函数）
  const contentSections = extractSectionsFromContent(extractedText);
  console.log(`📝 内容特征识别: ${contentSections.length} 个章节`);
  
  // 第4层：合并和去重（直接复用Word的函数）
  const mergedSections = mergeSectionResults(htmlSections, patternSections, contentSections, extractedText);
  console.log(`🔗 合并后章节: ${mergedSections.length} 个`);
  
  // 第5层：AI辅助优化（直接复用Word的函数）
  const finalSections = await optimizeSectionsWithAI(mergedSections);
  console.log(`🤖 AI优化后: ${finalSections.length} 个章节`);
  
  return finalSections;
}

module.exports = {
  parsePdfDocumentStructure
}; 