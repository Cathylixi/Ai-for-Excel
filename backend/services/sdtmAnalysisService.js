const OpenAI = require('openai');
const cheerio = require('cheerio');

// 初始化OpenAI客户端
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY
});

/**
 * 从Schedule of Assessment表格中提取第一列的procedures
 * @param {Object} assessmentSchedule - 识别出的评估时间表对象
 * @returns {Array} procedures - 提取出的procedure列表
 */
function extractProceduresFromSchedule(assessmentSchedule) {
  try {
    console.log('🔍 开始从Schedule of Assessment提取第一列procedures...');
    
    if (!assessmentSchedule || !assessmentSchedule.htmlContent) {
      console.log('❌ 没有找到有效的Assessment Schedule');
      return [];
    }
    
    const $ = cheerio.load(assessmentSchedule.htmlContent);
    const procedures = [];
    
    // 查找表格中的所有行
    const rows = $('tr');
    console.log(`📊 表格包含 ${rows.length} 行`);
    
    let headerSkipped = false;
    
    rows.each(function(index) {
      const firstCell = $(this).find('td:first-child, th:first-child');
      
      if (firstCell.length > 0) {
        let cellText = firstCell.text().trim();
        
        // 跳过表头行（通常包含 "Procedure", "Assessment", "Activity" 等词）
        if (!headerSkipped) {
          const headerKeywords = ['procedure', 'assessment', 'activity', 'visit', 'evaluation', 'test'];
          const isHeader = headerKeywords.some(keyword => 
            cellText.toLowerCase().includes(keyword) && cellText.length < 50
          );
          
          if (isHeader) {
            console.log(`⏭️ 跳过表头行: "${cellText}"`);
            headerSkipped = true;
            return; // 继续下一行
          }
        }
        
        // 智能过滤：精准剔除无效信息
        if (cellText && 
            cellText.length > 3 && 
            cellText.length < 150 && 
            !cellText.match(/^\d+$/) &&  // 不是纯数字
            !cellText.match(/^[A-Z]\d*$/) && // 不是单个字母加数字（如 "A1", "B2"）
            cellText !== '-' && 
            cellText !== 'N/A') {
          
          // 仅过滤明显的时间点/访视标识（更宽松的过滤）
          const isTimePoint = cellText.match(/^(Day\s+\d+\s+(Pre|Post)[\s-]?dose|Visit\s+\d+|Week\s+\d+|Month\s+\d+|Screening\s*$|Baseline\s*$|Follow[\s-]?up\s*$|End\s+of\s+Study|EOS\s*$|Cycle\s+\d+\s*$)/i);
          
          // 过滤过长的描述性文本（可能是study design等）
          const isTooDescriptive = cellText.length > 100 && cellText.includes(':');
          
          if (!isTimePoint && !isTooDescriptive) {
            procedures.push(cellText);
            console.log(`✅ 提取到procedure: "${cellText}"`);
          } else {
            console.log(`⏭️ 跳过时间点/访视: "${cellText.substring(0, 60)}..."`);
          }
        }
      }
    });
    
    // 去重
    const uniqueProcedures = [...new Set(procedures)];
    console.log(`📝 共提取到 ${uniqueProcedures.length} 个独特的procedures`);
    
    return uniqueProcedures;
    
  } catch (error) {
    console.error('❌ 提取procedures失败:', error);
    return [];
  }
}

/**
 * 使用GPT分析procedures的SDTM映射关系
 * @param {Array} procedures - procedure列表
 * @returns {Object} 分析结果包含mappings和summary
 */
