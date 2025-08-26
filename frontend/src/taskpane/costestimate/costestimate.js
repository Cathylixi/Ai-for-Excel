/*
 * costestimate.js - Step 3-7 (Project Selection → SDTM Analysis → ADaM Analysis → Completion) 模块
 * 职责：核心业务逻辑和Excel操作
 */

// 全局变量 (从主文件引用)
// const API_BASE_URL - 在主文件中定义
// window.currentDocumentId - 全局状态
// let currentSDTMData - SDTM分析数据

// ===== Step 3: Project Selection 模块 =====

// 🔥 项目选择动态输入框逻辑
function initProjectSelectionLogic() {
  // 获取所有需要动态输入框的checkbox
  const checkboxesWithCounts = document.querySelectorAll('[data-requires-count]');
  
  checkboxesWithCounts.forEach(checkbox => {
    checkbox.addEventListener('change', function() {
      const countType = this.getAttribute('data-requires-count');
      const container = document.getElementById(`${countType}-container`);
      
      if (container) {
        if (this.checked) {
          // 显示输入框
          container.style.display = 'flex';
          // 聚焦到输入框
          const input = container.querySelector('.count-input');
          if (input) {
            setTimeout(() => input.focus(), 300);
          }
        } else {
          // 隐藏输入框并清空值
          container.style.display = 'none';
          const input = container.querySelector('.count-input');
          if (input) {
            input.value = '';
          }
        }
      }
    });
  });
}

// 🔥 收集项目选择详细信息 (简化格式: 项目名->次数)
function collectProjectSelectionDetails() {
  const projectSelectionDetails = {};
  
  // 收集所有勾选的项目和对应的次数
  const allCheckboxes = document.querySelectorAll('.ms-CheckBox-input');
  allCheckboxes.forEach((checkbox) => {
    if (checkbox.checked) {
      const projectName = checkbox.parentElement.querySelector('.ms-CheckBox-text').textContent.trim();
      
      // 根据项目类型获取对应的数量输入框
      let count = null;
      const requiresCount = checkbox.getAttribute('data-requires-count');
      
      if (requiresCount) {
        const countInput = document.getElementById(`${requiresCount}-count`);
        if (countInput && countInput.value) {
          count = parseInt(countInput.value);
        }
      }
      
      // 直接存储: "项目名": 次数 (没有次数则为null)
      projectSelectionDetails[projectName] = count;
    }
  });
  
  return {
    projectSelectionDetails
  };
}

// 🔥 保存项目选择详细信息到后端
async function saveProjectSelectionDetails() {
  try {
    const currentDocumentId = moduleConfig.getCurrentDocumentId();
    if (!currentDocumentId) {
      console.warn('没有当前文档ID，跳过保存项目选择详情');
      return;
    }
    
    const { projectSelectionDetails } = collectProjectSelectionDetails();
    

    
    // 检查是否有任何项目选择
    if (Object.keys(projectSelectionDetails).length === 0) {
      console.log('没有项目选择，跳过保存');
      return;
    }
    
    const response = await fetch(`${moduleConfig.API_BASE_URL}/api/documents/${currentDocumentId}/project-selection`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        projectSelectionDetails: {
          ...projectSelectionDetails,
          lastUpdated: new Date().toISOString()
        }
      })
    });
    
    if (!response.ok) {
      throw new Error(`保存项目选择失败: ${response.statusText}`);
    }
    
    const result = await response.json();
    console.log('✅ 项目选择详情已保存:', result);
    
  } catch (error) {
    console.error('❌ 保存项目选择详情时出错:', error);
    throw error;
  }
}

// ===== Excel表格操作模块 =====

// 🔥 自动创建标准成本分析表格标题
async function createStandardCostAnalysisHeaders() {
  try {
    await Excel.run(async (context) => {
      // 获取当前活动的工作表
      const worksheet = context.workbook.worksheets.getActiveWorksheet();
      
      // 定义标准的列标题
      const headers = [
        "Task",
        "Unit", 
        "Cost Per Hour",
        "# of Hours Per Unit",
        "Cost Per Unit",
        "Estimated cost",
        "Notes"
      ];
      
      // 获取第一行的范围（A1:G1）
      const headerRange = worksheet.getRange("A1:G1");
      
      // 设置标题值
      headerRange.values = [headers];
      
      // 设置格式：粗体
      headerRange.format.font.bold = true;
      
      // 可选：设置其他格式
      headerRange.format.font.size = 12;
      headerRange.format.fill.color = "#E7E7E7"; // 浅灰色背景
      headerRange.format.borders.getItem("EdgeTop").style = "Continuous";
      headerRange.format.borders.getItem("EdgeBottom").style = "Continuous";
      headerRange.format.borders.getItem("EdgeLeft").style = "Continuous";
      headerRange.format.borders.getItem("EdgeRight").style = "Continuous";
      headerRange.format.borders.getItem("InsideVertical").style = "Continuous";
      
      // 自动调整列宽
      headerRange.format.autofitColumns();

      await context.sync();
      
      console.log('✅ 标准成本分析表格标题已创建');
      // moduleConfig.showStatusMessage('Excel table headers created successfully!', 'success');
    });
  } catch (error) {
    console.error('❌ 创建Excel标题时出错:', error);
    moduleConfig.showStatusMessage('Failed to create Excel headers: ' + error.message, 'error');
  }
}

// 🔥 根据项目选择填写Excel任务列表（完整逻辑，基于backup_original）
async function populateExcelWithSelectedProjects(passedProjectDetails = null) {
  try {
    let savedProjectDetails = {};
    
    // 🔥 优先使用传入的数据（恢复模式）
    if (passedProjectDetails) {
      savedProjectDetails = passedProjectDetails;
      console.log('✅ 使用传入的项目选择数据');
    } else {
      // 🔥 没有传入数据时，从数据库获取
      const currentDocumentId = moduleConfig.getCurrentDocumentId();
      if (currentDocumentId) {
        try {
          const response = await fetch(`${moduleConfig.API_BASE_URL}/api/documents/${currentDocumentId}/content`);
          if (response.ok) {
            const docData = await response.json();
            if (docData.document && docData.document.CostEstimateDetails?.projectSelection?.selectionDetails) {
              savedProjectDetails = docData.document.CostEstimateDetails.projectSelection.selectionDetails;
            }
          }
        } catch (error) {
          console.warn('无法获取已保存的项目详情，使用当前选择:', error);
        }
      }
      
      // 🔥 最后才从UI获取（仅在非恢复模式下）
      if (Object.keys(savedProjectDetails).length === 0) {
        console.log('📋 从UI收集项目选择详情...');
        const { projectSelectionDetails } = collectProjectSelectionDetails();
        savedProjectDetails = projectSelectionDetails;
        
        // 如果UI也没有数据，直接返回
        if (Object.keys(savedProjectDetails).length === 0) {
          console.warn('⚠️ 无法获取项目选择数据，Excel表格将为空');
          moduleConfig.showStatusMessage('No project selection data available', 'warning');
          return;
        }
      }
    }

    console.log('🔍 [DEBUG] 项目选择详情:', savedProjectDetails);

    await Excel.run(async (context) => {
      const worksheet = context.workbook.worksheets.getActiveWorksheet();
      let currentRow = 2;

      // 处理用户选择的项目
      if (Object.keys(savedProjectDetails).length > 0) {
        for (const [projectName, count] of Object.entries(savedProjectDetails)) {
          if (projectName === 'lastUpdated') continue;

          const isSDTM = projectName.toLowerCase().includes("sdtm");
          const isADAM = projectName.toLowerCase().includes("adam");
          const isDSUR = projectName.toLowerCase().includes("dsur");
          const isDSMB = projectName.toLowerCase().includes("dsmb");
          const isStatisticalAnalysisPlan = projectName.toLowerCase().includes("statistical analysis plan");

          // 🔥 复杂项目：SDTM, ADaM, Statistical Analysis Plan
          if (isSDTM || isADAM || isStatisticalAnalysisPlan) {
            // 写入项目标题行
            const projectNameRange = worksheet.getRange(`A${currentRow}:G${currentRow}`);
            projectNameRange.values = [[projectName, "", "", "", "", "", ""]];
            projectNameRange.format.font.bold = true;
            projectNameRange.format.horizontalAlignment = "Left";
            currentRow++;
            const sectionTitleRow = currentRow - 1; // 记录标题行位置用于计算Subtotal

            // 🏗️ SDTM 项目展开
            if (isSDTM) {
              const sdtmSubItems = [
                { name: "SDTM Annotated CRFs (aCRF)", unit: "", costPerHour: 1.0, hoursPerUnit: 32, costPerUnit: 32.0 },
                { name: "SDTM Dataset Specs (High Complexity)", unit: "", costPerHour: 1.0, hoursPerUnit: 3, costPerUnit: 3.0 },
                { name: "SDTM Dataset Specs (Medium Complexity)", unit: "", costPerHour: 1.0, hoursPerUnit: 2, costPerUnit: 2.0 },
                { name: "SDTM Production and Validation: Programs and Datasets (High Complexity)", unit: "", costPerHour: 1.0, hoursPerUnit: 16, costPerUnit: 16.0 },
                { name: "SDTM Production and Validation: Programs and Datasets (Medium Complexity)", unit: "", costPerHour: 1.0, hoursPerUnit: 10, costPerUnit: 10.0 },
                { name: "SDTM Pinnacle 21 Report Creation and Review", unit: "", costPerHour: 1.0, hoursPerUnit: 6, costPerUnit: 6.0 },
                { name: "SDTM Reviewer's Guide", unit: "", costPerHour: 1.0, hoursPerUnit: 32, costPerUnit: 32.0 },
                { name: "SDTM Define.xml", unit: "", costPerHour: 1.0, hoursPerUnit: 32, costPerUnit: 32.0 },
                { name: "SDTM Dataset File xpt Conversion and Review", unit: "", costPerHour: 1.0, hoursPerUnit: 0.2, costPerUnit: 0.2 }
              ];

              for (const subItem of sdtmSubItems) {
                const subItemRange = worksheet.getRange(`A${currentRow}:G${currentRow}`);
                subItemRange.values = [[
                  subItem.name,
                  "", // Unit 留空，待SDTM分析后填入
                  `$${subItem.costPerHour}`,
                  subItem.hoursPerUnit,
                  "", // Cost Per Unit 用公式计算 = C*D
                  "", // Estimated Cost 用公式计算 = B*C*D
                  ""
                ]];
                
                // 为Cost Per Unit列(E)设置Excel公式：=C*D
                const costPerUnitCell = worksheet.getRange(`E${currentRow}`);
                costPerUnitCell.formulas = [[`=C${currentRow}*D${currentRow}`]];
                costPerUnitCell.format.numberFormat = [["$#,##0.00"]];
                
                // 为Estimated Cost列(F)设置Excel公式：=B*C*D
                const estimatedCostCell = worksheet.getRange(`F${currentRow}`);
                estimatedCostCell.formulas = [[`=B${currentRow}*C${currentRow}*D${currentRow}`]];
                estimatedCostCell.format.numberFormat = [["$#,##0.00"]];
                
                subItemRange.format.font.bold = false;
                subItemRange.format.horizontalAlignment = "Left";
                const numberColumns = worksheet.getRange(`B${currentRow}:F${currentRow}`);
                numberColumns.format.horizontalAlignment = "Right";
                currentRow++;
              }
            } 
            // 🏗️ ADaM 项目展开
            else if (isADAM) {
              const adamSubItems = [
                { name: "ADaM Dataset Specs (High Complexity)", unit: "", costPerHour: 1.0, hoursPerUnit: 3, costPerUnit: 3.0 },
                { name: "ADaM Dataset Specs (Medium Complexity)", unit: "", costPerHour: 1.0, hoursPerUnit: 2, costPerUnit: 2.0 },
                { name: "ADaM Production and Validation: Programs and Datasets (High Complexity)", unit: "", costPerHour: 1.0, hoursPerUnit: 18, costPerUnit: 18.0 },
                { name: "ADaM Production and Validation: Programs and Datasets (Medium Complexity)", unit: "", costPerHour: 1.0, hoursPerUnit: 10, costPerUnit: 10.0 },
                { name: "ADaM Pinnacle 21 Report Creation and Review", unit: "", costPerHour: 1.0, hoursPerUnit: 4, costPerUnit: 4.0 },
                { name: "ADaM Reviewer's Guide", unit: "", costPerHour: 1.0, hoursPerUnit: 32, costPerUnit: 32.0 },
                { name: "ADaM Define.xml", unit: "", costPerHour: 1.0, hoursPerUnit: 32, costPerUnit: 32.0 },
                { name: "ADaM Dataset Program xpt Conversion and Review", unit: "", costPerHour: 1.0, hoursPerUnit: 0.2, costPerUnit: 0.2 },
                { name: "ADaM Program txt Conversion and Review", unit: "", costPerHour: 1.0, hoursPerUnit: 0.2, costPerUnit: 0.2 }
              ];

              for (const subItem of adamSubItems) {
                const subItemRange = worksheet.getRange(`A${currentRow}:G${currentRow}`);
                subItemRange.values = [[
                  subItem.name,
                  "", // Unit 留空，待分析后填入
                  `$${subItem.costPerHour}`,
                  subItem.hoursPerUnit,
                  "", // Cost Per Unit 用公式计算 = C*D
                  "", // Estimated Cost 用公式计算 = B*C*D
                  ""
                ]];
                
                // 为Cost Per Unit列(E)设置Excel公式：=C*D
                const costPerUnitCell = worksheet.getRange(`E${currentRow}`);
                costPerUnitCell.formulas = [[`=C${currentRow}*D${currentRow}`]];
                costPerUnitCell.format.numberFormat = [["$#,##0.00"]];
                
                // 为Estimated Cost列(F)设置Excel公式：=B*C*D
                const estimatedCostCell = worksheet.getRange(`F${currentRow}`);
                estimatedCostCell.formulas = [[`=B${currentRow}*C${currentRow}*D${currentRow}`]];
                estimatedCostCell.format.numberFormat = [["$#,##0.00"]];
                
                subItemRange.format.font.bold = false;
                subItemRange.format.horizontalAlignment = "Left";
                const numberColumns = worksheet.getRange(`B${currentRow}:F${currentRow}`);
                numberColumns.format.horizontalAlignment = "Right";
                currentRow++;
              }
            } 
            // 🏗️ Statistical Analysis Plan 项目展开
            else if (isStatisticalAnalysisPlan) {
              const sapSubItems = [
                { name: "Statistical Analysis Plan Draft 1", unit: "", costPerHour: 1.0, hoursPerUnit: 40, costPerUnit: 40.0 },
                { name: "Statistical Analysis Plan Draft 2", unit: "", costPerHour: 1.0, hoursPerUnit: 30, costPerUnit: 30.0 },
                { name: "Statistical Analysis Plan Final", unit: "", costPerHour: 1.0, hoursPerUnit: 20, costPerUnit: 20.0 },
                { name: "Analysis Shells Development", unit: "", costPerHour: 1.0, hoursPerUnit: 60, costPerUnit: 60.0 },
                { name: "Mock Tables, Listings, and Figures", unit: "", costPerHour: 1.0, hoursPerUnit: 40, costPerUnit: 40.0 }
              ];
              for (const subItem of sapSubItems) {
                const subItemRange = worksheet.getRange(`A${currentRow}:G${currentRow}`);
                subItemRange.values = [[subItem.name, "", `$${subItem.costPerHour}`, subItem.hoursPerUnit, "", "", ""]];
                
                // 为Cost Per Unit列(E)设置Excel公式：=C*D
                const costPerUnitCell = worksheet.getRange(`E${currentRow}`);
                costPerUnitCell.formulas = [[`=C${currentRow}*D${currentRow}`]];
                costPerUnitCell.format.numberFormat = [["$#,##0.00"]];
                
                // 为Estimated Cost列(F)设置Excel公式：=B*C*D
                const estimatedCostCell = worksheet.getRange(`F${currentRow}`);
                estimatedCostCell.formulas = [[`=B${currentRow}*C${currentRow}*D${currentRow}`]];
                estimatedCostCell.format.numberFormat = [["$#,##0.00"]];
                
                subItemRange.format.font.bold = false;
                subItemRange.format.horizontalAlignment = "Left";
                const numberColumns = worksheet.getRange(`B${currentRow}:F${currentRow}`);
                numberColumns.format.horizontalAlignment = "Right";
                currentRow++;
              }
            }

            // 🧮 添加主Subtotal行
            const mainSubtotalRange = worksheet.getRange(`A${currentRow}:G${currentRow}`);
            mainSubtotalRange.values = [["Subtotal", "", "", "", "", "", ""]];
            
            // 计算Subtotal范围：从项目标题的下一行到当前行的前一行
            const subtotalRow = currentRow;
            const lastItemRow = subtotalRow - 1;
            const firstItemRow = sectionTitleRow + 1;
            
            // 为Subtotal的F列设置SUM公式
            const subtotalCell = worksheet.getRange(`F${currentRow}`);
            subtotalCell.formulas = [[`=SUM(F${firstItemRow}:F${lastItemRow})`]];
            subtotalCell.format.numberFormat = [["$#,##0.00"]];
            subtotalCell.format.font.bold = true;
            
            mainSubtotalRange.format.font.bold = true;
            mainSubtotalRange.format.horizontalAlignment = "Right";
            currentRow++;

            // 🚚 Transfer部分（仅SDTM和ADaM且count > 0）
            if (count && count > 0 && (isSDTM || isADAM)) {
              const transferSubsection = isSDTM ? `SDTM Dataset Transfer (${count} times)` : `ADAM Dataset Transfer (${count} times)`;
              const transferRange = worksheet.getRange(`A${currentRow}:G${currentRow}`);
              transferRange.values = [[transferSubsection, "", "", "", "", "", ""]];
              transferRange.format.font.bold = true;
              transferRange.format.horizontalAlignment = "Left";
              currentRow++;

              const transferSubItems = isSDTM ? [
                { name: `Production and Validation, the first 2 times`, unit: 2, costPerHour: 1.0, hoursPerUnit: 25, costPerUnit: 25.0 },
                { name: `Production and Validation, the last ${count - 2} times`, unit: count - 2, costPerHour: 1.0, hoursPerUnit: 12.5, costPerUnit: 12.5 }
              ] : [
                { name: `Production and Validation, the first 2 times`, unit: 2, costPerHour: 1.0, hoursPerUnit: 15, costPerUnit: 15.0 },
                { name: `Production and Validation, the last ${count - 2} times`, unit: count - 2, costPerHour: 1.0, hoursPerUnit: 7.5, costPerUnit: 7.5 }
              ];
              
              for (const transferSubItem of transferSubItems) {
                const transferSubItemRange = worksheet.getRange(`A${currentRow}:G${currentRow}`);
                transferSubItemRange.values = [[transferSubItem.name, transferSubItem.unit, `$${transferSubItem.costPerHour}`, transferSubItem.hoursPerUnit, "", "", ""]];
                
                // 为Cost Per Unit列(E)设置Excel公式：=C*D
                const transferCostPerUnitCell = worksheet.getRange(`E${currentRow}`);
                transferCostPerUnitCell.formulas = [[`=C${currentRow}*D${currentRow}`]];
                transferCostPerUnitCell.format.numberFormat = [["$#,##0.00"]];
                
                // 为Transfer项设置Estimated Cost公式：=B*C*D
                const transferEstCostCell = worksheet.getRange(`F${currentRow}`);
                transferEstCostCell.formulas = [[`=B${currentRow}*C${currentRow}*D${currentRow}`]];
                transferEstCostCell.format.numberFormat = [["$#,##0.00"]];
                
                transferSubItemRange.format.font.bold = false;
                transferSubItemRange.format.horizontalAlignment = "Left";
                const transferNumberColumns = worksheet.getRange(`B${currentRow}:F${currentRow}`);
                transferNumberColumns.format.horizontalAlignment = "Right";
                currentRow++;
              }
              
              // Transfer Subtotal
              const transferSubtotalRange = worksheet.getRange(`A${currentRow}:G${currentRow}`);
              transferSubtotalRange.values = [["Subtotal", "", "", "", "", "", ""]];
              transferSubtotalRange.format.font.bold = true;
              transferSubtotalRange.format.horizontalAlignment = "Right";
              currentRow++;
            }

          } 
          // 🏷️ 特殊处理：DSUR/DSMB Rerun
          else if (isDSUR || isDSMB) {
            if (count && count > 0) {
              const rerunSubsection = isDSUR ? `DSUR Rerun (${count} times)` : `DSMB Rerun (${count} times)`;
              const rerunRange = worksheet.getRange(`A${currentRow}:G${currentRow}`);
              rerunRange.values = [[rerunSubsection, "", "", "", "", "", ""]];
              rerunRange.format.font.bold = true;
              rerunRange.format.horizontalAlignment = "Left";
              currentRow++;
              const rerunSubtotalRange = worksheet.getRange(`A${currentRow}:G${currentRow}`);
              rerunSubtotalRange.values = [["Subtotal", "", "", "", "", "", ""]];
              rerunSubtotalRange.format.font.bold = true;
              rerunSubtotalRange.format.horizontalAlignment = "Right";
              currentRow++;
            }
          } 
          // 🏷️ 简单项目：其他所有项目（TFL, Interim Analysis等）
          else {
            const projectNameRange = worksheet.getRange(`A${currentRow}:G${currentRow}`);
            projectNameRange.values = [[projectName, "", "", "", "", "", ""]];
            projectNameRange.format.font.bold = true;
            projectNameRange.format.horizontalAlignment = "Left";
            currentRow++;
            const subtotalRange = worksheet.getRange(`A${currentRow}:G${currentRow}`);
            subtotalRange.values = [["Subtotal", "", "", "", "", "", ""]];
            subtotalRange.format.font.bold = true;
            subtotalRange.format.horizontalAlignment = "Right";
            currentRow++;
          }
        }
      }

      // 🏁 固定末尾三部分（始终显示）
      const defaultSections = [
        'License Fees',
        'Adhoc Analysis',
        'Project Management/Administration(12 Months)'
      ];
      for (const sectionName of defaultSections) {
        const range = worksheet.getRange(`A${currentRow}:G${currentRow}`);
        range.values = [[sectionName, "", "", "", "", "", ""]];
        range.format.font.bold = true;
        range.format.horizontalAlignment = 'Left';
        currentRow++;
        const subtotalRange = worksheet.getRange(`A${currentRow}:G${currentRow}`);
        subtotalRange.values = [["Subtotal", "", "", "", "", "", ""]];
        subtotalRange.format.font.bold = true;
        subtotalRange.format.horizontalAlignment = 'Right';
        currentRow++;
      }

      // 🎯 Grand Total
      const grandTotalRange = worksheet.getRange(`A${currentRow}:G${currentRow}`);
      grandTotalRange.values = [["Grand Total", "", "", "", "", "", ""]];
      grandTotalRange.format.font.bold = true;
      grandTotalRange.format.horizontalAlignment = 'Right';

      // 🧮 为Grand Total的F列添加动态SUM公式，计算所有Subtotal行的总和
      await addGrandTotalFormula(worksheet, currentRow);

      await context.sync();
      console.log('✅ Excel项目列表已填充完成（完整逻辑）');
      // moduleConfig.showStatusMessage('Excel table populated successfully!', 'success');
    });

  } catch (error) {
    console.error('❌ 填充Excel项目列表时出错:', error);
    moduleConfig.showStatusMessage('Failed to populate Excel: ' + error.message, 'error');
  }
}

