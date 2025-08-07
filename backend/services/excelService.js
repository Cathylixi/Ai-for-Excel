const XLSX = require('xlsx');
const cheerio = require('cheerio');
const fs = require('fs');
const path = require('path');

// 处理带有合并单元格的HTML表格数据提取
function extractTableDataWithMergedCells(scheduleHtml) {
  const $ = cheerio.load(scheduleHtml);
  
  // 提取表格数据，正确处理合并单元格
  let rows = [];
  let maxCols = 15;
  
  // 🔥 新算法：创建占用位置映射表
  const occupancyMap = new Map(); // key: "row,col", value: true
  
  $('table tr').each((trIndex, tr) => {
    const $tr = $(tr);
    let colIndex = 0;
    
    // 确保当前行存在
    if (!rows[trIndex]) {
      rows[trIndex] = new Array(maxCols).fill(undefined);
    }
    
    $tr.find('th, td').each((cellIndex, cell) => {
      const $cell = $(cell);
      const cellText = $cell.text().trim();
      const colspan = parseInt($cell.attr('colspan') || '1');
      const rowspan = parseInt($cell.attr('rowspan') || '1');
      
      // 🔥 核心修复：找到第一个未被占用的列位置
      while (colIndex < maxCols && occupancyMap.has(`${trIndex},${colIndex}`)) {
        colIndex++;
      }
      
      // 扩展数组如果需要
      if (colIndex >= maxCols) {
        console.warn(`表格列数超出预期: ${colIndex}, 扩展到 ${colIndex + 10}`);
        maxCols = colIndex + 10;
        for (let r = 0; r < rows.length; r++) {
          if (rows[r]) {
            while (rows[r].length < maxCols) {
              rows[r].push(undefined);
            }
          }
        }
      }
      
      // 填充当前单元格
      rows[trIndex][colIndex] = cellText;
      
      // 🔥 关键：在占用映射表中标记所有被这个单元格占用的位置
      for (let r = 0; r < rowspan; r++) {
        for (let c = 0; c < colspan; c++) {
          const targetRow = trIndex + r;
          const targetCol = colIndex + c;
          occupancyMap.set(`${targetRow},${targetCol}`, true);
          
          // 确保目标行存在
          if (!rows[targetRow]) {
            rows[targetRow] = new Array(maxCols).fill(undefined);
          }
          
          // 如果不是起始单元格，标记为空字符串（占用但无内容）
          if (r > 0 || c > 0) {
            rows[targetRow][targetCol] = '';
          }
        }
      }
      
      colIndex += colspan;
    });
  });
  
  // 清理空行和调整列数
  const cleanedRows = rows.filter(row => row && row.some(cell => cell !== undefined && cell !== null && cell.trim() !== ''))
    .map(row => {
      // 找到最后一个非空单元格的位置
      let lastIndex = row.length - 1;
      while (lastIndex >= 0 && (row[lastIndex] === undefined || row[lastIndex] === null || row[lastIndex].trim() === '')) {
        lastIndex--;
      }
      // 将undefined替换为空字符串，以便Excel处理
      return row.slice(0, lastIndex + 1).map(cell => cell === undefined || cell === null ? '' : cell);
    });

  return cleanedRows;
}

// 生成Excel文件
function generateExcelFile(cleanedRows, fileName, targetDir) {
  if (cleanedRows.length === 0) {
    throw new Error('无法从HTML中提取表格数据');
  }

  // 创建工作簿和工作表
  const workbook = XLSX.utils.book_new();
  const worksheet = XLSX.utils.aoa_to_sheet(cleanedRows);
  XLSX.utils.book_append_sheet(workbook, worksheet, 'Assessment Schedule');

  // 确保目标目录存在
  if (!fs.existsSync(targetDir)) {
    fs.mkdirSync(targetDir, { recursive: true });
  }
  
  // 保存文件
  const filePath = path.join(targetDir, fileName);
  XLSX.writeFile(workbook, filePath);
  
  return {
    fileName: fileName,
    filePath: filePath,
    rowsCount: cleanedRows.length,
    columnsCount: cleanedRows[0]?.length || 0
  };
}

// 为评估时间表生成Excel文件名
function generateAssessmentScheduleFileName(originalName) {
  const timestamp = new Date().toISOString().slice(0, 19).replace(/[:.]/g, '-');
  const cleanOriginalName = originalName.replace(/\.[^/.]+$/, ""); // 去掉扩展名
  return `AssessmentSchedule_${cleanOriginalName}_${timestamp}.xlsx`;
}

// 导出评估时间表到Excel
function exportAssessmentScheduleToExcel(scheduleHtml, originalName, targetDir) {
  try {
    console.log('📊 开始导出评估时间表到Excel...');
    
    // 提取表格数据
    const cleanedRows = extractTableDataWithMergedCells(scheduleHtml);
    
    // 生成文件名
    const fileName = generateAssessmentScheduleFileName(originalName);
    
    // 生成Excel文件
    const result = generateExcelFile(cleanedRows, fileName, targetDir);
    
    console.log(`✅ 评估时间表Excel导出成功: ${result.filePath}`);
    return result;
    
  } catch (error) {
    console.error('❌ 导出评估时间表失败:', error);
    throw error;
  }
}

module.exports = {
  extractTableDataWithMergedCells,
  generateExcelFile,
  generateAssessmentScheduleFileName,
  exportAssessmentScheduleToExcel
}; 