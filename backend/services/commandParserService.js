const OpenAI = require('openai');

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

// 受支持的任务列表与关键词
const SUPPORTED_TASKS = [
  {
    name: 'Cost Estimate',
    key: 'costEstimate',
    keywords: ['cost', 'estimate', 'estimation', 'budget', 'pricing', 'quote']
  },
  {
    name: 'SAS Analysis',
    key: 'sasAnalysis',
    keywords: ['sas', 'analysis', 'statistical', 'program', 'tlfs', 'tables', 'figures', 'listings']
  }
];

function matchTaskByKeywords(keywords) {
  if (!Array.isArray(keywords)) return null;
  const lower = keywords.map(k => String(k || '').toLowerCase());
  let best = null;
  let bestScore = 0;
  for (const task of SUPPORTED_TASKS) {
    const score = task.keywords.reduce((acc, kw) => acc + (lower.includes(kw) ? 1 : 0), 0);
    if (score > bestScore) { best = task; bestScore = score; }
  }
  return best;
}

async function parseUserCommand(userInput) {
  const prompt = `You are an assistant that extracts intent from a single user sentence about a clinical study workflow.
Return STRICT JSON with keys: {"studyIdentifier": string|null, "taskKeywords": string[]}.
Study identifier is usually an alphanumeric code like SK123-KBI. Never invent it.
Task keywords should be a small set of useful tokens from the user's request (e.g., ["cost","estimate"]).
Input: ${userInput}`;

  const resp = await openai.chat.completions.create({
    model: 'gpt-4',
    messages: [{ role: 'user', content: prompt }],
    temperature: 0.1,
    max_tokens: 120
  });
  const content = (resp.choices?.[0]?.message?.content || '').trim();
  let parsed = { studyIdentifier: null, taskKeywords: [] };
  try {
    parsed = JSON.parse(content);
  } catch (e) {
    const start = content.indexOf('{');
    const end = content.lastIndexOf('}');
    if (start >= 0 && end > start) parsed = JSON.parse(content.slice(start, end + 1));
  }
  const task = matchTaskByKeywords(parsed.taskKeywords || []);
  return {
    studyIdentifier: parsed.studyIdentifier || null,
    matchedTask: task ? { name: task.name, key: task.key } : null
  };
}

module.exports = { parseUserCommand, SUPPORTED_TASKS };