// 🧮 为Grand Total行添加动态SUM公式，计算所有Subtotal行的总和
async function addGrandTotalFormula(worksheet, grandTotalRowIndex) {
  try {
    // 获取整个表格的数据来查找所有Subtotal行
    const usedRange = worksheet.getUsedRange();
    usedRange.load(['values', 'rowCount']);
    await worksheet.context.sync();
    
    const allRows = usedRange.values;
    const subtotalRows = []; // 存储所有Subtotal行的Excel行号（1-based）
    
    // 扫描所有行，查找"Subtotal"行
    for (let i = 0; i < allRows.length; i++) {
      const firstCell = String(allRows[i][0] || '').trim();
      if (firstCell.toLowerCase() === 'subtotal') {
        const excelRowNumber = i + 1; // Excel行号从1开始
        subtotalRows.push(excelRowNumber);
        // 获取上一行内容来识别这个Subtotal属于哪个项目
        const previousRowContent = i > 0 ? String(allRows[i-1][0] || '').trim() : '';
        console.log(`🔍 发现Subtotal行: Excel行号 ${excelRowNumber}, 属于项目: "${previousRowContent}"`);
      }
    }
    
    if (subtotalRows.length > 0) {
      // 构建SUM公式：SUM(F2,F5,F8,...)的形式，引用所有Subtotal行的F列
      const cellReferences = subtotalRows.map(rowNum => `F${rowNum}`).join(',');
      const sumFormula = `=SUM(${cellReferences})`;
      
      // 设置Grand Total行的F列公式  
      const grandTotalCell = worksheet.getRange(`F${grandTotalRowIndex}`); // grandTotalRowIndex已经是1-based的Excel行号
      grandTotalCell.formulas = [[sumFormula]];
      grandTotalCell.format.numberFormat = [["$#,##0.00"]];
      grandTotalCell.format.horizontalAlignment = 'Right';
      grandTotalCell.format.font.bold = true;
      
      console.log(`✅ 已设置Grand Total公式: ${sumFormula}`);
      console.log(`✅ 引用了 ${subtotalRows.length} 个Subtotal行: ${subtotalRows.join(', ')}`);
    } else {
      console.warn('⚠️ 没有找到任何Subtotal行，Grand Total公式未设置');
    }
    
  } catch (error) {
    console.error('❌ 设置Grand Total公式时出错:', error);
  }
}

// 🔄 更新Grand Total公式（用于SDTM/ADaM确认后的动态更新）
async function updateGrandTotalFormula(worksheet) {
  try {
    // 获取整个表格的数据
    const usedRange = worksheet.getUsedRange();
    usedRange.load(['values', 'rowCount']);
    await worksheet.context.sync();
    
    const allRows = usedRange.values;
    const subtotalRows = []; // 存储所有Subtotal行的Excel行号（1-based）
    let grandTotalRowIndex = -1; // Grand Total行的Excel行号（1-based）
    
    // 扫描所有行，查找"Subtotal"行和"Grand Total"行
    for (let i = 0; i < allRows.length; i++) {
      const firstCell = String(allRows[i][0] || '').trim().toLowerCase();
      
      if (firstCell === 'subtotal') {
        const excelRowNumber = i + 1; // Excel行号从1开始
        subtotalRows.push(excelRowNumber);
        // 获取上一行内容来识别这个Subtotal属于哪个项目
        const previousRowContent = i > 0 ? String(allRows[i-1][0] || '').trim() : '';
        console.log(`🔍 发现Subtotal行: Excel行号 ${excelRowNumber}, 属于项目: "${previousRowContent}"`);
      } else if (firstCell === 'grand total') {
        grandTotalRowIndex = i + 1; // Excel行号从1开始
        console.log(`🔍 发现Grand Total行: Excel行号 ${grandTotalRowIndex}`);
      }
    }
    
    if (grandTotalRowIndex > 0 && subtotalRows.length > 0) {
      // 构建SUM公式：SUM(F2,F5,F8,...)的形式，引用所有Subtotal行的F列
      const cellReferences = subtotalRows.map(rowNum => `F${rowNum}`).join(',');
      const sumFormula = `=SUM(${cellReferences})`;
      
      // 更新Grand Total行的F列公式
      const grandTotalCell = worksheet.getRange(`F${grandTotalRowIndex}`);
      grandTotalCell.formulas = [[sumFormula]];
      grandTotalCell.format.numberFormat = [["$#,##0.00"]];
      grandTotalCell.format.horizontalAlignment = 'Right';
      grandTotalCell.format.font.bold = true;
      
      console.log(`✅ 已更新Grand Total公式: ${sumFormula}`);
      console.log(`✅ 引用了 ${subtotalRows.length} 个Subtotal行: ${subtotalRows.join(', ')}`);
    } else if (grandTotalRowIndex <= 0) {
      console.warn('⚠️ 没有找到Grand Total行，无法更新公式');
    } else {
      console.warn('⚠️ 没有找到任何Subtotal行，Grand Total公式未更新');
    }
    
  } catch (error) {
    console.error('❌ 更新Grand Total公式时出错:', error);
  }
}

// ===== Step 5: SDTM Analysis Results 模块 =====

