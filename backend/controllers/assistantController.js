const Document = require('../models/documentModel');
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
    const doc = await Document.findOne({ 
      studyNumber: { $regex: studyRegex }
    }).select('_id studyNumber projectDone');
    if (!doc) {
      return res.json({ success: true, data: { foundStudy: false } });
    }

    const done = doc.projectDone || {};
    let isUnfinished = null;
    if (task.key === 'costEstimate') {
      // 未完成：isCostEstimate 为 false 即未完成
      isUnfinished = done.hasOwnProperty('isCostEstimate') ? !Boolean(done.isCostEstimate) : null;
    } else if (task.key === 'sasAnalysis') {
      isUnfinished = done.hasOwnProperty('isSasAnalysis') ? !Boolean(done.isSasAnalysis) : null;
    }

    return res.json({
      success: true,
      data: {
        foundStudy: true,
        documentId: String(doc._id),
        studyNumber: doc.studyNumber,
        taskKey: task.key,
        taskName: task.name,
        isUnfinished
      }
    });
  } catch (err) {
    console.error('lookupStudyTask error:', err.message);
    return res.status(500).json({ success: false, message: 'Lookup failed', error: err.message });
  }
}

module.exports = { parseCommand, lookupStudyTask };


