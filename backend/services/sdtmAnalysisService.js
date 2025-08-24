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
        mappings: new Map(),
        summary: {
          total_procedures: 0,
          total_sdtm_domains: 0,
          unique_domains: []
        }
      };
    }
    
    // Build GPT prompt
    const prompt = `You are a clinical trial data standards (CDISC SDTM) expert. I have a list of procedures from the Schedule of Assessment in a Clinical Protocol. Please analyze which SDTM domains each procedure corresponds to.

🔥 CRITICAL REQUIREMENT: You must provide SDTM domain mapping for every single procedure in the list below. Do not skip any. Even if a procedure doesn't look like a standard medical procedure, you must select the most appropriate SDTM domain based on its content.

Procedure List:
${procedures.map((p, i) => `${i + 1}. ${p}`).join('\n')}

Please analyze based on CDISC SDTM standards version 3.4. Common SDTM domains include:

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

🔥 MAPPING AND COMPLEXITY RULES:
1. Each procedure should be a standard medical procedure or assessment activity
2. Based on the medical meaning of the procedure, map to the most appropriate SDTM domain
3. Assess complexity level for each procedure: 
   - High Complexity: Complex laboratory tests, multi-parameter biomarkers, complex questionnaire assessments, special medical examinations, etc. 
   - Medium Complexity: Standard physical examinations, basic vital signs, routine laboratory tests, standard drug administration, etc. 
   - If SV is counted under Medium Complexity, please move it under High Complexity instead, if SV is not counted, please add to High Complexity directly
4. Domain-level mutual exclusivity principle for complexity statistics (VERY IMPORTANT): 
   - Please deduplicate by "domain" in the summary when counting complexity sets. 
   - If the same domain is marked as both High and Medium across different procedures, assign that domain to the High set (High overrides Medium). 
   - The final High and Medium sets must be mutually exclusive at the domain level. 
   - Also, total_sdtm_domains must equal the length of unique_domains and equal the size of the union of High and Medium sets.

Please return JSON format, ensuring the mappings array contains exactly ${procedures.length} entries (one per procedure):
{
  "mappings": [
    {
      "procedure": "exact matching procedure name",
      "sdtm_domains": ["corresponding domains"],
      "complexity": "High" or "Medium"
    }
  ],
  "summary": {
    "total_procedures": ${procedures.length},
    "total_sdtm_domains": "length of unique_domains array (deduplicated unique domain count)",
    "unique_domains": ["list of all non-duplicate domains"],
    "highComplexitySdtm": {
      "count": "number of high complexity domains (mutually exclusive, deduplicated by domain, no overlap with Medium)",
      "domains": ["list of high complexity domains (deduplicated)"]
    },
    "mediumComplexitySdtm": {
      "count": "number of medium complexity domains (mutually exclusive, deduplicated by domain, no overlap with High)",
      "domains": ["list of medium complexity domains (deduplicated)"]
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
        mappings: new Map(),
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
    
    // 处理新的数组格式: [{ "procedure": "name", "sdtm_domains": ["domain1"], "complexity": "High" }]
    if (analysis.mappings && Array.isArray(analysis.mappings)) {
      analysis.mappings.forEach(item => {
        const procedure = item.procedure;
        const domains = item.sdtm_domains || [];
        const complexity = item.complexity || 'Medium';
        
        domains.forEach(d => {
          const dom = (d || '').trim();
          if (!dom) return;
          const existing = domainToComplexity.get(dom);
          if (!existing || (existing === 'Medium' && complexity === 'High')) {
            domainToComplexity.set(dom, complexity);
          }
        });
      });
    }
    const uniqueDomains = Array.from(domainToComplexity.keys());
    const highDomains = uniqueDomains.filter(d => domainToComplexity.get(d) === 'High');
    const mediumDomains = uniqueDomains.filter(d => domainToComplexity.get(d) === 'Medium');

    // 🔥 手动添加试验域到Medium Complexity（这些域不会从procedures中产生）
    const trialDomains = ['TA', 'TE', 'TI', 'TV', 'TS', 'SE'];
    trialDomains.forEach(domain => {
      const existing = domainToComplexity.get(domain);
      if (!existing) {
        domainToComplexity.set(domain, 'Medium');
      }
    });
    
    // 重新计算域列表（包含试验域）
    const finalUniqueDomains = Array.from(domainToComplexity.keys());
    const finalHighDomains = finalUniqueDomains.filter(d => domainToComplexity.get(d) === 'High');
    const finalMediumDomains = finalUniqueDomains.filter(d => domainToComplexity.get(d) === 'Medium');

    analysis.summary.unique_domains = finalUniqueDomains;
    analysis.summary.total_sdtm_domains = finalUniqueDomains.length;
    analysis.summary.highComplexitySdtm = {
      count: finalHighDomains.length,
      domains: finalHighDomains
    };
    analysis.summary.mediumComplexitySdtm = {
      count: finalMediumDomains.length,
      domains: finalMediumDomains
    };

    console.log(`✅ SDTM分析完成 - 发现 ${analysis.summary.unique_domains.length} 个不同的SDTM域（包含${trialDomains.length}个试验域）`);
    
    // 转换mappings为Map格式以便MongoDB存储 - 简化为字符串格式
    const mappingsMap = new Map();
    if (analysis.mappings && Array.isArray(analysis.mappings)) {
      analysis.mappings.forEach(item => {
        const procedure = item.procedure;
        const domains = item.sdtm_domains || [];
        if (procedure && Array.isArray(domains)) {
          // 将数组转换为逗号分隔的字符串，简洁明了
          const domainsString = domains.join(', ');
          mappingsMap.set(procedure, domainsString);
        }
      });
    }
    
    console.log(`📊 简化映射格式: ${mappingsMap.size} 个procedures映射`);
    Array.from(mappingsMap.entries()).slice(0, 3).forEach(([proc, domains]) => {
      console.log(`   "${proc}": "${domains}"`);
    });
    
    return {
      success: true,
      mappings: mappingsMap,
      summary: analysis.summary,
      analyzedAt: new Date()
    };
    
  } catch (error) {
    console.error('❌ SDTM映射分析失败:', error);
    return {
      success: false,
      message: error.message || 'SDTM分析暂时不可用',
      mappings: new Map(),
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