// SDTM分析结果显示函数
function displaySDTMAnalysis(sdtmAnalysis) {
  console.log('🔍 [DEBUG] 显示SDTM分析结果:', sdtmAnalysis);
  
  if (!sdtmAnalysis || !sdtmAnalysis.procedures) {
    console.warn('❌ No SDTM analysis data to display');
    return;
  }

  // 🔥 设置全局currentSDTMData供确认功能使用
  // 将Map格式的mappings转换为数组格式，便于编辑功能使用
  window.currentSDTMData = {
    ...sdtmAnalysis,
    mappings: sdtmAnalysis.mappings ? convertMapToMappingsList(sdtmAnalysis.mappings, sdtmAnalysis.procedures) : (sdtmAnalysis.procedures || []).map(proc => ({procedure: proc, sdtm_domains: []}))
  };

  // 更新统计信息
  const totalProcedures = sdtmAnalysis.procedures?.length || 0;
  const uniqueDomains = sdtmAnalysis.summary?.unique_domains || [];
  const totalDomains = uniqueDomains.length;

  console.log('🔍 [DEBUG] 统计信息:', { totalProcedures, totalDomains, uniqueDomains });

  // 安全更新DOM元素
  const proceduresEl = document.getElementById('total-procedures');
  const domainsEl = document.getElementById('total-domains');
  
  if (proceduresEl) {
    proceduresEl.textContent = totalProcedures;
    console.log('✅ 已更新procedures count:', totalProcedures);
  } else {
    console.error('❌ 找不到 total-procedures 元素');
  }
  
  if (domainsEl) {
    domainsEl.textContent = totalDomains;
    console.log('✅ 已更新domains count:', totalDomains);
  } else {
    console.error('❌ 找不到 total-domains 元素');
  }

  // 显示域概览 - 使用正确的CSS类名
  const domainsOverview = document.getElementById('domains-list-overview');
  if (domainsOverview) {
    domainsOverview.innerHTML = uniqueDomains.map(domain => 
      `<span class="domain-tag">${domain}</span>`
    ).join('');
    console.log('✅ 已更新域概览');
  } else {
    console.error('❌ 找不到 domains-list-overview 元素');
  }

  // 显示高复杂度和中等复杂度域
  const highComplexityDomains = document.getElementById('high-complexity-domains');
  const mediumComplexityDomains = document.getElementById('medium-complexity-domains');
  
  if (highComplexityDomains && sdtmAnalysis.summary?.highComplexitySdtm?.domains) {
    highComplexityDomains.innerHTML = sdtmAnalysis.summary.highComplexitySdtm.domains.map(domain => 
      `<span class="domain-tag">${domain}</span>`
    ).join('');
    console.log('✅ 已更新高复杂度域');
  }
  
  if (mediumComplexityDomains && sdtmAnalysis.summary?.mediumComplexitySdtm?.domains) {
    mediumComplexityDomains.innerHTML = sdtmAnalysis.summary.mediumComplexitySdtm.domains.map(domain => 
      `<span class="domain-tag">${domain}</span>`
    ).join('');
    console.log('✅ 已更新中等复杂度域');
  }

  // 显示程序到域的映射
  console.log('🔍 [DEBUG] 开始显示映射列表...');
  // 🔥 使用已经转换为数组格式的mappings
  displayFlatMappingsList(window.currentSDTMData.mappings);
  
  // 显示容器
  const mappingsContainer = document.getElementById('sdtm-mappings-container');
  if (mappingsContainer) {
    mappingsContainer.style.display = 'block';
    console.log('✅ 已显示映射容器');
    
    // 🔥 重新绑定按钮事件（因为容器刚刚变为可见）
    bindSDTMButtonEvents();
  } else {
    console.error('❌ 找不到 sdtm-mappings-container 元素');
  }
}

// 编辑模式状态
let isEditMode = false; // SDTM编辑模式
let isADaMEditMode = false; // ADaM编辑模式

// 🔥 新增：将Map格式的mappings转换为前端期望的数组格式
function convertMapToMappingsList(mappingsMap, procedures = []) {
  console.log('🔍 [DEBUG] 转换Map格式mappings:', mappingsMap);
  
  if (!mappingsMap) return [];
  
  const result = [];
  
  // 如果mappings是Map对象
  if (mappingsMap instanceof Map) {
    mappingsMap.forEach((domains, procedure) => {
      const domainArray = domains ? domains.split(',').map(d => d.trim()).filter(d => d) : [];
      result.push({
        procedure: procedure,
        sdtm_domains: domainArray
      });
    });
  } 
  // 如果mappings是普通对象
  else if (typeof mappingsMap === 'object') {
    Object.entries(mappingsMap).forEach(([procedure, domains]) => {
      let domainArray = [];
      if (typeof domains === 'string') {
        domainArray = domains.split(',').map(d => d.trim()).filter(d => d);
      } else if (Array.isArray(domains)) {
        domainArray = domains;
      }
      result.push({
        procedure: procedure,
        sdtm_domains: domainArray
      });
    });
  }
  
  // 如果没有mappings但有procedures，创建空映射
  if (result.length === 0 && procedures && procedures.length > 0) {
    procedures.forEach(procedure => {
      result.push({
        procedure: procedure,
        sdtm_domains: []
      });
    });
  }
  
  console.log('✅ 转换后的mappings列表:', result);
  return result;
}

// 切换编辑模式
function toggleEditMode() {
  console.log('🔍 [DEBUG] 切换编辑模式，当前状态:', isEditMode);
  
  const editBtn = document.getElementById('edit-mappings-btn');
  const confirmBtn = document.getElementById('confirm-mappings-btn');
  const mappingItems = document.querySelectorAll('.flat-mapping-item');
  
  if (!isEditMode) {
    // 进入编辑模式
    isEditMode = true;
    editBtn.textContent = 'Cancel Edit';
    editBtn.style.backgroundColor = '#dc3545';
    confirmBtn.style.display = 'none'; // 隐藏确认按钮
    
    // 为每个映射项添加编辑功能
    mappingItems.forEach((item, index) => {
      makeItemEditable(item, index);
    });
    
    console.log('✅ 进入编辑模式');
  } else {
    // 退出编辑模式
    isEditMode = false;
    editBtn.textContent = 'Edit';
    editBtn.style.backgroundColor = '#007bff';
    confirmBtn.style.display = 'inline-block'; // 显示确认按钮
    
    // 恢复映射项为只读状态
    mappingItems.forEach((item, index) => {
      makeItemReadOnly(item, index);
    });
    
    console.log('✅ 退出编辑模式');
  }
}

// 🔥 新增：ADaM编辑模式切换
function toggleADaMEditMode() {
  console.log('🔍 [DEBUG] 切换ADaM编辑模式，当前状态:', isADaMEditMode);
  
  const editBtn = document.getElementById('edit-adam-mappings-btn');
  const confirmBtn = document.getElementById('confirm-adam-mappings-btn');
  const mappingItems = document.querySelectorAll('.adam-mapping-item');
  
  if (!isADaMEditMode) {
    // 进入编辑模式
    isADaMEditMode = true;
    editBtn.textContent = 'Cancel Edit';
    editBtn.style.backgroundColor = '#dc3545';
    confirmBtn.style.display = 'none'; // 隐藏确认按钮
    
    // 为每个ADaM映射项添加编辑功能
    mappingItems.forEach((item, index) => {
      makeADaMItemEditable(item, index);
    });
    
    console.log('✅ 进入ADaM编辑模式');
  } else {
    // 退出编辑模式
    isADaMEditMode = false;
    editBtn.textContent = 'Edit';
    editBtn.style.backgroundColor = '#007bff';
    confirmBtn.style.display = 'inline-block'; // 显示确认按钮
    
    // 恢复ADaM映射项为只读状态
    mappingItems.forEach((item, index) => {
      makeADaMItemReadOnly(item, index);
    });
    
    console.log('✅ 退出ADaM编辑模式');
  }
}

// 让映射项变为可编辑（使用contentEditable进行直接文字编辑）
function makeItemEditable(item, index) {
  const domainSpans = item.querySelectorAll('.domain-tag');
  
  domainSpans.forEach((span, domainIndex) => {
    // 转换为可编辑标签
    span.className = 'editable-domain-tag';
    span.dataset.mappingIndex = index;
    span.dataset.domainIndex = domainIndex;
    
    // 添加删除按钮
    if (!span.querySelector('.remove-domain-btn')) {
      const removeBtn = document.createElement('span');
      removeBtn.className = 'remove-domain-btn';
      removeBtn.innerHTML = '×';
      removeBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        removeDomainTag(span);
      });
      span.appendChild(removeBtn);
    }
    
    // 添加点击编辑功能
    span.addEventListener('click', () => {
      makeTagEditable(span);
    });
    
    // 应用编辑模式样式
    span.style.cssText = `
      background: #e6f3ff;
      color: #0078d7;
      padding: 4px 8px;
      border-radius: 12px;
      font-size: 11px;
      font-weight: 500;
      border: 1px solid #b3d9ff;
      position: relative;
      display: inline-flex;
      align-items: center;
      gap: 4px;
      cursor: text;
      min-width: 30px;
      margin: 1px;
      transition: all 0.2s ease;
    `;
  });
}

// 让映射项变为只读
function makeItemReadOnly(item, index) {
  const editableSpans = item.querySelectorAll('.editable-domain-tag');
  
  editableSpans.forEach(span => {
    // 移除删除按钮
    const removeBtn = span.querySelector('.remove-domain-btn');
    if (removeBtn) {
      removeBtn.remove();
    }
    
    // 移除事件监听器
    span.replaceWith(span.cloneNode(true)); // 清除所有事件监听器
    
    // 恢复为普通domain-tag
    const newSpan = item.querySelector('.editable-domain-tag');
    if (newSpan) {
      newSpan.className = 'domain-tag';
      const currentText = newSpan.textContent.trim();
      
      // 恢复原有样式
      if (currentText && currentText !== 'No Mapping') {
        newSpan.style.cssText = `
          background: #e3f2fd;
          color: #1976d2;
          padding: 2px 6px;
          border-radius: 3px;
          font-size: 11px;
          margin: 1px;
          display: inline-block;
        `;
      } else {
        newSpan.style.cssText = `
          background: #f5f5f5;
          color: #666;
          padding: 2px 6px;
          border-radius: 3px;
          font-size: 11px;
          margin: 1px;
          display: inline-block;
          font-style: italic;
        `;
      }
    }
  });
}

// 使标签进入可编辑状态（直接文字编辑）
function makeTagEditable(tag) {
  if (tag.contentEditable === 'true') return; // 已经在编辑状态
  
  const originalText = tag.textContent.replace('×', '').trim();
  tag.innerHTML = originalText; // 移除删除按钮
  tag.contentEditable = 'true';
  tag.classList.add('editing');
  tag.focus();
  
  // 选中所有文本
  const range = document.createRange();
  range.selectNodeContents(tag);
  const selection = window.getSelection();
  selection.removeAllRanges();
  selection.addRange(range);
  
  // 编辑中的样式
  tag.style.cssText += `
    background-color: white !important;
    border-color: #0078d7 !important;
    box-shadow: 0 0 0 2px rgba(0, 120, 215, 0.3) !important;
    outline: none !important;
  `;
  
  // 处理编辑完成
  const finishEditing = () => {
    tag.contentEditable = 'false';
    tag.classList.remove('editing');
    
    const newText = tag.textContent.trim();
    const mappingIndex = parseInt(tag.dataset.mappingIndex);
    const domainIndex = parseInt(tag.dataset.domainIndex);
    
    console.log(`🔍 [DEBUG] 编辑完成: ${originalText} → ${newText}`);
    
    // 更新数据
    if (newText && window.currentSDTMData && window.currentSDTMData.mappings[mappingIndex]) {
      window.currentSDTMData.mappings[mappingIndex].sdtm_domains[domainIndex] = newText;
      console.log('✅ 已更新SDTM数据');
    }
    
    // 重新创建标签（包含删除按钮）
    const newTag = createEditableDomainTag(newText, mappingIndex, domainIndex);
    tag.parentNode.replaceChild(newTag, tag);
  };
  
  // 监听事件
  tag.addEventListener('blur', finishEditing);
  tag.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      finishEditing();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      tag.textContent = originalText;
      finishEditing();
    }
  });
}

// 创建可编辑的Domain标签
function createEditableDomainTag(domainText, mappingIndex, domainIndex) {
  const tag = document.createElement('span');
  tag.className = 'editable-domain-tag';
  tag.textContent = domainText;
  tag.dataset.mappingIndex = mappingIndex;
  tag.dataset.domainIndex = domainIndex;
  
  // 删除按钮
  const removeBtn = document.createElement('span');
  removeBtn.className = 'remove-domain-btn';
  removeBtn.innerHTML = '×';
  removeBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    removeDomainTag(tag);
  });
  tag.appendChild(removeBtn);
  
  // 点击编辑功能
  tag.addEventListener('click', () => {
    if (isEditMode) {
      makeTagEditable(tag);
    }
  });
  
  // 应用样式
  tag.style.cssText = `
    background: #e6f3ff;
    color: #0078d7;
    padding: 4px 8px;
    border-radius: 12px;
    font-size: 11px;
    font-weight: 500;
    border: 1px solid #b3d9ff;
    position: relative;
    display: inline-flex;
    align-items: center;
    gap: 4px;
    cursor: text;
    min-width: 30px;
    margin: 1px;
    transition: all 0.2s ease;
  `;
  
  return tag;
}

// 🔥 新增：让ADaM映射项变为可编辑
function makeADaMItemEditable(item, index) {
  const domainSpans = item.querySelectorAll('.domain-tag');
  
  domainSpans.forEach((span, domainIndex) => {
    // 转换为可编辑标签
    span.className = 'editable-domain-tag adam-editable';
    span.dataset.mappingIndex = index;
    span.dataset.domainIndex = domainIndex;
    
    // 添加删除按钮
    if (!span.querySelector('.remove-domain-btn')) {
      const removeBtn = document.createElement('span');
      removeBtn.className = 'remove-domain-btn';
      removeBtn.innerHTML = '×';
      removeBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        removeADaMDomainTag(span);
      });
      span.appendChild(removeBtn);
    }
    
    // 添加点击编辑功能
    span.addEventListener('click', () => {
      makeADaMTagEditable(span);
    });
    
    // 应用编辑模式样式（ADaM使用不同颜色）
    span.style.cssText = `
      background: #ffe6f3;
      color: #d70078;
      padding: 4px 8px;
      border-radius: 12px;
      font-size: 11px;
      font-weight: 500;
      border: 1px solid #ffb3d9;
      position: relative;
      display: inline-flex;
      align-items: center;
      gap: 4px;
      cursor: text;
      min-width: 30px;
      margin: 1px;
      transition: all 0.2s ease;
    `;
  });
}

// 🔥 新增：让ADaM映射项变为只读
function makeADaMItemReadOnly(item, index) {
  const domainSpans = item.querySelectorAll('.editable-domain-tag, .domain-tag');
  
  domainSpans.forEach(span => {
    // 移除编辑相关的类和属性
    span.className = 'domain-tag';
    span.removeAttribute('data-mapping-index');
    span.removeAttribute('data-domain-index');
    span.contentEditable = 'false';
    
    // 移除删除按钮
    const removeBtn = span.querySelector('.remove-domain-btn');
    if (removeBtn) {
      removeBtn.remove();
    }
    
    // 移除所有事件监听器（重新创建元素）
    const newSpan = span.cloneNode(true);
    span.parentNode.replaceChild(newSpan, span);
    
    // 恢复只读样式
    newSpan.style.cssText = `
      background: #f0f0f0;
      color: #333;
      padding: 4px 8px;
      border-radius: 12px;
      font-size: 11px;
      font-weight: 500;
      border: 1px solid #ccc;
      display: inline-flex;
      align-items: center;
      min-width: 30px;
      margin: 1px;
      cursor: default;
    `;
  });
}

