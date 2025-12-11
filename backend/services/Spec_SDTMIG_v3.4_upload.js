#!/usr/bin/env node
/**
 * SDTMIG v3.4 Upload Script
 * 
 * 功能：
 * 1. 读取 backend/Resource/SDTMIG_v3.4.xlsx 文件
 * 2. 解析所有 sheets 的内容
 * 3. 按照 column 结构存储到 MongoDB References.SDTMIG_v3.4 集合
 * 
 * 数据结构：
 * - 每个 sheet 作为一个独立文档
 * - 每个文档包含：sheet_name, columns, data (按行存储的记录数组)
 * 
 * 使用方法：
 * node backend/services/Spec_SDTMIG_v3.4_upload.js
 */

const fs = require('fs');
const path = require('path');
const XLSX = require('xlsx');
const mongoose = require('mongoose');
require('dotenv').config();

// ===================== 配置参数 =====================

const EXCEL_PATH = path.join(__dirname, '../Resource/SDTMIG_v3.4.xlsx');
const MONGO_URI = process.env.MONGODB_URI || 'mongodb+srv://xixili0818:QWERasdf1234@cluster0.cfd61nz.mongodb.net/?retryWrites=true&w=majority&appName=Cluster0';
const DB_NAME = 'References';
const COLLECTION_NAME = 'SDTMIG_v3.4';

// ===================== 辅助函数 =====================

/**
 * 清理单元格值
 */
function cleanValue(value) {
  if (value === null || value === undefined || value === '') {
    return null;
  }
  if (typeof value === 'string') {
    return value.trim();
  }
  return value;
}

/**
 * 将工作表转换为 JSON 格式（按列存储）
 */
function sheetToJson(worksheet) {
  const range = XLSX.utils.decode_range(worksheet['!ref'] || 'A1');
  const columns = [];
  const data = [];
  
  // 读取表头（第一行）
  for (let col = range.s.c; col <= range.e.c; col++) {
    const cellAddress = XLSX.utils.encode_cell({ r: range.s.r, c: col });
    const cell = worksheet[cellAddress];
    columns.push(cell ? cleanValue(cell.v) : `Column_${col + 1}`);
  }
  
  // 读取数据行（从第二行开始）
  for (let row = range.s.r + 1; row <= range.e.r; row++) {
    const record = {};
    let hasData = false;
    
    for (let col = range.s.c; col <= range.e.c; col++) {
      const cellAddress = XLSX.utils.encode_cell({ r: row, c: col });
      const cell = worksheet[cellAddress];
      const columnName = columns[col - range.s.c];
      const value = cell ? cleanValue(cell.v) : null;
      
      record[columnName] = value;
      if (value !== null) {
        hasData = true;
      }
    }
    
    // 只添加非空行
    if (hasData) {
      data.push(record);
    }
  }
  
  return { columns, data };
}

// ===================== 主函数 =====================

