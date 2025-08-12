const OpenAI = require('openai');
const cheerio = require('cheerio');

// 初始化OpenAI客户端
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY
});

// AI识别评估时间表函数
async function identifyAssessmentScheduleWithAI(tables) {
  try {
    console.log('🤖 开始使用AI识别评估时间表...');
    
    for (let i = 0; i < tables.length; i++) {
      const table = tables[i];
      
      // 为了节省API调用成本，我们只分析表格的前几行来判断
      const $ = cheerio.load(table.htmlContent);
      
      // 提取表格的结构信息用于AI判断
      const tableStructure = {
        headers: [],
        firstRowData: [],
        totalRows: $('tr').length,
        totalCols: $('th, td').length
      };
      
      // 提取表头
      $('thead tr:first th, tr:first th, tr:first td').each(function() {
        tableStructure.headers.push($(this).text().trim());
      });
      
      // 提取第一行数据
      $('tbody tr:first td, tr:eq(1) td').each(function() {
        tableStructure.firstRowData.push($(this).text().trim());
      });
      
      // 构建给AI的prompt - 重新设计为功能性识别
      const prompt = `You are a clinical trial data expert. Your task is to identify tables suitable for SDTM conversion - specifically tables that map study visits/timepoints to assessments/procedures.

**FUNCTIONAL PURPOSE:**
We need tables that can be used to generate SDTM domains by mapping:
- VISIT numbers/timepoints to assessment procedures
- WHEN (visit/day/week/month) specific assessments occur
- A structured schedule for data collection activities

**ACCEPT tables that contain:**
1. **Multiple timepoints** - Visit 1, Visit 2, Day 1, Wk2, Month 4, Baseline, Follow-up, Screening, etc.
2. **Assessment activities** - Labs, vitals, questionnaires, procedures, evaluations, etc.
3. **Visit-procedure mapping** - Shows WHICH assessments happen at WHICH visits
4. **Matrix/schedule format** - Structured layout showing time vs. activities relationship

**Table titles might include:**
- "Schedule of Events", "Schedule of Assessments", "Visit Schedule"  
- "Study Timeline", "Assessment Calendar", "Procedure Schedule"
- Or even generic titles if content shows visit-assessment mapping

**REJECT tables that are:**
- Synopsis/summary (narrative descriptions)
- Demographics/baseline characteristics
- Table of Contents, abbreviations, references
- Pure administrative text without visit structure

**Table Analysis:**
- **Headers:** ${tableStructure.headers.join(', ')}
- **First data row:** ${tableStructure.firstRowData.join(', ')}
- **Total rows:** ${tableStructure.totalRows}, **Total columns:** ${tableStructure.totalCols}

**Key indicators:**
- Contains timepoint keywords? ${tableStructure.headers.filter(h => h.match(/(visit|day|week|month|cycle|screening|baseline|follow)/i)).length > 0 ? 'YES' : 'NO'}
- Multiple columns (3+)? ${tableStructure.totalCols >= 3 ? 'YES' : 'NO'}
- Multiple rows (3+)? ${tableStructure.totalRows >= 3 ? 'YES' : 'NO'}

Can this table be used to create an SDTM visit schedule? Respond ONLY with JSON:
{
  "isAssessmentSchedule": true/false,
  "confidence": 0.0-1.0,
  "reason": "Brief functional explanation"
}`;

      try {
        const response = await openai.chat.completions.create({
          model: "gpt-3.5-turbo",
          messages: [
            {
              role: "user",
              content: prompt
            }
          ],
          max_tokens: 200,
          temperature: 0.1
        });
        
        const aiResponse = response.choices[0].message.content.trim();
        console.log(`📊 表格 ${i} AI回复:`, aiResponse);
        
        // 解析AI的JSON回复
        const analysis = JSON.parse(aiResponse);
        
        if (analysis.isAssessmentSchedule && analysis.confidence > 0.7) {
          console.log(`✅ 找到评估时间表! 表格索引: ${i}, 置信度: ${analysis.confidence}`);
          return {
            tableIndex: i,
            htmlContent: table.htmlContent,
            confidence: analysis.confidence,
            identifiedBy: 'ai',
            reason: analysis.reason
          };
        }
        
      } catch (apiError) {
        console.warn(`⚠️ AI API调用失败 (表格 ${i}):`, apiError.message);
        continue; // 继续检查下一个表格
      }
      
      // 添加小延迟，避免API调用过于频繁
      await new Promise(resolve => setTimeout(resolve, 500));
    }
    
    console.log('❌ 未找到评估时间表');
    
    // 备用方案：基于关键词直接识别Schedule of Events
    console.log('🔍 启用备用识别：基于关键词匹配...');
    for (let i = 0; i < tables.length; i++) {
      const table = tables[i];
      const title = (table.title || '').toLowerCase();
      
      if (title.includes('schedule of events') || 
          title.includes('schedule of assessments') ||
          (title.includes('schedule') && title.includes('section'))) {
        console.log(`✅ 备用方案识别成功: "${table.title}"`);
        return {
          tableIndex: i,
          htmlContent: table.htmlContent,
          confidence: 0.8,
          identifiedBy: 'keyword-backup',
          reason: 'Identified by keyword matching (backup method)',
          functionalType: 'schedule-of-events-keyword-match'
        };
      }
    }
    
    return null;
    
  } catch (error) {
    console.error('❌ AI识别评估时间表失败:', error);
    return null;
  }
}