// 🔥 新增：使ADaM标签进入可编辑状态
function makeADaMTagEditable(tag) {
  if (tag.contentEditable === 'true') return; // 已经在编辑状态
  
  const originalText = tag.textContent.replace('×', '').trim();
  tag.innerHTML = originalText; // 移除删除按钮
  tag.contentEditable = 'true';
  tag.classList.add('editing');
  tag.focus();
  
  // 选中所有文本
  const range = document.createRange();
  range.selectNodeContents(tag);
  const selection = window.getSelection();
  selection.removeAllRanges();
  selection.addRange(range);
  
  // 编辑中的样式（ADaM专用颜色）
  tag.style.cssText += `
    background-color: white !important;
    border-color: #d70078 !important;
    box-shadow: 0 0 0 2px rgba(215, 0, 120, 0.3) !important;
    outline: none !important;
  `;
  
  // 处理编辑完成
  const finishEditing = () => {
    tag.contentEditable = 'false';
    tag.classList.remove('editing');
    
    const newText = tag.textContent.trim();
    const mappingIndex = parseInt(tag.dataset.mappingIndex);
    const domainIndex = parseInt(tag.dataset.domainIndex);
    
    console.log(`🔍 [DEBUG] ADaM编辑完成: ${originalText} → ${newText}`);
    
    // 更新ADaM数据
    if (newText && window.currentADaMData && window.currentADaMData.mappings && window.currentADaMData.mappings[mappingIndex]) {
      if (Array.isArray(window.currentADaMData.mappings[mappingIndex].adam_domains)) {
        window.currentADaMData.mappings[mappingIndex].adam_domains[domainIndex] = newText;
      }
      console.log('✅ 已更新ADaM数据');
    }
    
    // 重新创建标签（包含删除按钮）
    const newTag = createEditableADaMDomainTag(newText, mappingIndex, domainIndex);
    tag.parentNode.replaceChild(newTag, tag);
  };
  
  // 监听事件
  tag.addEventListener('blur', finishEditing);
  tag.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      finishEditing();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      tag.textContent = originalText;
      finishEditing();
    }
  });
}

// 🔥 新增：创建可编辑的ADaM Domain标签
function createEditableADaMDomainTag(domainText, mappingIndex, domainIndex) {
  const tag = document.createElement('span');
  tag.className = 'editable-domain-tag adam-editable';
  tag.textContent = domainText;
  tag.dataset.mappingIndex = mappingIndex;
  tag.dataset.domainIndex = domainIndex;
  
  // 删除按钮
  const removeBtn = document.createElement('span');
  removeBtn.className = 'remove-domain-btn';
  removeBtn.innerHTML = '×';
  removeBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    removeADaMDomainTag(tag);
  });
  tag.appendChild(removeBtn);
  
  // 点击编辑功能
  tag.addEventListener('click', () => {
    if (isADaMEditMode) {
      makeADaMTagEditable(tag);
    }
  });
  
  // 应用样式（ADaM专用颜色）
  tag.style.cssText = `
    background: #ffe6f3;
    color: #d70078;
    padding: 4px 8px;
    border-radius: 12px;
    font-size: 11px;
    font-weight: 500;
    border: 1px solid #ffb3d9;
    position: relative;
    display: inline-flex;
    align-items: center;
    gap: 4px;
    cursor: text;
    min-width: 30px;
    margin: 1px;
    transition: all 0.2s ease;
  `;
  
  return tag;
}

// 🔥 新增：移除ADaM Domain标签
function removeADaMDomainTag(tag) {
  const mappingIndex = parseInt(tag.dataset.mappingIndex);
  const domainIndex = parseInt(tag.dataset.domainIndex);
  
  // 从数据中移除
  if (window.currentADaMData && window.currentADaMData.mappings && window.currentADaMData.mappings[mappingIndex]) {
    if (Array.isArray(window.currentADaMData.mappings[mappingIndex].adam_domains)) {
      window.currentADaMData.mappings[mappingIndex].adam_domains.splice(domainIndex, 1);
    }
    console.log('✅ 已从ADaM数据中移除域:', tag.textContent.replace('×', '').trim());
  }
  
  // 从DOM中移除
  tag.remove();
  
  // 重新更新剩余标签的索引
  const container = tag.parentNode;
  if (container) {
    const siblings = container.querySelectorAll('.editable-domain-tag, .domain-tag');
    siblings.forEach((sibling, newIndex) => {
      sibling.dataset.domainIndex = newIndex;
    });
  }
}

// 删除域标签
function removeDomainTag(tag) {
  const mappingIndex = parseInt(tag.dataset.mappingIndex);
  const domainIndex = parseInt(tag.dataset.domainIndex);
  
  console.log(`🔍 [DEBUG] 删除域标签: mapping=${mappingIndex}, domain=${domainIndex}`);
  
  // 从数据中删除
  if (window.currentSDTMData && window.currentSDTMData.mappings[mappingIndex]) {
    window.currentSDTMData.mappings[mappingIndex].sdtm_domains.splice(domainIndex, 1);
    console.log('✅ 已从SDTM数据中删除');
  }
  
  // 从DOM中删除
  tag.remove();
  
  // 重新显示整个映射列表以更新索引
  if (window.currentSDTMData) {
    displayFlatMappingsList(window.currentSDTMData.mappings);
  }
}

// Edit按钮处理函数 - 使用箭头函数避免this绑定问题
const handleEditMappings = () => {
  console.log('🔍 [DEBUG] Edit按钮被点击');
  toggleEditMode();
};

// 🔥 绑定ADaM按钮事件的独立函数
function bindADaMButtonEvents() {
  console.log('🔍 [DEBUG] 开始绑定ADaM按钮事件...');
  
  const editBtn = document.getElementById('edit-adam-mappings-btn');
  const confirmBtn = document.getElementById('confirm-adam-mappings-btn');
  
  if (editBtn) {
    // 🔥 修复：启用ADaM编辑功能，与SDTM保持一致
    editBtn.onclick = () => {
      console.log('🔍 [DEBUG] ADaM Edit按钮被点击');
      try {
        toggleADaMEditMode(); // 调用ADaM编辑模式切换
      } catch (error) {
        console.error('❌ ADaM Edit按钮处理出错:', error);
        moduleConfig.showStatusMessage('ADaM edit button error: ' + error.message, 'error');
      }
    };
    // 🔥 启用编辑功能
    editBtn.disabled = false;
    editBtn.style.opacity = '1';
    console.log('✅ ADaM Edit按钮事件已绑定（已启用）');
  } else {
    console.error('❌ 找不到 edit-adam-mappings-btn 元素');
  }
  
  if (confirmBtn) {
    // 🔥 修复：使用全局模块调用，与SDTM保持一致
    confirmBtn.onclick = () => {
      console.log('🔍 [DEBUG] ADaM Confirm & Save按钮被点击');
      try {
        // 直接调用全局可访问的函数
        window.CostEstimateModule.confirmADaMAnalysis();
      } catch (error) {
        console.error('❌ ADaM确认按钮处理出错:', error);
        moduleConfig.showStatusMessage('ADaM confirm button error: ' + error.message, 'error');
      }
    };
    console.log('✅ ADaM Confirm按钮事件已绑定');
  } else {
    console.error('❌ 找不到 confirm-adam-mappings-btn 元素');
  }
}

// 🔥 绑定SDTM按钮事件的独立函数
function bindSDTMButtonEvents() {
  console.log('🔍 [DEBUG] 开始绑定SDTM按钮事件...');
  
  const editBtn = document.getElementById('edit-mappings-btn');
  const confirmBtn = document.getElementById('confirm-mappings-btn');
  
  if (editBtn) {
    // 🔥 使用最简单直接的事件绑定方式
    editBtn.onclick = () => {
      console.log('🔍 [DEBUG] Edit按钮被点击 (内联处理)');
      try {
        toggleEditMode();
      } catch (error) {
        console.error('❌ Edit按钮处理出错:', error);
        moduleConfig.showStatusMessage('Edit button error: ' + error.message, 'error');
      }
    };
    console.log('✅ Edit按钮事件已绑定');
  } else {
    console.error('❌ 找不到 edit-mappings-btn 元素');
  }
  
  if (confirmBtn) {
    // 🔥 使用最简单直接的事件绑定方式
    confirmBtn.onclick = () => {
      console.log('🔍 [DEBUG] Confirm & Save按钮被点击 (内联处理)');
      try {
        // 直接调用全局可访问的函数
        window.CostEstimateModule.confirmSDTMAnalysis();
      } catch (error) {
        console.error('❌ Confirm按钮处理出错:', error);
        moduleConfig.showStatusMessage('Confirm button error: ' + error.message, 'error');
      }
    };
    console.log('✅ Confirm & Save按钮事件已绑定');
  } else {
    console.error('❌ 找不到 confirm-mappings-btn 元素');
  }
}

// 显示扁平化的映射列表
function displayFlatMappingsList(mappingsData) {
  console.log('🔍 [DEBUG] displayFlatMappingsList 调用，mappingsData:', mappingsData);
  
  const container = document.getElementById('flat-mappings-list');
  if (!container) {
    console.error('❌ 找不到 flat-mappings-list 元素');
    return;
  }

  container.innerHTML = '';
  console.log('✅ 已清空映射列表容器');

  if (!mappingsData || mappingsData.length === 0) {
    console.warn('⚠️ 没有mappings数据可显示');
    container.innerHTML = '<p>No procedure mappings available.</p>';
    return;
  }

  // 🔥 智能处理不同的数据格式
  let processedMappings = [];
  
  if (typeof mappingsData[0] === 'string') {
    // 如果是字符串数组 (procedures数组)，转换为映射格式
    console.log('🔍 [DEBUG] 检测到字符串数组，转换为映射格式');
    processedMappings = mappingsData.map(procName => ({
      procedure: procName,
      sdtm_domains: [] // 没有域信息
    }));
  } else if (typeof mappingsData[0] === 'object' && mappingsData[0].procedure) {
    // 如果是对象数组 (mappings数组)，直接使用
    console.log('🔍 [DEBUG] 检测到对象数组，直接使用');
    processedMappings = mappingsData;
  } else {
    console.error('❌ 无法识别的数据格式:', mappingsData[0]);
    container.innerHTML = '<p>Invalid mapping data format.</p>';
    return;
  }

  processedMappings.forEach((mapping, index) => {
    console.log(`🔍 [DEBUG] 处理第${index + 1}个mapping:`, mapping);
    
    const mappingDiv = document.createElement('div');
    mappingDiv.className = 'flat-mapping-item';
    
    const procedureName = mapping.procedure || 'Unknown Procedure';
    const domains = mapping.sdtm_domains || [];
    
    mappingDiv.innerHTML = `
      <div class="flat-procedure-name"><strong>${procedureName}:</strong></div>
      <div class="flat-domain-tags">
        ${domains.map(domain => 
          `<span class="domain-tag">${domain}</span>`
        ).join('')}
      </div>
    `;
    container.appendChild(mappingDiv);
  });
  
  console.log(`✅ 已显示 ${processedMappings.length} 个映射项`);
}

// 收集当前显示的映射数据
function collectCurrentMappings() {
  console.log('🔍 [DEBUG] 收集当前映射数据...');
  
  const mappingItems = document.querySelectorAll('.flat-mapping-item');
  const updatedMappings = [];
  
  mappingItems.forEach((item, index) => {
    const procedureElement = item.querySelector('strong');
    const domainElements = item.querySelectorAll('.domain-tag, .editable-domain-tag, .domain-edit-select');
    
    if (procedureElement) {
      const procedure = procedureElement.textContent.trim().replace(':', '');
      const domains = [];
      
      domainElements.forEach(element => {
        let domainValue;
        if (element.tagName === 'SELECT') {
          domainValue = element.value;
        } else {
          // 处理普通标签和可编辑标签
          domainValue = element.textContent.trim();
          // 移除删除按钮的×符号
          domainValue = domainValue.replace('×', '').trim();
        }
        
        if (domainValue && domainValue !== 'No Mapping') {
          domains.push(domainValue);
        }
      });
      
      updatedMappings.push({
        procedure: procedure,
        sdtm_domains: domains
      });
      
      console.log(`📋 映射 ${index + 1}: ${procedure} → [${domains.join(', ')}]`);
    }
  });
  
  console.log('✅ 收集到的映射数据总数:', updatedMappings.length);
  return updatedMappings;
}

// 🔥 新增：收集当前ADaM映射数据（用户编辑后的）
function collectCurrentADaMMappings() {
  console.log('🔍 [DEBUG] 收集当前ADaM映射数据...');
  
  const mappingItems = document.querySelectorAll('.adam-mapping-item');
  const updatedMappings = [];
  
  mappingItems.forEach((item, index) => {
    const sdtmElement = item.querySelector('.adam-sdtm-name strong');
    const adamElements = item.querySelectorAll('.domain-tag, .editable-domain-tag, .domain-edit-select');
    
    if (sdtmElement) {
      const sdtmDomain = sdtmElement.textContent.replace('SDTM: ', '').trim();
      const adamDomains = [];
      
      adamElements.forEach(element => {
        let adamValue;
        if (element.tagName === 'SELECT') {
          adamValue = element.value;
        } else {
          // 处理普通标签和可编辑标签
          adamValue = element.textContent.trim();
          // 移除删除按钮的×符号
          adamValue = adamValue.replace('×', '').trim();
        }
        
        if (adamValue && adamValue !== 'No Mapping') {
          adamDomains.push(adamValue);
        }
      });
      
      updatedMappings.push({
        sdtm_domains: sdtmDomain,      // ADaM映射的源是SDTM域
        adam_domains: adamDomains      // ADaM映射的目标是ADaM域数组
      });
      
      console.log(`📋 ADaM映射 ${index + 1}: ${sdtmDomain} → [${adamDomains.join(', ')}]`);
    }
  });
  
  console.log('✅ 收集到的ADaM映射数据总数:', updatedMappings.length);
  return updatedMappings;
}

