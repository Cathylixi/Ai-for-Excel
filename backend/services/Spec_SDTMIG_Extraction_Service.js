/**
 * Spec SDTMIG Extraction Service
 * 功能：从本地SDTMIG_v3.4.xlsx文件中提取Datasets和Variables数据
 * 用途：一次性导入CDISC标准参考数据到数据库
 * Author: LLX Solutions
 */

const XLSX = require('xlsx');
const path = require('path');
const fs = require('fs');

/**
 * 提取SDTMIG_v3.4.xlsx文件中的Datasets和Variables数据
 * @returns {Promise<Object>} 包含Datasets和Variables的结构化数据
 */
async function extractSDTMIGData() {
  try {
    console.log('📄 开始提取SDTMIG_v3.4.xlsx数据...');
    
    // 构建文件路径
    const filePath = path.join(__dirname, '..', 'Resource', 'SDTMIG_v3.4.xlsx');
    
    // 检查文件是否存在
    if (!fs.existsSync(filePath)) {
      throw new Error(`SDTMIG文件不存在: ${filePath}`);
    }
    
    console.log('📁 文件路径:', filePath);
    
    // 读取Excel文件
    const workbook = XLSX.readFile(filePath);
    console.log('📋 发现工作表:', workbook.SheetNames);
    
    if (workbook.SheetNames.length < 3) {
      throw new Error('SDTMIG文件工作表数量不足，至少需要3个sheet');
    }
    
    const result = {};
    
    // 提取第2个sheet - Datasets
    const datasetsSheetName = workbook.SheetNames[1]; // 第2个sheet
    console.log('📊 正在处理Datasets sheet:', datasetsSheetName);
    
    if (datasetsSheetName.toLowerCase() !== 'datasets') {
      console.warn(`⚠️ 警告: 第2个sheet名称为"${datasetsSheetName}"，期望为"Datasets"`);
    }
    
    const datasetsSheet = workbook.Sheets[datasetsSheetName];
    const datasetsJsonData = XLSX.utils.sheet_to_json(datasetsSheet);
    
    if (datasetsJsonData.length === 0) {
      throw new Error('Datasets工作表没有数据');
    }
    
    // 提取表头
    const datasetsHeaders = Object.keys(datasetsJsonData[0]);
    console.log('📋 Datasets表头字段:', datasetsHeaders);
    console.log('📊 Datasets数据行数:', datasetsJsonData.length);
    
    result.Datasets = {
      table_title: datasetsHeaders,
      table_content: datasetsJsonData,
      source_file: 'SDTMIG_v3.4.xlsx',
      sheet_name: datasetsSheetName,
      loaded_at: new Date(),
      version: '3.4',
      row_count: datasetsJsonData.length
    };
    
    // 提取第3个sheet - Variables
    const variablesSheetName = workbook.SheetNames[2]; // 第3个sheet
    console.log('📊 正在处理Variables sheet:', variablesSheetName);
    
    if (variablesSheetName.toLowerCase() !== 'variables') {
      console.warn(`⚠️ 警告: 第3个sheet名称为"${variablesSheetName}"，期望为"Variables"`);
    }
    
    const variablesSheet = workbook.Sheets[variablesSheetName];
    const variablesJsonData = XLSX.utils.sheet_to_json(variablesSheet);
    
    if (variablesJsonData.length === 0) {
      throw new Error('Variables工作表没有数据');
    }
    
    // 提取表头
    const variablesHeaders = Object.keys(variablesJsonData[0]);
    console.log('📋 Variables表头字段:', variablesHeaders);
    console.log('📊 Variables数据行数:', variablesJsonData.length);
    
    result.Variables = {
      table_title: variablesHeaders,
      table_content: variablesJsonData,
      source_file: 'SDTMIG_v3.4.xlsx',
      sheet_name: variablesSheetName,
      loaded_at: new Date(),
      version: '3.4',
      row_count: variablesJsonData.length
    };
    
    // 🔥 新增：根据Core字段过滤Variables数据
    console.log('🔍 开始按Core字段分类Variables数据...');
    
    const variables_req = variablesJsonData.filter(row => row.Core === 'Req');
    const variables_perm = variablesJsonData.filter(row => row.Core === 'Perm');
    const variables_exp = variablesJsonData.filter(row => row.Core === 'Exp');
    
    // 🔥 新增：提取每个分类中的唯一Dataset Name
    const req_unique_datasets = [...new Set(variables_req.map(row => row['Dataset Name']))].filter(Boolean).sort();
    const perm_unique_datasets = [...new Set(variables_perm.map(row => row['Dataset Name']))].filter(Boolean).sort();
    const exp_unique_datasets = [...new Set(variables_exp.map(row => row['Dataset Name']))].filter(Boolean).sort();
    
    console.log('📊 Variables分类统计:', {
      total: variablesJsonData.length,
      req: variables_req.length,
      perm: variables_perm.length,
      exp: variables_exp.length,
      req_unique_datasets: req_unique_datasets.length,
      perm_unique_datasets: perm_unique_datasets.length,
      exp_unique_datasets: exp_unique_datasets.length
    });
    
    console.log('📋 唯一Dataset Name分布:');
    console.log('  - Req Datasets:', req_unique_datasets);
    console.log('  - Perm Datasets:', perm_unique_datasets);
    console.log('  - Exp Datasets:', exp_unique_datasets);
    
    // Variables_Req数据
    result.Variables_Req = {
      table_title: variablesHeaders, // 相同的表头
      table_content: variables_req,
      Dataset_unique: req_unique_datasets, // 🔥 新增：唯一Dataset Name列表
      source_file: 'SDTMIG_v3.4.xlsx',
      sheet_name: variablesSheetName,
      filter_criteria: 'Core=Req',
      loaded_at: new Date(),
      version: '3.4',
      row_count: variables_req.length,
      unique_datasets_count: req_unique_datasets.length // 🔥 新增：唯一Dataset数量
    };
    
    // Variables_Perm数据
    result.Variables_Perm = {
      table_title: variablesHeaders, // 相同的表头
      table_content: variables_perm,
      Dataset_unique: perm_unique_datasets, // 🔥 新增：唯一Dataset Name列表
      source_file: 'SDTMIG_v3.4.xlsx',
      sheet_name: variablesSheetName,
      filter_criteria: 'Core=Perm',
      loaded_at: new Date(),
      version: '3.4',
      row_count: variables_perm.length,
      unique_datasets_count: perm_unique_datasets.length // 🔥 新增：唯一Dataset数量
    };
    
    // Variables_Exp数据
    result.Variables_Exp = {
      table_title: variablesHeaders, // 相同的表头
      table_content: variables_exp,
      Dataset_unique: exp_unique_datasets, // 🔥 新增：唯一Dataset Name列表
      source_file: 'SDTMIG_v3.4.xlsx',
      sheet_name: variablesSheetName,
      filter_criteria: 'Core=Exp',
      loaded_at: new Date(),
      version: '3.4',
      row_count: variables_exp.length,
      unique_datasets_count: exp_unique_datasets.length // 🔥 新增：唯一Dataset数量
    };
    
    console.log('✅ SDTMIG数据提取完成');
    console.log('📊 提取结果统计:', {
      datasets_rows: result.Datasets.row_count,
      variables_rows: result.Variables.row_count,
      variables_req_rows: result.Variables_Req.row_count,
      variables_perm_rows: result.Variables_Perm.row_count,
      variables_exp_rows: result.Variables_Exp.row_count,
      datasets_columns: result.Datasets.table_title.length,
      variables_columns: result.Variables.table_title.length
    });
    
    return {
      success: true,
      data: result,
      message: 'SDTMIG data extracted successfully'
    };
    
  } catch (error) {
    console.error('❌ 提取SDTMIG数据失败:', error);
    return {
      success: false,
      error: error.message,
      message: 'Failed to extract SDTMIG data'
    };
  }
}

