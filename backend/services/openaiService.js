const OpenAI = require('openai');
const cheerio = require('cheerio');

// 初始化OpenAI客户端
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY
});

/**
 * Identify the Assessment Schedule from PDF tables (array-based) using AI.
 * This mirrors the Word HTML flow but adapts the prompt to 2D array tables.
 *
 * @param {Array} tables - Array of PDF tables with shape: { data: string[][], rows: number, columns: number, page?: number, table_index?: number }
 * @returns {Promise<null|{ tableIndex: number, data: string[][], page?: number, rows: number, columns: number, confidence: number, identifiedBy: string, reason?: string }>}
 */
async function identifyAssessmentScheduleForPdfTables(tables) {
  try {
    if (!Array.isArray(tables) || tables.length === 0) {
      return null;
    }

    // console.log('🤖 Start AI identification for PDF Assessment Schedule...');

    for (let i = 0; i < tables.length; i++) {
      const table = tables[i] || {};
      const data = Array.isArray(table.data) ? table.data : [];
      const headers = Array.isArray(data[0]) ? data[0] : [];
      const firstRow = Array.isArray(data[1]) ? data[1] : [];
      const totalRows = Number(table.rows || data.length || 0);
      const totalCols = Number(table.columns || (Array.isArray(headers) ? headers.length : 0));

      const timepointHit = headers.filter(h => h && /(visit|day|week|month|cycle|screening|baseline|follow)/i.test(String(h))).length > 0 ? 'YES' : 'NO';

      const prompt = `You are a clinical trial data expert. Your task is to identify the MAIN "Schedule of Assessment" or "Schedule of Events" table that contains the comprehensive visit-by-procedure matrix for the entire study.

WHAT WE'RE LOOKING FOR:
This must be the PRIMARY schedule table that shows:
- COMPREHENSIVE list of study procedures/assessments (typically 10+ different types)
- MULTIPLE study visits/timepoints (typically 5+ visits like Screening, Baseline, Week 2, Week 4, Month 3, etc.)
- MATRIX format showing which procedures happen at which visits (usually marked with X, •, or checkmarks)

MUST CONTAIN DIVERSE ASSESSMENT TYPES:
- Laboratory tests (blood work, chemistry, hematology)
- Vital signs (blood pressure, heart rate, temperature)
- Physical examinations
- Medical history/concomitant medications
- Questionnaires/quality of life assessments
- Safety assessments/adverse events
- Study drug administration/accountability

REJECT if table contains:
- Only a few specific procedures (< 8 procedures)
- Only one type of assessment (e.g., only imaging, only questionnaires)
- Limited timepoints (< 4 visits)
- Detailed sub-procedures of one main assessment
- Summary or subset tables

Table Analysis (array-based table):
- Headers: ${headers.join(', ')}
- First data row: ${firstRow.join(', ')}
- Total rows: ${totalRows}, Total columns: ${totalCols}

Key indicators:
- Contains timepoint keywords? ${timepointHit}
- Multiple columns (3+)? ${totalCols >= 3 ? 'YES' : 'NO'}
- Multiple rows (8+)? ${totalRows >= 8 ? 'YES' : 'NO'}

Is this the MAIN comprehensive Schedule of Assessment for the study? Respond ONLY with JSON:
{
  "isAssessmentSchedule": true/false,
  "confidence": 0.0-1.0,
  "reason": "Brief explanation focusing on comprehensiveness and diversity"
}`;

      try {
        const response = await openai.chat.completions.create({
          model: 'gpt-3.5-turbo',
          messages: [{ role: 'user', content: prompt }],
          max_tokens: 200,
          temperature: 0.1
        });

        const aiText = (response.choices?.[0]?.message?.content || '').trim();
        // console.log(`📊 PDF table ${i} AI reply:`, aiText);

        let analysis;
        try {
          analysis = JSON.parse(aiText);
        } catch (e) {
          const start = aiText.indexOf('{');
          const end = aiText.lastIndexOf('}') + 1;
          if (start >= 0 && end > start) {
            analysis = JSON.parse(aiText.slice(start, end));
          } else {
            throw e;
          }
        }

        if (analysis && analysis.isAssessmentSchedule && Number(analysis.confidence) > 0.7) {
          console.log(`✅ Found PDF Assessment Schedule at index ${i}, confidence ${analysis.confidence}`);
          return {
            tableIndex: typeof table.table_index === 'number' ? table.table_index : i,
            data: data,
            page: table.page,
            rows: totalRows,
            columns: totalCols,
            confidence: Number(analysis.confidence) || 0.7,
            identifiedBy: 'ai_pdf',
            reason: analysis.reason || undefined
          };
        }
      } catch (apiError) {
        console.warn(`⚠️ AI identification failed for PDF table ${i}: ${apiError.message}`);
      }

      // Small delay to avoid bursting the API
      await new Promise(r => setTimeout(r, 200));
    }

    // console.log('❌ No Assessment Schedule identified among PDF tables');
    return null;
  } catch (err) {
    console.error('❌ identifyAssessmentScheduleForPdfTables failed:', err.message);
    return null;
  }
}