// 确认SDTM分析结果
async function confirmSDTMAnalysis() {
  console.log('🔍 [DEBUG] Confirm & Save按钮被点击');
  
  // 如果正在编辑模式，先退出编辑模式以保存更改
  if (isEditMode) {
    console.log('🔄 退出编辑模式并保存更改...');
    toggleEditMode(); // 这会将选择框转换回span并保存数据
  }
  
  // 收集当前显示的映射数据（包括用户编辑的）
  const updatedMappings = collectCurrentMappings();
  console.log('🔍 [DEBUG] 收集到的更新映射:', updatedMappings);
  
  const currentDocumentId = moduleConfig.getCurrentDocumentId();
  console.log('🔍 [DEBUG] 当前文档ID:', currentDocumentId);
  
  if (!currentDocumentId) {
    console.error('❌ 没有文档ID');
    moduleConfig.showStatusMessage('No document ID found. Please re-upload the document.', 'error');
    return;
  }

  // 检查是否有基础的SDTM数据（允许空的映射数组）
  if (!window.currentSDTMData) {
    console.error('❌ 没有基础SDTM数据');
    moduleConfig.showStatusMessage('No SDTM analysis data available to confirm.', 'error');
    return;
  }

  try {
    console.log('🔍 [DEBUG] 开始发送确认请求...');
    
    // 🔥 修正：按照backup_original的正确格式发送数据
    const response = await fetch(`${moduleConfig.API_BASE_URL}/api/documents/${currentDocumentId}/confirm-sdtm`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        procedures: window.currentSDTMData.procedures || [],
        mappings: updatedMappings, // 使用用户编辑后的映射数据
        summary: window.currentSDTMData.summary || {}
      })
    });

    console.log('🔍 [DEBUG] API响应状态:', response.status);

    if (!response.ok) {
      const errorText = await response.text();
      console.error('❌ API响应错误:', errorText);
      throw new Error(`确认SDTM失败: ${response.statusText}`);
    }

    const result = await response.json();
    console.log('✅ SDTM分析已确认:', result);
    
    // 更新全局SDTM数据（包含用户编辑后的映射）
    window.currentSDTMData = {
      ...window.currentSDTMData,
      mappings: updatedMappings
    };
    
    // 显示确认状态
    const confirmationStatus = document.getElementById('confirmation-status');
    if (confirmationStatus) {
      confirmationStatus.style.display = 'flex';
    }

    // 禁用编辑按钮
    const editBtn = document.getElementById('edit-mappings-btn');
    const confirmBtn = document.getElementById('confirm-mappings-btn');
    if (editBtn) editBtn.disabled = true;
    if (confirmBtn) confirmBtn.disabled = true;

    // moduleConfig.showStatusMessage('SDTM analysis confirmed and saved successfully!', 'success');
    
    // ⬇️ 根据返回的成本估算快照，填入Excel中的 Unit、Estimated cost 和 Notes
    const costEstimate = result?.data?.costEstimate;
    if (costEstimate && costEstimate['SDTM Datasets Production and Validation']) {
      console.log('🔧 应用Unit、Cost和Notes到Excel...');
      await applySDTMUnitsAndCostsToExcel(costEstimate['SDTM Datasets Production and Validation']);
      console.log('✅ Unit、Cost和Notes已同步填入Excel');
    } else {
      console.warn('⚠️ 没有收到costEstimate数据，尝试从文档获取...');
      // 兜底：从文档重新获取
      try {
        const docResp = await fetch(`${moduleConfig.API_BASE_URL}/api/documents/${currentDocumentId}/content`);
        if (docResp.ok) {
          const docData = await docResp.json();
          const snapshot = docData?.document?.CostEstimateDetails?.sdtmTableInput?.['SDTM Datasets Production and Validation'];
          if (snapshot) {
            console.log('🔧 使用文档中的快照数据...');
            await applySDTMUnitsAndCostsToExcel(snapshot);
          }
        }
      } catch (e) {
        console.warn('无法从文档获取数据:', e);
      }
    }

    // 🔥 修改：不自动跳转，让用户通过底部蓝色Next按钮手动跳转
            console.log('✅ SDTM分析已确认，用户可以点击Next按钮继续到Step 6 (ADaM分析)');

  } catch (error) {
    console.error('❌ 确认SDTM分析时出错:', error);
    moduleConfig.showStatusMessage('Failed to confirm SDTM analysis: ' + error.message, 'error');
  }
}

// 🔥 确认ADaM分析结果
async function confirmADaMAnalysis() {
  console.log('🔍 [DEBUG] ADaM Confirm & Save按钮被点击');
  
  // 🔥 如果正在ADaM编辑模式，先退出编辑模式以保存更改
  if (isADaMEditMode) {
    console.log('🔄 退出ADaM编辑模式并保存更改...');
    toggleADaMEditMode(); // 这会将编辑的数据保存并退出编辑模式
  }
  
  // 收集当前显示的ADaM映射数据（包括用户编辑的）
  const updatedMappings = collectCurrentADaMMappings();
  console.log('🔍 [DEBUG] 收集到的更新ADaM映射:', updatedMappings);
  
  const currentDocumentId = moduleConfig.getCurrentDocumentId();
  console.log('🔍 [DEBUG] 当前文档ID:', currentDocumentId);
  
  if (!currentDocumentId) {
    console.error('❌ 没有文档ID');
    moduleConfig.showStatusMessage('No document ID found. Please re-upload the document.', 'error');
    return;
  }

  // 检查是否有基础的ADaM数据（允许空的映射数组）
  if (!window.currentADaMData) {
    console.error('❌ 没有基础ADaM数据');
    moduleConfig.showStatusMessage('No ADaM analysis data available to confirm.', 'error');
    return;
  }

  try {
    console.log('🔍 [DEBUG] 开始发送ADaM确认请求...');
    
    // 🔥 发送到后端API保存用户确认的ADaM数据
    const response = await fetch(`${moduleConfig.API_BASE_URL}/api/documents/${currentDocumentId}/confirm-adam`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        mappings: updatedMappings, // 使用用户编辑后的映射数据
        summary: window.currentADaMData.summary || {}
      })
    });

    console.log('🔍 [DEBUG] API响应状态:', response.status);

    if (!response.ok) {
      const errorText = await response.text();
      console.error('❌ API响应错误:', errorText);
      throw new Error(`确认ADaM失败: ${response.statusText}`);
    }

    const result = await response.json();
    console.log('✅ ADaM分析已确认:', result);
    
    // 更新全局ADaM数据（包含用户编辑后的映射）
    window.currentADaMData = {
      ...window.currentADaMData,
      mappings: updatedMappings
    };
    
    // 显示确认状态
    const confirmationStatus = document.getElementById('adam-confirmation-status');
    if (confirmationStatus) {
      confirmationStatus.style.display = 'flex';
    }

    // 禁用编辑按钮
    const editBtn = document.getElementById('edit-adam-mappings-btn');
    const confirmBtn = document.getElementById('confirm-adam-mappings-btn');
    if (editBtn) editBtn.disabled = true;
    if (confirmBtn) confirmBtn.disabled = true;

    // moduleConfig.showStatusMessage('ADaM analysis confirmed and saved successfully!', 'success');
    
    // ⬇️ 根据返回的成本估算快照，填入Excel中的 Unit、Estimated cost 和 Notes
    const costEstimate = result?.data?.costEstimate;
    if (costEstimate && costEstimate['ADaM Datasets Production and Validation']) {
      console.log('🔧 应用ADaM Unit、Cost和Notes到Excel...');
      await applyADaMUnitsAndCostsToExcel(costEstimate['ADaM Datasets Production and Validation']);
      console.log('✅ ADaM Unit、Cost和Notes已同步填入Excel');
    } else {
      console.warn('⚠️ 没有收到ADaM costEstimate数据，尝试从文档获取...');
      // 兜底：从文档重新获取
      try {
        const docResp = await fetch(`${moduleConfig.API_BASE_URL}/api/documents/${currentDocumentId}/content`);
        if (docResp.ok) {
          const docData = await docResp.json();
          const snapshot = docData?.document?.CostEstimateDetails?.adamTableInput?.['ADaM Datasets Production and Validation'];
          if (snapshot) {
            console.log('🔧 使用文档中的ADaM快照数据...');
            await applyADaMUnitsAndCostsToExcel(snapshot);
          }
        }
      } catch (e) {
        console.warn('无法从文档获取ADaM数据:', e);
      }
    }

    // 🔥 修改：不自动跳转，让用户通过底部蓝色Next按钮手动跳转
    console.log('✅ ADaM分析已确认，用户可以点击Next按钮继续到Step 7 (完成)');

  } catch (error) {
    console.error('❌ 确认ADaM分析时出错:', error);
    moduleConfig.showStatusMessage('Failed to confirm ADaM analysis: ' + error.message, 'error');
  }
}

// 将SDTM的units和estimatedCosts写入Excel相应行
async function applySDTMUnitsAndCostsToExcel(snapshot) {
  const taskToKey = {
    'SDTM Annotated CRFs (aCRF)': 'annotatedCrf',
    'SDTM Dataset Specs (High Complexity)': 'specsHigh',
    'SDTM Dataset Specs (Medium Complexity)': 'specsMedium',
    'SDTM Production and Validation: Programs and Datasets (High Complexity)': 'prodHigh',
    'SDTM Production and Validation: Programs and Datasets (Medium Complexity)': 'prodMedium',
    'SDTM Pinnacle 21 Report Creation and Review': 'pinnacle21',
    "SDTM Reviewer's Guide": 'reviewersGuide',
    'SDTM Define.xml': 'defineXml',
    'SDTM Dataset File xpt Conversion and Review': 'xptConversion'
  };

  try {
    await Excel.run(async (context) => {
      const sheet = context.workbook.worksheets.getActiveWorksheet();
      const used = sheet.getUsedRange();
      used.load(['values', 'rowIndex', 'columnIndex']);
      await context.sync();

      const startRow = used.rowIndex || 0;
      const startCol = used.columnIndex || 0;
      const rows = used.values;
      const units = snapshot.units || {};
      const costs = snapshot.estimatedCosts || {};
      const notes = snapshot.notes || {};
      const subtotal = snapshot.subtotal ?? null;

      console.log('🔍 [DEBUG] SDTM快照数据:', { units, costs, notes, subtotal });

      // 写每个子项的 Unit 并设置 Estimated Cost 公式
      for (let r = 0; r < rows.length; r++) {
        const task = String(rows[r][0] || '').trim();
        if (!taskToKey.hasOwnProperty(task)) continue;
        const key = taskToKey[task];
        const unitVal = units[key] ?? '';

        const unitCell = sheet.getRangeByIndexes(startRow + r, startCol + 1, 1, 1); // B列
        const estCostCell = sheet.getRangeByIndexes(startRow + r, startCol + 5, 1, 1); // F列
        
        // 写入Unit值
        unitCell.values = [[unitVal === '' ? '' : Number(unitVal)]];
        unitCell.format.horizontalAlignment = 'Right';
        
        // 设置Estimated Cost公式 = B列 × C列 × D列
        if (unitVal !== '') {
          const rowNum = startRow + r + 1; // Excel行号从1开始
          estCostCell.formulas = [[`=B${rowNum}*C${rowNum}*D${rowNum}`]];
          estCostCell.format.numberFormat = [["$#,##0.00"]];
          estCostCell.format.horizontalAlignment = 'Right';
          console.log(`✅ 已设置 ${task}: Unit=${unitVal}, 公式=B${rowNum}*C${rowNum}*D${rowNum}`);
        } else {
          estCostCell.values = [['']];
        }
        
        // 🔥 设置Notes（G列）
        const noteKey = taskToKey[task];
        if (notes[noteKey]) {
          const noteCell = sheet.getRangeByIndexes(startRow + r, startCol + 6, 1, 1); // G列
          noteCell.values = [[notes[noteKey]]];
          noteCell.format.horizontalAlignment = 'Left';
          console.log(`✅ 已设置 ${task} 的 Notes: ${notes[noteKey]}`);
        }
      }

      // 定位SDTM主块后的Subtotal行，并设置SUM公式
      // 找到SDTM主标题行
      let sdtmStartRow = -1;
      for (let r = 0; r < rows.length; r++) {
        const task = String(rows[r][0] || '').trim();
        if (task.toLowerCase() === 'sdtm datasets production and validation') {
          sdtmStartRow = r;
          break;
        }
      }
      if (sdtmStartRow >= 0) {
        // 向下寻找第一个值为 'Subtotal' 的行
        for (let r = sdtmStartRow + 1; r < rows.length; r++) {
          const firstCell = String(rows[r][0] || '').trim();
          if (firstCell.toLowerCase() === 'subtotal') {
            const subtotalCell = sheet.getRangeByIndexes(startRow + r, startCol + 5, 1, 1); // F列
            
            // 设置SUM公式来自动计算SDTM部分的小计
            const subtotalRowNum = startRow + r + 1; // Excel行号（1-based）
            const sdtmSectionStartRow = startRow + sdtmStartRow + 2; // Excel行号：标题下一行
            const sdtmSectionEndRow = subtotalRowNum - 1; // Excel行号：Subtotal前一行
            
            // 从标题下一行到Subtotal前一行（避免包含Subtotal本身）
            subtotalCell.formulas = [[`=SUM(F${sdtmSectionStartRow}:F${sdtmSectionEndRow})`]];
            subtotalCell.format.numberFormat = [["$#,##0.00"]];
            subtotalCell.format.horizontalAlignment = 'Right';
            subtotalCell.format.font.bold = true;
            console.log(`✅ 已设置Subtotal公式: =SUM(F${sdtmSectionStartRow}:F${sdtmSectionEndRow})`);
            break;
          }
        }
      }

      // 🧮 更新Grand Total公式（SDTM确认后）
      await updateGrandTotalFormula(sheet);
      
      await context.sync();
      // moduleConfig.showStatusMessage('Units, estimated costs and subtotal applied from confirmed SDTM data.', 'success');
    });
  } catch (err) {
    console.error('Failed to write SDTM units and costs:', err);
    moduleConfig.showStatusMessage('Failed to write units/costs/subtotal to Excel: ' + err.message, 'error');
  }
}

// 🔥 新增：将ADaM的units和estimatedCosts写入Excel相应行
async function applyADaMUnitsAndCostsToExcel(snapshot) {
  const taskToKey = {
    'ADaM Dataset Specs (High Complexity)': 'adamSpecsHigh',
    'ADaM Dataset Specs (Medium Complexity)': 'adamSpecsMedium',
    'ADaM Production and Validation: Programs and Datasets (High Complexity)': 'adamProdHigh',
    'ADaM Production and Validation: Programs and Datasets (Medium Complexity)': 'adamProdMedium',
    'ADaM Pinnacle 21 Report Creation and Review': 'adamPinnacle21',
    "ADaM Reviewer's Guide": 'adamReviewersGuide',
    'ADaM Define.xml': 'adamDefineXml',
    'ADaM Dataset Program xpt Conversion and Review': 'adamXptConversion', // 🔥 修复：Excel中是"Program"不是"File"
    'ADaM Program txt Conversion and Review': 'adamTxtConversion' // 🔥 新增：Excel中的txt转换任务
  };

  try {
    await Excel.run(async (context) => {
      const sheet = context.workbook.worksheets.getActiveWorksheet();
      const used = sheet.getUsedRange();
      used.load(['values', 'rowIndex', 'columnIndex']);
      await context.sync();

      const startRow = used.rowIndex || 0;
      const startCol = used.columnIndex || 0;
      const rows = used.values;
      const units = snapshot.units || {};
      const costs = snapshot.estimatedCosts || {};
      const notes = snapshot.notes || {};
      const subtotal = snapshot.subtotal ?? null;

      console.log('🔍 [DEBUG] ADaM快照数据:', { units, costs, notes, subtotal });

      // 写每个子项的 Unit 并设置 Estimated Cost 公式
      for (let r = 0; r < rows.length; r++) {
        const task = String(rows[r][0] || '').trim();
        if (!taskToKey.hasOwnProperty(task)) continue;
        const key = taskToKey[task];
        const unitVal = units[key] ?? '';

        const unitCell = sheet.getRangeByIndexes(startRow + r, startCol + 1, 1, 1); // B列
        const estCostCell = sheet.getRangeByIndexes(startRow + r, startCol + 5, 1, 1); // F列
        
        // 写入Unit值
        unitCell.values = [[unitVal === '' ? '' : Number(unitVal)]];
        unitCell.format.horizontalAlignment = 'Right';
        
        // 设置Estimated Cost公式 = B列 × C列 × D列
        if (unitVal !== '') {
          const rowNum = startRow + r + 1; // Excel行号从1开始
          estCostCell.formulas = [[`=B${rowNum}*C${rowNum}*D${rowNum}`]];
          estCostCell.format.numberFormat = [["$#,##0.00"]];
          estCostCell.format.horizontalAlignment = 'Right';
          console.log(`✅ 已设置 ${task}: Unit=${unitVal}, 公式=B${rowNum}*C${rowNum}*D${rowNum}`);
        } else {
          estCostCell.values = [['']];
        }
        
        // 🔥 设置Notes（G列）
        const noteKey = taskToKey[task];
        if (notes[noteKey]) {
          const noteCell = sheet.getRangeByIndexes(startRow + r, startCol + 6, 1, 1); // G列
          noteCell.values = [[notes[noteKey]]];
          noteCell.format.horizontalAlignment = 'Left';
          console.log(`✅ 已设置 ${task} 的 Notes: ${notes[noteKey]}`);
        }
      }

      // 定位ADaM主块后的Subtotal行，并设置SUM公式
      // 找到ADaM主标题行
      let adamStartRow = -1;
      for (let r = 0; r < rows.length; r++) {
        const task = String(rows[r][0] || '').trim();
        if (task.toLowerCase() === 'adam datasets production and validation') {
          adamStartRow = r;
          break;
        }
      }
      if (adamStartRow >= 0) {
        // 向下寻找第一个值为 'Subtotal' 的行
        for (let r = adamStartRow + 1; r < rows.length; r++) {
          const firstCell = String(rows[r][0] || '').trim();
          if (firstCell.toLowerCase() === 'subtotal') {
            const subtotalCell = sheet.getRangeByIndexes(startRow + r, startCol + 5, 1, 1); // F列
            
            // 设置SUM公式来自动计算ADaM部分的小计
            const subtotalRowNum = startRow + r + 1; // Excel行号（1-based）
            const adamSectionStartRow = startRow + adamStartRow + 2; // Excel行号：标题下一行
            const adamSectionEndRow = subtotalRowNum - 1; // Excel行号：Subtotal前一行
            
            // 从标题下一行到Subtotal前一行（避免包含Subtotal本身）
            subtotalCell.formulas = [[`=SUM(F${adamSectionStartRow}:F${adamSectionEndRow})`]];
            subtotalCell.format.numberFormat = [["$#,##0.00"]];
            subtotalCell.format.horizontalAlignment = 'Right';
            subtotalCell.format.font.bold = true;
            console.log(`✅ 已设置ADaM Subtotal公式: =SUM(F${adamSectionStartRow}:F${adamSectionEndRow})`);
            break;
          }
        }
      }

      // 🧮 更新Grand Total公式（ADaM确认后）
      await updateGrandTotalFormula(sheet);
      
      await context.sync();
      // moduleConfig.showStatusMessage('ADaM units, estimated costs and subtotal applied from confirmed data.', 'success');
    });
  } catch (err) {
    console.error('Failed to write ADaM units and costs:', err);
    moduleConfig.showStatusMessage('Failed to write ADaM units/costs/subtotal to Excel: ' + err.message, 'error');
  }
}

