const fs = require('fs');
const path = require('path');
require('dotenv').config();

// Read config with sane defaults
const CRF_TMP_DIR = process.env.CRF_TMP_DIR || '/tmp/crf';
const ANNOT_GAP = Number(process.env.ANNOT_GAP || 25);
const ANNOT_BOX_W = Number(process.env.ANNOT_BOX_W || 20); // 保留作为默认/最小宽度
const ANNOT_PAD = Number(process.env.ANNOT_PAD || 2);

// 🔧 新增：动态宽度配置
const ANNOT_MIN_WIDTH = Number(process.env.ANNOT_MIN_WIDTH || 18); // 最小宽度
const ANNOT_MAX_WIDTH = Number(process.env.ANNOT_MAX_WIDTH || 80); // 最大宽度
const ANNOT_TEXT_PADDING = Number(process.env.ANNOT_TEXT_PADDING || 8); // 文字左右边距

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
  // 🔧 新增：动态宽度配置导出
  ANNOT_MIN_WIDTH,
  ANNOT_MAX_WIDTH,
  ANNOT_TEXT_PADDING
};