// AI识别评估时间表函数
async function identifyAssessmentScheduleWithAI(tables) {
  try {
    // console.log('🤖 开始使用AI识别评估时间表...');
    
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
        // console.log(`📊 表格 ${i} AI回复:`, aiResponse);
        
        // 解析AI的JSON回复
        const analysis = JSON.parse(aiResponse);
        
        if (analysis.isAssessmentSchedule && analysis.confidence > 0.7) {
          // console.log(`✅ 找到评估时间表! 表格索引: ${i}, 置信度: ${analysis.confidence}`);
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
    
    // console.log('❌ 未找到评估时间表');
    
    // 备用方案：基于关键词直接识别Schedule of Events
    // console.log('🔍 启用备用识别：基于关键词匹配...');
    for (let i = 0; i < tables.length; i++) {
      const table = tables[i];
      const title = (table.title || '').toLowerCase();
      
      if (title.includes('schedule of events') || 
          title.includes('schedule of assessments') ||
          (title.includes('schedule') && title.includes('section'))) {
        // console.log(`✅ 备用方案识别成功: "${table.title}"`);
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

    // 取前面的文本，但要包含足够的页面来识别重复pattern（增加到8000字符）
    const head = fullText.slice(0, 8000);

    const prompt = `Extract study number and page header from this clinical protocol text:

1. STUDY NUMBER: Find protocol/study identifier (like "SPI-611", "ABC-123")

2. PAGE HEADER: Find text that repeats on every page
   - May be single line or multiple lines
   - Replace actual page numbers with PAGE_NUM
   - Include exactly what repeats, nothing more or less

Return ONLY valid JSON with curly braces:

Examples:
{"studyNumber": "XYZ-123", "headerPattern": "Study XYZ-123 Draft 2 Page PAGE_NUM of 30", "hasHeader": true}
{"studyNumber": "DEF-456", "headerPattern": "Protocol DEF-456 Version 1.0 Page PAGE_NUM of 25\nConfidential Document", "hasHeader": true}  
{"studyNumber": "GHI-789", "headerPattern": null, "hasHeader": false}

TEXT:
${head}`;

    // console.log('🤖 ===== AI HEADER DETECTION START =====');
    // console.log(`🤖 Input text length: ${head.length} characters`);
    // console.log('🤖 Calling OpenAI GPT-4 for Study Number and Header detection...');
    
    const resp = await openai.chat.completions.create({
      model: 'gpt-4',
      messages: [{ role: 'user', content: prompt }],
      temperature: 0.1,
      max_tokens: 200  // Increased for better header detection
    });

    const content = (resp.choices?.[0]?.message?.content || '').trim();
    // console.log(`🤖 AI raw response: ${content}`);
    // console.log('🤖 Parsing AI response...');
    
    let result = { studyNumber: null, headerInfo: null };
    
    try {
      const json = JSON.parse(content);
      
      // console.log('🤖 ===== AI JSON RESPONSE BREAKDOWN =====');
      // console.log(`🤖 studyNumber: "${json.studyNumber || 'null'}"`);
      // console.log(`🤖 hasHeader: ${json.hasHeader || 'false'}`);
      // console.log(`🤖 headerPattern: "${json.headerPattern || 'null'}"`);
      // console.log('🤖 ========================================');
      
      // Extract study number
      result.studyNumber = (json && json.studyNumber && json.studyNumber !== 'N/A') 
        ? String(json.studyNumber).trim() : null;
      // console.log(`🤖 Extracted Study Number: "${result.studyNumber}"`);
      
      // Extract header info
      if (json && json.hasHeader && json.headerPattern) {
        result.headerInfo = {
          hasHeader: json.hasHeader,
          headerPattern: json.headerPattern
        };
        // console.log(`🤖 ✅ HEADER DETECTED!`);
        // console.log(`🤖 Header Pattern: "${json.headerPattern}"`);
        // console.log(`🤖 Has Header: ${json.hasHeader}`);
      } else {
        // console.log(`🤖 ❌ NO HEADER DETECTED`);
        // console.log(`🤖 Reason: hasHeader=${json ? json.hasHeader : 'unknown'}, pattern=${json ? json.headerPattern : 'unknown'}`);
        result.headerInfo = null;
      }
      
    } catch (e) {
      // console.log(`🤖 ⚠️ JSON parsing failed: ${e.message}`);
      // console.log('🤖 Attempting fallback parsing...');
      
      // 如果不是纯JSON，尝试提取花括号内JSON
      const start = content.indexOf('{');
      const end = content.lastIndexOf('}');
      if (start >= 0 && end > start) {
        const extractedJson = content.slice(start, end + 1);
        // console.log(`🤖 Extracted JSON from response: ${extractedJson}`);
        
        try {
          const json = JSON.parse(extractedJson);
          
          // console.log('🤖 ===== FALLBACK JSON RESPONSE BREAKDOWN =====');
          // console.log(`🤖 studyNumber: "${json.studyNumber || 'null'}"`);
          // console.log(`🤖 hasHeader: ${json.hasHeader || 'false'}`);
          // console.log(`🤖 headerPattern: "${json.headerPattern || 'null'}"`);
          // console.log('🤖 ============================================');
          
          result.studyNumber = (json && json.studyNumber && json.studyNumber !== 'N/A') 
            ? String(json.studyNumber).trim() : null;
          // console.log(`🤖 Extracted Study Number (fallback): "${result.studyNumber}"`);
            
          if (json && json.hasHeader && json.headerPattern) {
            result.headerInfo = {
              hasHeader: json.hasHeader,
              headerPattern: json.headerPattern
            };
            // console.log(`🤖 ✅ HEADER DETECTED (fallback)!`);
            // console.log(`🤖 Header Pattern (fallback): "${json.headerPattern}"`);
            // console.log(`🤖 Has Header (fallback): ${json.hasHeader}`);
          } else {
            // console.log(`🤖 ❌ NO HEADER DETECTED (fallback)`);
            // console.log(`🤖 Reason (fallback): hasHeader=${json ? json.hasHeader : 'unknown'}, pattern=${json ? json.headerPattern : 'unknown'}`);
            result.headerInfo = null;
          }
        } catch (fallbackError) {
          // console.log(`🤖 ❌ Fallback JSON parsing also failed: ${fallbackError.message}`);
          result.headerInfo = null;
        }
      } else {
        // console.log(`🤖 ❌ No valid JSON found in response`);
        result.headerInfo = null;
      }
    }

    // 兜底：正则基于常见行
    if (!result.studyNumber) {
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
      if (candidates.length > 0) result.studyNumber = candidates[0];
    }

    // console.log('🤖 ===== FINAL AI EXTRACTION RESULT =====');
    // console.log(`🤖 Study Number: "${result.studyNumber || 'null'}"`);
    // if (result.headerInfo) {
    //   console.log(`🤖 Header Detected: ✅ YES`);
    //   console.log(`🤖 Header Pattern: "${result.headerInfo.headerPattern}"`);
    //   console.log(`🤖 Has Header: ${result.headerInfo.hasHeader}`);
    // } else {
    //   console.log(`🤖 Header Detected: ❌ NO`);
    // }
    // console.log('🤖 ===== AI HEADER DETECTION END =====');
    return result;
  } catch (err) {
    console.error('🤖 ❌ AI Study Number extraction FAILED:', err.message);
    console.error('🤖 Error details:', err);
    console.warn('🤖 Using regex fallback for Study Number extraction');
    // console.log('🤖 ===== AI HEADER DETECTION END (ERROR) =====');
    return { studyNumber: null, headerInfo: null };
  }
}

module.exports = {
  identifyAssessmentScheduleWithAI,
  extractStudyNumber,
  identifyAssessmentScheduleForPdfTables,
  /**
   * Identify repeating header/footer/page-number patterns and form name patterns
   * from first N pages' rows (line-level text) of a CRF PDF.
   * @param {Array<{page_number:number, rows:Array<{row_index:number, full_text:string}>}>} firstPagesRows
   * @returns {Promise<{success:boolean, header_patterns:string[], footer_patterns:string[], page_number_patterns:string[], form_name_patterns:string[]}>}
   */
  identifyCrfHeaderFooterAndFormPatterns: async function identifyCrfHeaderFooterAndFormPatterns(firstPagesRows) {
    try {
      if (!Array.isArray(firstPagesRows) || firstPagesRows.length === 0) {
        return { success: false, header_patterns: [], footer_patterns: [], page_number_patterns: [], form_name_patterns: [] };
      }

      // Build compact input: per page list of lines
      const pagesText = firstPagesRows.map(p => ({ page: p.page_number, lines: (p.rows || []).map(r => String(r.full_text || '').trim()).filter(Boolean) }));

      const instruction = `You are analyzing CRF (Case Report Form) pages to identify repeating patterns that appear consistently across multiple pages.

BACKGROUND: CRF documents typically have:
- Headers with version info, project names, generation timestamps
- Form titles like "Form: PARTICIPANT ENROLLMENT" 
- Footers with version codes, page numbers
- Consistent formatting across all pages

TASK: Find lines that repeat on MULTIPLE pages (3+ pages) with same structure but variable content.

EXAMPLES of typical CRF patterns:
- Header: "Version 8.100 CLINICAL QA 12MAR2023 | Protocol: XYZ-789-C01"
- Timestamp: "Document Generated: 22 Apr 2023 09:14:26 EST"
- Form title: "CRF: ADVERSE EVENTS" 
- Footer: "Version 8.100 CLINICAL QA 12MAR2023 [Document ID: 445]"
- Page number: "12 of 187" or "12/187"

IDENTIFY:
1) HEADER patterns (TOP 1-n repeatinglines of pages):
   - Version/software lines (e.g., "Version \\\\d+\\\\.\\\\d+ .+ \\\\| Protocol: .+" or "V\\\\d+\\\\.\\\\d+ PROD .+ Study Name: .+")
   - Generation timestamps (e.g., "Document Generated: .+ EST" or "Created On: .+ \\\\(UTC\\\\)" or "Generated On: .+ \\\\(GMT\\\\)")
   - Project identification lines
   - Form title lines that appear in header area (should be filtered from content)

2) FOOTER patterns (BOTTOM 1-n repeating lines of pages):
   - Version references with brackets/parentheses (e.g., "Version \\\\d+\\\\.\\\\d+ .+ \\\\[Document ID: \\\\d+\\\\]" or "V\\\\d+\\\\.\\\\d+ .+ \\\\(\\\\d+\\\\)")
   - Document identifiers

3) PAGE NUMBER patterns:
   - Format like "\\\\d+ of \\\\d+" or "\\\\d+/\\\\d+" or "Page \\\\d+"

4) FORM NAME patterns:
   - Lines starting with "Form:" or "CRF:" or other possible patterns (e.g., "Form:\\\\s*(.+)" or "CRF:\\\\s*(.+)")
   - Capture the actual form name in group 1

REQUIREMENTS:
- Return STRICT JSON: {"header_patterns":[], "footer_patterns":[], "page_number_patterns":[], "form_name_patterns":[]}
- Each pattern must be valid JavaScript regex string
- Use \\\\d+ for numbers, .+ for variable text, \\\\s+ for spaces
- Test patterns should match the STRUCTURE, allowing content to vary
- Only include patterns that appear on 3+ pages

ANALYZE THESE PAGES:\n${JSON.stringify(pagesText).slice(0, 12000)}`;

      const resp = await openai.chat.completions.create({
        model: 'gpt-4',
        messages: [{ role: 'user', content: instruction }],
        temperature: 0.1,
        max_tokens: 800
      });

      const raw = (resp.choices?.[0]?.message?.content || '').trim();
      let parsed = null;
      try { parsed = JSON.parse(raw); } catch (_) {
        const s = raw.indexOf('{'); const e = raw.lastIndexOf('}');
        if (s >= 0 && e > s) { try { parsed = JSON.parse(raw.slice(s, e + 1)); } catch (_) {} }
      }
      if (!parsed) return { success: false, header_patterns: [], footer_patterns: [], page_number_patterns: [], form_name_patterns: [] };

      // Validate and clean patterns
      const validatePattern = (pattern) => {
        try {
          new RegExp(pattern); // Test if valid regex
          return pattern.length > 2 && pattern.length < 500; // Reasonable length
        } catch (e) {
          console.warn(`❌ Invalid regex pattern: ${pattern}`, e.message);
          return false;
        }
      };
      
      const normArr = (x) => Array.isArray(x) ? 
        x.map(s => String(s || '').trim())
         .filter(Boolean)
         .filter(validatePattern) : [];

      const result = {
        success: true,
        header_patterns: normArr(parsed.header_patterns),
        footer_patterns: normArr(parsed.footer_patterns),
        page_number_patterns: normArr(parsed.page_number_patterns),
        form_name_patterns: normArr(parsed.form_name_patterns)
      };

      // Log validation results
      console.log(`✅ Pattern validation results:`);
      console.log(`📋 Header patterns: ${result.header_patterns.length}`);
      console.log(`📋 Footer patterns: ${result.footer_patterns.length}`);
      console.log(`📋 Page number patterns: ${result.page_number_patterns.length}`);
      console.log(`📋 Form name patterns: ${result.form_name_patterns.length}`);
      
      return result;
    } catch (e) {
      console.warn('identifyCrfHeaderFooterAndFormPatterns failed:', e.message);
      return { success: false, header_patterns: [], footer_patterns: [], page_number_patterns: [], form_name_patterns: [] };
    }
  },
  /**
   * Identify endpoint sections by titles only. Returns array of { index, category, cleaned_title }
   */
  identifyEndpoints: async function identifyEndpoints(sectionTitles) {
    try {
      if (!Array.isArray(sectionTitles) || sectionTitles.length === 0) return [];
      const numbered = sectionTitles.map((t, i) => `${i}: ${t || ''}`).join('\n');
      const prompt = `You are a clinical protocol analyst. Given an ordered list of section titles from a protocol, identify which entries correspond to study endpoints/objectives and classify each as Primary, Secondary, Safety, Exploratory or Other. Only return JSON array like: [{"index":12,"category":"Primary","cleaned_title":"Primary Endpoint"}].\n\nSECTION TITLES:\n${numbered}`;
      const resp = await openai.chat.completions.create({
        model: 'gpt-4',
        messages: [{ role: 'user', content: prompt }],
        temperature: 0.1,
        max_tokens: 300
      });
      const raw = (resp.choices?.[0]?.message?.content || '').trim();
      let json;
      try { json = JSON.parse(raw); } catch (_) {
        const s = raw.indexOf('{'); const e = raw.lastIndexOf('}');
        if (s >= 0 && e > s) json = JSON.parse(raw.slice(s, e + 1)); else json = [];
      }
      // Normalize category
      const norm = (c) => {
        const x = String(c || '').toLowerCase();
        if (x.includes('primary')) return 'Primary';
        if (x.includes('secondary')) return 'Secondary';
        if (x.includes('safety')) return 'Safety';
        if (x.includes('explor')) return 'Exploratory';
        return 'Other';
      };
      return (Array.isArray(json) ? json : []).map(it => ({
        index: Number(it.index),
        category: norm(it.category),
        cleaned_title: String(it.cleaned_title || sectionTitles[it.index] || '').replace(/^\s*\d+(?:\.\d+)*\s*[\)\-\:]?\s*/,'').trim()
      })).filter(it => Number.isInteger(it.index) && it.index >= 0 && it.index < sectionTitles.length);
    } catch (e) {
      console.warn('identifyEndpoints AI failed, falling back to rules:', e.message);
      // Rule-based fallback
      const results = [];
      (sectionTitles || []).forEach((title, idx) => {
        const t = String(title || '');
        const low = t.toLowerCase();
        const isEndpoint = /(endpoint|objective|efficacy)/i.test(t);
        if (!isEndpoint) return;
        let category = 'Other';
        if (low.includes('primary')) category = 'Primary';
        else if (low.includes('secondary')) category = 'Secondary';
        else if (low.includes('safety')) category = 'Safety';
        else if (low.includes('explor')) category = 'Exploratory';
        results.push({ index: idx, category, cleaned_title: t.replace(/^\s*\d+(?:\.\d+)*\s*[\)\-\:]?\s*/,'').trim() });
      });
      return results;
    }
  }
}; 