async function analyzeSDTMMapping(procedures) {
  try {
    console.log('🤖 开始使用GPT分析SDTM映射关系...');
    
    if (!procedures || procedures.length === 0) {
      return {
        success: false,
        message: '没有procedures可供分析',
        mappings: [],
        summary: {
          total_procedures: 0,
          total_sdtm_domains: 0,
          unique_domains: []
        }
      };
    }
    
    // 构建GPT prompt
    const prompt = `你是一个临床试验数据标准(CDISC SDTM)专家。我有一个来自Clinical Protocol中Schedule of Assessment的procedure列表，请分析每个procedure分别对应哪些SDTM域。

🔥 重要要求：你必须为下面列表中的每一个procedure都提供SDTM域映射，不允许跳过任何一个。即使某个procedure看起来不像标准的医学程序，你也必须基于其内容选择最合适的SDTM域。

Procedure列表：
${procedures.map((p, i) => `${i + 1}. ${p}`).join('\n')}

请基于CDISC SDTM标准分析，常见的SDTM域包括：
- AE (Adverse Events)
- CM (Concomitant Medications)
- DM (Demographics)
- EG (ECG Test Results)
- EX (Exposure)
- LB (Laboratory Test Results)
- MB (Microbiology Specimen)
- PE (Physical Examinations)
- QS (Questionnaires)
- SC (Subject Characteristics)
- VS (Vital Signs)
- DA (Drug Accountability)
- DS (Disposition)
- MH (Medical History)
- SU (Substance Use)
- FA (Findings About)
- IE (Inclusion/Exclusion)

🔥 映射与复杂度规则：
1. 每个procedure都应该是标准的医学程序或评估活动
2. 基于procedure的医学含义，映射到最合适的SDTM域
3. 为每个procedure评估复杂度等级：
   - High Complexity: 复杂的实验室检测、多参数生物标志物、复杂的问卷评估、特殊的医学检查等
   - Medium Complexity: 标准的体格检查、基础生命体征、常规实验室检测、标准药物给药等
4. 复杂度统计的域级互斥原则（非常重要）：
   - 请在summary中按“域（domain）”去重后统计复杂度集合。
   - 若同一个域在不同procedures中同时被标注为High与Medium，请将该域归入High集合（High覆盖Medium）。
   - 最终 High 与 Medium 两个集合在域级别必须互斥，且它们的并集大小必须等于 unique_domains 的长度。
   - 同时，total_sdtm_domains 必须等于 unique_domains 的长度，且等于 High 与 Medium 两个集合并集的大小。

请返回JSON格式，确保mappings数组包含exactly ${procedures.length}个条目（每个procedure一个）：
{
  "mappings": [
    {
      "procedure": "完全匹配的procedure名称", 
      "sdtm_domains": ["相应的域"],
      "complexity": "High"或"Medium"
    }
  ],
  "summary": {
    "total_procedures": ${procedures.length},
    "total_sdtm_domains": "unique_domains数组的长度（去重后的唯一域数量）",
    "unique_domains": ["所有不重复的域列表"],
    "highComplexitySdtm": {
      "count": "高复杂度域的数量（互斥，按域去重，并与Medium不重叠）",
      "domains": ["高复杂度域列表（去重）"]
    },
    "mediumComplexitySdtm": {
      "count": "中复杂度域的数量（互斥，按域去重，并与High不重叠）", 
      "domains": ["中复杂度域列表（去重）"]
    }
  }
}`;

    const response = await openai.chat.completions.create({
      model: "gpt-4",  // 升级到 GPT-4
      messages: [
        {
          role: "user",
          content: prompt
        }
      ],
      max_tokens: 2000,  // 增加token限制，因为GPT-4的理解和生成能力更强
      temperature: 0.1   // 保持低温度以获得确定性的答案
    });
    
    const aiResponse = response.choices[0].message.content.trim();
    console.log('📊 GPT分析回复:', aiResponse);
    
    // 解析AI的JSON回复
    let analysis;
    try {
      // 提取JSON部分（处理GPT可能包含额外文本的情况）
      let jsonText = aiResponse;
      const jsonStart = aiResponse.indexOf('{');
      const jsonEnd = aiResponse.lastIndexOf('}') + 1;
      
      if (jsonStart !== -1 && jsonEnd > jsonStart) {
        jsonText = aiResponse.substring(jsonStart, jsonEnd);
      }
      
      analysis = JSON.parse(jsonText);
    } catch (parseError) {
      console.error('❌ GPT回复JSON解析失败:', parseError);
      return {
        success: false,
        message: '分析结果解析失败',
        mappings: [],
        summary: {
          total_procedures: procedures.length,
          total_sdtm_domains: 0,
          unique_domains: []
        }
      };
    }
    
    // 验证分析结果结构
    if (!analysis.mappings || !analysis.summary) {
      throw new Error('GPT返回的分析结果格式不正确');
    }

    // 统一后处理：基于域去重并确保 High 覆盖 Medium、互斥且一致
    const domainToComplexity = new Map();
    (analysis.mappings || []).forEach(m => {
      const c = m && m.complexity === 'High' ? 'High' : 'Medium';
      const domains = Array.isArray(m?.sdtm_domains) ? m.sdtm_domains : [];
      domains.forEach(d => {
        const dom = (d || '').trim();
        if (!dom) return;
        const existing = domainToComplexity.get(dom);
        if (!existing || (existing === 'Medium' && c === 'High')) {
          domainToComplexity.set(dom, c);
        }
      });
    });
    const uniqueDomains = Array.from(domainToComplexity.keys());
    const highDomains = uniqueDomains.filter(d => domainToComplexity.get(d) === 'High');
    const mediumDomains = uniqueDomains.filter(d => domainToComplexity.get(d) === 'Medium');

    analysis.summary.unique_domains = uniqueDomains;
    analysis.summary.total_sdtm_domains = uniqueDomains.length;
    analysis.summary.highComplexitySdtm = {
      count: highDomains.length,
      domains: highDomains
    };
    analysis.summary.mediumComplexitySdtm = {
      count: mediumDomains.length,
      domains: mediumDomains
    };

    console.log(`✅ SDTM分析完成 - 发现 ${analysis.summary.unique_domains.length} 个不同的SDTM域`);
    
    return {
      success: true,
      mappings: analysis.mappings,
      summary: analysis.summary,
      analyzedAt: new Date()
    };
    
  } catch (error) {
    console.error('❌ SDTM映射分析失败:', error);
    return {
      success: false,
      message: error.message || 'SDTM分析暂时不可用',
      mappings: [],
      summary: {
        total_procedures: procedures.length,
        total_sdtm_domains: 0,
        unique_domains: []
      }
    };
  }
}

