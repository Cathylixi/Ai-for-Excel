#!/bin/bash

echo "测试文档上传和SDTM分析..."

# 使用正确的multipart/form-data格式上传文件
curl -k -X POST \
  -H "Content-Type: multipart/form-data" \
  -F "document=@backend/Resource/protocol/spi-gcf-301-pk-protocol-am1-final4.docx" \
  -F "documentType=ClinicalProtocol" \
  https://localhost:4000/api/upload-document \
  | jq '.'

echo "测试完成！" 