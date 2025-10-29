#!/bin/bash
# CDISC SDTM Terminology 导入脚本快速启动

echo "============================================================"
echo "🚀 CDISC SDTM Terminology 导入脚本"
echo "============================================================"
echo ""

# 切换到脚本目录
cd "$(dirname "$0")"

# 检查Python3
if ! command -v python3 &> /dev/null; then
    echo "❌ Python3 未安装"
    exit 1
fi

echo "✅ Python版本: $(python3 --version)"
echo ""

# 检查Excel文件
EXCEL_PATH="../Resource/CDISC SDTM Terminology_20250328.xls"
if [ ! -f "$EXCEL_PATH" ]; then
    echo "❌ Excel文件不存在: $EXCEL_PATH"
    exit 1
fi

echo "✅ Excel文件: $EXCEL_PATH ($(ls -lh "$EXCEL_PATH" | awk '{print $5}'))"
echo ""

# 检查依赖
echo "📦 检查Python依赖..."
if ! python3 -c "import pandas" 2>/dev/null; then
    echo "⚠️  pandas未安装，正在安装依赖..."
    pip3 install -r requirements_sdtm.txt
else
    echo "✅ 依赖已安装"
fi

echo ""
echo "============================================================"
echo "🎬 开始执行导入..."
echo "============================================================"
echo ""

# 执行导入脚本
python3 import_sdtm_terminology.py

EXIT_CODE=$?

echo ""
if [ $EXIT_CODE -eq 0 ]; then
    echo "============================================================"
    echo "✅ 导入完成！"
    echo "============================================================"
else
    echo "============================================================"
    echo "❌ 导入失败，退出码: $EXIT_CODE"
    echo "============================================================"
fi

exit $EXIT_CODE

