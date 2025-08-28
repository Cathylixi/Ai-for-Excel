const OpenAI = require('openai');

// 初始化OpenAI客户端
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY
});

/**
 * 使用GPT分析SDTM数据集的ADaM映射关系
 * @param {Array} sdtmDomains - SDTM域列表
 * @returns {Object} 分析结果包含mappings和summary
 */
async function analyzeADaMMappings(sdtmDomains) {
  try {
    console.log('🤖 开始使用GPT分析ADaM映射关系...');
    
    if (!sdtmDomains || sdtmDomains.length === 0) {
      return {
        success: false,
        message: '没有SDTM域可供分析',
        mappings: new Map(),
        summary: {
          total_adam_domains: 0,
          unique_adam_domains: []
        }
      };
    }
    
    // Build GPT prompt
    const prompt = `You are a clinical trial data standards (CDISC ADaM) expert. I have a list of SDTM datasets with corresponding procedures. Please analyze which ADaM domains we need to summarize all those SDTM.

IMPORTANT: Return ONLY valid JSON. Do not include any explanations, markdown code fences, or additional text outside the JSON object.

🔥 CRITICAL REQUIREMENT: Please go through all the SDTM datasets in the list and map them to ADaM domains reasonably, ADSL is the must to have one.

SDTM Domains List:
${sdtmDomains.map((d, i) => `${i + 1}. ${d}`).join('\n')}

Please analyze based on CDISC ADaM standards version 1.2. Common ADaM domains include:

- ADAE
- ADCM
- ADEG
- ADLB
- ADQS
- ADVS

🔥 MAPPING AND COMPLEXITY RULES:
1. Assess complexity level for each ADaM: 
   - High Complexity: The ADaM generation needs multiple SDTM datasets. Should include ADSL, efficacy related ADaM, etc. 
   - Medium Complexity: The ADaM generation only needs single SDTM and merge with ADSL. Should include safety Related ADaM, etc.

Please return JSON format, ensuring the mappings array contains exactly ${sdtmDomains.length} entries:

{
  "mappings": [
    {
      "sdtm_domains": ["对应的 SDTM 域"],
      "adam_domains": ["对应的 ADaM 域"],
      "complexity": "High" or "Medium"
    }
  ],
  "summary": {
    "total_adam_domains": "去重后 ADaM 域的数量",
    "unique_adam_domains": ["所有去重后的 ADaM 域"],
    "highComplexityAdam": {
      "count": "高复杂度 ADaM 域数量 (去重, 与 Medium 不重叠)",
      "domains": ["高复杂度 ADaM 域列表"]
    },
    "mediumComplexityAdam": {
      "count": "中等复杂度 ADaM 域数量 (去重, 与 High 不重叠)",
      "domains": ["中等复杂度 ADaM 域列表"]
    }
  }
}`;

    const response = await openai.chat.completions.create({
      model: "gpt-4",  // 使用GPT-4
      messages: [
        {
          role: "user",
          content: prompt
        }
      ],
      max_tokens: 2000,
      temperature: 0.3
    });

    const analysisText = response.choices[0].message.content.trim();
    console.log('🔍 [DEBUG] AI返回原始内容:', analysisText);

    // 解析JSON响应（容错：处理带前言/代码块等非纯JSON的情况）
    function extractJson(text) {
      // 尝试直接解析
      try { return JSON.parse(text); } catch (_) {}
      // 提取 ```json ... ```
      const codeJson = text.match(/```json[\s\S]*?```/i);
      if (codeJson && codeJson[0]) {
        const inner = codeJson[0].replace(/```json/i, '').replace(/```/g, '').trim();
        try { return JSON.parse(inner); } catch (_) {}
      }
      // 提取 ``` ... ```
      const codeAny = text.match(/```[\s\S]*?```/);
      if (codeAny && codeAny[0]) {
        const inner = codeAny[0].replace(/```/g, '').trim();
        try { return JSON.parse(inner); } catch (_) {}
      }
      // 从第一个 { 到最后一个 } 截取
      const first = text.indexOf('{');
      const last = text.lastIndexOf('}');
      if (first !== -1 && last !== -1 && last > first) {
        const inner = text.slice(first, last + 1);
        try { return JSON.parse(inner); } catch (_) {}
      }
      return null;
    }

    let analysis = extractJson(analysisText);
    if (!analysis) {
      console.error('❌ JSON解析失败: AI响应不是有效JSON');
      return {
        success: false,
        message: '分析结果解析失败',
        mappings: new Map(),
        summary: {
          total_adam_domains: 0,
          unique_adam_domains: []
        }
      };
    }
    
    // 验证分析结果结构
    if (!analysis.mappings || !analysis.summary) {
      throw new Error('GPT返回的分析结果格式不正确');
    }

    // 统一后处理：基于域去重并确保 High 覆盖 Medium、互斥且一致
    const domainToComplexity = new Map();
    
    // 处理数组格式: [{ "sdtm_domains": ["DM"], "adam_domains": ["ADSL"], "complexity": "High" }]
    if (analysis.mappings && Array.isArray(analysis.mappings)) {
      analysis.mappings.forEach(item => {
        const adamDomains = item.adam_domains || [];
        const complexity = item.complexity || 'Medium';
        
        adamDomains.forEach(d => {
          const dom = (d || '').trim();
          if (!dom) return;
          const existing = domainToComplexity.get(dom);
          if (!existing || (existing === 'Medium' && complexity === 'High')) {
            domainToComplexity.set(dom, complexity);
          }
        });
      });
    }
    
    // 🔥 确保ADSL在High Complexity中（必须包含）
    if (!domainToComplexity.has('ADSL')) {
      domainToComplexity.set('ADSL', 'High');
    }
    
    // 重新计算域列表
    const finalUniqueDomains = Array.from(domainToComplexity.keys());
    const finalHighDomains = finalUniqueDomains.filter(d => domainToComplexity.get(d) === 'High');
    const finalMediumDomains = finalUniqueDomains.filter(d => domainToComplexity.get(d) === 'Medium');

    analysis.summary.unique_adam_domains = finalUniqueDomains;
    analysis.summary.total_adam_domains = finalUniqueDomains.length;
    analysis.summary.highComplexityAdam = {
      count: finalHighDomains.length,
      domains: finalHighDomains
    };
    analysis.summary.mediumComplexityAdam = {
      count: finalMediumDomains.length,
      domains: finalMediumDomains
    };

    console.log(`✅ ADaM分析完成 - 发现 ${analysis.summary.unique_adam_domains.length} 个不同的ADaM域`);
    
    // 转换mappings为Map格式以便MongoDB存储 - 简化为字符串格式
    const mappingsMap = new Map();
    if (analysis.mappings && Array.isArray(analysis.mappings)) {
      analysis.mappings.forEach(item => {
        const sdtmDomains = item.sdtm_domains || [];
        const adamDomains = item.adam_domains || [];
        if (sdtmDomains.length > 0 && adamDomains.length > 0) {
          // 将SDTM域作为key，ADaM域作为value
          const sdtmKey = sdtmDomains.join(', ');
          const adamValue = adamDomains.join(', ');
          mappingsMap.set(sdtmKey, adamValue);
        }
      });
    }
    
    console.log(`📊 简化映射格式: ${mappingsMap.size} 个SDTM→ADaM映射`);
    Array.from(mappingsMap.entries()).slice(0, 3).forEach(([sdtm, adam]) => {
      console.log(`   "${sdtm}": "${adam}"`);
    });
    
    return {
      success: true,
      mappings: mappingsMap,
      summary: analysis.summary,
      analyzedAt: new Date()
    };
    
  } catch (error) {
    console.error('❌ ADaM映射分析失败:', error);
    return {
      success: false,
      message: error.message || 'ADaM分析暂时不可用',
      mappings: new Map(),
      summary: {
        total_adam_domains: 0,
        unique_adam_domains: []
      }
    };
  }
}

/**
 * 完整的ADaM分析流程
 * @param {Object} sdtmAnalysisResult - SDTM分析结果
 * @returns {Object} 完整的ADaM分析结果
 */
async function performADaMAnalysis(sdtmAnalysisResult) {
  try {
    console.log('🎯 开始完整的ADaM分析流程...');
    
    // 从SDTM分析结果中提取域列表
    const sdtmDomains = sdtmAnalysisResult?.summary?.unique_domains || [];
    
    if (sdtmDomains.length === 0) {
      return {
        success: false,
        message: '未能从SDTM分析结果中提取到有效的域',
        mappings: new Map(),
        summary: {
          total_adam_domains: 0,
          unique_adam_domains: []
        }
      };
    }
    
    // GPT分析ADaM映射
    const mappingResult = await analyzeADaMMappings(sdtmDomains);
    
    return {
      success: mappingResult.success,
      message: mappingResult.message || 'ADaM分析完成',
      mappings: mappingResult.mappings,
      summary: mappingResult.summary,
      analyzedAt: new Date()
    };
    
  } catch (error) {
    console.error('❌ 完整ADaM分析失败:', error);
    return {
      success: false,
      message: '完整ADaM分析失败',
      mappings: new Map(),
      summary: {
        total_adam_domains: 0,
        unique_adam_domains: []
      }
    };
  }
}

/**
 * 根据确认的ADaM域生成TFL(Tables, Figures, Listings)清单
 * @param {Array} adamDomains - 用户确认的ADaM域列表
 * @returns {Object} 包含outputs数组的结果
 */
async function generateOutputsFromDomains(adamDomains) {
  try {
    console.log('🎯 开始根据ADaM域生成TFL清单...');
    
    if (!adamDomains || adamDomains.length === 0) {
      return {
        success: false,
        message: '没有ADaM域可供分析',
        outputs: []
      };
    }
    
    // 构建提示词
    const domainsText = adamDomains.map((d, i) => `${i + 1}. ${d}`).join('\n');
    
    const prompt = `You are a clinical trial biostatistician. I have a list of ADaM datasets. Please analyze which outputs (tables, figures, listings) we need to summarize all those ADaM.

🔥 CRITICAL REQUIREMENT: Please go through all the ADaM datasets in the list and consider which outputs can be generated from each of them. Please analyze based on the ICH E3 guideline, as the outputs are used to generate the Clinical Study Reports.

🔥 MAPPING AND UNIQUENESS RULES:

1. Provide the number and title for each outputs. - Table and Figure number should start from 14.x, 14.1 is demographic data related, 14.2 is efficacy data related, 14.3 is safety data related, etc. - Listing number should start from 16.x
2. Assess uniqueness for each outputs: - Unique outputs: The programming code for that output need to be generated from scratch - Repeating outputs: The layout is similar as the unique outputs. The programming code does not need to be generated from scratch, but can use the unique output code to simply change the condition. For example, the same table for different laboratory test category, the same table for AE/SAE/AE leading to death summary.
3. Correspondence between outputs - Each table must have corresponding listing - Table and figure do not have a one-to-one correspondence - For the solid tumor oncology trial, must include waterfall plot, simmer lane plot and spider plot. If there are ADTTE domain, must include KM plot for the time-to-event end point.

ADaM Datasets:
${domainsText}

Please return ONLY valid JSON in the following format:
{
  "outputs": [
    {
      "adamDataset": "ADSL",
      "num": "14.1.1",
      "type": "Table",
      "title": "Demographics and Baseline Characteristics",
      "uniqueness": "Unique",
      "correspondingListing": "16.1.1"
    },
    {
      "adamDataset": "ADRS",
      "num": "14.2.1",
      "type": "Table", 
      "title": "Best Overall Response (BOR)",
      "uniqueness": "Unique",
      "correspondingListing": "16.1.11"
    }
  ]
}`;

    console.log('🤖 调用OpenAI生成TFL清单...');
    
    const response = await openai.chat.completions.create({
      model: "gpt-4",
      messages: [
        {
          role: "user",
          content: prompt
        }
      ],
      max_tokens: 3000,
      temperature: 0.2
    });

    const responseText = response.choices[0].message.content.trim();
    console.log('🔍 [DEBUG] AI返回TFL内容:', responseText);

    // 解析JSON响应（复用现有的健壮解析逻辑）
    function extractJson(text) {
      try { return JSON.parse(text); } catch (_) {}
      const codeJson = text.match(/```json[\s\S]*?```/i);
      if (codeJson && codeJson[0]) {
        const inner = codeJson[0].replace(/```json/i, '').replace(/```/g, '').trim();
        try { return JSON.parse(inner); } catch (_) {}
      }
      const codeAny = text.match(/```[\s\S]*?```/);
      if (codeAny && codeAny[0]) {
        const inner = codeAny[0].replace(/```/g, '').trim();
        try { return JSON.parse(inner); } catch (_) {}
      }
      const first = text.indexOf('{');
      const last = text.lastIndexOf('}');
      if (first !== -1 && last !== -1 && last > first) {
        const inner = text.slice(first, last + 1);
        try { return JSON.parse(inner); } catch (_) {}
      }
      return null;
    }

    let result = extractJson(responseText);
    if (!result || !result.outputs || !Array.isArray(result.outputs)) {
      console.error('❌ TFL JSON解析失败: AI响应不是有效JSON');
      return {
        success: false,
        message: 'TFL分析结果解析失败',
        outputs: []
      };
    }

    // 验证和清理输出数据
    const validOutputs = result.outputs.filter(output => {
      return output.num && output.type && output.title && output.uniqueness;
    }).map(output => ({
      adamDataset: String(output.adamDataset || ''), // 🔥 新增：ADaM数据集字段
      num: String(output.num || ''),
      type: String(output.type || ''),
      title: String(output.title || ''),
      uniqueness: String(output.uniqueness || ''),
      repeatOf: output.repeatOf ? String(output.repeatOf) : undefined,
      correspondingListing: output.correspondingListing ? String(output.correspondingListing) : undefined
    }));

    console.log(`✅ TFL生成完成 - 共 ${validOutputs.length} 个输出项`);
    
    return {
      success: true,
      outputs: validOutputs,
      generatedAt: new Date()
    };
    
  } catch (error) {
    console.error('❌ TFL生成失败:', error);
    return {
      success: false,
      message: error.message || 'TFL生成暂时不可用',
      outputs: []
    };
  }
}

module.exports = {
  analyzeADaMMappings,
  performADaMAnalysis,
  generateOutputsFromDomains
};