/**
 * 完整的SDTM分析流程
 * @param {Object} assessmentSchedule - 评估时间表对象
 * @returns {Object} 完整的SDTM分析结果
 */
async function performSDTMAnalysis(assessmentSchedule) {
  try {
    console.log('🎯 开始完整的SDTM分析流程...');
    
    // 第一步：提取procedures
    const procedures = extractProceduresFromSchedule(assessmentSchedule);
    
    if (procedures.length === 0) {
      return {
        success: false,
        message: '未能从评估时间表中提取到有效的procedures',
        procedures: [],
        mappings: [],
        summary: {
          total_procedures: 0,
          total_sdtm_domains: 0,
          unique_domains: []
        }
      };
    }
    
    // 第二步：GPT分析SDTM映射
    const mappingResult = await analyzeSDTMMapping(procedures);
    
    return {
      success: mappingResult.success,
      message: mappingResult.message || 'SDTM分析完成',
      procedures: procedures,
      mappings: mappingResult.mappings,
      summary: mappingResult.summary,
      analyzedAt: new Date()
    };
    
  } catch (error) {
    console.error('❌ 完整SDTM分析失败:', error);
    return {
      success: false,
      message: '完整SDTM分析失败',
      procedures: [],
      mappings: [],
      summary: {
        total_procedures: 0,
        total_sdtm_domains: 0,
        unique_domains: []
      }
    };
  }
}

module.exports = {
  extractProceduresFromSchedule,
  analyzeSDTMMapping,
  performSDTMAnalysis
}; 