// ⬇️ 新增：AI 提取 Study Number（带正则兜底）
async function extractStudyNumber(fullText) {
  try {
    if (!fullText || typeof fullText !== 'string') return null;

    // 优先截取前面的文本（通常编号在首页/前几页）
    const head = fullText.slice(0, 4000);

    const prompt = `You are a clinical protocol expert. Extract the unique study protocol identifier ("Study Number" / "Protocol Number") from the following text. 
- It is usually an alphanumeric code like "SPI-GCF-301-PK".
- Ignore IND numbers, drug codes, version numbers, dates.
- If multiple candidates exist, pick the most likely global protocol identifier.
- Return ONLY strict JSON: {"studyNumber": "<value>"}. If not found, return {"studyNumber":"N/A"}.

TEXT:
${head}`;

    const resp = await openai.chat.completions.create({
      model: 'gpt-4',
      messages: [{ role: 'user', content: prompt }],
      temperature: 0.1,
      max_tokens: 50
    });

    const content = (resp.choices?.[0]?.message?.content || '').trim();
    let studyNumber = null;
    try {
      const json = JSON.parse(content);
      studyNumber = (json && json.studyNumber) ? String(json.studyNumber).trim() : null;
    } catch (e) {
      // 如果不是纯JSON，尝试提取花括号内JSON
      const start = content.indexOf('{');
      const end = content.lastIndexOf('}');
      if (start >= 0 && end > start) {
        const json = JSON.parse(content.slice(start, end + 1));
        studyNumber = (json && json.studyNumber) ? String(json.studyNumber).trim() : null;
      }
    }

    // 兜底：正则基于常见行
    if (!studyNumber || studyNumber === 'N/A') {
      const lines = head.split(/\n|\r/);
      const candidates = [];
      for (const line of lines) {
        const t = line.trim();
        if (!t) continue;
        if (/study\s*(number|no\.)/i.test(t) || /protocol\s*(number|no\.)/i.test(t) || /protocol:\s*/i.test(t)) {
          const m = t.match(/([A-Z]{2,}[A-Z0-9\-]{2,})/i);
          if (m && m[1]) candidates.push(m[1]);
        }
      }
      if (candidates.length > 0) studyNumber = candidates[0];
    }

    return studyNumber || null;
  } catch (err) {
    console.warn('提取Study Number失败:', err.message);
    return null;
  }
}

module.exports = {
  identifyAssessmentScheduleWithAI,
  extractStudyNumber
}; 