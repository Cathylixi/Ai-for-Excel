/**
 * SDTMIG Reference Data Model
 * 功能：独立存储CDISC SDTMIG参考数据，避免Study文档超过16MB限制
 * Author: LLX Solutions
 */

const mongoose = require('mongoose');

// SDTMIG参考数据Schema
const SDTMIGReferenceSchema = new mongoose.Schema({
  version: { type: String, required: true, index: true }, // SDTMIG版本，如"3.4"
  
  // Datasets数据
  Datasets: {
    table_title: [{ type: String }], // 表头字段名称数组
    table_content: [{ type: mongoose.Schema.Types.Mixed }], // 行数据，每行一个对象
    source_file: { type: String, default: 'SDTMIG_v3.4.xlsx' },
    sheet_name: { type: String, default: 'Datasets' },
    total_rows: { type: Number },
    loaded_at: { type: Date }
  },
  
  // Variables数据  
  Variables: {
    table_title: [{ type: String }], // 表头字段名称数组
    table_content: [{ type: mongoose.Schema.Types.Mixed }], // 行数据，每行一个对象
    source_file: { type: String, default: 'SDTMIG_v3.4.xlsx' },
    sheet_name: { type: String, default: 'Variables' },
    total_rows: { type: Number },
    loaded_at: { type: Date }
  },
  
  // 🔥 新增：Variables按Core字段分类存储
  Variables_Req: {
    table_title: [{ type: String }], // 与Variables相同的表头
    table_content: [{ type: mongoose.Schema.Types.Mixed }], // Core='Req'的行数据
    Dataset_unique: [{ type: String }], // 🔥 新增：Core='Req'中唯一的Dataset Name列表
    source_file: { type: String, default: 'SDTMIG_v3.4.xlsx' },
    sheet_name: { type: String, default: 'Variables' },
    filter_criteria: { type: String, default: 'Core=Req' },
    total_rows: { type: Number },
    unique_datasets_count: { type: Number }, // 🔥 新增：唯一Dataset数量
    loaded_at: { type: Date }
  },
  
  Variables_Perm: {
    table_title: [{ type: String }], // 与Variables相同的表头
    table_content: [{ type: mongoose.Schema.Types.Mixed }], // Core='Perm'的行数据
    Dataset_unique: [{ type: String }], // 🔥 新增：Core='Perm'中唯一的Dataset Name列表
    source_file: { type: String, default: 'SDTMIG_v3.4.xlsx' },
    sheet_name: { type: String, default: 'Variables' },
    filter_criteria: { type: String, default: 'Core=Perm' },
    total_rows: { type: Number },
    unique_datasets_count: { type: Number }, // 🔥 新增：唯一Dataset数量
    loaded_at: { type: Date }
  },
  
  Variables_Exp: {
    table_title: [{ type: String }], // 与Variables相同的表头
    table_content: [{ type: mongoose.Schema.Types.Mixed }], // Core='Exp'的行数据
    Dataset_unique: [{ type: String }], // 🔥 新增：Core='Exp'中唯一的Dataset Name列表
    source_file: { type: String, default: 'SDTMIG_v3.4.xlsx' },
    sheet_name: { type: String, default: 'Variables' },
    filter_criteria: { type: String, default: 'Core=Exp' },
    total_rows: { type: Number },
    unique_datasets_count: { type: Number }, // 🔥 新增：唯一Dataset数量
    loaded_at: { type: Date }
  },
  
  // 元数据
  imported_at: { type: Date, default: Date.now },
  imported_by: { type: String, default: 'System' },
  file_info: {
    original_path: { type: String },
    file_size: { type: Number },
    checksum: { type: String }
  }
}, {
  collection: 'sdtmig_reference' // 指定collection名称
});

// 创建索引提高查询性能
SDTMIGReferenceSchema.index({ version: 1 });
SDTMIGReferenceSchema.index({ 'Datasets.table_content.Dataset Name': 1 });
SDTMIGReferenceSchema.index({ 'Variables.table_content.Dataset Name': 1 });
SDTMIGReferenceSchema.index({ 'Variables.table_content.Variable Name': 1 });
// 🔥 新增：分类Variables的索引
SDTMIGReferenceSchema.index({ 'Variables_Req.table_content.Dataset Name': 1 });
SDTMIGReferenceSchema.index({ 'Variables_Req.table_content.Variable Name': 1 });
SDTMIGReferenceSchema.index({ 'Variables_Perm.table_content.Dataset Name': 1 });
SDTMIGReferenceSchema.index({ 'Variables_Perm.table_content.Variable Name': 1 });
SDTMIGReferenceSchema.index({ 'Variables_Exp.table_content.Dataset Name': 1 });
SDTMIGReferenceSchema.index({ 'Variables_Exp.table_content.Variable Name': 1 });

const SDTMIGReference = mongoose.model('SDTMIGReference', SDTMIGReferenceSchema);

module.exports = SDTMIGReference;