async function uploadSDTMIG() {
  console.log('=' .repeat(60));
  console.log('🚀 开始上传 SDTMIG v3.4 到 MongoDB');
  console.log('='.repeat(60));
  
  // 1. 检查文件是否存在
  if (!fs.existsSync(EXCEL_PATH)) {
    console.error(`❌ 文件不存在: ${EXCEL_PATH}`);
    process.exit(1);
  }
  
  console.log(`📄 Excel 文件: ${EXCEL_PATH}`);
  
  // 2. 连接 MongoDB
  console.log(`🔌 连接 MongoDB...`);
  try {
    await mongoose.connect(MONGO_URI, {
      serverSelectionTimeoutMS: 10000
    });
    console.log('✅ MongoDB 连接成功');
  } catch (error) {
    console.error(`❌ MongoDB 连接失败: ${error.message}`);
    process.exit(1);
  }
  
  // 明确切换到 References 数据库
  const db = mongoose.connection.useDb(DB_NAME);
  const collection = db.collection(COLLECTION_NAME);
  
  // 3. 读取 Excel 文件
  console.log(`\n📖 读取 Excel 文件...`);
  let workbook;
  try {
    workbook = XLSX.readFile(EXCEL_PATH);
    console.log(`✅ 读取成功`);
    console.log(`   📊 Sheet 数量: ${workbook.SheetNames.length}`);
    console.log(`   📋 Sheet 列表: ${workbook.SheetNames.join(', ')}`);
  } catch (error) {
    console.error(`❌ 读取 Excel 失败: ${error.message}`);
    await mongoose.disconnect();
    process.exit(1);
  }
  
  // 4. 清空集合（可选）
  console.log(`\n🗑️  清空旧数据...`);
  try {
    const deleteResult = await collection.deleteMany({});
    console.log(`   ✅ 已删除 ${deleteResult.deletedCount} 条旧记录`);
  } catch (error) {
    console.error(`   ⚠️  清空失败: ${error.message}`);
  }
  
  // 5. 处理每个 sheet
  console.log(`\n🔄 开始处理 Sheets...`);
  const documents = [];
  const currentTime = new Date().toISOString();
  
  for (const sheetName of workbook.SheetNames) {
    console.log(`\n   📑 处理 Sheet: "${sheetName}"`);
    
    try {
      const worksheet = workbook.Sheets[sheetName];
      const { columns, data } = sheetToJson(worksheet);
      
      console.log(`      ├─ 列数: ${columns.length}`);
      console.log(`      ├─ 行数: ${data.length}`);
      console.log(`      └─ 列名: ${columns.slice(0, 5).join(', ')}${columns.length > 5 ? '...' : ''}`);
      
      // 构建文档
      const document = {
        file_name: 'SDTMIG_v3.4.xlsx',
        file_type: 'SDTMIG_Reference',
        version: '3.4',
        sheet_name: sheetName,
        description: `SDTM Implementation Guide v3.4 - ${sheetName} Domain`,
        columns: columns,
        data: data,
        total_rows: data.length,
        total_columns: columns.length,
        created_at: currentTime,
        last_updated: currentTime,
        metadata: {
          source: 'SDTMIG_v3.4.xlsx',
          sheet: sheetName,
          format: 'SDTM IG v3.4',
          version: '3.4'
        }
      };
      
      documents.push(document);
      
    } catch (error) {
      console.error(`      ❌ 处理失败: ${error.message}`);
    }
  }
  
  // 6. 批量插入到 MongoDB
  console.log(`\n💾 开始存储到 MongoDB...`);
  console.log(`   📍 数据库: ${DB_NAME}`);
  console.log(`   📍 集合: ${COLLECTION_NAME}`);
  
  try {
    if (documents.length > 0) {
      const result = await collection.insertMany(documents);
      console.log(`   ✅ 插入成功: ${result.insertedCount} 个 Sheet 文档`);
    } else {
      console.log(`   ⚠️  没有数据可插入`);
    }
  } catch (error) {
    console.error(`   ❌ 插入失败: ${error.message}`);
    await mongoose.disconnect();
    process.exit(1);
  }
  
  // 7. 创建索引
  console.log(`\n🔧 创建索引...`);
  try {
    await collection.createIndex({ sheet_name: 1 });
    await collection.createIndex({ 'metadata.version': 1 });
    console.log(`   ✅ 索引创建完成`);
  } catch (error) {
    console.error(`   ⚠️  索引创建失败: ${error.message}`);
  }
  
  // 8. 验证结果
  console.log(`\n🔍 验证导入结果...`);
  try {
    const count = await collection.countDocuments({});
    console.log(`   ✅ 验证成功！`);
    console.log(`   📊 集合中的文档数: ${count}`);
    
    // 显示第一个文档的摘要信息
    const firstDoc = await collection.findOne({});
    if (firstDoc) {
      console.log(`   📋 示例文档:`);
      console.log(`      ├─ Sheet: ${firstDoc.sheet_name}`);
      console.log(`      ├─ 行数: ${firstDoc.total_rows}`);
      console.log(`      ├─ 列数: ${firstDoc.total_columns}`);
      console.log(`      └─ 版本: ${firstDoc.version}`);
    }
  } catch (error) {
    console.error(`   ❌ 验证失败: ${error.message}`);
  }
  
  // 9. 关闭连接
  await mongoose.disconnect();
  console.log(`\n🔌 已断开 MongoDB 连接`);
  
  console.log('\n' + '='.repeat(60));
  console.log('✅ SDTMIG v3.4 上传完成');
  console.log('='.repeat(60));
  
  // 10. 输出查询示例
  console.log('\n📝 查询示例:');
  console.log('  // 查看所有 sheets');
  console.log('  db.SDTMIG_v3.4.find({}, {sheet_name: 1, total_rows: 1})');
  console.log('');
  console.log('  // 查询特定 sheet 的数据');
  console.log('  db.SDTMIG_v3.4.findOne({sheet_name: "AE"})');
  console.log('');
  console.log('  // 查询某个 sheet 的列名');
  console.log('  db.SDTMIG_v3.4.findOne({sheet_name: "DM"}, {columns: 1})');
  console.log('');
  console.log('  // 统计 sheets 数量');
  console.log('  db.SDTMIG_v3.4.countDocuments({})');
  console.log('');
}

// ===================== 执行脚本 =====================

if (require.main === module) {
  uploadSDTMIG()
    .then(() => {
      console.log('\n✨ 脚本执行完成\n');
      process.exit(0);
    })
    .catch((error) => {
      console.error('\n❌ 脚本执行失败:', error);
      process.exit(1);
    });
}

module.exports = { uploadSDTMIG };

