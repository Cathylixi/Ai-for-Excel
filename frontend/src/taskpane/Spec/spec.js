// Spec Page
(function(){
  let API_BASE_URL = (typeof window !== 'undefined' && window.API_BASE_URL) ? window.API_BASE_URL : '';
  let currentStudyId = (typeof window !== 'undefined' && window.currentDocumentId) ? window.currentDocumentId : null;

  // 🔥 新增：Spec创建状态管理
  let currentSheetIndex = 0;
  let sheetsToCreate = [];
  let isCreatingSheets = false;

  function qs(id){ return document.getElementById(id); }

  // Unified status reporter to avoid window.alert (not supported in Office add-ins)
  function reportStatus(message, type){
    try {
      if (window.TaskPaneController && typeof window.TaskPaneController.showStatusMessage === 'function') {
        window.TaskPaneController.showStatusMessage(message, type || 'info');
      return;
    }
      if (typeof window.showStatusMessage === 'function') {
        window.showStatusMessage(message, type || 'info');
      return;
      }
    } catch (_) {}
    // Fallback: lightweight inline banner
    let host = document.getElementById('spec-container') || document.body;
    let banner = document.getElementById('spec-status-banner');
    if (!banner) {
      banner = document.createElement('div');
      banner.id = 'spec-status-banner';
      banner.style.cssText = 'margin:12px 0;padding:10px 14px;border-radius:6px;font-size:13px;';
      host.insertBefore(banner, host.firstChild);
    }
    banner.style.background = (type === 'error') ? '#fde7e9' : (type === 'success') ? '#e6f4ea' : '#f3f2f1';
    banner.style.color = '#323130';
    banner.textContent = message;
  }

  // Bind "I'm Finished" button click event (extracted for reusability)
  function bindFinishButton() {
    const finishBtn = qs('spec-finish-btn');
    
    if (finishBtn) {
      finishBtn.addEventListener('click', () => {
        // Check if coming from chat flow - now detecting waiting_for_spec_finish state
        const isFromChatFlow = (window.chatFlowState === 'waiting_for_spec_finish');
        
        console.log('🏁 Spec finished', { 
          isFromChatFlow, 
          pendingTaskAfterAnnotation: window.pendingTaskAfterAnnotation 
        });
        
        // Return to chat page first
        if (typeof window.showStep === 'function') {
          window.showStep(1);
        } else if (typeof window.TaskPaneController?.showStep === 'function') {
          window.TaskPaneController.showStep(1);
        }
        
        // If from chat flow, trigger completion event (keep original event name for compatibility)
        if (isFromChatFlow && window.pendingTaskAfterAnnotation) {
          setTimeout(() => {
            window.dispatchEvent(new CustomEvent('crfAnnotationComplete', {
              detail: { 
                fromChatFlow: true,
                pendingTaskAfterAnnotation: window.pendingTaskAfterAnnotation
              }
            }));
          }, 300); // Slight delay to ensure page transition completes
        }
      });
    }
  }
  
  // Legacy wrapper for backward compatibility
  function initBindings() {
    bindFinishButton();
  }

  // 显示Spec页面界面
  function showSpecInterface() {
    const container = qs('spec-container');
    if (!container) return;
    
    container.innerHTML = `
      <div class="spec-wrapper">
        <h3 class="ms-font-l">📋 Spec Processing</h3>

        <div class="annotation-content" style="text-align: center; padding: 40px 20px;">
          <div class="annotation-progress">
            <i class="ms-Icon ms-Icon--ExcelDocument ms-font-xxl" style="color: #107c10; margin-bottom: 20px;"></i>
            <h4 class="ms-font-l">Creating Spec Excel Worksheets...</h4>
            <p class="ms-font-m" style="color: #605e5c; margin: 20px 0;">
              Setting up comprehensive Excel structure for spec analysis.<br/>
              This will create multiple worksheets with proper headers.
            </p>
          </div>
        </div>
      </div>
    `;
    
    // 🔥 自动开始Excel表格创建过程
    setTimeout(() => {
      createSpecExcelSheets();
    }, 1000);
  }

  // ===== Excel表格创建模块 =====
  
  // 主要的Excel表格创建函数
  async function createSpecExcelSheets() {
    try {
      console.log('🚀 Starting Spec Excel sheets creation...');
      
      // 🔥 初始化状态变量
      currentSheetIndex = 0;
      isCreatingSheets = true;
      sheetsToCreate = [
        { name: 'Study', createFn: createStudySheet },
        { name: 'Updated Tracker', createFn: createUpdatedTrackerSheet },
        { name: 'Datasets', createFn: createDatasetsSheet },
        { name: 'Variables', createFn: createVariablesSheet },
        { name: 'Methods', createFn: createMethodsSheet },
        { name: 'TESTCD_Details', createFn: createTESTCDDetailsSheet },
        { name: 'SUPP_Details', createFn: createSUPPDetailsSheet },
        { name: 'TA_Data', createFn: createTADataSheet },
        { name: 'TE_Data', createFn: createTEDataSheet },
        { name: 'TI_Data', createFn: createTIDataSheet },
        { name: 'TV_Data', createFn: createTVDataSheet },
        { name: 'TS_Data', createFn: createTSDataSheet }
      ];
      
      // 显示进度UI（包含Create按钮，等待用户点击）
      showSpecProgressUI();
      
    } catch (error) {
      console.error('❌ Failed to start Spec Excel sheets creation:', error);
      reportStatus(`Failed to create Excel worksheets: ${error.message}`, 'error');
    }
  }
  
  // 显示进度UI (与CRF annotation store to database风格一致)
  function showSpecProgressUI() {
    const container = qs('spec-container');
    if (!container) return;
    
    // 🔥 修正逻辑：currentSheetIndex表示即将创建的sheet索引
    const currentSheet = sheetsToCreate[currentSheetIndex]; // 即将创建的sheet
    const isAllCompleted = currentSheetIndex >= sheetsToCreate.length; // 是否全部完成
    const progressPercent = Math.round((currentSheetIndex / sheetsToCreate.length) * 100); // 已创建的进度
    
    // 🔥 按钮逻辑修正 - 添加User Confirmed逻辑
    let buttonHtml = '';
    if (isAllCompleted) {
      // 所有sheet已创建完成
      buttonHtml = '<button id="spec-finish-btn" class="ms-Button ms-Button--primary" style="font-size: 16px; padding: 12px 32px; border-radius: 8px;"><span class="ms-Button-label">I\'m Finished</span></button>';
    } else if (currentSheetIndex === 0) {
      // 第一个sheet，只显示"Create Sheet"
      buttonHtml = '<button id="spec-create-btn" class="ms-Button ms-Button--primary" style="font-size: 16px; padding: 12px 32px; border-radius: 8px;"><span class="ms-Button-label">Create Sheet</span></button>';
    } else {
      // 后续sheet已创建，显示"User Confirmed" + "Next Sheet"(禁用)
      buttonHtml = `
        <div style="display: flex; gap: 12px; justify-content: center;">
          <button id="spec-confirm-btn" class="ms-Button ms-Button--primary" style="font-size: 16px; padding: 12px 32px; border-radius: 8px;">
            <span class="ms-Button-label">User Confirmed</span>
          </button>
          <button id="spec-next-btn" class="ms-Button" disabled style="font-size: 16px; padding: 12px 32px; border-radius: 8px; opacity: 0.6;">
            <span class="ms-Button-label">Next Sheet</span>
          </button>
        </div>`;
    }
    
    container.innerHTML = `
      <div class="spec-wrapper">
        <h3 class="ms-font-l">📋 Spec Processing</h3>

        <div class="annotation-content" style="text-align: center; padding: 40px 20px;">
          <div class="annotation-progress">
            <i class="ms-Icon ms-Icon--ExcelDocument ms-font-xxl" style="color: #107c10; margin-bottom: 20px;"></i>
            <h4 class="ms-font-l">Creating Spec Excel Worksheets...</h4>
            <p class="ms-font-m" style="color: #605e5c; margin: 20px 0;">
              Setting up comprehensive Excel structure for spec analysis.<br/>
              Creating worksheets step by step with user control.
            </p>
            
            <div class="progress-block" style="max-width:720px;margin:24px auto;text-align:left;">
              <div style="margin:8px 0 4px 0;display:flex;justify-content:space-between;align-items:center;">
                <span class="ms-font-m">📊 Excel Worksheets</span>
                <span id="spec-progress-text" class="ms-font-s" style="color:#605e5c;">${currentSheetIndex}/${sheetsToCreate.length} sheets</span>
              </div>
              <div class="progress-bar" style="height:10px;background:#edebe9;border-radius:6px;overflow:hidden;">
                <div id="spec-progress-fill" style="height:100%;width:${progressPercent}%;background:#107c10;transition:width .3s ease;"></div>
              </div>
              <div id="spec-percentage" class="ms-font-s" style="text-align:right;color:#605e5c;margin-top:4px;">${progressPercent}%</div>
            </div>

            <div id="spec-current-status" class="ms-font-s" style="color:#323130; margin-top: 8px;">
              ${isAllCompleted ? 'All worksheets completed!' : `Next to create: ${currentSheet.name}`}
            </div>
            
            <div style="margin-top: 30px;">
              ${buttonHtml}
            </div>
          </div>
        </div>
      </div>
    `;
    
    // 绑定按钮事件
    setTimeout(() => {
      const createBtn = qs('spec-create-btn');
      const confirmBtn = qs('spec-confirm-btn');
      const nextBtn = qs('spec-next-btn');
      const finishBtn = qs('spec-finish-btn');
      
      if (createBtn) {
        createBtn.addEventListener('click', handleCreateButtonClick);
      }
      
      if (confirmBtn) {
        confirmBtn.addEventListener('click', handleConfirmButtonClick);
      }
      
      if (nextBtn) {
        nextBtn.addEventListener('click', handleNextButtonClick);
      }
      
      if (finishBtn) {
        initBindings(); // 现有的finish按钮处理
      }
    }, 50);
  }
  
  // 🔥 新增：创建当前sheet
  async function createNextSheet() {
    if (currentSheetIndex >= sheetsToCreate.length) {
      // 所有sheet创建完成
      showSpecCompleteUI();
      return;
    }
    
    const sheet = sheetsToCreate[currentSheetIndex];
    
    try {
      console.log(`📊 Creating sheet ${currentSheetIndex + 1}/${sheetsToCreate.length}: ${sheet.name}`);
      
      // 创建表格
      await sheet.createFn();
      
      // 🔥 先移动到下一个sheet索引（表示这个sheet已完成）
      currentSheetIndex++;
      
      // 🔥 新增：创建成功后立即更新section状态为created
      await updateSpecSectionStatus(sheet.name, 'created');
      
      // 更新数据库全局status
      await updateSpecStatus(sheet.name);
      
      console.log(`✅ Sheet ${sheet.name} created successfully`);
      
      // 🔥 更新UI：检查是否所有sheet都创建完成
      if (currentSheetIndex >= sheetsToCreate.length) {
        // 所有完成，显示完成界面
        setTimeout(() => {
          showSpecCompleteUI();
          reportStatus('✅ All Excel worksheets created successfully!', 'success');
        }, 500);
      } else {
        // 还有未创建的sheet，更新进度UI
        showSpecProgressUI();
      }
      
    } catch (error) {
      console.error(`❌ Failed to create sheet ${sheet.name}:`, error);
      reportStatus(`Failed to create ${sheet.name}: ${error.message}`, 'error');
    }
  }

  // 🔥 新增：更新数据库中的Spec状态
  async function updateSpecStatus(sheetName) {
    try {
      if (!currentStudyId) {
        console.warn('⚠️ currentStudyId为空，跳过status更新');
        return;
      }
      
      console.log(`💾 更新Spec状态: ${sheetName}`);
      
      const response = await fetch(`${API_BASE_URL}/api/studies/${currentStudyId}/spec-status`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          status: sheetName,
          completed_at: new Date().toISOString()
        })
      });
      
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }
      
      const result = await response.json();
      
      if (result.success) {
        console.log(`✅ Spec状态更新成功: ${sheetName}`);
      } else {
        console.warn(`⚠️ Spec状态更新失败: ${result.message}`);
      }
      
    } catch (error) {
      console.error('❌ 更新Spec状态失败:', error);
      // 不抛出错误，让sheet创建流程继续
    }
  }

  // 🔥 新增：处理Create按钮点击（第一个sheet）
  async function handleCreateButtonClick() {
    const createBtn = qs('spec-create-btn');
    if (createBtn) {
      createBtn.disabled = true;
      createBtn.innerHTML = '<span class="ms-Button-label">Creating...</span>';
    }
    
    await createNextSheet();
  }

  // 🔥 新增：处理Next按钮点击（后续sheet）
  async function handleNextButtonClick() {
    const nextBtn = qs('spec-next-btn');
    if (nextBtn) {
      nextBtn.disabled = true;
      nextBtn.innerHTML = '<span class="ms-Button-label">Creating...</span>';
    }
    
    await createNextSheet();
  }

  // 🔥 新增：处理User Confirmed按钮点击
  async function handleConfirmButtonClick() {
    const confirmBtn = qs('spec-confirm-btn');
    if (confirmBtn) {
      confirmBtn.disabled = true;
      confirmBtn.innerHTML = '<span class="ms-Button-label">Saving...</span>';
    }
    
    const sheet = sheetsToCreate[currentSheetIndex - 1]; // 当前已创建的sheet
    
    try {
      console.log(`💾 开始确认保存表格: ${sheet.name}`);
      
      // 根据sheet名称调用对应的保存函数
      await saveCurrentSheetToDatabase(sheet.name);
      
      // 更新section状态为confirmed
      await updateSpecSectionStatus(sheet.name, 'confirmed');
      
      console.log(`✅ Sheet ${sheet.name} confirmed and saved`);
      
      // 启用Next按钮
      const nextBtn = qs('spec-next-btn');
      if (nextBtn) {
        nextBtn.disabled = false;
        nextBtn.style.opacity = '1';
      }
      
      // 更新确认按钮状态
      if (confirmBtn) {
        confirmBtn.innerHTML = '<span class="ms-Button-label">✅ Confirmed</span>';
        confirmBtn.disabled = true;
        confirmBtn.style.opacity = '0.8';
      }
      
    } catch (error) {
      console.error(`❌ Failed to confirm sheet ${sheet.name}:`, error);
      
      if (confirmBtn) {
        confirmBtn.disabled = false;
        confirmBtn.innerHTML = '<span class="ms-Button-label">User Confirmed</span>';
      }
      
      reportStatus(`Failed to save ${sheet.name}: ${error.message}`, 'error');
    }
  }

  // 🔥 新增：根据表格名称调用对应保存函数
  async function saveCurrentSheetToDatabase(sheetName) {
    console.log(`💾 开始保存当前表格到数据库: ${sheetName}`);
    
    switch (sheetName) {
      case 'Study':
        await saveStudyDataToDatabase();
        break;
      case 'Datasets':
        await saveDatasetsDataToDatabase();
        break;
      case 'Variables':
        await saveVariablesDataToDatabase();
        break;
      case 'TESTCD_Details':
        if (typeof window.SpecTESTCD !== 'undefined' && window.SpecTESTCD.readAndSaveTESTCDFromExcel) {
          await window.SpecTESTCD.readAndSaveTESTCDFromExcel();
        } else {
          throw new Error('SpecTESTCD.readAndSaveTESTCDFromExcel function not available');
        }
        break;
      case 'SUPP_Details':
        if (typeof window.SpecSUPP !== 'undefined' && window.SpecSUPP.readAndSaveSUPPFromExcel) {
          await window.SpecSUPP.readAndSaveSUPPFromExcel();
        } else {
          throw new Error('SpecSUPP.readAndSaveSUPPFromExcel function not available');
        }
        break;
      case 'TA_Data':
        if (typeof window.SpecTA !== 'undefined' && window.SpecTA.readAndSaveTAFromExcel) {
          await window.SpecTA.readAndSaveTAFromExcel();
        } else {
          throw new Error('SpecTA.readAndSaveTAFromExcel function not available');
        }
        break;
      case 'TE_Data':
        if (typeof window.SpecTE !== 'undefined' && window.SpecTE.readAndSaveTEFromExcel) {
          await window.SpecTE.readAndSaveTEFromExcel();
        } else {
          throw new Error('SpecTE.readAndSaveTEFromExcel function not available');
        }
        break;
      case 'TI_Data':
        if (typeof window.SpecTI !== 'undefined' && window.SpecTI.readAndSaveTIFromExcel) {
          await window.SpecTI.readAndSaveTIFromExcel();
        } else {
          throw new Error('SpecTI.readAndSaveTIFromExcel function not available');
        }
        break;
      case 'TS_Data':
        if (typeof window.SpecTS !== 'undefined' && window.SpecTS.readAndSaveTSFromExcel) {
          await window.SpecTS.readAndSaveTSFromExcel();
        } else {
          throw new Error('SpecTS.readAndSaveTSFromExcel function not available');
        }
        break;
      case 'Methods':
      case 'Updated Tracker':
      case 'TV_Data':
        console.log(`⚠️ ${sheetName} 保存功能暂未实现，仅更新状态`);
        // 这些表格暂时只更新状态，不做实际保存
        break;
      default:
        throw new Error(`未知的表格类型: ${sheetName}`);
    }
    
    console.log(`✅ ${sheetName} 保存完成`);
  }

  // 🔥 新增：更新section状态
  async function updateSpecSectionStatus(sectionName, status) {
    try {
      if (!currentStudyId) {
        console.warn('⚠️ currentStudyId为空，跳过section状态更新');
        return;
      }
      
      console.log(`💾 更新Section状态: ${sectionName} → ${status}`);
      
      const response = await fetch(`${API_BASE_URL}/api/studies/${currentStudyId}/spec-section-status`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          section: sectionName,
          status: status
        })
      });
      
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }
      
      const result = await response.json();
      
      if (result.success) {
        console.log(`✅ Section状态更新成功: ${sectionName} → ${status}`);
      } else {
        console.warn(`⚠️ Section状态更新失败: ${result.message}`);
        throw new Error(result.message);
      }
      
    } catch (error) {
      console.error('❌ 更新Section状态失败:', error);
      throw error;
    }
  }
  
  // 显示完成状态UI (与CRF annotation完成界面风格一致)
  function showSpecCompleteUI() {
    const container = qs('spec-container');
    if (!container) return;
    
    container.innerHTML = `
      <div class="spec-wrapper">
        <h3 class="ms-font-l">📋 Spec Processing</h3>

        <!-- Intro card with completion message (will be removed after dataset generation) -->
        <div id="spec-intro-card" class="annotation-content" style="text-align: center; padding: 40px 20px;">
          <div class="annotation-completed">
            <i class="ms-Icon ms-Icon--CheckMark ms-font-xxl" style="color: #107c10; margin-bottom: 20px;"></i>
            <h4 class="ms-font-l">Spec Processing Completed Successfully!</h4>
            <p class="ms-font-m" style="color: #605e5c; margin: 20px 0;">
              All Excel worksheets have been created and configured.<br/>
              Your spec analysis structure is now ready to use.
            </p>
            
            <div style="margin: 30px 0;">
              <p class="ms-font-s" style="color: #323130; margin-bottom: 20px;">
                ✅ 12 Excel worksheets created successfully<br/>
                📋 Headers configured with green background<br/>
                🎯 Ready for comprehensive spec analysis
              </p>
            </div>
          </div>
        </div>

        <!-- Gray button matching other Spec pages style -->
        <div style="text-align: center; margin-top: 24px;">
          <button id="generate-dataset-specs-btn" class="ms-Button" 
            style="font-size: 16px; padding: 12px 32px; border-radius: 8px; 
                   background: #f3f2f1; color: #201f1e; border: 1px solid #8a8886;
                   transition: background 0.2s;"
            onmouseover="this.style.background='#e1dfdd'"
            onmouseout="this.style.background='#f3f2f1'">
            <span class="ms-Button-label">🚀 Generate Dataset-Specific Specs</span>
          </button>
        </div>

        <!-- Dataset Specs download container (will hold download UI and "I'm Finished" button) -->
        <div id="spec-completion-page">
          <div id="dataset-specs-download-container"></div>
        </div>
      </div>
    `;
    
    // Bind button events
    setTimeout(() => {
      // Bind "Generate Dataset-Specific Specs" button
      const generateBtn = qs('generate-dataset-specs-btn');
      if (generateBtn && window.SpecDatasetSeparation) {
        generateBtn.addEventListener('click', () => {
          window.SpecDatasetSeparation.generateDatasetSpecificSpecs();
        });
      }
    }, 50);
  }
  
  // ===== 各个表格创建函数 =====
  
  // 创建Study表格
  async function createStudySheet() {
    await Excel.run(async (context) => {
      const workbook = context.workbook;
      const worksheet = workbook.worksheets.add('Study');
      
      // 设置表头
      const headers = ['Attribute', 'Value'];
      const headerRange = worksheet.getRange('A1:B1');
      headerRange.values = [headers];
      
      // 设置表头格式：草绿色背景 + 粗体 + 边框
      headerRange.format.font.bold = true;
      headerRange.format.font.size = 12;
      headerRange.format.fill.color = '#90EE90'; // 草绿色
      headerRange.format.borders.getItem('EdgeTop').style = 'Continuous';
      headerRange.format.borders.getItem('EdgeBottom').style = 'Continuous';
      headerRange.format.borders.getItem('EdgeLeft').style = 'Continuous';
      headerRange.format.borders.getItem('EdgeRight').style = 'Continuous';
      headerRange.format.borders.getItem('InsideVertical').style = 'Continuous';
      
      // 自动调整列宽
      headerRange.format.autofitColumns();
      
      await context.sync();
      console.log('✅ Study sheet headers created');
    });
    
    // 🔥 新增：填充Study表格数据
    await populateStudyData();
    
    // 🔥 新增：保存Study表格数据到数据库
    await saveStudyDataToDatabase();
  }
  
  // 🔥 新增：填充Study表格的数据
  async function populateStudyData() {
    try {
      console.log('📋 开始填充Study表格数据...');
      
      // 获取protocol信息（调用新的API）
      let protocolInfo = {
        sponsorName: null,
        protocolTitle: null,
        protocolNumber: null
      };
      
      if (currentStudyId) {
        try {
          console.log('🌐 调用API获取protocol信息...');
          const response = await fetch(`${API_BASE_URL}/api/studies/${currentStudyId}/protocol-info`);
          
          if (response.ok) {
            const result = await response.json();
            if (result.success && result.data) {
              protocolInfo = result.data;
              console.log('✅ 成功获取protocol信息:', protocolInfo);
            } else {
              console.warn('⚠️ API返回失败:', result.message);
            }
          } else {
            console.warn('⚠️ API调用失败:', response.status, response.statusText);
          }
        } catch (apiError) {
          console.error('❌ 调用protocol API失败:', apiError);
        }
      } else {
        console.warn('⚠️ 当前studyId为空，无法获取protocol信息');
      }
      
      // 准备数据行：6行属性和对应的值
      const studyData = [
        ['Sponsor Name', protocolInfo.sponsorName || ''],
        ['Protocol Title', protocolInfo.protocolTitle || ''],
        ['Protocol Number', protocolInfo.protocolNumber || ''],
        ['CDISC SDTM Model Version', '2.0'], // 🔥 确保显示为字符串"2.0"
        ['CDISC SDTM Implementation Guide (IG) Version', '3.4'], // 🔥 确保显示为字符串"3.4"
        ['CDISC SDTM Controlled Terminology Version', '2025-03-28'] // 🔥 标准日期格式
      ];
      
      // 填充数据到Excel
      await Excel.run(async (context) => {
        const worksheet = context.workbook.worksheets.getItem('Study');
        
        // 从A2开始填充数据（A1是表头）
        const dataRange = worksheet.getRange('A2:B7'); // 6行数据
        dataRange.values = studyData;
        
        // 设置数据行格式
        dataRange.format.borders.getItem('EdgeTop').style = 'Continuous';
        dataRange.format.borders.getItem('EdgeBottom').style = 'Continuous';
        dataRange.format.borders.getItem('EdgeLeft').style = 'Continuous';
        dataRange.format.borders.getItem('EdgeRight').style = 'Continuous';
        dataRange.format.borders.getItem('InsideVertical').style = 'Continuous';
        dataRange.format.borders.getItem('InsideHorizontal').style = 'Continuous';
        
        // 🔥 设置左对齐
        dataRange.format.horizontalAlignment = 'Left';
        
        // 自动调整列宽
        const fullRange = worksheet.getRange('A1:B7');
        fullRange.format.autofitColumns();
        
        await context.sync();
        console.log('✅ Study表格数据填充完成');
      });
      
    } catch (error) {
      console.error('❌ Study表格数据填充失败:', error);
      // 即使数据填充失败，也要确保表格结构存在
      await Excel.run(async (context) => {
        const worksheet = context.workbook.worksheets.getItem('Study');
        
        // 填充空白数据作为降级方案
        const fallbackData = [
          ['Sponsor Name', ''],
          ['Protocol Title', ''],
          ['Protocol Number', ''],
          ['CDISC SDTM Model Version', '2.0'], // 🔥 确保显示为字符串"2.0"
          ['CDISC SDTM Implementation Guide (IG) Version', '3.4'], // 🔥 确保显示为字符串"3.4"
          ['CDISC SDTM Controlled Terminology Version', '2025-03-28'] // 🔥 标准日期格式
        ];
        
        const dataRange = worksheet.getRange('A2:B7');
        dataRange.values = fallbackData;
        
        // 设置边框
        dataRange.format.borders.getItem('EdgeTop').style = 'Continuous';
        dataRange.format.borders.getItem('EdgeBottom').style = 'Continuous';
        dataRange.format.borders.getItem('EdgeLeft').style = 'Continuous';
        dataRange.format.borders.getItem('EdgeRight').style = 'Continuous';
        dataRange.format.borders.getItem('InsideVertical').style = 'Continuous';
        dataRange.format.borders.getItem('InsideHorizontal').style = 'Continuous';
        
        // 🔥 设置左对齐（降级方案）
        dataRange.format.horizontalAlignment = 'Left';
        
        const fullRange = worksheet.getRange('A1:B7');
        fullRange.format.autofitColumns();
        
        await context.sync();
        console.log('⚠️ Study表格使用降级数据填充');
      });
    }
  }
  
  // 🔥 新增：读取Study表格数据并保存到数据库
  async function saveStudyDataToDatabase() {
    try {
      console.log('💾 开始读取Study表格数据并保存到数据库...');
      
      const studyTableData = await Excel.run(async (context) => {
        const worksheet = context.workbook.worksheets.getItem('Study');
        
        // 读取完整的表格数据（包括表头和数据行）
        const usedRange = worksheet.getRange('A1:B7'); // 表头 + 6行数据
        usedRange.load(['values']);
        await context.sync();
        
        const allData = usedRange.values;
        
        if (!Array.isArray(allData) || allData.length < 2) {
          throw new Error('Study表格数据不完整');
        }
        
        // 分离表头和数据行
        const table_title = allData[0]; // 第一行是表头: ['Attribute', 'Value']
        const dataRows = allData.slice(1); // 剩下的6行是数据
        
        // 将数据行转换为对象数组格式 {Attribute: "...", Value: "..."}
        const table_content = dataRows.map(row => ({
          Attribute: row[0] || '',
          Value: row[1] || ''
        }));
        
        console.log('📋 读取到的表头:', table_title);
        console.log('📊 读取到的数据:', table_content);
        
        return {
          table_title,
          table_content
        };
      });
      
      // 调用后端API保存数据
      if (currentStudyId) {
        console.log('🌐 调用API保存Study表格数据...');
        
        const response = await fetch(`${API_BASE_URL}/api/studies/${currentStudyId}/spec-study-data`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json'
          },
          body: JSON.stringify(studyTableData)
        });
        
        if (!response.ok) {
          throw new Error(`API调用失败: ${response.status} ${response.statusText}`);
        }
        
        const result = await response.json();
        
        if (result.success) {
          console.log('✅ Study表格数据保存成功:', result.data);
        } else {
          throw new Error(result.message || 'API返回失败');
        }
      } else {
        console.warn('⚠️ 当前studyId为空，无法保存到数据库');
      }
      
    } catch (error) {
      console.error('❌ 保存Study表格数据到数据库失败:', error);
      // 不抛出错误，让流程继续
    }
  }
  
  // 创建Updated Tracker表格
  async function createUpdatedTrackerSheet() {
    await Excel.run(async (context) => {
      const workbook = context.workbook;
      const worksheet = workbook.worksheets.add('Updated Tracker');
      
      // 设置表头
      const headers = [
        'Changed by (initials)', 
        'Date Specs Updated', 
        'Domain Updated', 
        'Update Description'
      ];
      const headerRange = worksheet.getRange('A1:D1');
      headerRange.values = [headers];
      
      // 设置表头格式：草绿色背景 + 粗体 + 边框
      headerRange.format.font.bold = true;
      headerRange.format.font.size = 12;
      headerRange.format.fill.color = '#90EE90'; // 草绿色
      headerRange.format.borders.getItem('EdgeTop').style = 'Continuous';
      headerRange.format.borders.getItem('EdgeBottom').style = 'Continuous';
      headerRange.format.borders.getItem('EdgeLeft').style = 'Continuous';
      headerRange.format.borders.getItem('EdgeRight').style = 'Continuous';
      headerRange.format.borders.getItem('InsideVertical').style = 'Continuous';
      
      // 自动调整列宽
      headerRange.format.autofitColumns();
      
      // 🔥 添加AutoFilter功能
      headerRange.worksheet.autoFilter.apply(headerRange);
      
      await context.sync();
      console.log('✅ Updated Tracker sheet created');
    });
  }
  
  // 创建Datasets表格
  async function createDatasetsSheet() {
    await Excel.run(async (context) => {
      const workbook = context.workbook;
      const worksheet = workbook.worksheets.add('Datasets');
      
      // 设置表头
      const headers = [
        'Dataset', 
        'Description', 
        'Class', 
        'Structure', 
        'Purpose', 
        'Key Variables'
      ];
      const headerRange = worksheet.getRange('A1:F1');
      headerRange.values = [headers];
      
      // 设置表头格式：草绿色背景 + 粗体 + 边框
      headerRange.format.font.bold = true;
      headerRange.format.font.size = 12;
      headerRange.format.fill.color = '#90EE90'; // 草绿色
      headerRange.format.borders.getItem('EdgeTop').style = 'Continuous';
      headerRange.format.borders.getItem('EdgeBottom').style = 'Continuous';
      headerRange.format.borders.getItem('EdgeLeft').style = 'Continuous';
      headerRange.format.borders.getItem('EdgeRight').style = 'Continuous';
      headerRange.format.borders.getItem('InsideVertical').style = 'Continuous';
      
      // 自动调整列宽
      headerRange.format.autofitColumns();
      
      // 🔥 添加AutoFilter功能
      headerRange.worksheet.autoFilter.apply(headerRange);
      
      await context.sync();
      console.log('✅ Datasets sheet headers created');
    });
    
    // 🔥 新增：填充Datasets表格数据
    await populateDatasetsData();
  }
  
  // 🔥 新增：填充Datasets表格的数据
  async function populateDatasetsData() {
    try {
      console.log('📋 开始填充Datasets表格数据...');
      
      // Step 1: 获取SDTMIG Dataset列表
      const datasetsList = await fetchSDTMIGDatasetsList();
      if (!datasetsList || datasetsList.length === 0) {
        console.warn('⚠️ 无法获取Dataset列表，跳过数据填充');
        return;
      }
      
      console.log(`📊 获取到 ${datasetsList.length} 个Datasets`);
      
      // Step 2: 为每个Dataset查找详细信息
      const datasetsData = [];
      
      for (let i = 0; i < datasetsList.length; i++) {
        const datasetName = datasetsList[i];
        console.log(`🔍 查找Dataset ${i+1}/${datasetsList.length}: ${datasetName}`);
        
        try {
          const datasetInfo = await fetchSDTMIGDatasetInfo(datasetName);
          if (datasetInfo) {
            datasetsData.push([
              datasetInfo.Dataset,
              datasetInfo.Description,
              datasetInfo.Class,
              datasetInfo.Structure,
              datasetInfo.Purpose,
              datasetInfo['Key Variables']
            ]);
          } else {
            // 如果查找失败，使用空白行
            datasetsData.push([datasetName, '', '', '', 'Tabulation', '']);
          }
        } catch (lookupError) {
          console.error(`❌ 查找Dataset ${datasetName} 信息失败:`, lookupError.message);
          // 使用空白行作为降级
          datasetsData.push([datasetName, '', '', '', 'Tabulation', '']);
        }
      }
      
      console.log(`📊 准备填充 ${datasetsData.length} 行数据到Excel`);
      
      // Step 3: 填充数据到Excel
      if (datasetsData.length > 0) {
        await Excel.run(async (context) => {
          const worksheet = context.workbook.worksheets.getItem('Datasets');
          
          // 计算数据范围 (A2开始，因为A1是表头)
          const dataRange = worksheet.getRange(`A2:F${1 + datasetsData.length}`);
          dataRange.values = datasetsData;
          
          // 设置数据行格式
          dataRange.format.borders.getItem('EdgeTop').style = 'Continuous';
          dataRange.format.borders.getItem('EdgeBottom').style = 'Continuous';
          dataRange.format.borders.getItem('EdgeLeft').style = 'Continuous';
          dataRange.format.borders.getItem('EdgeRight').style = 'Continuous';
          dataRange.format.borders.getItem('InsideVertical').style = 'Continuous';
          dataRange.format.borders.getItem('InsideHorizontal').style = 'Continuous';
          
          // 设置左对齐
          dataRange.format.horizontalAlignment = 'Left';
          
          // 自动调整列宽
          const fullRange = worksheet.getRange(`A1:F${1 + datasetsData.length}`);
          fullRange.format.autofitColumns();
          
          await context.sync();
          console.log('✅ Datasets表格数据填充完成');
        });
      }
      
      // Step 4: 保存到数据库 (参考Study表格的保存逻辑)
      await saveDatasetsDataToDatabase();
      
    } catch (error) {
      console.error('❌ Datasets表格数据填充失败:', error);
      // 即使数据填充失败，也确保基础表格结构存在
    }
  }
  
  // 🔥 新增：获取SDTMIG Dataset列表 (包含CRF Exp数据)
  async function fetchSDTMIGDatasetsList() {
    try {
      console.log('🌐 调用API获取SDTMIG Dataset列表 (包含CRF数据)...');
      
      if (!currentStudyId) {
        console.error('❌ 当前studyId为空，无法获取Dataset列表');
        return null;
      }
      
      const response = await fetch(`${API_BASE_URL}/api/studies/${currentStudyId}/sdtmig-datasets-list`);
      
      if (!response.ok) {
        throw new Error(`API调用失败: ${response.status} ${response.statusText}`);
      }
      
      const result = await response.json();
      
      if (result.success && result.data && Array.isArray(result.data.datasets)) {
        console.log(`✅ 成功获取 ${result.data.datasets.length} 个Datasets`);
        console.log('📊 Dataset来源统计:', {
          req: result.data.req_count,
          perm: result.data.perm_count,
          crf_exp: result.data.crf_exp_count,
          total: result.data.total_count
        });
        
        if (result.data.breakdown) {
          console.log('📋 CRF Exp Datasets:', result.data.breakdown.crf_exp_datasets);
        }
        
        return result.data.datasets;
      } else {
        throw new Error(result.message || 'API返回数据格式错误');
      }
      
    } catch (error) {
      console.error('❌ 获取SDTMIG Dataset列表失败:', error);
      return null;
    }
  }
  
  // 🔥 新增：查找特定Dataset的详细信息
  async function fetchSDTMIGDatasetInfo(datasetName) {
    try {
      const response = await fetch(`${API_BASE_URL}/api/sdtmig-dataset-info/${encodeURIComponent(datasetName)}`);
      
      if (!response.ok) {
        throw new Error(`API调用失败: ${response.status} ${response.statusText}`);
      }
      
      const result = await response.json();
      
      if (result.success && result.data && result.data.dataset_info) {
        return result.data.dataset_info;
      } else {
        throw new Error(result.message || 'Dataset信息不存在');
      }
      
    } catch (error) {
      console.error(`❌ 查找Dataset ${datasetName} 信息失败:`, error);
      return null;
    }
  }
  
  // 🔥 新增：保存Datasets表格数据到数据库
  async function saveDatasetsDataToDatabase() {
    try {
      console.log('💾 开始保存Datasets表格数据到数据库...');
      
      const datasetsTableData = await Excel.run(async (context) => {
        const worksheet = context.workbook.worksheets.getItem('Datasets');
        
        // 读取完整的表格数据
        const usedRange = worksheet.getUsedRange();
        usedRange.load(['values']);
        await context.sync();
        
        const allData = usedRange.values;
        
        if (!Array.isArray(allData) || allData.length < 2) {
          throw new Error('Datasets表格数据不完整');
        }
        
        // 分离表头和数据行
        const table_title = allData[0]; // 第一行是表头
        const dataRows = allData.slice(1); // 剩下的是数据行
        
        // 转换为对象数组格式
        const table_content = dataRows.map(row => ({
          Dataset: row[0] || '',
          Description: row[1] || '',
          Class: row[2] || '',
          Structure: row[3] || '',
          Purpose: row[4] || '',
          'Key Variables': row[5] || ''
        }));
        
        console.log('📋 读取到Datasets表头:', table_title);
        console.log('📊 读取到Datasets数据:', table_content.length, '行');
        
        return {
          table_title,
          table_content
        };
      });
      
      // 调用后端API保存数据 (需要创建新的API)
      if (currentStudyId) {
        console.log('🌐 调用API保存Datasets表格数据...');
        
        const response = await fetch(`${API_BASE_URL}/api/studies/${currentStudyId}/spec-datasets-data`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json'
          },
          body: JSON.stringify(datasetsTableData)
        });
        
        if (response.ok) {
          const result = await response.json();
          if (result.success) {
            console.log('✅ Datasets表格数据保存成功');
          } else {
            console.warn('⚠️ Datasets数据保存返回失败:', result.message);
          }
        } else {
          console.warn('⚠️ Datasets数据保存API调用失败:', response.status);
        }
      } else {
        console.warn('⚠️ 当前studyId为空，无法保存Datasets数据到数据库');
      }
      
    } catch (error) {
      console.error('❌ 保存Datasets表格数据到数据库失败:', error);
      // 不抛出错误，让流程继续
    }
  }
  
  // 创建Variables表格
  async function createVariablesSheet() {
    await Excel.run(async (context) => {
      const workbook = context.workbook;
      const worksheet = workbook.worksheets.add('Variables');
      
      // 设置表头 (新增Core字段)
      const headers = [
        'Dataset', 
        'Variable', 
        'Label', 
        'Data Type', 
        'Length', 
        'Format', 
        'Origin', 
        'Method Keyword', 
        'Source/Derivation',
        'Core'
      ];
      const headerRange = worksheet.getRange('A1:J1');
      headerRange.values = [headers];
      
      // 设置表头格式：草绿色背景 + 粗体 + 边框
      headerRange.format.font.bold = true;
      headerRange.format.font.size = 12;
      headerRange.format.fill.color = '#90EE90'; // 草绿色
      headerRange.format.borders.getItem('EdgeTop').style = 'Continuous';
      headerRange.format.borders.getItem('EdgeBottom').style = 'Continuous';
      headerRange.format.borders.getItem('EdgeLeft').style = 'Continuous';
      headerRange.format.borders.getItem('EdgeRight').style = 'Continuous';
      headerRange.format.borders.getItem('InsideVertical').style = 'Continuous';
      
      // 自动调整列宽
      headerRange.format.autofitColumns();
      
      // 🔥 添加AutoFilter功能
      headerRange.worksheet.autoFilter.apply(headerRange);
      
      await context.sync();
      console.log('✅ Variables sheet headers created');
    });
    
    // 🔥 新增：填充Variables表格数据
    await populateVariablesDataUnified();
  }
  
  // // 🔥 重构：填充Variables表格的数据 (新的两阶段逻辑)
  // async function populateVariablesData() {
  //   try {
  //     console.log('📋 开始填充Variables表格数据 (SDTMIG + CRF两阶段)...');
  //     
  //     // Phase 1: 获取SDTMIG Variables (Core='Req'或'Perm')
  //     console.log('🔍 Phase 1: 处理SDTMIG标准Variables...');
  //     const sdtmigVariables = await fetchSDTMIGVariablesReqPerm();
  //     if (!sdtmigVariables || sdtmigVariables.length === 0) {
  //       console.warn('⚠️ 无法获取SDTMIG Variables，跳过标准Variables处理');
  //     }
  //     
  //     // 获取CRF数据用于验证
  //     const crfVariablesData = await fetchCRFVariablesData();
  //     if (!crfVariablesData || crfVariablesData.length === 0) {
  //       console.warn('⚠️ 无法获取CRF Variables数据');
  //     }
  //     
  //     // 获取SDTMIG Variables_Exp数据用于CRF Variables信息补充
  //     const variablesExp = await fetchSDTMIGVariablesExp();
  //     if (!variablesExp || variablesExp.length === 0) {
  //       console.warn('⚠️ 无法获取Variables_Exp数据，CRF Variables的Label和Data Type将为空');
  //     }
  //     
  //     // 获取Study数据用于特殊规则 (AE.STUDYID, AE.DOMAIN)
  //     const studyData = await readStudyDataFromExcel();
  //     if (!studyData || studyData.length === 0) {
  //       console.warn('⚠️ 无法获取Study数据，特殊规则将不生效');
  //     }
  //     
  //     let processedVariables = [];
  //     
  //     // 处理SDTMIG Variables
  //     if (sdtmigVariables && sdtmigVariables.length > 0 && crfVariablesData) {
  //       processedVariables = processSDTMIGVariables(sdtmigVariables, crfVariablesData, studyData);
  //       console.log(`📊 Phase 1完成: ${processedVariables.length} 个SDTMIG Variables`);
  //     }
  //     
  //     // Phase 2: 处理CRF独有Variables
  //     console.log('🔍 Phase 2: 处理CRF独有Variables...');
  //     
  //     // 读取Datasets列表
  //     const datasetsList = await readDatasetsFromExcel();
  //     if (!datasetsList || datasetsList.length === 0) {
  //       console.warn('⚠️ 无法获取Datasets列表，跳过CRF Variables处理');
  //     } else if (crfVariablesData) {
  //       // 合并CRF独有Variables (去重逻辑自动处理)
  //       processedVariables = processVariablesFromCRF(processedVariables, datasetsList, crfVariablesData, variablesExp);
  //       console.log(`📊 Phase 2完成: 最终 ${processedVariables.length} 个Variables`);
  //     }
  //     
  //     // Phase 3: 填充到Excel和保存到数据库
  //     if (processedVariables.length > 0) {
  //       console.log('🔍 Phase 3: 填充Excel和保存数据库...');
  //       await fillVariablesToExcel(processedVariables);
  //       await saveVariablesDataToDatabase();
  //     } else {
  //       console.warn('⚠️ 没有处理的Variables数据，跳过Excel填充');
  //     }
  //     
  //   } catch (error) {
  //     console.error('❌ Variables表格数据填充失败:', error);
  //   }
  // }
  
  // 🔥 新增：从Excel Datasets表格中读取Dataset列表
  async function readDatasetsFromExcel() {
    try {
      console.log('📋 从Excel Datasets表格读取Dataset列表...');
      
      return await Excel.run(async (context) => {
        const worksheet = context.workbook.worksheets.getItem('Datasets');
        const usedRange = worksheet.getUsedRange();
        usedRange.load(['values']);
        await context.sync();
        
        const allData = usedRange.values;
        
        if (!Array.isArray(allData) || allData.length < 2) {
          throw new Error('Datasets表格数据不完整');
        }
        
        // 提取Dataset列表 (第一列，跳过表头)
        const datasetsList = allData.slice(1).map(row => row[0]).filter(Boolean);
        
        console.log('📊 从Excel读取到的Datasets:', datasetsList);
        return datasetsList;
      });
      
    } catch (error) {
      console.error('❌ 从Excel读取Datasets失败:', error);
      return null;
    }
  }

  // 🔥 新增：从Excel Study表格中读取数据用于特殊规则
  async function readStudyDataFromExcel() {
    try {
      console.log('📋 从Excel Study表格读取数据 (用于特殊规则)...');
      
      return await Excel.run(async (context) => {
        const worksheet = context.workbook.worksheets.getItem('Study');
        const usedRange = worksheet.getUsedRange();
        usedRange.load(['values']);
        await context.sync();
        
        const allData = usedRange.values;
        
        if (!Array.isArray(allData) || allData.length < 3) {
          throw new Error('Study表格数据不完整，至少需要3行数据');
        }
        
        // 转换为table_content格式 (跳过表头，构建对象数组)
        const studyData = allData.slice(1).map(row => ({
          Attribute: row[0] || '',
          Value: row[1] || ''
        }));
        
        console.log('📊 从Excel读取到的Study数据:', studyData);
        console.log(`🎯 Protocol Number (第3行): "${studyData[2]?.Value || 'N/A'}"`);
        
        return studyData;
      });
      
    } catch (error) {
      console.error('❌ 从Excel读取Study数据失败:', error);
      return null;
    }
  }

  // 🔥 新增：提取STUDYID值的复用函数 (从Study表格第3行Protocol Number)
  async function getStudyIdValue() {
    try {
      const studyData = await readStudyDataFromExcel();
      return studyData?.[2]?.Value || '';
    } catch (error) {
      console.error('❌ 获取STUDYID值失败:', error);
      return '';
    }
  }
  
  // // 🔥 新增：获取SDTMIG Variables (Core='Req'或'Perm')
  // async function fetchSDTMIGVariablesReqPerm() {
  //   try {
  //     console.log('🌐 调用API获取SDTMIG Variables (Req+Perm)...');
  //     
  //     const response = await fetch(`${API_BASE_URL}/api/sdtmig-variables-reqperm`);
  //     
  //     if (!response.ok) {
  //       throw new Error(`API调用失败: ${response.status} ${response.statusText}`);
  //     }
  //     
  //     const result = await response.json();
  //     
  //     if (result.success && result.data && Array.isArray(result.data.variables)) {
  //       console.log('✅ 成功获取SDTMIG Variables');
  //       console.log('📊 SDTMIG统计:', result.data.statistics);
  //       return result.data.variables;
  //     } else {
  //       throw new Error(result.message || 'API返回数据格式错误');
  //     }
  //     
  //   } catch (error) {
  //     console.error('❌ 获取SDTMIG Variables失败:', error);
  //     return null;
  //   }
  // }

  // // 🔥 新增：获取SDTMIG Variables_Exp数据用于CRF Variables信息补充
  // async function fetchSDTMIGVariablesExp() {
  //   try {
  //     console.log('🌐 调用API获取SDTMIG Variables_Exp数据...');
  //     
  //     const response = await fetch(`${API_BASE_URL}/api/sdtmig-variables-exp`);
  //     
  //     if (!response.ok) {
  //       throw new Error(`API调用失败: ${response.status} ${response.statusText}`);
  //     }
  //     
  //     const result = await response.json();
  //     
  //     if (result.success && result.data && Array.isArray(result.data.variables_exp)) {
  //       console.log('✅ 成功获取SDTMIG Variables_Exp数据');
  //       console.log('📊 Variables_Exp统计:', result.data.statistics);
  //       return result.data.variables_exp;
  //     } else {
  //       throw new Error(result.message || 'API返回数据格式错误');
  //     }
  //     
  //   } catch (error) {
  //     console.error('❌ 获取SDTMIG Variables_Exp数据失败:', error);
  //     return null;
  //   }
  // }

  // 🔥 新增：获取CRF Variables数据
  async function fetchCRFVariablesData() {
    try {
      console.log('🌐 调用API获取CRF Variables数据...');
      
      if (!currentStudyId) {
        console.error('❌ 当前studyId为空，无法获取CRF数据');
        return null;
      }
      
      const response = await fetch(`${API_BASE_URL}/api/studies/${currentStudyId}/crf-variables-data`);
      
      if (!response.ok) {
        throw new Error(`API调用失败: ${response.status} ${response.statusText}`);
      }
      
      const result = await response.json();
      
      if (result.success && result.data && Array.isArray(result.data.mapping_data)) {
        console.log('✅ 成功获取CRF Variables数据');
        console.log('📊 CRF统计:', result.data.statistics);
        return result.data.mapping_data;
      } else {
        throw new Error(result.message || 'API返回数据格式错误');
      }
      
    } catch (error) {
      console.error('❌ 获取CRF Variables数据失败:', error);
      return null;
    }
  }

  // 🔥 新增：获取所有SDTMIG Variables（不分Core类型）
  async function fetchAllSDTMIGVariables() {
    try {
      console.log('🌐 调用API获取所有SDTMIG Variables...');
      
      const response = await fetch(`${API_BASE_URL}/api/sdtmig-variables-all`);
      
      if (!response.ok) {
        throw new Error(`API调用失败: ${response.status} ${response.statusText}`);
      }
      
      const result = await response.json();
      
      if (result.success && result.data && Array.isArray(result.data.variables)) {
        console.log('✅ 成功获取所有SDTMIG Variables');
        console.log('📊 SDTMIG统计:', result.data.statistics);
        return result.data.variables;
      } else {
        throw new Error(result.message || 'API返回数据格式错误');
      }
      
    } catch (error) {
      console.error('❌ 获取所有SDTMIG Variables失败:', error);
      return null;
    }
  }

  // 🔥 新增：提取CRF Variable Matrix
  async function extractCRFVariableMatrix() {
    try {
      console.log('📋 构建CRF Variable Matrix...');
      
      const crfMappingData = await fetchCRFVariablesData();
      if (!crfMappingData || crfMappingData.length === 0) {
        console.warn('⚠️ 无法获取CRF数据，返回空矩阵');
        return [];
      }
      
      // 构建Variable Matrix: [Form_Name, Form_Mapping, Page_Number, Question_Variable]
      const variableMatrix = crfMappingData.map(mapping => ({
        Form_Name: mapping.form_name || mapping.form_key,
        Form_Mapping: mapping.processed_dataset, // 已预处理的Dataset名称
        Page_Number: mapping.page_number,
        Question_Variable: mapping.question_variable
      }));
      
      console.log('📊 CRF Variable Matrix统计:', {
        total_mappings: variableMatrix.length,
        unique_forms: [...new Set(variableMatrix.map(v => v.Form_Name))].length,
        unique_datasets: [...new Set(variableMatrix.map(v => v.Form_Mapping))].length,
        unique_variables: [...new Set(variableMatrix.map(v => v.Question_Variable))].length
      });
      
      return variableMatrix;
      
    } catch (error) {
      console.error('❌ 构建CRF Variable Matrix失败:', error);
      return [];
    }
  }

  // 🔥 新增：统一处理Variables逻辑（基于用户新逻辑）
  function processVariablesUnified(datasets, allSDTMIGVariables, crfVariableMatrix, studyData) {
    console.log('🔄 开始统一处理Variables逻辑...');
    
    const result = [];
    
    // 双重循环：datasets × sdtmigVariables
    datasets.forEach(dataset => {
      console.log(`🔍 处理Dataset: ${dataset}`);
      
      allSDTMIGVariables.forEach(sdtmigVar => {
        if (sdtmigVar['Dataset Name'] === dataset) {
          const variable = sdtmigVar['Variable Name'];
          const core = sdtmigVar.Core;
          
          console.log(`  📋 检查Variable: ${dataset}.${variable} (Core: ${core})`);
          
          // 查找CRF中的使用情况
          const crfUsages = crfVariableMatrix.filter(crf => 
            crf.Form_Mapping === dataset && crf.Question_Variable === variable
          );
          
          // 检查result中是否已存在[Dataset, Variable]组合
          const existingIndex = result.findIndex(
            r => r.Dataset === dataset && r.Variable === variable
          );
          
          // 条件分支处理
          if (core === 'Req' || core === 'Exp') {
            // 情况1: Core = Req or Exp (总是处理，不管是否在CRF中使用)
            if (existingIndex === -1) {
              // 情况1.1: 未在result中出现过 - 新建
              const newVariable = {
                Dataset: dataset,
                Variable: variable,
                Label: sdtmigVar['Variable Label'] || '',
                'Data Type': sdtmigVar['Type'] || '',
                Length: '',
                Format: '',
                Origin: '',
                'Method Keyword': '',
                'Source/Derivation': '',
                Core: core
              };
              
              // 检查CRF使用情况来设置Origin和Source/Derivation
              if (crfUsages.length > 0) {
                // 在CRF中使用 → 设置Origin和Source
                if (crfUsages.length === 1) {
                  newVariable.Origin = `CRF Page ${crfUsages[0].Page_Number}`;
                  newVariable['Source/Derivation'] = `Map to RAW.${crfUsages[0].Form_Name}.${variable}`;
                } else {
                  const origins = crfUsages.map(usage => `Page ${usage.Page_Number}`);
                  newVariable.Origin = `CRF ${origins.join('; ')}`;
                  
                  const sources = crfUsages.map(usage => `Map to RAW.${usage.Form_Name}.${variable}`);
                  newVariable['Source/Derivation'] = sources.join('\n');
                }
              }
              // 如果不在CRF中使用，Origin和Source/Derivation保持空
              
              result.push(newVariable);
              console.log(`    ✅ 新建Req/Exp Variable: ${dataset}.${variable} (CRF使用: ${crfUsages.length > 0})`);
              
            } else {
              // 情况1.2: 已在result中出现过 - 合并（只有在CRF中使用时才合并）
              if (crfUsages.length > 0) {
                const existing = result[existingIndex];
                const newPages = crfUsages.map(usage => `Page ${usage.Page_Number}`);
                existing.Origin += `; ${newPages.join('; ')}`;
                
                const newSources = crfUsages.map(usage => `Map to RAW.${usage.Form_Name}.${variable}`);
                if (existing['Source/Derivation'] === '') {
                  existing['Source/Derivation'] = newSources.join('\n');
                } else {
                  existing['Source/Derivation'] += '\n' + newSources.join('\n');
                }
                
                console.log(`    🔄 合并Req/Exp Variable: ${dataset}.${variable}`);
              }
            }
          } else if (core === 'Perm') {
            // 情况2: Core = Perm（只要CRF中出现的）
            if (crfUsages.length > 0) {
              if (existingIndex === -1) {
                // 情况2.1: 在CRF中出现，未在result中出现过 - 新建
                const newVariable = {
                  Dataset: dataset,
                  Variable: variable,
                  Label: sdtmigVar['Variable Label'] || '',
                  'Data Type': sdtmigVar['Type'] || '',
                  Length: '',
                  Format: '',
                  Origin: `CRF Page ${crfUsages[0].Page_Number}`,
                  'Method Keyword': '',
                  'Source/Derivation': `Map to RAW.${crfUsages[0].Form_Name}.${variable}`,
                  Core: core
                };
                
                // 处理多个CRF使用情况
                if (crfUsages.length > 1) {
                  const origins = crfUsages.map(usage => `Page ${usage.Page_Number}`);
                  newVariable.Origin = `CRF ${origins.join('; ')}`;
                  
                  const sources = crfUsages.map(usage => `Map to RAW.${usage.Form_Name}.${variable}`);
                  newVariable['Source/Derivation'] = sources.join('\n');
                }
                
                result.push(newVariable);
                console.log(`    ✅ 新建Perm Variable: ${dataset}.${variable}`);
                
              } else {
                // 情况2.2: 在CRF中出现，也在result中出现过 - 合并
                const existing = result[existingIndex];
                const newPages = crfUsages.map(usage => `Page ${usage.Page_Number}`);
                existing.Origin += `; ${newPages.join('; ')}`;
                
                const newSources = crfUsages.map(usage => `Map to RAW.${usage.Form_Name}.${variable}`);
                if (existing['Source/Derivation'] === '') {
                  existing['Source/Derivation'] = newSources.join('\n');
                } else {
                  existing['Source/Derivation'] += '\n' + newSources.join('\n');
                }
                
                console.log(`    🔄 合并Perm Variable: ${dataset}.${variable}`);
              }
            }
          }
        }
      });
    });
    
    // 特殊规则处理
    result.forEach(variable => {
      if (variable.Variable === 'STUDYID' && studyData && studyData.length >= 3) {
        variable.Origin = 'Protocol';
        variable['Source/Derivation'] = `Set to "${studyData[2]?.Value || ''}"`;
        console.log(`  🎯 应用${variable.Dataset}.STUDYID特殊规则`);
      } else if (variable.Variable === 'DOMAIN') {
        variable.Origin = 'Assigned';
        variable['Method Keyword'] = 'USUBJID';
        variable['Source/Derivation'] = `Set to "${variable.Dataset}"`;
        console.log(`  🎯 应用${variable.Dataset}.DOMAIN特殊规则`);
      }
    });
    
    console.log('✅ 统一Variables处理完成');
    console.log('📊 最终Variables统计:', {
      total_variables: result.length,
      datasets_covered: [...new Set(result.map(v => v.Dataset))].length,
      core_distribution: {
        Req: result.filter(v => v.Core === 'Req').length,
        Perm: result.filter(v => v.Core === 'Perm').length,
        Exp: result.filter(v => v.Core === 'Exp').length
      }
    });
    
    return result;
  }

  // 🔥 新增：统一Variables数据填充主控制函数
  async function populateVariablesDataUnified() {
    try {
      console.log('📋 开始统一Variables数据填充...');
      
      // 获取所有必要数据
      const datasets = await readDatasetsFromExcel();
      const allSDTMIGVariables = await fetchAllSDTMIGVariables();
      const crfVariableMatrix = await extractCRFVariableMatrix();
      const studyData = await readStudyDataFromExcel();
      
      console.log('📊 数据获取完成:', {
        datasets_count: datasets?.length || 0,
        sdtmig_variables_count: allSDTMIGVariables?.length || 0,
        crf_matrix_count: crfVariableMatrix?.length || 0,
        study_data_count: studyData?.length || 0
      });
      
      // 统一处理Variables
      const result = processVariablesUnified(datasets, allSDTMIGVariables, crfVariableMatrix, studyData);
      
      // 填充Excel和保存数据库
      if (result.length > 0) {
        console.log('🔍 填充Excel和保存数据库...');
        await fillVariablesToExcel(result);
        await saveVariablesDataToDatabase();
      } else {
        console.warn('⚠️ 没有处理的Variables数据');
      }
      
    } catch (error) {
      console.error('❌ 统一Variables数据填充失败:', error);
    }
  }
  
  // // 🔥 新增：处理SDTMIG Variables + CRF验证
  // function processSDTMIGVariables(sdtmigVariables, crfMappingData, studyData = null) {
  //   console.log('🔄 开始处理SDTMIG Variables (Req+Perm) + CRF验证 + 特殊规则...');
  //   
  //   const variablesOutput = [];
  //   
  //   // Phase 1: 处理SDTMIG标准Variables
  //   sdtmigVariables.forEach(sdtmigVar => {
  //     const dataset = sdtmigVar['Dataset Name'];
  //     const variable = sdtmigVar['Variable Name'];
  //     
  //     console.log(`📋 处理SDTMIG Variable: ${dataset}.${variable} (${sdtmigVar.Core})`);
  //     
  //     // 填充基本信息
  //     const newVariable = {
  //       Dataset: dataset,
  //       Variable: variable,
  //       Label: sdtmigVar['Variable Label'] || '',
  //       'Data Type': sdtmigVar['Type'] || '',
  //       Length: '',
  //       Format: '',
  //       Origin: '', // 先设为空，后面检查CRF使用情况
  //       'Method Keyword': '',
  //       'Source/Derivation': '',
  //       Core: sdtmigVar.Core
  //     };
  //     
  //     // 检查该Variable是否在CRF中实际使用
  //     const crfUsages = crfMappingData.filter(mapping => 
  //       mapping.processed_dataset === dataset && 
  //       mapping.question_variable === variable
  //     );
  //     
  //     if (crfUsages.length > 0) {
  //       // 在CRF中使用 → 设置Origin
  //       const pages = [...new Set(crfUsages.map(usage => usage.page_number))];
  //       newVariable.Origin = pages.map(page => `CRF Page ${page}`).join(', ');
  //       
  //       // 🔥 新增：设置Source/Derivation映射 "Map to RAW.form_key.variable_name"
  //       const mappings = crfUsages.map(usage => 
  //         `Map to RAW.${usage.form_key}.${usage.question_variable}`
  //       );
  //       newVariable['Source/Derivation'] = mappings.join('\n');
  //       
  //       console.log(`  ✅ CRF中使用: ${dataset}.${variable} (${newVariable.Origin})`);
  //       console.log(`  📋 Source/Derivation映射: ${mappings.length} 个映射`);
  //     } else {
  //       // 未在CRF中使用 → Origin保持空
  //       console.log(`  ⚪ CRF中未使用: ${dataset}.${variable}`);
  //     }
  //     
  //     // 🔥 特殊规则：AE.STUDYID 和 AE.DOMAIN
  //     if (dataset === 'AE' && variable === 'STUDYID' && studyData && studyData.length >= 3) {
  //       // 特殊规则1: AE.STUDYID → Origin=Protocol, Source/Derivation=Set to "Study[2].Value"
  //       newVariable.Origin = 'Protocol';
  //       newVariable['Source/Derivation'] = `Set to "${studyData[2]?.Value || ''}"`;
  //       console.log(`  🎯 应用AE.STUDYID特殊规则: Origin=Protocol, Source/Derivation=Set to "${studyData[2]?.Value || ''}"`);
  //     } else if (dataset === 'AE' && variable === 'DOMAIN') {
  //       // 特殊规则2: AE.DOMAIN → Origin=Assigned, Method Keyword=USUBJID, Source/Derivation=Set to "AE"
  //       newVariable.Origin = 'Assigned';
  //       newVariable['Method Keyword'] = 'USUBJID';
  //       newVariable['Source/Derivation'] = 'Set to "AE"';
  //       console.log(`  🎯 应用AE.DOMAIN特殊规则: Origin=Assigned, Method Keyword=USUBJID, Source/Derivation=Set to "AE"`);
  //     }
  //     
  //     variablesOutput.push(newVariable);
  //   });
  //   
  //   console.log('✅ SDTMIG Variables处理完成');
  //   console.log('📊 SDTMIG Variables统计:', {
  //     total_sdtmig_variables: variablesOutput.length,
  //     used_in_crf: variablesOutput.filter(v => v.Origin !== '').length,
  //     not_used_in_crf: variablesOutput.filter(v => v.Origin === '').length
  //   });
  //   
  //   return variablesOutput;
  // }

  // // 🔥 修改：处理CRF独有Variables (原有逻辑保持)
  // function processVariablesFromCRF(existingVariables, datasetsList, crfMappingData, variablesExp = null) {
  //   console.log('🔄 开始处理CRF独有Variables (去重逻辑 + Exp信息补充)...');
  //   
  //   const variablesOutput = [...existingVariables]; // 从已有Variables开始
  //   
  //   // 对于每个Dataset
  //   datasetsList.forEach(targetDataset => {
  //     console.log(`🔍 处理Dataset: ${targetDataset}`);
  //     
  //     // 在CRF数据中查找匹配的Mapping
  //     const matchingMappings = crfMappingData.filter(mapping => 
  //       mapping.processed_dataset === targetDataset
  //     );
  //     
  //     console.log(`  📊 找到 ${matchingMappings.length} 个匹配的Mapping`);
  //     
  //     // 对于每个匹配的Mapping
  //     matchingMappings.forEach(mapping => {
  //       const variable = mapping.question_variable;
  //       const pageNumber = mapping.page_number;
  //       
  //       if (!variable || variable.toLowerCase() === 'null' || variable.includes('[NOT SUBMITTED]')) {
  //         return; // 跳过空的或null的变量
  //       }
  //       
  //       // 检查是否已存在相同的Dataset+Variable组合 (关键去重逻辑)
  //       const existingIndex = variablesOutput.findIndex(
  //         v => v.Variable === variable && v.Dataset === targetDataset
  //       );
  //       
  //       if (existingIndex === -1) {
  //         // 不存在 → 创建新Variable条目 (CRF独有)
  //         
  //         // 🔥 新增：从Variables_Exp中查找补充信息
  //         let label = '';
  //         let dataType = '';
  //         
  //         if (variablesExp && Array.isArray(variablesExp)) {
  //           const expVariable = variablesExp.find(
  //             v => v['Dataset Name'] === targetDataset && v['Variable Name'] === variable
  //           );
  //           
  //           if (expVariable) {
  //             label = expVariable['Variable Label'] || '';
  //             dataType = expVariable['Type'] || '';
  //             console.log(`    📋 从Variables_Exp补充信息: ${targetDataset}.${variable} (Label: "${label}", Type: "${dataType}")`);
  //           } else {
  //             console.log(`    ⚪ Variables_Exp中未找到: ${targetDataset}.${variable}`);
  //           }
  //         }
  //         
  //         variablesOutput.push({
  //           Dataset: targetDataset,
  //           Variable: variable,
  //           Label: label,
  //           'Data Type': dataType,
  //           Length: '',
  //           Format: '',
  //           Origin: `CRF Page ${pageNumber}`,
  //           'Method Keyword': '',
  //           'Source/Derivation': `Map to RAW.${mapping.form_key}.${variable}`, // 🔥 CRF Variables映射
  //           Core: 'Exp' // 🔥 CRF Variables设置为Exp
  //         });
  //         
  //         console.log(`    ✅ 新增CRF Variable: ${targetDataset}.${variable} (CRF Page ${pageNumber})`);
  //         
  //       } else {
  //         // 已存在 → 合并Origin页码
  //         const existing = variablesOutput[existingIndex];
  //         const newPageRef = `CRF Page ${pageNumber}`;
  //         
  //         if (!existing.Origin.includes(newPageRef)) {
  //           if (existing.Origin === '') {
  //             existing.Origin = newPageRef;
  //           } else {
  //             existing.Origin += `, ${newPageRef}`;
  //           }
  //           console.log(`    🔄 合并页码: ${targetDataset}.${variable} (${existing.Origin})`);
  //         }
  //         
  //         // 🔥 确保CRF Variables的Core为Exp (覆盖原有值)
  //         existing.Core = 'Exp';
  //         
  //         // 🔥 新增：追加Source/Derivation映射
  //         const newMapping = `Map to RAW.${mapping.form_key}.${variable}`;
  //         if (existing['Source/Derivation'] === '') {
  //           existing['Source/Derivation'] = newMapping;
  //         } else {
  //           existing['Source/Derivation'] += `\n${newMapping}`;
  //         }
  //         console.log(`    📋 追加Source/Derivation映射: ${newMapping}`);
  //       }
  //     });
  //   });
  //   
  //   console.log('✅ CRF Variables处理完成');
  //   console.log('📊 最终Variables统计:', {
  //     total_variables: variablesOutput.length,
  //     datasets_covered: [...new Set(variablesOutput.map(v => v.Dataset))].length,
  //     variables_with_origin: variablesOutput.filter(v => v.Origin !== '').length,
  //     variables_with_multiple_pages: variablesOutput.filter(v => v.Origin.includes(',')).length
  //   });
  //   
  //   return variablesOutput;
  // }
  
  // 🔥 新增：将Variables数据填入Excel
  async function fillVariablesToExcel(variablesData) {
    try {
      console.log('📊 填充Variables数据到Excel...');
      
      await Excel.run(async (context) => {
        const worksheet = context.workbook.worksheets.getItem('Variables');
        
        // 准备Excel数据格式 (二维数组，包含Core字段)
        const excelData = variablesData.map(variable => [
          variable.Dataset,
          variable.Variable,
          variable.Label,
          variable['Data Type'],
          variable.Length,
          variable.Format,
          variable.Origin,
          variable['Method Keyword'],
          variable['Source/Derivation'],
          variable.Core
        ]);
        
        // 计算数据范围 (A2开始，因为A1是表头，现在是A1:J1包含Core)
        if (excelData.length > 0) {
          const dataRange = worksheet.getRange(`A2:J${1 + excelData.length}`);
          dataRange.values = excelData;
          
          // 设置数据行格式
          dataRange.format.borders.getItem('EdgeTop').style = 'Continuous';
          dataRange.format.borders.getItem('EdgeBottom').style = 'Continuous';
          dataRange.format.borders.getItem('EdgeLeft').style = 'Continuous';
          dataRange.format.borders.getItem('EdgeRight').style = 'Continuous';
          dataRange.format.borders.getItem('InsideVertical').style = 'Continuous';
          dataRange.format.borders.getItem('InsideHorizontal').style = 'Continuous';
          
          // 设置左对齐
          dataRange.format.horizontalAlignment = 'Left';
          
          // 自动调整列宽
          const fullRange = worksheet.getRange(`A1:J${1 + excelData.length}`);
          fullRange.format.autofitColumns();
          
          await context.sync();
          console.log('✅ Variables表格数据填充完成');
        }
      });
      
    } catch (error) {
      console.error('❌ Variables数据填入Excel失败:', error);
    }
  }
  
  // 🔥 新增：保存Variables表格数据到数据库
  async function saveVariablesDataToDatabase() {
    try {
      console.log('💾 开始保存Variables表格数据到数据库...');
      
      const variablesTableData = await Excel.run(async (context) => {
        const worksheet = context.workbook.worksheets.getItem('Variables');
        
        // 读取完整的表格数据
        const usedRange = worksheet.getUsedRange();
        usedRange.load(['values']);
        await context.sync();
        
        const allData = usedRange.values;
        
        if (!Array.isArray(allData) || allData.length < 1) {
          throw new Error('Variables表格数据不完整');
        }
        
        // 分离表头和数据行
        const table_title = allData[0]; // 第一行是表头
        const dataRows = allData.slice(1); // 剩下的是数据行
        
        // 转换为对象数组格式 (包含Core字段)
        const table_content = dataRows.map(row => ({
          Dataset: row[0] || '',
          Variable: row[1] || '',
          Label: row[2] || '',
          'Data Type': row[3] || '',
          Length: row[4] || '',
          Format: row[5] || '',
          Origin: row[6] || '',
          'Method Keyword': row[7] || '',
          'Source/Derivation': row[8] || '',
          Core: row[9] || '' // 🔥 新增：Core字段
        }));
        
        console.log('📋 读取到Variables表头:', table_title);
        console.log('📊 读取到Variables数据:', table_content.length, '行');
        
        return {
          table_title,
          table_content
        };
      });
      
      // 调用后端API保存数据
      if (currentStudyId) {
        console.log('🌐 调用API保存Variables表格数据...');
        
        const response = await fetch(`${API_BASE_URL}/api/studies/${currentStudyId}/spec-variables-data`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json'
          },
          body: JSON.stringify(variablesTableData)
        });
        
        if (response.ok) {
          const result = await response.json();
          if (result.success) {
            console.log('✅ Variables表格数据保存成功');
          } else {
            console.warn('⚠️ Variables数据保存返回失败:', result.message);
          }
        } else {
          console.warn('⚠️ Variables数据保存API调用失败:', response.status);
        }
      } else {
        console.warn('⚠️ 当前studyId为空，无法保存Variables数据到数据库');
      }
      
    } catch (error) {
      console.error('❌ 保存Variables表格数据到数据库失败:', error);
      // 不抛出错误，让流程继续
    }
  }
  
  // 创建Methods表格
  async function createMethodsSheet() {
    await Excel.run(async (context) => {
      const workbook = context.workbook;
      const worksheet = workbook.worksheets.add('Methods');
      
      // 设置表头
      const headers = [
        'Method Keyword', 
        'Name', 
        'Description'
      ];
      const headerRange = worksheet.getRange('A1:C1');
      headerRange.values = [headers];
      
      // 设置表头格式：草绿色背景 + 粗体 + 边框
      headerRange.format.font.bold = true;
      headerRange.format.font.size = 12;
      headerRange.format.fill.color = '#90EE90'; // 草绿色
      headerRange.format.borders.getItem('EdgeTop').style = 'Continuous';
      headerRange.format.borders.getItem('EdgeBottom').style = 'Continuous';
      headerRange.format.borders.getItem('EdgeLeft').style = 'Continuous';
      headerRange.format.borders.getItem('EdgeRight').style = 'Continuous';
      headerRange.format.borders.getItem('InsideVertical').style = 'Continuous';
      
      // 自动调整列宽
      headerRange.format.autofitColumns();
      
      // 🔥 添加AutoFilter功能
      headerRange.worksheet.autoFilter.apply(headerRange);
      
      await context.sync();
      console.log('✅ Methods sheet created');
    });
  }
  
  // 创建TESTCD_Details表格
  async function createTESTCDDetailsSheet() {
    await Excel.run(async (context) => {
      const workbook = context.workbook;
      const worksheet = workbook.worksheets.add('TESTCD_Details');
      
      // 设置表头 - 32个字段
      const headers = [
        'Dataset', 
        '--TESTCD Value', 
        '--TEST Value', 
        'Raw Dataset Name or External Source Name', 
        'Selection Criteria', 
        '--CAT Value', 
        '--SCAT Value', 
        '--STAT Source/Derivation', 
        '--REASND Source/Derivation', 
        '--ORRES Source/Derivation', 
        '--ORRESU Source/Derivation', 
        '--STRESC Source/Derivation', 
        '--STRESN Source/Derivation', 
        '--STRESU Source/Derivation', 
        '--DTC Source/Derivation', 
        '--CLSIG Source/Derivation', 
        '--POS Source/Derivation', 
        '--LAT Source/Derivation', 
        '--LOC Source/Derivation', 
        '--DIR Source/Derivation', 
        '--NAM Source/Derivation', 
        '--SPEC Source/Derivation', 
        '--OBJ Value', 
        '--METHOD Source/Derivation', 
        'FOCID', 
        'TSTDTL Source/Derivation', 
        '--EVLINT Source/Derivation', 
        '--EVINTX Source/Derivation', 
        '--EVAL Source/Derivation', 
        '--EVALINT Source/Derivation', 
        'RAW Variable 1', 
        'RAW Variable 2'
      ];
      const headerRange = worksheet.getRange('A1:AF1'); // A1到AF1 (32列)
      headerRange.values = [headers];
      
      // 设置表头格式：草绿色背景 + 粗体 + 边框
      headerRange.format.font.bold = true;
      headerRange.format.font.size = 12;
      headerRange.format.fill.color = '#90EE90'; // 草绿色
      headerRange.format.borders.getItem('EdgeTop').style = 'Continuous';
      headerRange.format.borders.getItem('EdgeBottom').style = 'Continuous';
      headerRange.format.borders.getItem('EdgeLeft').style = 'Continuous';
      headerRange.format.borders.getItem('EdgeRight').style = 'Continuous';
      headerRange.format.borders.getItem('InsideVertical').style = 'Continuous';
      
      // 自动调整列宽
      headerRange.format.autofitColumns();
      
      // 🔥 添加AutoFilter功能
      headerRange.worksheet.autoFilter.apply(headerRange);
      
      await context.sync();
      console.log('✅ TESTCD_Details sheet headers created');
    });
    
    // 🔥 新增：填充TESTCD Details数据
    await populateTESTCDDetailsData();
  }
  
  // 创建SUPP_Details表格
  async function createSUPPDetailsSheet() {
    await Excel.run(async (context) => {
      const workbook = context.workbook;
      const worksheet = workbook.worksheets.add('SUPP_Details');
      
      // 设置表头
      const headers = [
        'Dataset', 
        'QNAM', 
        'QLABEL', 
        'Raw Dataset Name or External Source Name', 
        'Selection Criteria', 
        'IDVAR', 
        'IDVARVAL', 
        'QVAL', 
        'QORIG', 
        'QEVAL'
      ];
      const headerRange = worksheet.getRange('A1:J1');
      headerRange.values = [headers];
      
      // 设置表头格式：草绿色背景 + 粗体 + 边框
      headerRange.format.font.bold = true;
      headerRange.format.font.size = 12;
      headerRange.format.fill.color = '#90EE90'; // 草绿色
      headerRange.format.borders.getItem('EdgeTop').style = 'Continuous';
      headerRange.format.borders.getItem('EdgeBottom').style = 'Continuous';
      headerRange.format.borders.getItem('EdgeLeft').style = 'Continuous';
      headerRange.format.borders.getItem('EdgeRight').style = 'Continuous';
      headerRange.format.borders.getItem('InsideVertical').style = 'Continuous';
      
      // 自动调整列宽
      headerRange.format.autofitColumns();
      
      // 🔥 添加AutoFilter功能
      headerRange.worksheet.autoFilter.apply(headerRange);
      
      await context.sync();
      console.log('✅ SUPP_Details sheet headers created');
    });
    
    // 🔥 新增：填充SUPP Details数据
    await populateSUPPDetailsData();
  }
  
  // 创建TA_Data表格
  async function createTADataSheet() {
    await Excel.run(async (context) => {
      const workbook = context.workbook;
      const worksheet = workbook.worksheets.add('TA_Data');
      
      // 设置表头
      const headers = [
        'STUDYID', 
        'DOMAIN', 
        'ARMCD', 
        'ARM', 
        'TAETORD', 
        'ETCD', 
        'ELEMENT', 
        'TABRANCH', 
        'TATRANS', 
        'EPOCH'
      ];
      const headerRange = worksheet.getRange('A1:J1');
      headerRange.values = [headers];
      
      // 设置表头格式：草绿色背景 + 粗体 + 边框
      headerRange.format.font.bold = true;
      headerRange.format.font.size = 12;
      headerRange.format.fill.color = '#90EE90'; // 草绿色
      headerRange.format.borders.getItem('EdgeTop').style = 'Continuous';
      headerRange.format.borders.getItem('EdgeBottom').style = 'Continuous';
      headerRange.format.borders.getItem('EdgeLeft').style = 'Continuous';
      headerRange.format.borders.getItem('EdgeRight').style = 'Continuous';
      headerRange.format.borders.getItem('InsideVertical').style = 'Continuous';
      
      // 自动调整列宽
      headerRange.format.autofitColumns();
      
      // 🔥 添加AutoFilter功能
      headerRange.worksheet.autoFilter.apply(headerRange);
      
      await context.sync();
      console.log('✅ TA_Data sheet created');
    });
    
    // 🔥 新增：调用AI生成并填充TA数据
    await populateTAData();
  }

  // 🔥 新增：填充TA_Data表格的STUDYID和DOMAIN默认值
  async function populateTADataDefaults() {
    try {
      console.log('📋 开始填充TA_Data默认值...');
      
      // 获取STUDYID值
      const studyId = await getStudyIdValue();
      
      await Excel.run(async (context) => {
        const worksheet = context.workbook.worksheets.getItem('TA_Data');
        
        // 填充第一行数据作为示例
        const dataRange = worksheet.getRange('A2:J2');
        dataRange.values = [[
          studyId,    // STUDYID
          'TA',       // DOMAIN
          '',         // ARMCD
          '',         // ARM
          '',         // TAETORD
          '',         // ETCD
          '',         // ELEMENT
          '',         // TABRANCH
          '',         // TATRANS
          ''          // EPOCH
        ]];
        
        // 设置左对齐
        dataRange.format.horizontalAlignment = 'Left';
        
        await context.sync();
        console.log('✅ TA_Data默认值填充完成');
      });
      
    } catch (error) {
      console.error('❌ TA_Data默认值填充失败:', error);
    }
  }
  
  // 创建TE_Data表格
  async function createTEDataSheet() {
    await Excel.run(async (context) => {
      const workbook = context.workbook;
      const worksheet = workbook.worksheets.add('TE_Data');
      
      // 设置表头
      const headers = [
        'STUDYID', 
        'DOMAIN', 
        'ETCD', 
        'ELEMENT', 
        'TESTRL', 
        'TEENRL', 
        'TEDUR'
      ];
      const headerRange = worksheet.getRange('A1:G1');
      headerRange.values = [headers];
      
      // 设置表头格式：草绿色背景 + 粗体 + 边框
      headerRange.format.font.bold = true;
      headerRange.format.font.size = 12;
      headerRange.format.fill.color = '#90EE90'; // 草绿色
      headerRange.format.borders.getItem('EdgeTop').style = 'Continuous';
      headerRange.format.borders.getItem('EdgeBottom').style = 'Continuous';
      headerRange.format.borders.getItem('EdgeLeft').style = 'Continuous';
      headerRange.format.borders.getItem('EdgeRight').style = 'Continuous';
      headerRange.format.borders.getItem('InsideVertical').style = 'Continuous';
      
      // 自动调整列宽
      headerRange.format.autofitColumns();
      
      // 🔥 添加AutoFilter功能
      headerRange.worksheet.autoFilter.apply(headerRange);
      
      await context.sync();
      console.log('✅ TE_Data sheet created');
    });
    
    // 🔥 新增：填充TE数据（调用SpecTE模块）
    await populateTEData();
  }
  
  // 创建TI_Data表格
  async function createTIDataSheet() {
    await Excel.run(async (context) => {
      const workbook = context.workbook;
      const worksheet = workbook.worksheets.add('TI_Data');
      
      // 设置表头
      const headers = [
        'STUDYID', 
        'DOMAIN', 
        'IETESTCD', 
        'IETEST', 
        'IECAT', 
        'TIVERS'
      ];
      const headerRange = worksheet.getRange('A1:F1');
      headerRange.values = [headers];
      
      // 设置表头格式：草绿色背景 + 粗体 + 边框
      headerRange.format.font.bold = true;
      headerRange.format.font.size = 12;
      headerRange.format.fill.color = '#90EE90'; // 草绿色
      headerRange.format.borders.getItem('EdgeTop').style = 'Continuous';
      headerRange.format.borders.getItem('EdgeBottom').style = 'Continuous';
      headerRange.format.borders.getItem('EdgeLeft').style = 'Continuous';
      headerRange.format.borders.getItem('EdgeRight').style = 'Continuous';
      headerRange.format.borders.getItem('InsideVertical').style = 'Continuous';
      
      // 自动调整列宽
      headerRange.format.autofitColumns();
      
      // 🔥 添加AutoFilter功能
      headerRange.worksheet.autoFilter.apply(headerRange);
      
      await context.sync();
      console.log('✅ TI_Data sheet created');
    });
    
    // 🔥 新增：填充TI数据（调用SpecTI模块）
    await populateTIData();
  }
  
  // 创建TV_Data表格
  async function createTVDataSheet() {
    await Excel.run(async (context) => {
      const workbook = context.workbook;
      const worksheet = workbook.worksheets.add('TV_Data');
      
      // 设置表头
      const headers = [
        'STUDYID', 
        'DOMAIN', 
        'VISITNUM', 
        'VISIT', 
        'ARMCD', 
        'TVSTRL', 
        'TVENRL'
      ];
      const headerRange = worksheet.getRange('A1:G1');
      headerRange.values = [headers];
      
      // 设置表头格式：草绿色背景 + 粗体 + 边框
      headerRange.format.font.bold = true;
      headerRange.format.font.size = 12;
      headerRange.format.fill.color = '#90EE90'; // 草绿色
      headerRange.format.borders.getItem('EdgeTop').style = 'Continuous';
      headerRange.format.borders.getItem('EdgeBottom').style = 'Continuous';
      headerRange.format.borders.getItem('EdgeLeft').style = 'Continuous';
      headerRange.format.borders.getItem('EdgeRight').style = 'Continuous';
      headerRange.format.borders.getItem('InsideVertical').style = 'Continuous';
      
      // 自动调整列宽
      headerRange.format.autofitColumns();
      
      // 🔥 添加AutoFilter功能
      headerRange.worksheet.autoFilter.apply(headerRange);
      
      await context.sync();
      console.log('✅ TV_Data sheet created');
    });
    
    // 🔥 新增：填充STUDYID和DOMAIN默认值
    await populateTVDataDefaults();
  }

  // 🔥 新增：填充TV_Data表格的STUDYID和DOMAIN默认值
  async function populateTVDataDefaults() {
    try {
      console.log('📋 开始填充TV_Data默认值...');
      
      // 获取STUDYID值
      const studyId = await getStudyIdValue();
      
      await Excel.run(async (context) => {
        const worksheet = context.workbook.worksheets.getItem('TV_Data');
        
        // 填充第一行数据作为示例
        const dataRange = worksheet.getRange('A2:G2');
        dataRange.values = [[
          studyId,    // STUDYID
          'TV',       // DOMAIN
          '',         // VISITNUM
          '',         // VISIT
          '',         // ARMCD
          '',         // TVSTRL
          ''          // TVENRL
        ]];
        
        // 设置左对齐
        dataRange.format.horizontalAlignment = 'Left';
        
        await context.sync();
        console.log('✅ TV_Data默认值填充完成');
      });
      
    } catch (error) {
      console.error('❌ TV_Data默认值填充失败:', error);
    }
  }
  
  // 创建TS_Data表格
  async function createTSDataSheet() {
    await Excel.run(async (context) => {
      const workbook = context.workbook;
      const worksheet = workbook.worksheets.add('TS_Data');
      
      // 设置表头
      const headers = [
        'STUDYID', 
        'DOMAIN', 
        'TSSEQ', 
        'TSGRPID', 
        'TSPARMCD', 
        'TSPARM', 
        'TSVAL', 
        'TSVALNF', 
        'TSVALCD', 
        'TSVCDREF', 
        'TSVCDVER'
      ];
      const headerRange = worksheet.getRange('A1:K1');
      headerRange.values = [headers];
      
      // 设置表头格式：草绿色背景 + 粗体 + 边框
      headerRange.format.font.bold = true;
      headerRange.format.font.size = 12;
      headerRange.format.fill.color = '#90EE90'; // 草绿色
      headerRange.format.borders.getItem('EdgeTop').style = 'Continuous';
      headerRange.format.borders.getItem('EdgeBottom').style = 'Continuous';
      headerRange.format.borders.getItem('EdgeLeft').style = 'Continuous';
      headerRange.format.borders.getItem('EdgeRight').style = 'Continuous';
      headerRange.format.borders.getItem('InsideVertical').style = 'Continuous';
      
      // 自动调整列宽
      headerRange.format.autofitColumns();
      
      // 🔥 添加AutoFilter功能
      headerRange.worksheet.autoFilter.apply(headerRange);
      
      await context.sync();
      console.log('✅ TS_Data sheet created');
    });
    
    // 🔥 修改：调用populateTSData（使用AI自动生成，类似TA/TE/TI）
    await populateTSData();
  }

  // 🔥 新增：填充TS_Data表格数据（使用AI基于Protocol Cover Page生成）
  async function populateTSData() {
    try {
      console.log('📋 开始填充TS_Data（AI生成基于Cover Page）...');
      
      // 配置SpecTS模块
      if (typeof window.SpecTS !== 'undefined' && window.SpecTS.init) {
        window.SpecTS.init({
          API_BASE_URL: API_BASE_URL,
          studyId: currentDocumentId
        });
        console.log('✅ SpecTS模块配置完成');
      } else {
        console.error('❌ window.SpecTS未定义');
        throw new Error('SpecTS模块未加载');
      }
      
      // 调用initTSDataGeneration自动生成并填充TS数据
      if (typeof window.SpecTS.initTSDataGeneration === 'function') {
        await window.SpecTS.initTSDataGeneration();
        console.log('✅ TS_Data生成并填充完成');
      } else {
        console.error('❌ SpecTS.initTSDataGeneration函数不存在');
        throw new Error('SpecTS.initTSDataGeneration函数不可用');
      }
      
    } catch (error) {
      console.error('❌ TS_Data填充失败:', error);
      throw error;
    }
  }

  // 🔥 新增：填充SUPP Details数据
  async function populateSUPPDetailsData() {
    try {
      console.log('📋 开始填充SUPP Details数据...');
      
      // 检查是否有SUPP处理器可用
      if (typeof window.SpecSUPP === 'undefined') {
        console.warn('⚠️ SpecSUPP模块未加载，跳过SUPP数据处理');
        return;
      }
      
      // 🔥 新增：先传入配置，确保API_BASE_URL和studyId正确
      console.log('🔧 [Spec] 配置SUPP模块:', { API_BASE_URL, currentStudyId });
      window.SpecSUPP.init({ API_BASE_URL, studyId: currentStudyId });
      
      // 调用SUPP处理器的主要流程
      await window.SpecSUPP.initSUPPDetailsGeneration();
      
    } catch (error) {
      console.error('❌ SUPP Details数据填充失败:', error);
      // 不抛出错误，让流程继续
    }
  }

  // 🔥 新增：填充TESTCD Details数据
  async function populateTESTCDDetailsData() {
    try {
      console.log('📋 开始填充TESTCD Details数据...');
      
      // 检查是否有TESTCD处理器可用
      if (typeof window.SpecTESTCD === 'undefined') {
        console.warn('⚠️ SpecTESTCD模块未加载，跳过TESTCD数据处理');
        return;
      }
      
      // 🔥 先传入配置，确保API_BASE_URL和studyId正确
      console.log('🔧 [Spec] 配置TESTCD模块:', { API_BASE_URL, currentStudyId });
      window.SpecTESTCD.init({ API_BASE_URL, studyId: currentStudyId });
      
      // 调用TESTCD处理器的主要流程
      await window.SpecTESTCD.initTESTCDDetailsGeneration();
      
    } catch (error) {
      console.error('❌ TESTCD Details数据填充失败:', error);
      // 不抛出错误，让流程继续
    }
  }

  // 🔥 新增：填充TA_Data数据
  async function populateTAData() {
    try {
      console.log('📋 开始填充TA_Data数据...');
      
      // 检查是否有TA处理器可用
      if (typeof window.SpecTA === 'undefined') {
        console.warn('⚠️ SpecTA模块未加载，跳过TA数据处理');
        return;
      }
      
      // 🔥 先传入配置，确保API_BASE_URL和studyId正确
      console.log('🔧 [Spec] 配置TA模块:', { API_BASE_URL, currentStudyId });
      window.SpecTA.init({ API_BASE_URL, studyId: currentStudyId });
      
      // 调用TA处理器的主要流程
      await window.SpecTA.initTADataGeneration();
      
    } catch (error) {
      console.error('❌ TA_Data数据填充失败:', error);
      // 不抛出错误，让流程继续
    }
  }

  // 🔥 添加：TE_Data填充函数
  async function populateTEData() {
    try {
      console.log('📋 开始填充TE_Data数据...');
      
      // 检查是否有TE处理器可用
      if (typeof window.SpecTE === 'undefined') {
        console.warn('⚠️ SpecTE模块未加载，跳过TE数据处理');
        return;
      }
      
      // 🔥 先传入配置，确保API_BASE_URL和studyId正确
      console.log('🔧 [Spec] 配置TE模块:', { API_BASE_URL, currentStudyId });
      window.SpecTE.init({ API_BASE_URL, studyId: currentStudyId });
      
      // 调用TE处理器的主要流程
      await window.SpecTE.initTEDataGeneration();
      
    } catch (error) {
      console.error('❌ TE_Data数据填充失败:', error);
      // 不抛出错误，让流程继续
    }
  }

  // 🔥 添加：TI_Data填充函数
  async function populateTIData() {
    try {
      console.log('📋 开始填充TI_Data数据...');
      
      // 检查是否有TI处理器可用
      if (typeof window.SpecTI === 'undefined') {
        console.warn('⚠️ SpecTI模块未加载，跳过TI数据处理');
        return;
      }
      
      // 🔥 先传入配置，确保API_BASE_URL和studyId正确
      console.log('🔧 [Spec] 配置TI模块:', { API_BASE_URL, currentStudyId });
      window.SpecTI.init({ API_BASE_URL, studyId: currentStudyId });
      
      // 调用TI处理器的主要流程
      await window.SpecTI.initTIDataGeneration();
      
    } catch (error) {
      console.error('❌ TI_Data数据填充失败:', error);
      // 不抛出错误，让流程继续
    }
  }

  // 全局初始化函数
  window.initSpecPage = function initSpecPage(cfg){
    console.log('🚀 Initializing Spec page with config:', cfg);
    
    if (cfg && cfg.API_BASE_URL) API_BASE_URL = cfg.API_BASE_URL;
    if (cfg && cfg.studyId) currentStudyId = cfg.studyId;
    
    // 显示Spec界面
    showSpecInterface();
    
    // 🔥 初始化 SpecDatasetSeparation 模块
    if (window.SpecDatasetSeparation && typeof window.SpecDatasetSeparation.init === 'function') {
      window.SpecDatasetSeparation.init({
        API_BASE_URL: API_BASE_URL,
        studyId: currentStudyId
      });
      console.log('✅ SpecDatasetSeparation module initialized');
    }
    
    console.log('✅ Spec page initialized');
  };
  
  // Expose bindFinishButton for external use (e.g., from SpecDatasetSeparation module)
  window.SpecModule = window.SpecModule || {};
  window.SpecModule.bindFinishButton = bindFinishButton;
})();