// 写入 SDTM Notes（来自数据库的域列表）
async function applySDTMNotesToExcel(sdtmInfo) {
  try {
    const highDomains = sdtmInfo?.summary?.highComplexitySdtm?.domains || [];
    const mediumDomains = sdtmInfo?.summary?.mediumComplexitySdtm?.domains || [];
    const allDomains = sdtmInfo?.summary?.unique_domains || [];

    const notesMap = {
      'SDTM Dataset Specs (High Complexity)': highDomains.join('/'),
      'SDTM Dataset Specs (Medium Complexity)': mediumDomains.join('/'),
      'SDTM Dataset File xpt Conversion and Review': allDomains.join('/'),
    };

    console.log('🔍 [DEBUG] SDTM Notes映射:', notesMap);

    await Excel.run(async (context) => {
      const sheet = context.workbook.worksheets.getActiveWorksheet();
      const used = sheet.getUsedRange();
      used.load(['values', 'rowIndex', 'columnIndex']);
      await context.sync();

      const startRow = used.rowIndex || 0;
      const startCol = used.columnIndex || 0;
      const rows = used.values;

      for (let r = 0; r < rows.length; r++) {
        const task = String(rows[r][0] || '').trim();
        if (!(task in notesMap)) continue;
        const note = notesMap[task] || '';
        const noteCell = sheet.getRangeByIndexes(startRow + r, startCol + 6, 1, 1); // 列G Notes
        noteCell.values = [[note]];
        noteCell.format.horizontalAlignment = 'Left';
        console.log(`✅ 已设置 ${task} 的 Notes: ${note}`);
      }

      await context.sync();
      // moduleConfig.showStatusMessage('Notes updated from SDTM confirmed data.', 'success');
    });
  } catch (err) {
    console.error('Failed to write SDTM notes:', err);
    moduleConfig.showStatusMessage('Failed to write SDTM notes: ' + err.message, 'error');
  }
}

// ===== Excel自动保存模块 =====

// 🔄 保存Excel变化到数据库（Unit值变化时触发）
async function saveExcelChangesToDatabase() {
  const currentDocumentId = moduleConfig.getCurrentDocumentId();
  if (!currentDocumentId) {
    console.warn('⚠️ 没有有效的文档ID，跳过保存');
    return;
  }
  
  try {
    await Excel.run(async (context) => {
      const worksheet = context.workbook.worksheets.getActiveWorksheet();
      const usedRange = worksheet.getUsedRange();
      usedRange.load(['values', 'rowIndex', 'columnIndex']);
      await context.sync();
      
      const rows = usedRange.values;
      const updatedUnits = {};
      
      // 提取所有Unit值（B列）
      for (let r = 0; r < rows.length; r++) {
        const taskName = String(rows[r][0] || '').trim();
        const unitValue = rows[r][1]; // B列
        
        if (taskName && unitValue !== undefined && unitValue !== '') {
          // 映射任务名称到key
          const taskKey = getTaskKeyFromName(taskName);
          if (taskKey) {
            updatedUnits[taskKey] = Number(unitValue) || 0;
          }
        }
      }
      
      console.log('🔍 [DEBUG] 提取的Unit数据:', updatedUnits);
      
      // 发送到后端保存
      const response = await fetch(`${moduleConfig.API_BASE_URL}/api/documents/${currentDocumentId}/update-units`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ units: updatedUnits })
      });
      
      const result = await response.json();
      if (result.success) {
        console.log('✅ Excel Unit变化已同步到数据库');
        // moduleConfig.showStatusMessage('Units updated and saved automatically!', 'success');
      } else {
        console.warn('⚠️ 保存Unit变化失败:', result.message);
      }
    });
  } catch (error) {
    console.error('❌ 保存Excel变化到数据库失败:', error);
    moduleConfig.showStatusMessage('Failed to save changes: ' + error.message, 'error');
  }
}

// 辅助函数：从任务名称获取对应的key
function getTaskKeyFromName(taskName) {
  const taskMapping = {
    // SDTM family
    'SDTM Annotated CRFs (aCRF)': 'annotatedCrf',
    'SDTM Dataset Specs (High Complexity)': 'specsHigh',
    'SDTM Dataset Specs (Medium Complexity)': 'specsMedium',
    'SDTM Production and Validation: Programs and Datasets (High Complexity)': 'prodHigh',
    'SDTM Production and Validation: Programs and Datasets (Medium Complexity)': 'prodMedium',
    'SDTM Pinnacle 21 Report Creation and Review': 'pinnacle21',
    "SDTM Reviewer's Guide": 'reviewersGuide',
    'SDTM Define.xml': 'defineXml',
    'SDTM Dataset File xpt Conversion and Review': 'xptConversion'
  };
  
  return taskMapping[taskName] || null;
}

// ===== Step 6: Completion 模块 =====

// 重置到开始状态
async function resetToStart() {
  try {
    // 清除状态变量
    uploadedProtocol = null;
    moduleConfig.setCurrentDocumentId(null);
    moduleConfig.clearDocumentIdFromSettings();
    currentSDTMData = null;
    
    // 清空所有步骤的选择状态
    const checkboxes = document.querySelectorAll('.ms-CheckBox-input');
    checkboxes.forEach(cb => {
      cb.checked = false;
    });
    
    // 隐藏所有动态输入框
    const countContainers = document.querySelectorAll('.count-input-container');
    countContainers.forEach(container => {
      container.style.display = 'none';
      const input = container.querySelector('.count-input');
      if (input) input.value = '';
    });
    
    // 重置上传界面
    const uploadArea = document.getElementById('protocol-upload-area');
    const progress = document.getElementById('protocol-progress');
    const result = document.getElementById('protocol-result');
    const fileInput = document.getElementById('protocol-file-input');
    
    if (uploadArea) uploadArea.style.display = 'block';
    if (progress) progress.style.display = 'none';
    if (result) result.style.display = 'none';
    if (fileInput) fileInput.value = '';
    
    // 隐藏SDTM分析
    const sdtmContainer = document.getElementById('sdtm-mappings-container');
    const confirmationStatus = document.getElementById('confirmation-status');
    if (sdtmContainer) sdtmContainer.style.display = 'none';
    if (confirmationStatus) confirmationStatus.style.display = 'none';
    
    // 🔥 重置AI助手聊天记录
    if (typeof resetAIChatInterface === 'function') {
      resetAIChatInterface();
    }

    // 回到第1步
    showStep(1);
    
    console.log('✅ 应用状态已重置');
  } catch (error) {
    console.error('❌ 重置应用状态时出错:', error);
  }
}

// 保存Excel到本地
async function saveExcelToLocal() {
  try {
    await Excel.run(async (context) => {
      const workbook = context.workbook;
      await workbook.save();
      await context.sync();
      console.log('✅ Excel文件已保存到本地');
    });
  } catch (error) {
    console.error('❌ 保存Excel文件时出错:', error);
  }
}

// 清空Excel内容
async function clearExcelContent() {
  try {
    await Excel.run(async (context) => {
      const worksheet = context.workbook.worksheets.getActiveWorksheet();
      const usedRange = worksheet.getUsedRange();
      usedRange.clear();
      await context.sync();
      console.log('✅ Excel内容已清空');
    });
  } catch (error) {
    console.error('❌ 清空Excel内容时出错:', error);
  }
}

// ===== 模块导出接口 =====

// 全局依赖变量 - 由主控制器传入
let moduleConfig = {};

// HTML模板生成函数
function getStep3HTML() {
  return `
    <div class="costestimate-step3">
      <h3 class="ms-font-l">🎯 Project Selection</h3>
      <p class="ms-font-s">Please select the services you need (multiple selection allowed):</p>
      <div class="project-options">
        <div class="project-option">
          <input type="checkbox" id="project-1" class="ms-CheckBox-input" />
          <label for="project-1" class="ms-CheckBox-label">
            <span class="ms-CheckBox-field"></span>
            <span class="ms-CheckBox-text">Statistical Analysis Plan and Shells Development (2 Drafts and 1 Final)</span>
          </label>
        </div>
        <div class="project-option">
          <input type="checkbox" id="project-2" class="ms-CheckBox-input" data-requires-count="sdtm-transfer" />
          <label for="project-2" class="ms-CheckBox-label">
            <span class="ms-CheckBox-field"></span>
            <span class="ms-CheckBox-text">SDTM Datasets Production and Validation</span>
          </label>
          <div class="count-input-container" id="sdtm-transfer-container" style="display: none;">
            <label class="count-label">Data Transfer Times:</label>
            <input type="number" id="sdtm-transfer-count" class="count-input ms-TextField-field" 
                   min="1" max="999" placeholder="e.g. 5" />
            <span class="count-suffix">times</span>
          </div>
        </div>
        <div class="project-option">
          <input type="checkbox" id="project-3" class="ms-CheckBox-input" data-requires-count="adam-transfer" />
          <label for="project-3" class="ms-CheckBox-label">
            <span class="ms-CheckBox-field"></span>
            <span class="ms-CheckBox-text">ADaM Datasets Production and Validation</span>
          </label>
          <div class="count-input-container" id="adam-transfer-container" style="display: none;">
            <label class="count-label">Data Transfer Times:</label>
            <input type="number" id="adam-transfer-count" class="count-input ms-TextField-field" 
                   min="1" max="999" placeholder="e.g. 3" />
            <span class="count-suffix">times</span>
          </div>
        </div>
        <div class="project-option">
          <input type="checkbox" id="project-4" class="ms-CheckBox-input" />
          <label for="project-4" class="ms-CheckBox-label">
            <span class="ms-CheckBox-field"></span>
            <span class="ms-CheckBox-text">Tables, Figures, and Listings Development</span>
          </label>
        </div>
        <div class="project-option">
          <input type="checkbox" id="project-5" class="ms-CheckBox-input" />
          <label for="project-5" class="ms-CheckBox-label">
            <span class="ms-CheckBox-field"></span>
            <span class="ms-CheckBox-text">Interim Analysis</span>
          </label>
        </div>
        <div class="project-option">
          <input type="checkbox" id="project-6" class="ms-CheckBox-input" />
          <label for="project-6" class="ms-CheckBox-label">
            <span class="ms-CheckBox-field"></span>
            <span class="ms-CheckBox-text">Final Analysis</span>
          </label>
        </div>
        <div class="project-option">
          <input type="checkbox" id="project-7" class="ms-CheckBox-input" />
          <label for="project-7" class="ms-CheckBox-label">
            <span class="ms-CheckBox-field"></span>
            <span class="ms-CheckBox-text">DSUR First Time</span>
          </label>
        </div>
        <div class="project-option">
          <input type="checkbox" id="project-8" class="ms-CheckBox-input" data-requires-count="dsur-rerun" />
          <label for="project-8" class="ms-CheckBox-label">
            <span class="ms-CheckBox-field"></span>
            <span class="ms-CheckBox-text">DSUR Rerun</span>
          </label>
          <div class="count-input-container" id="dsur-rerun-container" style="display: none;">
            <label class="count-label">Rerun Times:</label>
            <input type="number" id="dsur-rerun-count" class="count-input ms-TextField-field" 
                   min="1" max="999" placeholder="e.g. 4" />
            <span class="count-suffix">times</span>
          </div>
        </div>
        <div class="project-option">
          <input type="checkbox" id="project-9" class="ms-CheckBox-input" />
          <label for="project-9" class="ms-CheckBox-label">
            <span class="ms-CheckBox-field"></span>
            <span class="ms-CheckBox-text">DSMB/IDMC First Time</span>
          </label>
        </div>
        <div class="project-option">
          <input type="checkbox" id="project-10" class="ms-CheckBox-input" data-requires-count="dsmb-rerun" />
          <label for="project-10" class="ms-CheckBox-label">
            <span class="ms-CheckBox-field"></span>
            <span class="ms-CheckBox-text">DSMB Rerun</span>
          </label>
          <div class="count-input-container" id="dsmb-rerun-container" style="display: none;">
            <label class="count-label">Rerun Times:</label>
            <input type="number" id="dsmb-rerun-count" class="count-input ms-TextField-field" 
                   min="1" max="999" placeholder="e.g. 2" />
            <span class="count-suffix">times</span>
          </div>
        </div>
      </div>

    </div>
  `;
}

function getStep4HTML() {
  return `
    <div class="costestimate-step4">
      <h3 class="ms-font-l">🔎 Start Analyzing...</h3>
      <p class="ms-font-s">We are running SDTM analysis based on your uploaded protocol. Please wait.</p>
      <div class="ms-Spinner">
        <div class="ms-Spinner-circle ms-Spinner-circle--large"></div>
      </div>
    </div>
  `;
}

