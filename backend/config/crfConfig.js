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
const WORD_GAP_THRESHOLD = Number(process.env.WORD_GAP_THRESHOLD || 18);
const LINE_HEIGHT_THRESHOLD = Number(process.env.LINE_HEIGHT_THRESHOLD || 15);
const VISUAL_LINE_Y_GAP = Number(process.env.VISUAL_LINE_Y_GAP || 8);

// OID Form 相关阈值
const OID_COLUMN_TOLERANCE = Number(process.env.OID_COLUMN_TOLERANCE || 20); // 列归属容差（px）
const OID_HEADER_KEYWORDS = ['Field Name', 'Data Type', 'Units', 'Values', 'Pre-Filled', 'Include', 'Field OID'];

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
  QUESTION_GAP_THRESHOLD,
  WORD_GAP_THRESHOLD,
  LINE_HEIGHT_THRESHOLD,
  VISUAL_LINE_Y_GAP,
  OID_COLUMN_TOLERANCE,
  OID_HEADER_KEYWORDS
};



