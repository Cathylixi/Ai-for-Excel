const Study = require('../models/studyModel');
const { parseUserCommand, SUPPORTED_TASKS } = require('../services/commandParserService');

// 构建对 studyNumber 友好的不区分大小写、兼容多种连字符/空白的正则
function buildStudyNumberRegex(input) {
  const source = String(input || '').trim();
  // 需要被视作"连字符/分隔"的字符集合：普通连字符、下划线、空格、常见破折号
  const hyphenOrSpace = /[-_\s‑–—]/; // 直接使用实际字符而不是Unicode转义

  let pattern = '';
  for (const ch of source) {
    if (hyphenOrSpace.test(ch)) {
      // 连续分隔符按一组匹配，允许数据库里与输入之间的差异
      pattern += '[-_\\s‑–—]+';
    } else {
      // 其它字符按字面量匹配，需要转义正则特殊字符
      pattern += ch.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    }
  }
  return new RegExp(`^${pattern}$`, 'i');
}

// Step 1-2: 仅解析用户命令（不查库）
async function parseCommand(req, res) {
  try {
    const { text } = req.body || {};
    if (!text || typeof text !== 'string') {
      return res.status(400).json({ success: false, message: 'Missing text' });
    }
    const result = await parseUserCommand(text);
    return res.json({ success: true, data: result });
  } catch (err) {
    console.error('parseCommand error:', err.message);
    return res.status(500).json({ success: false, message: 'Parse failed', error: err.message });
  }
}

// Step 4: 确认后查询数据库并检查未完成进度
async function lookupStudyTask(req, res) {
  try {
    const { studyIdentifier, taskKey } = req.body || {};
    if (!taskKey) return res.status(400).json({ success: false, message: 'Missing taskKey' });

    const task = SUPPORTED_TASKS.find(t => t.key === taskKey);
    if (!task) return res.status(400).json({ success: false, message: 'Unsupported task' });

    if (!studyIdentifier) {
      return res.json({ success: true, data: { foundStudy: false } });
    }

    // 使用不区分大小写，且兼容不同连字符/空白的查询
    const studyRegex = buildStudyNumberRegex(studyIdentifier);
    const doc = await Study.findOne({ 
      studyNumber: { $regex: studyRegex }
    }).select('_id studyNumber projectDone CostEstimateDetails.sdtmAnalysisStatus');
    if (!doc) {
      return res.json({ success: true, data: { foundStudy: false } });
    }

    const done = doc.projectDone || {};
    let isUnfinished = null;
    let currentStatus = null;
    
    if (task.key === 'costEstimate') {
      // 🔥 新的三状态逻辑：null=从未开始, false=进行中, true=已完成
      const status = done.isCostEstimate;
      if (status === null || status === undefined) {
        isUnfinished = null;  // 从未开始
      } else if (status === false) {
        isUnfinished = true;  // 已开始但未完成
      } else if (status === true) {
        isUnfinished = false; // 已完成
      }
      // 🔥 获取当前的 sdtmAnalysisStatus 以便前端精确路由
      currentStatus = doc.CostEstimateDetails?.sdtmAnalysisStatus || null;
    } else if (task.key === 'sasAnalysis') {
      // 🔥 新的三状态逻辑：null=从未开始, false=进行中, true=已完成
      const status = done.isSasAnalysis;
      if (status === null || status === undefined) {
        isUnfinished = null;  // 从未开始
      } else if (status === false) {
        isUnfinished = true;  // 已开始但未完成
      } else if (status === true) {
        isUnfinished = false; // 已完成
      }
      // 对于SAS分析，我们暂时不需要状态机，保持原有逻辑
      currentStatus = null;
    }

    return res.json({
      success: true,
      data: {
        foundStudy: true,
        documentId: String(doc._id),
        studyNumber: doc.studyNumber,
        taskKey: task.key,
        taskName: task.name,
        isUnfinished,
        currentStatus // 🔥 新增：返回当前的精确状态
      }
    });
  } catch (err) {
    console.error('lookupStudyTask error:', err.message);
    return res.status(500).json({ success: false, message: 'Lookup failed', error: err.message });
  }
}

module.exports = { parseCommand, lookupStudyTask };

// ===== 新增：Yes/No 判别（轻量实现，前端可调用）=====
// 请求体: { text: string }
// 返回: { success: true, data: { intent: 'yes' | 'no' | 'unknown' } }
async function parseYesNo(req, res) {
  try {
    const { text } = req.body || {};
    if (!text || typeof text !== 'string') {
      return res.status(400).json({ success: false, message: 'Missing text' });
    }
    const lower = text.trim().toLowerCase();
    const yesList = ['yes','y','yeah','yep','ok','okay','sure','correct','right','confirm','confirmed','agree','agreed','当然','好的','是','没问题','行','可以'];
    const noList  = ['no','n','nope','not','cancel','wrong','incorrect','拒绝','不要','不是','不行','不可以'];
    const isYes = yesList.some(w => lower.includes(w));
    const isNo  = noList.some(w => lower.includes(w));
    let intent = 'unknown';
    if (isYes && !isNo) intent = 'yes';
    else if (isNo && !isYes) intent = 'no';
    return res.json({ success: true, data: { intent } });
  } catch (err) {
    console.error('parseYesNo error:', err.message);
    return res.status(500).json({ success: false, message: 'parse yes/no failed', error: err.message });
  }
}

module.exports.parseYesNo = parseYesNo;