function getStep5HTML() {
  return `
    <div class="costestimate-step5">
      <h3 class="ms-font-l">📊 SDTM Analysis Results</h3>
      
      <div class="sdtm-summary" id="sdtm-summary">
        <div class="summary-stats">
          <div class="stat-item">
            <span class="stat-label">Procedures Found:</span>
            <span class="stat-value" id="total-procedures">0</span>
          </div>
          <div class="stat-item">
            <span class="stat-label">SDTM Domains Found:</span>
            <span class="stat-value" id="total-domains">0</span>
          </div>
        </div>
        <div class="domains-overview">
          <span class="stat-label">Identified Domains:</span>
          <div class="domains-list-overview" id="domains-list-overview"></div>
        </div>
        
        <div class="domains-overview">
          <span class="stat-label">High Complexity SDTM:</span>
          <div class="domains-list-overview" id="high-complexity-domains"></div>
        </div>
        
        <div class="domains-overview">
          <span class="stat-label">Medium Complexity SDTM:</span>
          <div class="domains-list-overview" id="medium-complexity-domains"></div>
        </div>
      </div>

      <div class="sdtm-status" id="sdtm-status" style="display: none;">
        <i class="ms-Icon ms-Icon--Info"></i>
        <span id="sdtm-status-text">Analyzing procedures...</span>
      </div>

      <div class="sdtm-mappings-container" id="sdtm-mappings-container" style="display: none;">
        <div class="mappings-header">
          <h4 class="ms-font-m">Procedure → SDTM Domain Mappings</h4>
          <div class="mappings-actions">
            <button class="ms-Button ms-Button--small" id="edit-mappings-btn">
              <span class="ms-Button-label">Edit</span>
            </button>
            <button class="ms-Button ms-Button--primary" id="confirm-mappings-btn">
              <span class="ms-Button-label">Confirm & Save</span>
            </button>
          </div>
        </div>
        
        <div class="flat-mappings-list" id="flat-mappings-list"></div>
        
        <div class="confirmation-status" id="confirmation-status" style="display: none;">
          <i class="ms-Icon ms-Icon--CheckMark"></i>
          <span>SDTM Analysis Confirmed and Saved</span>
        </div>
      </div>
    </div>
  `;
}

function getStep6HTML() {
  return `
    <div class="costestimate-step6">
      <h3 class="ms-font-l">📊 ADaM Analysis Results</h3>
      
      <div id="adam-status" class="adam-analyzing-status">
        <h3 class="ms-font-l">🔎 Start Analyzing...</h3>
        <p class="ms-font-s">We are running ADaM analysis based on your SDTM results. Please wait.</p>
        <div class="ms-Spinner">
          <div class="ms-Spinner-circle ms-Spinner-circle--large"></div>
        </div>
      </div>

      <div class="adam-summary" id="adam-summary" style="display: none;">
        <div class="summary-stats">
          <div class="stat-item">
            <span class="stat-label">SDTM Domains Found:</span>
            <span class="stat-value" id="total-sdtm-domains">0</span>
          </div>
          <div class="stat-item">
            <span class="stat-label">ADaM Domains Generated:</span>
            <span class="stat-value" id="total-adam-domains">0</span>
          </div>
        </div>
        <div class="domains-overview">
          <span class="stat-label">Identified ADaM Domains:</span>
          <div class="domains-list-overview" id="adam-domains-list-overview"></div>
        </div>
        
        <div class="domains-overview">
          <span class="stat-label">High Complexity ADaM:</span>
          <div class="domains-list-overview" id="high-complexity-adam"></div>
        </div>
        
        <div class="domains-overview">
          <span class="stat-label">Medium Complexity ADaM:</span>
          <div class="domains-list-overview" id="medium-complexity-adam"></div>
        </div>
      </div>

      <div class="adam-mappings-container" id="adam-mappings-container" style="display: none;">
        <div class="mappings-header">
          <h4 class="ms-font-m">SDTM → ADaM Domain Mappings</h4>
          <div class="mappings-actions">
            <button class="ms-Button ms-Button--small" id="edit-adam-mappings-btn">
              <span class="ms-Button-label">Edit</span>
            </button>
            <button class="ms-Button ms-Button--primary" id="confirm-adam-mappings-btn">
              <span class="ms-Button-label">Confirm & Save</span>
            </button>
          </div>
        </div>
        
        <div class="adam-mappings-list" id="adam-mappings-list"></div>
        
        <div class="confirmation-status" id="adam-confirmation-status" style="display: none;">
          <i class="ms-Icon ms-Icon--CheckMark"></i>
          <span>ADaM Analysis Confirmed and Saved</span>
        </div>
      </div>
    </div>
  `;
}

function getStep7HTML() {
  return `
    <div class="costestimate-step7">
      <div class="completion-confirmation-section">
        <div class="completion-icon">
          <span class="ms-Icon ms-Icon--CheckMark" style="font-size: 48px; color: #28a745;"></span>
        </div>
        
        <h3 class="completion-title">Analysis Complete!</h3>
        
        <div class="completion-message">
          <p>🎉 All the analysis are done successfully!</p>
          <p>Your cost estimation, SDTM mapping and ADaM analysis have been completed and saved to Excel.</p>
          <p>Click "Done" to confirm completion and start a new project.</p>
        </div>
        

      </div>
    </div>
`;
}

// 动态插入CostEstimate HTML内容
function insertCostEstimateHTML() {
  // 插入 Step 3 内容
  const step3Container = document.getElementById('costestimate-step3-container');
  if (step3Container) {
    step3Container.innerHTML = getStep3HTML();
  }

  // 插入 Step 4 内容
  const step4Container = document.getElementById('costestimate-step4-container');
  if (step4Container) {
    step4Container.innerHTML = getStep4HTML();
  }

  // 插入 Step 5 内容
  const step5Container = document.getElementById('costestimate-step5-container');
  if (step5Container) {
    step5Container.innerHTML = getStep5HTML();
  }

  // 插入 Step 6 内容 (ADaM Analysis)
  const step6Container = document.getElementById('costestimate-step6-container');
  if (step6Container) {
    step6Container.innerHTML = getStep6HTML();
  }

  // 插入 Step 7 内容 (Completion)
  const step7Container = document.getElementById('costestimate-step7-container');
  if (step7Container) {
    step7Container.innerHTML = getStep7HTML();
  }
}

// 初始化costestimate模块的所有功能
function initCostEstimateModule(config = {}) {
  console.log('🚀 初始化 costestimate 模块...');
  
  // 保存配置
  moduleConfig = {
    API_BASE_URL: config.API_BASE_URL || 'https://localhost:4000',
    showStep: config.showStep || (() => console.warn('showStep not provided')),
    showStatusMessage: config.showStatusMessage || ((msg, type) => console.warn('showStatusMessage not provided:', msg)),
    cacheExcelState: config.cacheExcelState || (() => console.warn('cacheExcelState not provided')),
    restoreExcelState: config.restoreExcelState || (() => console.warn('restoreExcelState not provided')),
    getCurrentDocumentId: config.getCurrentDocumentId || (() => console.warn('getCurrentDocumentId not provided')),
    setCurrentDocumentId: config.setCurrentDocumentId || (() => console.warn('setCurrentDocumentId not provided')),
    clearDocumentIdFromSettings: config.clearDocumentIdFromSettings || (() => console.warn('clearDocumentIdFromSettings not provided'))
  };
  
  // 动态插入HTML内容
  insertCostEstimateHTML();
  
  initProjectSelectionLogic();
  
  // 🔥 初始化时尝试绑定SDTM按钮事件（如果按钮存在的话）
  // 主要的事件绑定会在displaySDTMAnalysis()时进行
  bindSDTMButtonEvents();
  
  console.log('✅ costestimate 模块初始化完成');
}

// 重置costestimate模块状态
function resetCostEstimateModule() {
  console.log('🔄 重置 costestimate 模块...');
  
  // 重置模块内部状态
  if (typeof currentSDTMData !== 'undefined') {
    currentSDTMData = null;
  }
  if (moduleConfig && typeof moduleConfig.setUploadedProtocol === 'function') {
    moduleConfig.setUploadedProtocol(null);
  }
  
  resetToStart();
  console.log('✅ costestimate 模块重置完成');
}

// 🔥 新增：ADaM分析结果显示函数
function displayADaMAnalysis(adamAnalysis) {
  console.log('🔍 [DEBUG] 显示ADaM分析结果:', adamAnalysis);
  
  if (!adamAnalysis || !adamAnalysis.summary) {
    console.warn('❌ No ADaM analysis data to display');
    return;
  }

  // 隐藏分析状态，显示结果
  const adamStatus = document.getElementById('adam-status');
  const adamSummary = document.getElementById('adam-summary');
  const adamMappingsContainer = document.getElementById('adam-mappings-container');
  
  if (adamStatus) adamStatus.style.display = 'none';
  if (adamSummary) adamSummary.style.display = 'block';
  if (adamMappingsContainer) adamMappingsContainer.style.display = 'block';

  // 更新统计信息
  // 计算输入SDTM域数量（从映射中提取）
  let inputSdtmDomains = new Set();
  if (adamAnalysis.mappings) {
    if (Array.isArray(adamAnalysis.mappings)) {
      // 数组格式
      adamAnalysis.mappings.forEach(mapping => {
        if (mapping.sdtm_domains) {
          mapping.sdtm_domains.forEach(domain => inputSdtmDomains.add(domain));
        }
      });
    } else if (typeof adamAnalysis.mappings === 'object') {
      // Map格式 或 对象格式
      Object.keys(adamAnalysis.mappings).forEach(sdtmDomain => {
        inputSdtmDomains.add(sdtmDomain);
      });
    }
  }
  
  const totalSdtmDomains = inputSdtmDomains.size;
  const totalAdamDomains = adamAnalysis.summary?.unique_adam_domains?.length || 0;
  const uniqueAdamDomains = adamAnalysis.summary?.unique_adam_domains || [];

  // 更新DOM元素
  const sdtmEl = document.getElementById('total-sdtm-domains');
  const adamEl = document.getElementById('total-adam-domains');
  
  if (sdtmEl) sdtmEl.textContent = totalSdtmDomains;
  if (adamEl) adamEl.textContent = totalAdamDomains;

  // 🔥 设置全局currentADaMData供确认功能使用
  // 确保映射数据格式正确，支持编辑功能
  let formattedMappings = [];
  if (adamAnalysis.mappings) {
    if (adamAnalysis.mappings instanceof Map) {
      // Map格式转为数组
      formattedMappings = Array.from(adamAnalysis.mappings.entries()).map(([sdtm, adam]) => ({
        sdtm_domains: sdtm,
        adam_domains: Array.isArray(adam) ? adam : String(adam).split(',').map(s => s.trim()).filter(Boolean)
      }));
    } else if (Array.isArray(adamAnalysis.mappings)) {
      // 数组格式（确保adam_domains是数组）
      formattedMappings = adamAnalysis.mappings.map(mapping => ({
        ...mapping,
        adam_domains: Array.isArray(mapping.adam_domains) 
          ? mapping.adam_domains 
          : String(mapping.adam_domains || '').split(',').map(s => s.trim()).filter(Boolean)
      }));
    } else if (typeof adamAnalysis.mappings === 'object') {
      // 对象格式转为数组
      formattedMappings = Object.entries(adamAnalysis.mappings).map(([sdtm, adam]) => ({
        sdtm_domains: sdtm,
        adam_domains: Array.isArray(adam) ? adam : String(adam).split(',').map(s => s.trim()).filter(Boolean)
      }));
    }
  }

  window.currentADaMData = {
    ...adamAnalysis,
    mappings: formattedMappings
  };
  console.log('✅ 已设置 window.currentADaMData (格式化后):', window.currentADaMData);

  // 显示ADaM域概览
  const adamDomainsOverview = document.getElementById('adam-domains-list-overview');
  if (adamDomainsOverview) {
    adamDomainsOverview.innerHTML = uniqueAdamDomains.map(domain => 
      `<span class="domain-tag">${domain}</span>`
    ).join('');
  }

  // 显示高复杂度和中等复杂度ADaM域
  const highComplexityAdam = document.getElementById('high-complexity-adam');
  const mediumComplexityAdam = document.getElementById('medium-complexity-adam');
  
  if (highComplexityAdam && adamAnalysis.summary?.highComplexityAdam?.domains) {
    highComplexityAdam.innerHTML = adamAnalysis.summary.highComplexityAdam.domains.map(domain => 
      `<span class="domain-tag">${domain}</span>`
    ).join('');
  }
  
  if (mediumComplexityAdam && adamAnalysis.summary?.mediumComplexityAdam?.domains) {
    mediumComplexityAdam.innerHTML = adamAnalysis.summary.mediumComplexityAdam.domains.map(domain => 
      `<span class="domain-tag">${domain}</span>`
    ).join('');
  }

  // 显示SDTM→ADaM映射
  displayADaMMappingsList(adamAnalysis.mappings);
  
  // 绑定ADaM按钮事件
  bindADaMButtonEvents();
}

// 显示ADaM映射列表
function displayADaMMappingsList(adamMappings) {
  const container = document.getElementById('adam-mappings-list');
  if (!container) {
    console.error('❌ 找不到 adam-mappings-list 容器');
    return;
  }

  container.innerHTML = '';

  if (!adamMappings) {
    console.warn('⚠️ 没有ADaM映射数据');
    return;
  }

  // 转换Map为数组（如果需要）
  let mappingsArray = [];
  if (adamMappings instanceof Map) {
    mappingsArray = Array.from(adamMappings.entries()).map(([sdtm, adam]) => ({
      sdtm_domains: sdtm,
      adam_domains: adam
    }));
  } else if (Array.isArray(adamMappings)) {
    mappingsArray = adamMappings;
  } else if (typeof adamMappings === 'object' && adamMappings !== null) {
    // 处理从MongoDB序列化来的对象格式
    mappingsArray = Object.entries(adamMappings).map(([sdtm, adam]) => ({
      sdtm_domains: sdtm,
      adam_domains: adam
    }));
  }

  mappingsArray.forEach((mapping) => {
    const mappingDiv = document.createElement('div');
    mappingDiv.className = 'adam-mapping-item';
    
    const sdtmDomains = mapping.sdtm_domains || 'Unknown SDTM';
    const adamDomains = mapping.adam_domains || 'Unknown ADaM';
    
    // 支持字符串（逗号分隔）或数组两种格式
    const adamDomainList = Array.isArray(adamDomains)
      ? adamDomains
      : String(adamDomains).split(',').map(s => s.trim()).filter(Boolean);
    
    const tagsHtml = adamDomainList.map(d => `<span class="domain-tag">${d}</span>`).join('');
    
    mappingDiv.innerHTML = `
      <div class="adam-sdtm-name"><strong>SDTM: ${sdtmDomains}</strong></div>
      <div class="adam-domain-tags">${tagsHtml}</div>
    `;
    container.appendChild(mappingDiv);
  });
  
  console.log(`✅ 已显示 ${mappingsArray.length} 个ADaM映射项`);
}

