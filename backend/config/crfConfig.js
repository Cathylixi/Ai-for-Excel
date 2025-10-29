const fs = require('fs');
const path = require('path');
require('dotenv').config();

// Read config with sane defaults
const CRF_TMP_DIR = process.env.CRF_TMP_DIR || '/tmp/crf';
const ANNOT_GAP = Number(process.env.ANNOT_GAP || 10);
const ANNOT_BOX_W = Number(process.env.ANNOT_BOX_W || 10); // 框高度，调矮一些
const ANNOT_PAD = Number(process.env.ANNOT_PAD || 0);

// 🆕 Question文本间隙检测阈值
const QUESTION_GAP_THRESHOLD = Number(process.env.QUESTION_GAP_THRESHOLD || 30);

// Ensure temp directory exists at module load
try {
  if (!fs.existsSync(CRF_TMP_DIR)) {
    fs.mkdirSync(CRF_TMP_DIR, { recursive: true });
  }
} catch (e) {
  console.warn('⚠️ 创建CRF临时目录失败:', e.message);
}

module.exports = {
  CRF_TMP_DIR,
  ANNOT_GAP,
  ANNOT_BOX_W,
  ANNOT_PAD,
  QUESTION_GAP_THRESHOLD
};