/**
 * 验证提取的数据格式
 * @param {Object} extractedData - 提取的数据
 * @returns {boolean} 数据是否有效
 */
function validateExtractedData(extractedData) {
  try {
    if (!extractedData || !extractedData.data) {
      return false;
    }
    
    const { Datasets, Variables, Variables_Req, Variables_Perm, Variables_Exp } = extractedData.data;
    
    // 验证Datasets
    if (!Datasets || !Array.isArray(Datasets.table_title) || !Array.isArray(Datasets.table_content)) {
      console.error('❌ Datasets数据格式无效');
      return false;
    }
    
    // 验证Variables
    if (!Variables || !Array.isArray(Variables.table_title) || !Array.isArray(Variables.table_content)) {
      console.error('❌ Variables数据格式无效');
      return false;
    }
    
    // 🔥 新增：验证分类Variables数据
    if (!Variables_Req || !Array.isArray(Variables_Req.table_title) || !Array.isArray(Variables_Req.table_content)) {
      console.error('❌ Variables_Req数据格式无效');
      return false;
    }
    
    if (!Variables_Perm || !Array.isArray(Variables_Perm.table_title) || !Array.isArray(Variables_Perm.table_content)) {
      console.error('❌ Variables_Perm数据格式无效');
      return false;
    }
    
    if (!Variables_Exp || !Array.isArray(Variables_Exp.table_title) || !Array.isArray(Variables_Exp.table_content)) {
      console.error('❌ Variables_Exp数据格式无效');
      return false;
    }
    
    console.log('✅ 数据格式验证通过（包含分类Variables）');
    return true;
    
  } catch (error) {
    console.error('❌ 数据验证失败:', error);
    return false;
  }
}

/**
 * 获取SDTMIG文件信息（不读取内容）
 * @returns {Object} 文件信息
 */
function getSDTMIGFileInfo() {
  try {
    const filePath = path.join(__dirname, '..', 'Resource', 'SDTMIG_v3.4.xlsx');
    
    if (!fs.existsSync(filePath)) {
      return {
        exists: false,
        path: filePath,
        message: 'SDTMIG文件不存在'
      };
    }
    
    const stats = fs.statSync(filePath);
    
    return {
      exists: true,
      path: filePath,
      size: stats.size,
      modified: stats.mtime,
      message: 'SDTMIG文件存在'
    };
    
  } catch (error) {
    return {
      exists: false,
      error: error.message,
      message: '无法获取SDTMIG文件信息'
    };
  }
}

module.exports = {
  extractSDTMIGData,
  validateExtractedData,
  getSDTMIGFileInfo
};
