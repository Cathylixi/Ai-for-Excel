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

// 生成成本分析Excel
function generateCostAnalysisExcel(projectSelection, originalName, targetDir) {
  try {
    console.log('📊 开始生成成本分析Excel...');
    
    if (!projectSelection || !projectSelection.selectedTasks || projectSelection.selectedTasks.length === 0) {
      console.log('⚠️ 没有选择任何项目，生成空模板');
      projectSelection = { selectedTasks: [], dataTransferTimes: {}, rerunTimes: {} };
    }
    
    // 创建Excel数据结构
    const rows = [];
    
    // 第1行：列标题（加粗）
    const headers = ['Task', 'Unit', 'Cost Per Hour', '# of Hours Per Unit', 'Cost Per Unit', 'Estimated cost', 'Notes'];
    rows.push(headers);
    
    // 映射任务名称到显示名称
    const taskDisplayNames = {
      'Statistical Analysis Plan and Shells Development (2 Drafts and 1 Final)': 'Statistical Analysis Plan and Shells Development (2 Drafts and 1 Final)',
      'SDTM Datasets Production and Validation': 'SDTM Datasets Production and Validation',
      'ADaM Datasets Production and Validation': 'ADaM Datasets Production and Validation',
      'Tables, Figures, and Listings Development': 'Tables, Figures, and Listings Development',
      'Interim Analysis': 'Interim Analysis',
      'Final Analysis': 'Final Analysis',
      'DSUR First Time': 'DSUR First Time',
      'DSUR Rerun': 'DSUR Rerun',
      'DSMB/IDMC First Time': 'DSMB/IDMC First Time',
      'DSMB Rerun': 'DSMB Rerun'
    };
    
    // 当前行号，从第2行开始（第1行是标题）
    let currentRow = 2;
    
    // 遍历选中的任务
    projectSelection.selectedTasks.forEach(task => {
      // 添加主任务行
      const taskRow = [taskDisplayNames[task] || task, '', '', '', '', '', ''];
      rows.push(taskRow);
      currentRow++;
      
      // 为SDTM和ADaM添加数据传输行
      if (task === 'SDTM Datasets Production and Validation' && projectSelection.dataTransferTimes?.sdtm > 0) {
        const transferRow = [`SDTM Dataset Transfer (${projectSelection.dataTransferTimes.sdtm} times)`, '', '', '', '', '', ''];
        rows.push(transferRow);
        currentRow++;
      }
      
      if (task === 'ADaM Datasets Production and Validation' && projectSelection.dataTransferTimes?.adam > 0) {
        const transferRow = [`ADaM Dataset Transfer (${projectSelection.dataTransferTimes.adam} times)`, '', '', '', '', '', ''];
        rows.push(transferRow);
        currentRow++;
      }
      
      // 为重跑任务添加重跑行
      if (task === 'DSUR Rerun' && projectSelection.rerunTimes?.dsur > 0) {
        const rerunRow = [`DSUR rerun (${projectSelection.rerunTimes.dsur} times)`, '', '', '', '', '', ''];
        rows.push(rerunRow);
        currentRow++;
      }
      
      if (task === 'DSMB Rerun' && projectSelection.rerunTimes?.dsmb > 0) {
        const rerunRow = [`DSMB rerun (${projectSelection.rerunTimes.dsmb} times)`, '', '', '', '', '', ''];
        rows.push(rerunRow);
        currentRow++;
      }
      
      // 添加Subtotal行
      const subtotalRow = ['Subtotal', '', '', '', '', '', ''];
      rows.push(subtotalRow);
      currentRow++;
      
      // 添加空行分隔
      rows.push(['', '', '', '', '', '', '']);
      currentRow++;
    });
    
    // 如果没有选择任何任务，至少添加标题行
    if (projectSelection.selectedTasks.length === 0) {
      // 添加一个示例行来显示格式
      rows.push(['(Please select projects from the Project Selection section)', '', '', '', '', '', '']);
    }
    
    // 生成文件名
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-').split('.')[0];
    const baseFileName = originalName ? 
      originalName.replace(/\.[^/.]+$/, '') : 
      'CostAnalysis';
    const fileName = `CostAnalysis_${baseFileName}_${timestamp}.xlsx`;
    
    // 创建工作簿
    const wb = XLSX.utils.book_new();
    const ws = XLSX.utils.aoa_to_sheet(rows);
    
    // 设置列宽
    const colWidths = [
      { wch: 50 }, // Task
      { wch: 10 }, // Unit
      { wch: 15 }, // Cost Per Hour
      { wch: 20 }, // # of Hours Per Unit
      { wch: 15 }, // Cost Per Unit
      { wch: 15 }, // Estimated cost
      { wch: 30 }  // Notes
    ];
    ws['!cols'] = colWidths;
    
    // 设置样式（加粗标题行和任务行）
    if (!ws['!rows']) ws['!rows'] = [];
    ws['!rows'][0] = { hpx: 20 }; // 标题行高度
    
    // 添加工作表
    XLSX.utils.book_append_sheet(wb, ws, 'Cost Analysis');
    
    // 确保目标目录存在
    if (!fs.existsSync(targetDir)) {
      fs.mkdirSync(targetDir, { recursive: true });
    }
    
    // 写入文件
    const filePath = path.join(targetDir, fileName);
    XLSX.writeFile(wb, filePath);
    
    console.log(`✅ 成本分析Excel生成成功: ${filePath}`);
    
    return {
      fileName,
      filePath,
      size: fs.statSync(filePath).size,
      generatedAt: new Date()
    };
    
  } catch (error) {
    console.error('❌ 生成成本分析Excel失败:', error);
    throw error;
  }
}

module.exports = {
  extractTableDataWithMergedCells,
  generateExcelFile,
  generateAssessmentScheduleFileName,
  exportAssessmentScheduleToExcel,
  generateCostAnalysisExcel
}; 