// 🔥 新增：自动加载ADaM分析结果（用于Step 6）
async function loadAndDisplayADaMResults() {
  try {
    const currentDocumentId = moduleConfig.getCurrentDocumentId();
    if (!currentDocumentId) {
      console.warn('没有当前文档ID，无法加载ADaM结果');
      return;
    }
    
    console.log('🔄 自动加载ADaM分析结果并恢复完整Excel状态...');
    
    const response = await fetch(`${moduleConfig.API_BASE_URL}/api/documents/${currentDocumentId}/content`);
    if (!response.ok) {
      throw new Error(`Failed to load document: ${response.statusText}`);
    }
    
    const data = await response.json();
    console.log('🔍 [DEBUG] API返回的完整数据结构:', JSON.stringify(data, null, 2));
    
    // 🔥 Step 1: 先恢复SDTM的Excel数据（作为基础）
    console.log('🔧 Step 1: 恢复SDTM基础Excel数据...');
    await loadAndDisplaySDTMResults(); // 先调用SDTM恢复，确保基础表格和SDTM数据都正确
    
    // 🔥 Step 2: 获取ADaM数据并显示UI
    const userConfirmedAdam = data.document?.CostEstimateDetails?.userConfirmedAdam;
    const originalAdamAnalysis = data.document?.CostEstimateDetails?.adamAnalysis;
    const sdtmAnalysisStatus = data.document?.CostEstimateDetails?.sdtmAnalysisStatus;
    
    console.log('🔍 [DEBUG] ADaM状态检查:', {
      userConfirmedAdam: userConfirmedAdam?.success,
      originalAdamAnalysis: originalAdamAnalysis?.success,
      sdtmAnalysisStatus
    });
    
    let adamDataToDisplay = null;
    
    if (userConfirmedAdam && userConfirmedAdam.success) {
      console.log('🔍 [DEBUG] 使用用户确认的ADaM数据');
      adamDataToDisplay = userConfirmedAdam;
    } else if (originalAdamAnalysis && originalAdamAnalysis.success) {
      console.log('🔍 [DEBUG] 使用原始AI分析的ADaM数据');
      adamDataToDisplay = originalAdamAnalysis;
    }
    
    // 🔥 Step 3: 显示ADaM分析结果UI
    if (adamDataToDisplay) {
      console.log('✅ ADaM分析结果加载成功，显示UI...');
      displayADaMAnalysis(adamDataToDisplay);
      
      // 🔥 如果是已确认状态，显示确认UI并禁用按钮
      if (sdtmAnalysisStatus === 'user_confirmed_adam_done') {
        console.log('🔧 设置ADaM已确认状态UI...');
        
        // 显示确认状态消息
        const confirmationStatus = document.getElementById('adam-confirmation-status');
        if (confirmationStatus) {
          confirmationStatus.style.display = 'flex';
          console.log('✅ 已显示ADaM确认状态消息');
        }
        
        // 禁用Edit和Confirm按钮
        const editBtn = document.getElementById('edit-adam-mappings-btn');
        const confirmBtn = document.getElementById('confirm-adam-mappings-btn');
        if (editBtn) {
          editBtn.disabled = true;
          console.log('✅ 已禁用ADaM编辑按钮');
        }
        if (confirmBtn) {
          confirmBtn.disabled = true;
          console.log('✅ 已禁用ADaM确认按钮');
        }
      }
    } else {
      console.warn('⚠️ 没有找到有效的ADaM分析结果');
      const adamStatus = document.getElementById('adam-status');
      if (adamStatus) {
        adamStatus.innerHTML = `
          <h3 class="ms-font-l">⚠️ ADaM Analysis Not Completed</h3>
          <p class="ms-font-s">ADaM analysis has not been completed yet or failed. Please try again.</p>
        `;
        adamStatus.className = 'adam-analyzing-status';
      }
    }
    
    // 🔥 Step 4: 如果ADaM已确认，恢复ADaM的Excel数据
    console.log('🔍 [DEBUG] ADaM恢复条件检查:', {
      sdtmAnalysisStatus,
      userConfirmedAdamSuccess: userConfirmedAdam?.success,
      shouldRestore: sdtmAnalysisStatus === 'user_confirmed_adam_done' && userConfirmedAdam?.success
    });
    
    if (sdtmAnalysisStatus === 'user_confirmed_adam_done' && userConfirmedAdam?.success) {
      console.log('🔧 Step 4: 恢复已确认的ADaM Excel数据...');
      
      const adamTableInput = data.document?.CostEstimateDetails?.adamTableInput;
      console.log('🔍 [DEBUG] adamTableInput完整数据:', JSON.stringify(adamTableInput, null, 2));
      
      const adamSection = adamTableInput?.['ADaM Datasets Production and Validation'];
      console.log('🔍 [DEBUG] adamSection完整数据:', JSON.stringify(adamSection, null, 2));
      
      console.log('🔍 [DEBUG] ADaM数据检查:', {
        adamTableInputExists: !!adamTableInput,
        adamTableInputKeys: adamTableInput ? Object.keys(adamTableInput) : null,
        adamSectionExists: !!adamSection,
        adamSectionUnits: adamSection?.units,
        adamSectionEstimatedCosts: adamSection?.estimatedCosts,
        adamSectionKeys: adamSection ? Object.keys(adamSection) : null
      });
      
      if (adamSection && adamSection.units) {
        console.log('🔧 应用ADaM Units, Costs和Notes到Excel...');
        await applyADaMUnitsAndCostsToExcel(adamSection);
        console.log('✅ ADaM Excel数据已恢复完成');
      } else {
        console.warn('⚠️ 没有找到ADaM Excel数据快照');
        console.warn('🔍 [DEBUG] 详细原因:', {
          noAdamTableInput: !adamTableInput,
          noAdamSection: !adamSection,
          noUnits: !adamSection?.units,
          availableKeys: adamTableInput ? Object.keys(adamTableInput) : 'N/A'
        });
      }
    } else {
      console.log('ℹ️ ADaM未确认或数据不完整，跳过Excel数据恢复');
      if (sdtmAnalysisStatus !== 'user_confirmed_adam_done') {
        console.log('🔍 [DEBUG] 状态不匹配:', sdtmAnalysisStatus, '!== user_confirmed_adam_done');
      }
      if (!userConfirmedAdam?.success) {
        console.log('🔍 [DEBUG] userConfirmedAdam数据:', JSON.stringify(userConfirmedAdam, null, 2));
      }
    }
    
    console.log('✅ ADaM状态恢复完成');
    
  } catch (error) {
    console.error('❌ 加载ADaM结果失败:', error);
    const adamStatus = document.getElementById('adam-status');
    if (adamStatus) {
      adamStatus.innerHTML = `
        <h3 class="ms-font-l">❌ Failed to Load ADaM Results</h3>
        <p class="ms-font-s">Error occurred while loading ADaM analysis results. Please try again.</p>
      `;
      adamStatus.className = 'adam-analyzing-status';
    }
  }
}

// 🔥 新增：自动加载SDTM分析结果（用于Step 5）
async function loadAndDisplaySDTMResults() {
  try {
    const currentDocumentId = moduleConfig.getCurrentDocumentId();
    if (!currentDocumentId) {
      console.warn('没有当前文档ID，无法加载SDTM结果');
      return;
    }
    
    console.log('🔄 自动加载SDTM分析结果并恢复Excel状态...');
    
    const response = await fetch(`${moduleConfig.API_BASE_URL}/api/documents/${currentDocumentId}/content`);
    if (!response.ok) {
      throw new Error(`Failed to load document: ${response.statusText}`);
    }
    
    const data = await response.json();
    console.log('🔍 [DEBUG] API返回的完整数据结构:', JSON.stringify(data, null, 2));
    
    // 🔥 获取项目状态
    const sdtmAnalysisStatus = data.document?.CostEstimateDetails?.sdtmAnalysisStatus;
    console.log('🔍 [DEBUG] 当前项目状态:', sdtmAnalysisStatus);
    
    // 🔥 Step 1: 重建Excel基础表格结构（所有状态都需要）
    console.log('🔧 重建Excel基础表格结构...');
    await createStandardCostAnalysisHeaders();
    
    // 🔥 Step 2: 填充已选择的项目内容（所有状态都需要）
    console.log('🔧 填充已选择的项目内容...');
    const projectSelection = data.document?.CostEstimateDetails?.projectSelection?.selectionDetails;
    if (projectSelection && Object.keys(projectSelection).length > 0) {
      console.log('🔍 [DEBUG] 传递项目选择数据:', projectSelection);
      await populateExcelWithSelectedProjects(projectSelection);
    } else {
      console.warn('⚠️ 没有找到项目选择数据，跳过Excel表格填充');
      moduleConfig.showStatusMessage('No project selection data found, cannot restore Excel table', 'warning');
      return; // 没有项目数据就不继续
    }
    
    // 🔥 Step 3: 根据状态恢复Excel数据
    if (sdtmAnalysisStatus === 'user_confirmed_sdtm_done' || 
        sdtmAnalysisStatus === 'adam_ai_analysis_done' || 
        sdtmAnalysisStatus === 'user_confirmed_adam_done') {
      // 已确认状态或ADaM阶段：恢复完整的SDTM Unit和Cost数据
      const costEstimate = data.document?.CostEstimateDetails?.sdtmTableInput;
      const sdtmSection = costEstimate?.['SDTM Datasets Production and Validation'];
      
      console.log('🔍 [DEBUG] SDTM数据检查:', {
        costEstimate: !!costEstimate,
        sdtmSection: !!sdtmSection,
        sdtmSectionUnits: sdtmSection?.units,
        sdtmSectionKeys: sdtmSection ? Object.keys(sdtmSection) : null,
        fullPath: 'data.document.CostEstimateDetails.sdtmTableInput["SDTM Datasets Production and Validation"]'
      });
      
      if (sdtmSection && sdtmSection.units) {
        console.log('🔧 恢复已确认的SDTM Unit和Cost数据...');
        await applySDTMUnitsAndCostsToExcel(sdtmSection);
      } else {
        console.warn('⚠️ 没有找到SDTM Excel数据快照');
      }
      
      // 恢复Notes数据
      const userConfirmedSdtm = data.document?.CostEstimateDetails?.userConfirmedSdtm;
      if (userConfirmedSdtm && userConfirmedSdtm.success) {
        console.log('🔧 恢复已确认的SDTM Notes...');
        await applySDTMNotesToExcel(userConfirmedSdtm);
      } else {
        console.warn('⚠️ 没有找到SDTM Notes数据');
      }
      
      console.log('✅ Excel状态已恢复到已确认状态（含Unit/Cost数据）');
    } else if (sdtmAnalysisStatus === 'sdtm_ai_analysis_done') {
      console.log('✅ Excel状态已恢复到AI分析完成状态（空Unit/Cost，待用户确认）');
    } else {
      console.log('✅ Excel状态已恢复到项目选择完成状态');
    }
    
    // 🔥 Step 4: 显示SDTM分析结果界面（优先使用已确认的数据）
    let sdtmDataToDisplay = null;
    
    // 优先检查是否有用户确认的数据
    const userConfirmedSdtm = data.document?.CostEstimateDetails?.userConfirmedSdtm;
    const originalSdtmAnalysis = data.document?.CostEstimateDetails?.sdtmAnalysis;
    
    if (userConfirmedSdtm && userConfirmedSdtm.success && userConfirmedSdtm.procedures?.length > 0) {
      console.log('🔍 [DEBUG] 使用用户确认的SDTM数据');
      // 用户已确认的数据，需要将Map格式的mappings转换为数组格式以便显示
      sdtmDataToDisplay = {
        ...userConfirmedSdtm,
        mappings: userConfirmedSdtm.mappings ? convertMapToMappingsList(userConfirmedSdtm.mappings, userConfirmedSdtm.procedures) : []
      };
    } else if (originalSdtmAnalysis && (originalSdtmAnalysis.success || originalSdtmAnalysis.procedures?.length > 0)) {
      console.log('🔍 [DEBUG] 使用原始AI分析的SDTM数据');
      sdtmDataToDisplay = originalSdtmAnalysis;
    }
    
    console.log('🔍 [DEBUG] 最终选择的SDTM数据:', sdtmDataToDisplay);
    
    if (sdtmDataToDisplay) {
      console.log('✅ SDTM分析结果加载成功');
      // 显示SDTM分析结果
      await displaySDTMAnalysis(sdtmDataToDisplay);
    } else {
      console.warn('⚠️ 没有找到有效的SDTM分析结果');
      moduleConfig.showStatusMessage('No SDTM analysis results found', 'warning');
    }
    
  } catch (error) {
    console.error('❌ 加载SDTM结果失败:', error);
    moduleConfig.showStatusMessage('Failed to load SDTM results: ' + error.message, 'error');
  }
}

// 暴露给主控制器的接口
if (typeof window !== 'undefined') {
  window.CostEstimateModule = {
    init: initCostEstimateModule,
    reset: resetCostEstimateModule,
    restoreApplicationState: loadAndDisplaySDTMResults, // 🔥 添加状态恢复函数
    // 导出主要函数供主控制器调用
    initProjectSelectionLogic,
    saveProjectSelectionDetails,
    createStandardCostAnalysisHeaders,
    populateExcelWithSelectedProjects,
    displaySDTMAnalysis,
    confirmSDTMAnalysis,
    applySDTMUnitsAndCostsToExcel,
    applySDTMNotesToExcel, // 🔥 新增
    loadAndDisplaySDTMResults, // 🔥 新增
    displayADaMAnalysis, // 🔥 新增ADaM显示函数
    loadAndDisplayADaMResults, // 🔥 新增ADaM加载函数
    confirmADaMAnalysis, // 🔥 新增ADaM确认函数
    collectCurrentADaMMappings, // 🔥 新增ADaM数据收集函数
    applyADaMUnitsAndCostsToExcel, // 🔥 新增ADaM Excel写入函数
    toggleADaMEditMode, // 🔥 新增ADaM编辑模式切换函数
    makeADaMItemEditable, // 🔥 新增ADaM编辑功能
    makeADaMItemReadOnly, // 🔥 新增ADaM只读功能
    bindADaMButtonEvents, // 🔥 新增ADaM按钮绑定函数
    saveExcelChangesToDatabase, // 🔥 新增Excel自动保存
    resetToStart,
    saveExcelToLocal,
    clearExcelContent,
    // 🔥 暴露按钮处理函数到全局作用域
    handleEditMappings,
    bindSDTMButtonEvents
  };
  
  // 🔥 将关键函数直接暴露到window对象，防止作用域问题
  window.handleEditMappings = handleEditMappings;
  window.confirmSDTMAnalysis = confirmSDTMAnalysis;
  window.confirmADaMAnalysis = confirmADaMAnalysis; // 🔥 新增：暴露ADaM确认函数
  window.collectCurrentADaMMappings = collectCurrentADaMMappings; // 🔥 新增：暴露ADaM数据收集函数
  window.applyADaMUnitsAndCostsToExcel = applyADaMUnitsAndCostsToExcel; // 🔥 新增：暴露ADaM Excel写入函数
  window.toggleADaMEditMode = toggleADaMEditMode; // 🔥 新增：暴露ADaM编辑模式切换函数
  window.makeADaMItemEditable = makeADaMItemEditable; // 🔥 新增：暴露ADaM编辑功能
  window.makeADaMItemReadOnly = makeADaMItemReadOnly; // 🔥 新增：暴露ADaM只读功能
}


























