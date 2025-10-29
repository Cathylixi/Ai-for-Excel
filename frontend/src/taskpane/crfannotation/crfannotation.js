// CRF Annotation Page
(function(){
  let API_BASE_URL = (typeof window !== 'undefined' && window.API_BASE_URL) ? window.API_BASE_URL : '';
  let currentStudyId = (typeof window !== 'undefined' && window.currentDocumentId) ? window.currentDocumentId : null;

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
    let host = document.getElementById('crfannotation-container') || document.body;
    let banner = document.getElementById('crfannotation-status-banner');
    if (!banner) {
      banner = document.createElement('div');
      banner.id = 'crfannotation-status-banner';
      banner.style.cssText = 'margin:12px 0;padding:10px 14px;border-radius:6px;font-size:13px;';
      host.insertBefore(banner, host.firstChild);
    }
    banner.style.background = (type === 'error') ? '#fde7e9' : (type === 'success') ? '#e6f4ea' : '#f3f2f1';
    banner.style.color = '#323130';
    banner.textContent = message;
  }

  function initBindings(){
    const startBtn = qs('crfannotation-start-btn');
    // 注意：I'm Finished按钮已经移动到各个具体的界面函数中进行绑定
    // 因为不同界面有不同的按钮ID (crfannotation-finish-btn 改为 crfannotation-dospec-btn等)
    
    // Start Annotation 按钮事件
    if (startBtn) startBtn.addEventListener('click', startAnnotationProcess);
  }

  // 🔥 修改：开始逐表单CRF annotation流程（直接进入表单处理，不再调用全量GPT）
  async function startAnnotationProcess() {
    console.log('🧠 Starting per-form CRF annotation flow...');
    
    try {
      // 🔥 新流程：直接进入逐表单模式，跳过全量GPT和中间界面
      reportStatus('Initializing per-form processing...', 'info');
      
      // Step 1: 初始化表单队列
      console.log('🔄 Step 1: 初始化表单队列...');
      await initializeFormsQueue();
      
      // Step 2: 创建Excel表头
      console.log('🔄 Step 2: 创建Excel表头...');
      await createChecklistHeadersOnly();
      
      // Step 3: 显示第一个表单处理界面
      console.log('🔄 Step 3: 显示第一个表单处理界面...');
      showFormProcessingView();
      
      reportStatus('✅ Ready to process forms one by one. Click "Process This Form" to start.', 'success');
      
    } catch (error) {
      console.error('❌ Failed to start per-form flow:', error);
      reportStatus(`Failed to start per-form flow: ${error.message}`, 'error');
    }
  }

  // Excel操作相关函数
  
  // 全局变量：保存创建的工作表名称
  let createdSheetName = null;
  
  // 全局状态：Checklist绘制完成状态
  let checklistReady = false;
  let checklistProgress = { totalForms: 0, processedForms: 0 };
  
  // 全局状态：数据存储完成状态
  let storedToDb = false;
  
  // 🔥 新增：逐表单处理状态管理
  let formsQueue = []; // 所有表单的formKey数组，如 ['VISIT_INFORMATION', 'DEMOGRAPHICS', ...]
  let currentFormIndex = 0; // 当前正在处理的表单索引（0开始）
  let confirmedFormsCount = 0; // 🔥 新增：已确认保存的表单数（用于进度计算）
  let currentRowInExcel = 2; // 当前Excel写入位置（追踪末行，A2开始）
  let formRowMapping = new Map(); // formKey → {startRow, endRow} 记录每个表单在Excel中的行范围
  let totalFormsCount = 0; // 总表单数（用于进度计算）
  
  // 🔥 新增：初始化表单队列
  async function initializeFormsQueue() {
    try {
      console.log('📋 开始初始化表单队列...');
      
      const response = await fetch(`${API_BASE_URL}/api/studies/${currentStudyId}/crf-data`);
      
      if (!response.ok) {
        throw new Error(`Failed to get CRF data: ${response.status}`);
      }
      
      const result = await response.json();
      if (!result.success) {
        throw new Error(result.message || 'Failed to get CRF data');
      }
      
      const crfFormList = result.data?.crfUploadResult?.crfFormList;
      if (!crfFormList) {
        throw new Error('No CRF form list found');
      }
      
      // 提取所有formKey作为队列
      formsQueue = Object.keys(crfFormList);
      totalFormsCount = formsQueue.length;
      currentFormIndex = 0;
      confirmedFormsCount = 0; // 🔥 重置已确认数
      currentRowInExcel = 2; // A2开始（A1是表头）
      formRowMapping.clear();
      
      console.log(`✅ 表单队列初始化完成: ${totalFormsCount} 个表单`);
      console.log(`📋 表单列表:`, formsQueue);
      
      return true;
      
    } catch (error) {
      console.error('❌ 初始化表单队列失败:', error);
      throw error;
    }
  }

  // 方案B：仅创建Checklist表头（按"Create Checklist"按钮触发）
  async function createChecklistHeadersOnly() {
    try {
      // 显示与Start Annotation一致的轻量提示
      reportStatus('Creating checklist headers in Excel...', 'info');
      
      await Excel.run(async (context) => {
        const worksheets = context.workbook.worksheets;
        worksheets.load("items/name");
        await context.sync();
        
        // 生成不重名的sheet名称
        let sheetName = "CRF Annotation Checklist";
        let counter = 1;
        while (worksheets.items.some(ws => ws.name === sheetName)) {
          counter++;
          sheetName = `CRF Annotation Checklist ${counter}`;
        }
        
        // 创建并激活
        const worksheet = worksheets.add(sheetName);
        worksheet.activate();
        await context.sync();
        
        // 6列表头
        const headers = [[
          'Form Name', 'Form Mapping', 'Page Number', 'Question Number', 'Question', 'Question Variable'
        ]];
        const headerRange = worksheet.getRange('A1:F1');
        headerRange.values = headers;
        headerRange.format.font.bold = true;
        headerRange.format.fill.color = '#E1F5FE';
        
        try { headerRange.format.autofitColumns(); } catch (_) {}
        await context.sync();
        
        createdSheetName = sheetName;
      });
      
      reportStatus('✅ Checklist headers created. You can now store corrections.', 'success');
    } catch (error) {
      console.error('❌ Failed to create checklist headers:', error);
      reportStatus(`Failed to create checklist: ${error.message}`, 'error');
      throw error;
    }
  }

  // 🔥 辅助函数：拼接Form Mapping（去重分号拼接）
  function joinFormMapping(mappingArray) {
    if (!Array.isArray(mappingArray)) return '';
    
    // 去重并用分号+空格拼接
    const uniqueMappings = [...new Set(mappingArray)];
    return uniqueMappings.join('; ');
  }

  // 🔥 辅助函数：提取Page Number（复制后端逻辑）
  function extractPageNumber(mapping, form) {
    // 优先使用 mapping.page_number
    if (typeof mapping.page_number === 'number') {
      return mapping.page_number;
    }
    
    // 回退到从 LabelForm 中查找
    if (Array.isArray(form.LabelForm)) {
      const labelItem = form.LabelForm.find(item => item.match_index === mapping.index);
      if (labelItem?.content?.page_number) {
        return labelItem.content.page_number;
      }
    }
    
    return null;
  }

  // 🔥 辅助函数：提取Question Variables（复制后端逻辑）
  function extractQuestionVariables(sdtmMappings) {
    if (!Array.isArray(sdtmMappings) || sdtmMappings.length === 0) {
      return '';
    }
    
    const variables = [];
    sdtmMappings.forEach(sdtmMapping => {
      if (sdtmMapping.variable) {
        // 🔥 关键：处理 "SITEID / USUBJID" → ["SITEID", "USUBJID"]
        const vars = sdtmMapping.variable.split(' / ').map(v => v.trim());
        variables.push(...vars);
      }
    });
    
    // 🔥 使用分号+空格拼接（不是斜杠）
    return variables.length > 0 ? variables.join('; ') : '';
  }

  // 🔥 新增：提取每個問題專屬的Form Mapping
  function extractQuestionFormMapping(sdtmMappings) {
    if (!Array.isArray(sdtmMappings) || sdtmMappings.length === 0) {
      return '';
    }
    
    const formMappings = [];
    sdtmMappings.forEach((sdtmMapping, index) => {
      console.log(`    [DEBUG] Processing mapping ${index}:`, sdtmMapping);
      
      if (sdtmMapping.mapping_type === 'supp' && sdtmMapping.variable && sdtmMapping.domain_code) {
        // SUPP 格式：QNAM in SUPP--
        const suppFormat = `${sdtmMapping.variable} in ${sdtmMapping.domain_code}`;
        formMappings.push(suppFormat);
        console.log(`    [DEBUG] SUPP格式生成: "${suppFormat}"`);
      } else if (sdtmMapping.domain_code && sdtmMapping.domain_label) {
        // 標準格式：DOMAIN (DOMAIN_LABEL)
        const standardFormat = `${sdtmMapping.domain_code} (${sdtmMapping.domain_label})`;
        formMappings.push(standardFormat);
        console.log(`    [DEBUG] 標準格式生成: "${standardFormat}"`);
      } else if (sdtmMapping.domain_code === '[NOT SUBMITTED]' || sdtmMapping.variable === '[NOT SUBMITTED]') {
        // 特殊格式：[NOT SUBMITTED]
        formMappings.push('[NOT SUBMITTED]');
        console.log(`    [DEBUG] NOT SUBMITTED格式生成`);
      } else {
        // 🔥 新增：處理其他可能的SUPP格式（容錯）
        if (sdtmMapping.domain_code && sdtmMapping.domain_code.includes(' in SUPP')) {
          formMappings.push(sdtmMapping.domain_code);
          console.log(`    [DEBUG] 容錯SUPP格式: "${sdtmMapping.domain_code}"`);
        } else {
          console.warn(`    [DEBUG] 無法處理的映射:`, sdtmMapping);
        }
      }
    });
    
    // 使用分号+空格拼接多個映射
    const result = formMappings.length > 0 ? formMappings.join('; ') : '';
    console.log(`    [DEBUG] 最終Form Mapping: "${result}"`);
    return result;
  }

  // 🔥 主函数：按Form分批构建并写入Excel数据
  async function drawChecklistByFormBatched(onComplete) {
    try {
      console.log('📊 开始分批绘制CRF Checklist...');
      
      // 重置状态
      checklistReady = false;
      checklistProgress = { totalForms: 0, processedForms: 0 };
      
      // 显示绘制进度界面
      showChecklistDrawingProgress();
      
      // Step 1: 获取CRF数据
      console.log('🌐 获取CRF原始数据...');
      const response = await fetch(`${API_BASE_URL}/api/studies/${currentStudyId}/crf-data`);
      
      if (!response.ok) {
        throw new Error(`Failed to get CRF data: ${response.status}`);
      }
      
      const result = await response.json();
      if (!result.success) {
        throw new Error(result.message || 'Failed to get CRF data');
      }
      
      const crfFormList = result.data?.crfUploadResult?.crfFormList;
      if (!crfFormList) {
        throw new Error('No CRF form list found');
      }
      
      const formKeys = Object.keys(crfFormList);
      checklistProgress.totalForms = formKeys.length;
      
      console.log(`📋 准备处理 ${formKeys.length} 个Forms:`, formKeys);
      
      let currentRow = 2; // 从第2行开始（第1行是表头）
      
      // Step 2: 逐个Form处理
      for (let formIndex = 0; formIndex < formKeys.length; formIndex++) {
        const formKey = formKeys[formIndex];
        const form = crfFormList[formKey];
        
        console.log(`🔄 处理Form ${formIndex + 1}/${formKeys.length}: ${formKey}`);
        
        // 更新进度显示
        updateChecklistProgress(formIndex + 1, formKeys.length, formKey);
        
        // 构建临时矩阵（只存当前Form的所有Question行）
        const rowsForForm = [];
        
        // 遍历当前Form的所有Question
        if (Array.isArray(form.Mapping)) {
          form.Mapping.forEach((mapping, i) => {
            const pageNumber = extractPageNumber(mapping, form) || '';
            const questionNumber = mapping.index || '';
            const questionText = mapping.label_row || '';
            const questionVariables = extractQuestionVariables(mapping.sdtm_mappings);
            
            // 🔥 新邏輯：每個問題生成專屬的Form Mapping
            const questionFormMapping = extractQuestionFormMapping(mapping.sdtm_mappings);
            
            // 构建一行（6列）
            const row = [
              formKey,              // Form Name
              questionFormMapping,  // Form Mapping（每個問題專屬）
              pageNumber,           // Page Number
              questionNumber,       // Question Number
              questionText,         // Question
              questionVariables     // Question Variable
            ];
            
            rowsForForm.push(row);
          });
        }
        
        // 立即写入Excel（一次性写入当前Form的所有行）
        if (rowsForForm.length > 0) {
          const endRow = currentRow + rowsForForm.length - 1;
          
          console.log(`📝 写入Form ${formKey} 到Excel (行${currentRow}-${endRow}), ${rowsForForm.length}行`);
          
          await Excel.run(async (context) => {
            const worksheet = context.workbook.worksheets.getItem(createdSheetName);
            const dataRange = worksheet.getRange(`A${currentRow}:F${endRow}`);
            dataRange.values = rowsForForm;
            
            await context.sync();
            console.log(`✅ Form ${formKey} 的 ${rowsForForm.length} 行数据已写入Excel`);
          });
          
          currentRow = endRow + 1;
        }
        
        checklistProgress.processedForms++;
        
        // Form间缓冲（除了最后一个）
        if (formIndex < formKeys.length - 1) {
          console.log('⏳ Form间缓冲 0.5秒...');
          await new Promise(resolve => setTimeout(resolve, 500));
        }
      }
      
      console.log(`✅ 所有Form绘制完成！总计处理了 ${formKeys.length} 个Forms`);
      
      // 标记完成状态
      checklistReady = true;
      
      // 调用完成回调
      if (typeof onComplete === 'function') {
        onComplete();
      }
      
    } catch (error) {
      console.error('❌ 分批绘制CRF Checklist失败:', error);
      reportStatus(`Failed to draw checklist: ${error.message}`, 'error');
      
      // 重新启用Create按钮以便重试
      const createBtn = qs('create-checklist-btn');
      if (createBtn) {
        createBtn.disabled = false;
        createBtn.innerHTML = '<span class="ms-Button-label">📄 Create Checklist</span>';
      }
    }
  }

  // 🔥 新增：显示单表单处理界面（逐表单模式）
  function showFormProcessingView() {
    const container = qs('crfannotation-container');
    if (!container) return;
    
    if (currentFormIndex >= formsQueue.length) {
      // 所有表单已处理完成
      showAllFormsCompletedView();
      return;
    }
    
    const currentFormKey = formsQueue[currentFormIndex];
    const progress = confirmedFormsCount; // 🔥 使用已确认表单数（0开始）
    const progressPercentage = totalFormsCount > 0 ? Math.round((progress / totalFormsCount) * 100) : 0;
    
    container.innerHTML = `
      <div class="crfannotation-wrapper">
        <h3 class="ms-font-l">📋 CRF Annotation - Form by Form</h3>

        <div class="annotation-content" style="padding: 20px;">
          
          <!-- 🔥 表单名显示在最上方（独立区域） -->
          <div class="current-form-header" style="text-align: center; margin-bottom: 20px;">
            <h4 class="ms-font-l" style="margin: 0; color: #0078d4;">
              ${currentFormKey}
            </h4>
            <p class="ms-font-s" style="margin: 8px 0 0 0; color: #605e5c;">
              Current Form
            </p>
          </div>
          
          <!-- 🔥 进度条显示在表单名下方 -->
          <div class="progress-block" style="margin: 24px 0;">
            <div style="margin: 8px 0 4px 0; text-align: center;">
              <span class="ms-font-m" style="color: #323130;">Processing Progress</span>
            </div>
            <div style="margin: 12px 0 8px 0; text-align: center;">
              <span id="form-progress-text" class="ms-font-m" style="color:#323130; font-weight: 600;">${progress} / ${totalFormsCount} forms</span>
            </div>
            <div class="progress-bar" style="height:12px; background:#edebe9; border-radius:6px; overflow:hidden; margin: 8px 0;">
              <div id="form-progress-fill" style="height:100%; width:${progressPercentage}%; background:#0078d4; transition:width .3s ease;"></div>
            </div>
            <div id="form-percentage" class="ms-font-s" style="text-align:center; color:#605e5c; margin-top:4px;">${progressPercentage}%</div>
          </div>

          <!-- 🔥 状态提示在进度条下方 -->
          <div id="form-current-status" class="ms-font-s" style="color:#323130; margin: 24px 0; padding: 12px; background: #f3f2f1; border-left: 3px solid #0078d4; text-align: left;">
            Ready to process form: <strong>${currentFormKey}</strong>
          </div>
        </div>

        <!-- 🔥 按钮在最下方 -->
        <div style="text-align: center; margin-top: 24px; display: flex; justify-content: center; gap: 12px;">
          <button id="process-current-form-btn" class="ms-Button ms-Button--primary" style="font-size: 16px; padding: 12px 24px; border-radius: 8px;">
            <span class="ms-Button-label">🚀 Process This Form</span>
          </button>
          <button id="user-confirmed-form-btn" class="ms-Button ms-Button--primary" disabled style="font-size: 16px; padding: 12px 24px; border-radius: 8px; opacity: 0.5;">
            <span class="ms-Button-label">✅ User Confirmed</span>
          </button>
          <button id="next-form-btn" class="ms-Button ms-Button--primary" disabled style="font-size: 16px; padding: 12px 24px; border-radius: 8px; opacity: 0.5;">
            <span class="ms-Button-label">➡️ Next Form</span>
          </button>
        </div>
      </div>
    `;
    
    // 绑定按钮事件
    bindFormProcessingButtons();
  }

  // 🔥 新增：绑定表单处理按钮事件
  function bindFormProcessingButtons() {
    const processBtn = qs('process-current-form-btn');
    const confirmBtn = qs('user-confirmed-form-btn');
    const nextBtn = qs('next-form-btn');
    
    if (processBtn) {
      processBtn.addEventListener('click', processSingleForm);
    }
    
    if (confirmBtn) {
      confirmBtn.addEventListener('click', confirmCurrentForm);
    }
    
    if (nextBtn) {
      nextBtn.addEventListener('click', moveToNextForm);
    }
    
    console.log('✅ 表单处理按钮事件已绑定');
  }

  // 🔥 新增：处理单个表单（调用GPT并写入Excel）
  async function processSingleForm() {
    try {
      const currentFormKey = formsQueue[currentFormIndex];
      console.log(`🧠 [单表单处理] 开始处理表单: ${currentFormKey}`);
      
      // 1. 禁用Process按钮并更新状态
      const processBtn = qs('process-current-form-btn');
      const statusDiv = qs('form-current-status');
      
      if (processBtn) {
        processBtn.disabled = true;
        processBtn.innerHTML = '<span class="ms-Button-label">⏳ Processing...</span>';
      }
      
      if (statusDiv) {
        statusDiv.innerHTML = `🧠 Calling GPT to analyze form: <strong>${currentFormKey}</strong>...`;
        statusDiv.style.borderLeftColor = '#ffa500'; // 橙色表示处理中
      }
      
      // 2. 调用后端单表单GPT端点
      console.log(`🌐 [单表单处理] 调用后端API: /api/studies/${currentStudyId}/generate-sdtm-mapping-for-form?formKey=${currentFormKey}`);
      
      const response = await fetch(`${API_BASE_URL}/api/studies/${currentStudyId}/generate-sdtm-mapping-for-form?formKey=${encodeURIComponent(currentFormKey)}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        }
      });
      
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }
      
      const result = await response.json();
      
      if (!result.success) {
        throw new Error(result.message || 'GPT processing failed');
      }
      
      console.log(`✅ [单表单处理] GPT处理成功:`, {
        formKey: result.data.formKey,
        questionsProcessed: result.data.questionsProcessed,
        excelRows: result.data.excelRows?.length
      });
      
      // 3. 获取Excel行数据（从API返回中获取）
      const excelRows = result.data.excelRows || [];
      
      if (excelRows.length === 0) {
        console.warn(`⚠️ [单表单处理] 表单 ${currentFormKey} 没有生成Excel行数据`);
        if (statusDiv) {
          statusDiv.innerHTML = `⚠️ Form <strong>${currentFormKey}</strong> processed but generated no rows.`;
        }
      } else {
        // 4. 将Excel行追加到Excel末尾
        console.log(`📝 [单表单处理] 开始写入 ${excelRows.length} 行数据到Excel...`);
        await appendFormDataToExcel(currentFormKey, excelRows);
        
        console.log(`✅ [单表单处理] Excel写入完成`);
        
        // 5. 更新状态提示
        if (statusDiv) {
          statusDiv.innerHTML = `✅ Form <strong>${currentFormKey}</strong> processed successfully! ${excelRows.length} rows added to Excel. Please review and confirm.`;
          statusDiv.style.borderLeftColor = '#107c10'; // 绿色表示成功
        }
      }
      
      // 6. 启用User Confirmed按钮
      const confirmBtn = qs('user-confirmed-form-btn');
      if (confirmBtn) {
        confirmBtn.disabled = false;
        confirmBtn.style.opacity = '1';
      }
      
      // 7. 隐藏Process按钮（已处理完成）
      if (processBtn) {
        processBtn.style.display = 'none';
      }
      
      reportStatus(`✅ Form ${currentFormKey} processed successfully!`, 'success');
      
    } catch (error) {
      console.error('❌ [单表单处理] 处理失败:', error);
      
      // 恢复Process按钮状态
      const processBtn = qs('process-current-form-btn');
      const statusDiv = qs('form-current-status');
      
      if (processBtn) {
        processBtn.disabled = false;
        processBtn.innerHTML = '<span class="ms-Button-label">🚀 Process This Form</span>';
      }
      
      if (statusDiv) {
        statusDiv.innerHTML = `❌ Failed to process form: <strong>${error.message}</strong>. Please retry.`;
        statusDiv.style.borderLeftColor = '#d13438'; // 红色表示错误
      }
      
      reportStatus(`Failed to process form: ${error.message}`, 'error');
    }
  }

  // 🔥 新增：将表单数据追加到Excel末尾
  async function appendFormDataToExcel(formKey, rowsData) {
    try {
      console.log(`📝 [Excel追加] 开始追加表单 "${formKey}" 的 ${rowsData.length} 行数据...`);
      
      await Excel.run(async (context) => {
        const worksheet = context.workbook.worksheets.getItem(createdSheetName);
        
        // 获取当前已使用的范围（含表头）
        const usedRange = worksheet.getUsedRange();
        usedRange.load(['rowCount']);
        await context.sync();
        
        const lastRow = usedRange.rowCount; // Excel行号（1-based）
        const startRow = lastRow + 1; // 在末尾追加
        const endRow = startRow + rowsData.length - 1;
        
        console.log(`📊 [Excel追加] Excel当前末行: ${lastRow}, 追加范围: A${startRow}:F${endRow}`);
        
        // 写入数据
        const dataRange = worksheet.getRange(`A${startRow}:F${endRow}`);
        dataRange.values = rowsData;
        
        await context.sync();
        
        // 记录该表单的行范围（用于重试时清空）
        formRowMapping.set(formKey, { startRow, endRow });
        currentRowInExcel = endRow + 1; // 更新当前Excel写入位置
        
        console.log(`✅ [Excel追加] 表单 "${formKey}" 数据已写入Excel: 行${startRow}-${endRow}`);
        console.log(`📊 [Excel追加] formRowMapping 已更新:`, Array.from(formRowMapping.entries()));
      });
      
    } catch (error) {
      console.error('❌ [Excel追加] 写入失败:', error);
      throw error;
    }
  }

  // 🔥 新增：确认当前表单并保存到数据库
  async function confirmCurrentForm() {
    try {
      const currentFormKey = formsQueue[currentFormIndex];
      console.log(`💾 [确认保存] 开始保存表单: ${currentFormKey}`);
      
      // 1. 禁用Confirmed按钮并更新状态
      const confirmBtn = qs('user-confirmed-form-btn');
      const statusDiv = qs('form-current-status');
      
      if (confirmBtn) {
        confirmBtn.disabled = true;
        confirmBtn.innerHTML = '<span class="ms-Button-label">💾 Saving...</span>';
      }
      
      if (statusDiv) {
        statusDiv.innerHTML = `💾 Saving form <strong>${currentFormKey}</strong> to database...`;
        statusDiv.style.borderLeftColor = '#0078d4'; // 蓝色表示保存中
      }
      
      // 2. 读取Excel中该表单的所有行（含用户修正）
      console.log(`📊 [确认保存] 读取Excel中表单 "${currentFormKey}" 的数据...`);
      const excelData = await readExcelChecklistData();
      const formRows = excelData.rows.filter(row => row[0] === currentFormKey); // 第一列是Form Name
      
      console.log(`📋 [确认保存] 表单 "${currentFormKey}" 在Excel中有 ${formRows.length} 行数据`);
      
      if (formRows.length === 0) {
        throw new Error(`No data found for form "${currentFormKey}" in Excel`);
      }
      
      // 3. 调用现有的分批保存API（只传当前表单的行）
      const isLastForm = currentFormIndex === formsQueue.length - 1;
      
      console.log(`💾 [确认保存] 保存到数据库: isLastBatch=${isLastForm}`);
      
      const response = await fetch(`${API_BASE_URL}/api/studies/${currentStudyId}/save-crf-corrected-data-batch`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          batchData: {
            headers: excelData.headers,
            rows: formRows
          },
          batchIndex: currentFormIndex,
          totalBatches: totalFormsCount,
          isLastBatch: isLastForm
        })
      });
      
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }
      
      const result = await response.json();
      
      if (!result.success) {
        throw new Error(result.message || '保存失败');
      }
      
      console.log(`✅ [确认保存] 表单 "${currentFormKey}" 保存成功:`, result.data);
      
      // 4. 🔥 递增已确认表单数
      confirmedFormsCount++;
      console.log(`📊 [确认保存] 已确认表单数: ${confirmedFormsCount}/${totalFormsCount}`);
      
      // 5. 🔥 更新进度条显示（立即反映已确认数）
      const progressFill = qs('form-progress-fill');
      const progressText = qs('form-progress-text');
      const progressPercentage = qs('form-percentage');
      
      const newPercentage = totalFormsCount > 0 ? Math.round((confirmedFormsCount / totalFormsCount) * 100) : 0;
      
      if (progressFill) {
        progressFill.style.width = `${newPercentage}%`;
      }
      if (progressText) {
        progressText.textContent = `${confirmedFormsCount} / ${totalFormsCount} forms`;
      }
      if (progressPercentage) {
        progressPercentage.textContent = `${newPercentage}%`;
      }
      
      // 6. 更新状态提示
      if (statusDiv) {
        statusDiv.innerHTML = `✅ Form <strong>${currentFormKey}</strong> confirmed and saved to database!`;
        statusDiv.style.borderLeftColor = '#107c10'; // 绿色表示成功
      }
      
      // 7. 禁用Confirmed按钮（已确认，防止重复保存）
      if (confirmBtn) {
        confirmBtn.innerHTML = '<span class="ms-Button-label">✅ Confirmed</span>';
        confirmBtn.disabled = true;
        confirmBtn.style.opacity = '0.5';
      }
      
      // 8. 启用Next按钮
      const nextBtn = qs('next-form-btn');
      if (nextBtn) {
        nextBtn.disabled = false;
        nextBtn.style.opacity = '1';
      }
      
      reportStatus(`✅ Form ${currentFormKey} confirmed and saved!`, 'success');
      
    } catch (error) {
      console.error('❌ [确认保存] 保存失败:', error);
      
      // 恢复Confirmed按钮状态
      const confirmBtn = qs('user-confirmed-form-btn');
      const statusDiv = qs('form-current-status');
      
      if (confirmBtn) {
        confirmBtn.disabled = false;
        confirmBtn.innerHTML = '<span class="ms-Button-label">✅ User Confirmed</span>';
      }
      
      if (statusDiv) {
        statusDiv.innerHTML = `❌ Failed to save form: <strong>${error.message}</strong>. Please retry.`;
        statusDiv.style.borderLeftColor = '#d13438'; // 红色表示错误
      }
      
      reportStatus(`Failed to save form: ${error.message}`, 'error');
    }
  }

  // 🔥 新增：移动到下一个表单
  function moveToNextForm() {
    try {
      console.log(`➡️ [Next表单] 移动到下一个表单...`);
      console.log(`📊 [Next表单] 当前索引: ${currentFormIndex}, 队列长度: ${formsQueue.length}`);
      
      // 递增索引
      currentFormIndex++;
      
      if (currentFormIndex >= formsQueue.length) {
        // 所有表单已处理完成
        console.log(`✅ [Next表单] 所有 ${totalFormsCount} 个表单已处理完成！`);
        showAllFormsCompletedView();
      } else {
        // 显示下一个表单的处理界面
        const nextFormKey = formsQueue[currentFormIndex];
        console.log(`🔄 [Next表单] 移动到下一个表单: ${nextFormKey} (${currentFormIndex + 1}/${totalFormsCount})`);
        showFormProcessingView();
      }
      
    } catch (error) {
      console.error('❌ [Next表单] 移动失败:', error);
      reportStatus(`Failed to move to next form: ${error.message}`, 'error');
    }
  }

  // 🔥 新增：显示所有表单完成界面
  function showAllFormsCompletedView() {
    const container = qs('crfannotation-container');
    if (!container) return;
    
    console.log('🎉 显示所有表单完成界面');
    
    container.innerHTML = `
      <div class="crfannotation-wrapper">
        <h3 class="ms-font-l">📋 CRF Annotation</h3>

        <div class="annotation-content" style="text-align: center; padding: 40px 20px;">
          <div class="annotation-completed">
            <i class="ms-Icon ms-Icon--CheckMark ms-font-xxl" style="color: #107c10; margin-bottom: 20px;"></i>
            <h4 class="ms-font-l">All Forms Processed and Saved!</h4>
            <p class="ms-font-m" style="color: #605e5c; margin: 20px 0;">
              All ${totalFormsCount} forms have been processed with GPT and saved to database.<br/>
              The CRF Annotation Checklist is now complete in Excel.
            </p>
            
            <div style="margin: 30px 0;">
              <p class="ms-font-s" style="color: #323130; margin-bottom: 20px;">
                ✅ ${totalFormsCount} forms processed successfully<br/>
                💾 All data saved to database<br/>
                📋 Ready for PDF annotation or Spec generation
              </p>
            </div>
          </div>
        </div>

        <div style="text-align: center; margin-top: 24px;">
          <button id="start-pdf-annotation-final-btn" class="ms-Button ms-Button--primary" style="font-size: 16px; padding: 12px 32px; border-radius: 8px; margin-right: 12px;">
            <span class="ms-Button-label">🎨 Start PDF Annotation</span>
          </button>
          <button id="goto-spec-btn" class="ms-Button ms-Button--primary" style="font-size: 16px; padding: 12px 32px; border-radius: 8px;">
            <span class="ms-Button-label">📊 Go to Spec</span>
          </button>
        </div>
      </div>
    `;
    
    // 绑定按钮事件
    setTimeout(() => {
      const pdfBtn = qs('start-pdf-annotation-final-btn');
      const specBtn = qs('goto-spec-btn');
      
      if (pdfBtn) {
        pdfBtn.addEventListener('click', startPdfAnnotationProcess);
      }
      
      if (specBtn) {
        specBtn.addEventListener('click', () => {
          console.log('🔄 导航到Spec页面');
          if (typeof window.showStep === 'function') {
            window.showStep(9); // Spec页面
          }
        });
      }
    }, 50);
  }

  // 🔥 显示Checklist绘制进度界面
  function showChecklistDrawingProgress() {
    const container = qs('crfannotation-container');
    if (!container) return;
    
    container.innerHTML = `
      <div class="crfannotation-wrapper">
        <h3 class="ms-font-l">📋 CRF Annotation</h3>

        <div class="annotation-content" style="text-align: center; padding: 40px 20px;">
          <div class="annotation-progress">
            <i class="ms-Icon ms-Icon--ExcelDocument ms-font-xxl" style="color: #107c10; margin-bottom: 20px;"></i>
            <h4 class="ms-font-l">Drawing Checklist Data...</h4>
            <p class="ms-font-m" style="color: #605e5c; margin: 20px 0;">
              Processing CRF forms and filling Excel checklist.<br/>
              Drawing data form by form with proper buffering.
            </p>
            
            <div class="progress-block" style="max-width:720px;margin:24px auto;text-align:left;">
              <div style="margin:8px 0 4px 0;display:flex;justify-content:space-between;align-items:center;">
                <span class="ms-font-m">📊 Form Processing</span>
                <span id="checklist-progress-text" class="ms-font-s" style="color:#605e5c;">0/0 forms</span>
              </div>
              <div class="progress-bar" style="height:10px;background:#edebe9;border-radius:6px;overflow:hidden;">
                <div id="checklist-progress-fill" style="height:100%;width:0%;background:#107c10;transition:width .3s ease;"></div>
              </div>
              <div id="checklist-percentage" class="ms-font-s" style="text-align:right;color:#605e5c;margin-top:4px;">0%</div>
            </div>

            <div id="checklist-current-status" class="ms-font-s" style="color:#323130; margin-top: 8px;">Starting form processing...</div>
          </div>
        </div>
      </div>
    `;
  }

  // 🔥 更新Checklist绘制进度
  function updateChecklistProgress(currentForm, totalForms, formName) {
    const progressFill = qs('checklist-progress-fill');
    const progressText = qs('checklist-progress-text');
    const progressPercentage = qs('checklist-percentage');
    const statusText = qs('checklist-current-status');
    
    const percentage = totalForms > 0 ? Math.round((currentForm / totalForms) * 100) : 0;
    
    if (progressFill) {
      progressFill.style.width = `${percentage}%`;
    }
    
    if (progressText) {
      progressText.textContent = `${currentForm}/${totalForms} forms`;
    }
    
    if (progressPercentage) {
      progressPercentage.textContent = `${percentage}%`;
    }
    
    if (statusText) {
      if (currentForm === totalForms) {
        statusText.textContent = 'All forms processed successfully!';
      } else {
        statusText.textContent = `Processing form: ${formName}...`;
      }
    }
  }

  // 🔥 显示Checklist绘制完成界面
  function showChecklistCompletedView() {
    const container = qs('crfannotation-container');
    if (!container) return;
    
    container.innerHTML = `
      <div class="crfannotation-wrapper">
        <h3 class="ms-font-l">📋 CRF Annotation</h3>

        <div class="annotation-content" style="text-align: center; padding: 40px 20px;">
          <div class="annotation-initial">
            <i class="ms-Icon ms-Icon--CheckMark ms-font-xxl" style="color: #107c10; margin-bottom: 20px;"></i>
            <h4 class="ms-font-l">Checklist Created Successfully!</h4>
            <p class="ms-font-m" style="color: #605e5c; margin: 20px 0;">
              CRF Annotation Checklist has been created in Excel.<br/>
              Please review the data and store corrections to database.
            </p>
            
            <div style="margin: 30px 0;">
              <p class="ms-font-s" style="color: #323130; margin-bottom: 20px;">
                ✅ Excel checklist created with ${checklistProgress.processedForms} forms<br/>
                🎯 Ready to store corrected data to database
              </p>
            </div>
          </div>
        </div>

        <div style="text-align: center; margin-top: 24px;">
          <button id="store-corrected-data-btn-final" class="ms-Button ms-Button--primary" style="font-size: 16px; padding: 12px 32px; border-radius: 8px; margin-right: 12px;">
            <span class="ms-Button-label">💾 Store Corrected Annotation to Database</span>
          </button>
        </div>
        
        <!-- PDF annotation button will be shown after storing data -->
        <div id="pdf-annotation-section" style="text-align: center; margin-top: 16px; display: none;">
          <p class="ms-font-m" style="color: #107c10; margin-bottom: 16px;">
            ✅ Successfully stored to database!
          </p>
          <button id="start-pdf-annotation-btn" class="ms-Button ms-Button--primary" style="font-size: 16px; padding: 12px 32px; border-radius: 8px;">
            <span class="ms-Button-label">🎨 Start PDF Annotation</span>
          </button>
        </div>
      </div>
    `;
    
    // 绑定最终的Store按钮（确保可用）
    const finalStoreBtn = qs('store-corrected-data-btn-final');
    const startPdfBtn = qs('start-pdf-annotation-btn');
    
    if (finalStoreBtn) {
      finalStoreBtn.disabled = false; // 确保可用
      finalStoreBtn.addEventListener('click', storeCorrectedDataToDatabase);
    }
    
    if (startPdfBtn) {
      startPdfBtn.addEventListener('click', startPdfAnnotationProcess);
    }
  }

  // 创建CRF Annotation Checklist工作表
  /*
  async function createCrfAnnotationChecklist() {
    try {
      console.log('📊 Creating CRF Annotation Checklist in Excel...');
      
      // 🔥 删除重复的状态检查，直接创建Excel表格
      console.log('✅ Proceeding with Excel creation (status already verified)');
      
      // 显示Excel创建进度界面
      showExcelCreationProgress();
      
      // Step 1: 创建工作表和表头（独立的Excel.run，确保表头落地）
      await Excel.run(async (context) => {
        console.log('📄 Step 1: Creating worksheet and headers...');
        
        // 检查是否已存在同名工作表
        const worksheets = context.workbook.worksheets;
        worksheets.load("items/name");
        await context.sync();
        
        let sheetName = "CRF Annotation Checklist";
        let counter = 1;
        
        // 如果存在同名sheet，添加数字后缀
        while (worksheets.items.some(ws => ws.name === sheetName)) {
          counter++;
          sheetName = `CRF Annotation Checklist ${counter}`;
        }
        
        console.log(`📄 Creating new sheet: ${sheetName}`);
        
        // 保存工作表名称到全局变量
        createdSheetName = sheetName;
        
        // 创建新的工作表
        const worksheet = worksheets.add(sheetName);
        worksheet.activate();
        await context.sync();
        
        // 设置表头（6列）
        const headers = [
          ["Form Name", "Form Mapping", "Page Number", "Question Number", "Question", "Question Variable"]
        ];
        
        const headerRange = worksheet.getRange("A1:F1");
        headerRange.values = headers;
        
        // 设置表头格式
        headerRange.format.font.bold = true;
        headerRange.format.fill.color = "#E1F5FE"; // 淡蓝色背景
        
        await context.sync(); // ✅ 表头一定落地
        
        // 自动调整列宽
        try {
          headerRange.format.autofitColumns();
          await context.sync();
        } catch (formatError) {
          console.warn('⚠️ Could not adjust column width:', formatError.message);
        }
        
        console.log('✅ CRF Annotation Checklist headers created successfully');
      });
      
      // Step 2: 分批填充数据（独立的Excel.run）
      await fillCrfDataToExcel();
      
      // 给用户反馈
      reportStatus('✅ CRF Annotation Checklist created and populated in Excel!', 'success');
      
    } catch (error) {
      console.error('❌ Failed to create CRF Annotation Checklist:', error);
      console.error('🔍 错误详细信息:', {
        message: error.message,
        stack: error.stack,
        currentStudyId: currentStudyId,
        API_BASE_URL: API_BASE_URL,
        createdSheetName: createdSheetName
      });
      console.warn('⚠️ Excel checklist creation failed, but continuing with main flow');
      reportStatus('⚠️ Could not create Excel checklist, but SDTM analysis completed successfully.', 'warning');
    }
  }
  */

  // 填充CRF数据到Excel工作表（按Form逐个处理）
  /*
  async function fillCrfDataToExcel() {
    try {
      console.log('📊 开始按Form逐个填充CRF数据...');
      
      // 🔍 检查关键变量
      if (!createdSheetName || !currentStudyId || !API_BASE_URL) {
        throw new Error('Missing required variables for Excel data filling');
      }
      
      // Step 1: 获取所有Form列表
      console.log('🌐 获取CRF Form列表...');
      const formListResponse = await fetch(`${API_BASE_URL}/api/studies/${currentStudyId}/crf-form-list`);
      
      if (!formListResponse.ok) {
        throw new Error(`Failed to get form list: ${formListResponse.status}`);
      }
      
      const formListResult = await formListResponse.json();
      if (!formListResult.success) {
        throw new Error(formListResult.message || 'Failed to get form list');
      }
      
      const allFormKeys = formListResult.data.formKeys;
      const totalForms = allFormKeys.length;
      
      console.log(`📋 获取到 ${totalForms} 个Forms:`, allFormKeys);
      
      // 初始化进度
      updateExcelProgress(0, totalForms, 0, totalForms);
      
      let currentRow = 2; // 从第2行开始（第1行是表头）
      let totalRowsFilled = 0;
      
      // Step 2: 逐个Form处理
      for (let formIndex = 0; formIndex < allFormKeys.length; formIndex++) {
        const formKey = allFormKeys[formIndex];
        
        try {
          console.log(`🔄 处理Form ${formIndex + 1}/${totalForms}: ${formKey}`);
          
          // Step 2.1: 获取单个Form的Excel数据
          console.log(`🌐 获取Form ${formKey} 的数据...`);
          const response = await fetch(`${API_BASE_URL}/api/studies/${currentStudyId}/crf-excel-data-by-form?formKey=${encodeURIComponent(formKey)}`);
          
          if (!response.ok) {
            throw new Error(`HTTP ${response.status}: ${response.statusText}`);
          }
          
          const result = await response.json();
          
          if (!result.success || !Array.isArray(result.data.rows)) {
            throw new Error(result.message || 'Invalid form data format');
          }
          
          const formRows = result.data.rows;
          console.log(`📊 Form ${formKey}: 获取到 ${formRows.length} 行数据`);
          
          // Step 2.2: 立即写入Excel
          if (formRows.length > 0) {
            const endRow = currentRow + formRows.length - 1;
            
            console.log(`📝 写入Form ${formKey} 到Excel (行${currentRow}-${endRow})...`);
            
            await Excel.run(async (context) => {
              const worksheet = context.workbook.worksheets.getItem(createdSheetName);
              const dataRange = worksheet.getRange(`A${currentRow}:F${endRow}`);
              dataRange.values = formRows;
              
              await context.sync();
              console.log(`✅ Form ${formKey} 的 ${formRows.length} 行数据已写入Excel`);
            });
            
            currentRow = endRow + 1;
            totalRowsFilled += formRows.length;
          }
          
          // Step 2.3: 更新进度
          updateExcelProgress(formIndex + 1, totalForms, formIndex + 1, totalForms);
          console.log(`✅ Form ${formIndex + 1}/${totalForms} 完成: ${formKey} (总行数: ${totalRowsFilled})`);
          
          // Step 2.4: 缓冲延迟（除了最后一个Form）
          if (formIndex < allFormKeys.length - 1) {
            console.log('⏳ Form间缓冲延迟...');
            await new Promise(resolve => setTimeout(resolve, 300)); // 300ms缓冲
          }
          
        } catch (formError) {
          console.error(`❌ Form ${formKey} 处理失败:`, formError.message);
          console.log(`🔄 继续处理下一个Form...`);
        }
      }
      
      // Step 3: 最后调整所有列宽
      if (totalRowsFilled > 0) {
        console.log('🎨 自动调整列宽...');
        try {
          await Excel.run(async (context) => {
            const worksheet = context.workbook.worksheets.getItem(createdSheetName);
            const fullRange = worksheet.getRange(`A1:F${1 + totalRowsFilled}`);
            fullRange.format.autofitColumns();
            await context.sync();
            console.log('✅ 列宽自动调整完成');
          });
        } catch (formatError) {
          console.warn('⚠️ 无法自动调整列宽:', formatError.message);
        }
      }
      
      console.log(`✅ 成功填充 ${totalRowsFilled} 行CRF数据到Excel，处理了 ${totalForms} 个Forms`);
      
      // Excel创建完成后，延迟显示最终界面
      setTimeout(() => {
        showSdtmCompletedView();
      }, 1000);
      
    } catch (error) {
      console.error('❌ 填充CRF数据到Excel失败:', error);
      console.warn('⚠️ Excel数据填充失败，但表格结构已创建');
      
      // 即使Excel填充失败，也显示完成界面
      setTimeout(() => {
        showSdtmCompletedView();
        reportStatus('⚠️ Excel表格已创建但数据填充部分失败，您仍可以继续操作。', 'warning');
      }, 1000);
    }
  }
  */

  // 从Excel工作表读取所有数据
  async function readExcelChecklistData() {
    try {
      console.log('📊 Reading data from CRF Annotation Checklist...');
      
      return await Excel.run(async (context) => {
        // 查找CRF Annotation Checklist工作表
        const worksheets = context.workbook.worksheets;
        worksheets.load("items/name");
        await context.sync();
        
        // 找到checklist工作表（可能有数字后缀）
        const checklistSheet = worksheets.items.find(ws => 
          ws.name.startsWith("CRF Annotation Checklist")
        );
        
        if (!checklistSheet) {
          throw new Error('CRF Annotation Checklist worksheet not found');
        }
        
        console.log(`📄 Found worksheet: ${checklistSheet.name}`);
        
        // 确保工作表是活动状态
        checklistSheet.activate();
        await context.sync();
        
        // 读取所有使用的数据范围（加载更多属性确保数据完整）
        const usedRange = checklistSheet.getUsedRange();
        usedRange.load(['values', 'rowIndex', 'columnIndex']);
        await context.sync();
        
        const allData = usedRange.values;
        if (!Array.isArray(allData) || allData.length < 2) {
          throw new Error('No data found in Excel worksheet');
        }
        
        // 分离表头和数据行
        const headers = allData[0]; // 第1行是表头
        const dataRows = allData.slice(1); // 第2行开始是数据
        
        console.log(`📊 Read ${dataRows.length} data rows from Excel`);
        
        return {
          headers,
          rows: dataRows
        };
      });
      
    } catch (error) {
      console.error('❌ Failed to read Excel checklist data:', error);
      throw error;
    }
  }

  // 存储修正后的数据到数据库（分批处理）
  async function storeCorrectedDataToDatabase() {
    try {
      console.log('💾 Starting to store corrected data to database (batch mode)...');
      
      // 显示存储进度界面
      showStoringProgressView();
      
      // 读取Excel数据
      const excelData = await readExcelChecklistData();
      console.log(`📊 Read ${excelData.rows.length} rows from Excel`);
      console.log('📋 Excel数据预览:', excelData.rows.slice(0, 3)); // 显示前3行数据
      
      // 🔧 按Form Name分组Excel数据
      const rowsByForm = {};
      excelData.rows.forEach(row => {
        const formName = row[0]; // Form Name在第一列
        if (!rowsByForm[formName]) {
          rowsByForm[formName] = [];
        }
        rowsByForm[formName].push(row);
      });
      
      const formNames = Object.keys(rowsByForm);
      const totalForms = formNames.length;
      const batchSize = 3;
      const totalBatches = Math.ceil(totalForms / batchSize);
      
      console.log(`📊 Data grouped by forms: ${totalForms} forms, ${totalBatches} batches`);
      console.log('📝 Form names:', formNames);
      console.log('📊 Rows per form:', Object.keys(rowsByForm).map(formName => ({
        formName,
        rowCount: rowsByForm[formName].length
      })));
      
      // 初始化存储进度
      updateStoringProgress(0, totalBatches);
      
      // 🔧 分批发送数据
      for (let batchIndex = 0; batchIndex < totalBatches; batchIndex++) {
        try {
          const start = batchIndex * batchSize;
          const end = Math.min(start + batchSize, totalForms);
          const batchFormNames = formNames.slice(start, end);
          
          // 收集当前批次的所有行数据
          const batchRows = [];
          batchFormNames.forEach(formName => {
            batchRows.push(...rowsByForm[formName]);
          });
          
          console.log(`💾 Storing batch ${batchIndex + 1}/${totalBatches}: ${batchFormNames.length} forms, ${batchRows.length} rows`);
          console.log(`📝 Batch ${batchIndex + 1} forms:`, batchFormNames);
          
          // 调用分批存储API
          const response = await fetch(`${API_BASE_URL}/api/studies/${currentStudyId}/save-crf-corrected-data-batch`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json'
            },
            body: JSON.stringify({
              batchData: {
                headers: excelData.headers,
                rows: batchRows
              },
              batchIndex,
              totalBatches,
              isLastBatch: batchIndex === totalBatches - 1
            })
          });
          
          if (!response.ok) {
            throw new Error(`HTTP ${response.status}: ${response.statusText}`);
          }
          
          const result = await response.json();
          
          if (!result.success) {
            throw new Error(result.message || `Failed to store batch ${batchIndex + 1}`);
          }
          
          console.log(`✅ Batch ${batchIndex + 1}/${totalBatches} stored successfully`);
          
          // 更新存储进度
          updateStoringProgress(batchIndex + 1, totalBatches, batchFormNames);
          
          // 添加短暂延迟
          if (batchIndex < totalBatches - 1) {
            await new Promise(resolve => setTimeout(resolve, 300));
          }
          
        } catch (batchError) {
          console.error(`❌ Batch ${batchIndex + 1} storage failed:`, batchError);
          throw batchError; // 重新抛出错误，中断整个流程
        }
      }
      
      console.log('✅ All batches stored successfully!');
      
      // 显示成功状态和PDF按钮
      showDataStoredSuccessfully();
      
    } catch (error) {
      console.error('❌ Failed to store corrected data:', error);
      
      // 恢复按钮状态
      const storeBtn = qs('store-corrected-data-btn');
      if (storeBtn) {
        storeBtn.disabled = false;
        storeBtn.innerHTML = '<span class="ms-Button-label">💾 Store Corrected Annotation to Database</span>';
      }
      
      reportStatus(`Failed to store data: ${error.message}`, 'error');
    }
  }

  // 显示数据存储成功后的状态（第四步：只有Start PDF按钮）
  function showDataStoredSuccessfully() {
    console.log('✅ Data stored successfully, showing PDF ready view...');
    
    // 标记存储完成状态
    storedToDb = true;
    
    // 显示PDF准备界面
    showPdfReadyView();
    
    reportStatus('✅ Corrected annotation data stored successfully!', 'success');
  }

  // 显示存储进度界面
  function showStoringProgressView() {
    const container = qs('crfannotation-container');
    if (!container) return;
    
    container.innerHTML = `
      <div class="crfannotation-wrapper">
        <h3 class="ms-font-l">📋 CRF Annotation</h3>

        <div class="annotation-content" style="text-align: center; padding: 40px 20px;">
          <div class="annotation-progress">
            <i class="ms-Icon ms-Icon--Save ms-font-xxl" style="color: #107c10; margin-bottom: 20px;"></i>
            <h4 class="ms-font-l">Storing Corrected Data...</h4>
            <p class="ms-font-m" style="color: #605e5c; margin: 20px 0;">
              Saving your corrected annotation data to database.<br/>
              Processing data in batches to ensure reliability.
            </p>
            
            <div class="progress-block" style="max-width:720px;margin:24px auto;text-align:left;">
              <div style="margin:8px 0 4px 0;display:flex;justify-content:space-between;align-items:center;">
                <span class="ms-font-m">💾 Data Storage</span>
                <span id="storing-progress-text" class="ms-font-s" style="color:#605e5c;">0/0 batches</span>
              </div>
              <div class="progress-bar" style="height:10px;background:#edebe9;border-radius:6px;overflow:hidden;">
                <div id="storing-progress-fill" style="height:100%;width:0%;background:#107c10;transition:width .3s ease;"></div>
              </div>
              <div id="storing-percentage" class="ms-font-s" style="text-align:right;color:#605e5c;margin-top:4px;">0%</div>
            </div>

            <div id="storing-current-status" class="ms-font-s" style="color:#323130; margin-top: 8px;">Preparing to store data...</div>
          </div>
        </div>
      </div>
    `;
  }

  // 显示Excel创建进度界面
  function showExcelCreationProgress() {
    const container = qs('crfannotation-container');
    if (!container) return;
    
    container.innerHTML = `
      <div class="crfannotation-wrapper">
        <h3 class="ms-font-l">📋 CRF Annotation</h3>

        <div class="annotation-content" style="text-align: center; padding: 40px 20px;">
          <div class="annotation-progress">
            <i class="ms-Icon ms-Icon--ExcelDocument ms-font-xxl" style="color: #107c10; margin-bottom: 20px;"></i>
            <h4 class="ms-font-l">Creating Excel Checklist...</h4>
            <p class="ms-font-m" style="color: #605e5c; margin: 20px 0;">
              Generating CRF annotation checklist in Excel.<br/>
              This may take a few moments for large CRF files.
            </p>
            
            <div class="progress-block" style="max-width:720px;margin:24px auto;text-align:left;">
              <div style="margin:8px 0 4px 0;display:flex;justify-content:space-between;align-items:center;">
                <span class="ms-font-m">📊 Excel Creation</span>
                <span id="excel-progress-text" class="ms-font-s" style="color:#605e5c;">0/0 batches</span>
              </div>
              <div class="progress-bar" style="height:10px;background:#edebe9;border-radius:6px;overflow:hidden;">
                <div id="excel-progress-fill" style="height:100%;width:0%;background:#107c10;transition:width .3s ease;"></div>
              </div>
              <div id="excel-percentage" class="ms-font-s" style="text-align:right;color:#605e5c;margin-top:4px;">0%</div>
            </div>

            <div id="excel-current-status" class="ms-font-s" style="color:#323130; margin-top: 8px;">Starting Excel creation...</div>
          </div>
        </div>
      </div>
    `;
  }

  // 更新存储进度
  function updateStoringProgress(currentBatch, totalBatches, currentForms) {
    const progressFill = qs('storing-progress-fill');
    const progressText = qs('storing-progress-text');
    const progressPercentage = qs('storing-percentage');
    const statusText = qs('storing-current-status');
    
    const percentage = totalBatches > 0 ? Math.round((currentBatch / totalBatches) * 100) : 0;
    
    if (progressFill) {
      progressFill.style.width = `${percentage}%`;
    }
    
    if (progressText) {
      progressText.textContent = `${currentBatch}/${totalBatches} batches`;
    }
    
    if (progressPercentage) {
      progressPercentage.textContent = `${percentage}%`;
    }
    
    if (statusText) {
      if (currentBatch === totalBatches) {
        statusText.textContent = 'All data stored successfully!';
      } else if (currentForms && Array.isArray(currentForms)) {
        statusText.textContent = `Storing batch ${currentBatch + 1}/${totalBatches}... (${currentForms.length} forms: ${currentForms.join(', ')})`;
      } else {
        statusText.textContent = `Storing batch ${currentBatch + 1}/${totalBatches}...`;
      }
    }
  }

  // 显示PDF生成进度界面
  function showPdfGenerationProgressView() {
    const container = qs('crfannotation-container');
    if (!container) return;
    
    container.innerHTML = `
      <div class="crfannotation-wrapper">
        <h3 class="ms-font-l">📋 CRF Annotation</h3>

        <div class="annotation-content" style="text-align: center; padding: 40px 20px;">
          <div class="annotation-progress">
            <i class="ms-Icon ms-Icon--FileImage ms-font-xxl" style="color: #d83b01; margin-bottom: 20px;"></i>
            <h4 class="ms-font-l">Generating PDF Annotations...</h4>
            <p class="ms-font-m" style="color: #605e5c; margin: 20px 0;">
              Creating annotated PDF with SDTM variable annotations.<br/>
              Processing forms in batches to handle large documents.
            </p>
            
            <div class="progress-block" style="max-width:720px;margin:24px auto;text-align:left;">
              <div style="margin:8px 0 4px 0;display:flex;justify-content:space-between;align-items:center;">
                <span class="ms-font-m">🎨 PDF Generation</span>
                <span id="pdf-generation-progress-text" class="ms-font-s" style="color:#605e5c;">0/0 batches</span>
              </div>
              <div class="progress-bar" style="height:10px;background:#edebe9;border-radius:6px;overflow:hidden;">
                <div id="pdf-generation-progress-fill" style="height:100%;width:0%;background:#d83b01;transition:width .3s ease;"></div>
              </div>
              <div id="pdf-generation-percentage" class="ms-font-s" style="text-align:right;color:#605e5c;margin-top:4px;">0%</div>
            </div>

            <div id="pdf-generation-current-status" class="ms-font-s" style="color:#323130; margin-top: 8px;">Starting PDF annotation...</div>
          </div>
        </div>
      </div>
    `;
  }

  // 更新PDF生成进度
  function updatePdfGenerationProgress(currentBatch, totalBatches, currentStatus) {
    const progressFill = qs('pdf-generation-progress-fill');
    const progressText = qs('pdf-generation-progress-text');
    const progressPercentage = qs('pdf-generation-percentage');
    const statusText = qs('pdf-generation-current-status');
    
    const percentage = totalBatches > 0 ? Math.round((currentBatch / totalBatches) * 100) : 0;
    
    if (progressFill) {
      progressFill.style.width = `${percentage}%`;
    }
    
    if (progressText) {
      progressText.textContent = `${currentBatch}/${totalBatches} batches`;
    }
    
    if (progressPercentage) {
      progressPercentage.textContent = `${percentage}%`;
    }
    
    if (statusText) {
      if (currentBatch === totalBatches) {
        statusText.textContent = 'PDF annotation completed successfully!';
      } else if (currentStatus) {
        statusText.textContent = currentStatus;
      } else {
        statusText.textContent = `Processing batch ${currentBatch + 1}/${totalBatches}...`;
      }
    }
  }

  // 更新Excel创建进度
  function updateExcelProgress(currentBatch, totalBatches, currentForms, totalForms) {
    const progressFill = qs('excel-progress-fill');
    const progressText = qs('excel-progress-text');
    const progressPercentage = qs('excel-percentage');
    const statusText = qs('excel-current-status');
    
    const percentage = totalBatches > 0 ? Math.round((currentBatch / totalBatches) * 100) : 0;
    
    if (progressFill) {
      progressFill.style.width = `${percentage}%`;
    }
    
    if (progressText) {
      progressText.textContent = `${currentBatch}/${totalBatches} batches`;
    }
    
    if (progressPercentage) {
      progressPercentage.textContent = `${percentage}%`;
    }
    
    if (statusText) {
      if (currentBatch === totalBatches) {
        statusText.textContent = 'Excel checklist created successfully!';
      } else {
        statusText.textContent = `Processing batch ${currentBatch + 1}/${totalBatches}... (${totalForms} forms total)`;
      }
    }
  }

  // 显示SDTM分析完成后的界面（第二步：只有Create Checklist按钮）
  function showSdtmCompletedView() {
    const container = qs('crfannotation-container');
    if (!container) return;
    
    container.innerHTML = `
      <div class="crfannotation-wrapper">
        <h3 class="ms-font-l">📋 CRF Annotation</h3>

        <div class="annotation-content" style="text-align: center; padding: 40px 20px;">
          <div class="annotation-initial">
            <i class="ms-Icon ms-Icon--CheckMark ms-font-xxl" style="color: #107c10; margin-bottom: 20px;"></i>
            <h4 class="ms-font-l">SDTM Analysis Completed!</h4>
            <p class="ms-font-m" style="color: #605e5c; margin: 20px 0;">
              SDTM mapping analysis completed successfully.<br/>
              Next step: Create Excel checklist for review and corrections.
            </p>
            
            <div style="margin: 30px 0;">
              <p class="ms-font-s" style="color: #323130; margin-bottom: 20px;">
                ✅ SDTM mappings generated and saved<br/>
                🎯 Ready to create Excel checklist
              </p>
            </div>
          </div>
        </div>

        <div style="text-align: center; margin-top: 24px;">
          <button id="create-checklist-btn" class="ms-Button ms-Button--primary" style="font-size: 16px; padding: 12px 32px; border-radius: 8px;">
            <span class="ms-Button-label">📄 Create Checklist</span>
          </button>
        </div>
      </div>
    `;
    
    // 🔥 修改：Create Checklist按钮逻辑（逐表单模式）
    const createChecklistBtn = qs('create-checklist-btn');
    
    if (createChecklistBtn) {
      createChecklistBtn.addEventListener('click', async () => {
        try {
          // 禁用Create按钮防止重复点击
          createChecklistBtn.disabled = true;
          createChecklistBtn.innerHTML = '<span class="ms-Button-label">📄 Creating...</span>';
          
          // Step 1: 初始化表单队列
          console.log('🔄 Step 1: 初始化表单队列...');
          await initializeFormsQueue();
          
          // Step 2: 创建Excel表头
          console.log('🔄 Step 2: 创建Excel表头...');
          await createChecklistHeadersOnly();
          
          // Step 3: 显示第一个表单的处理界面（不自动开始处理）
          console.log('🔄 Step 3: 显示第一个表单处理界面...');
          setTimeout(() => {
            showFormProcessingView();
            reportStatus('✅ Checklist headers created. Ready to process forms one by one.', 'success');
          }, 500);
          
        } catch (error) {
          console.error('❌ 创建Checklist失败:', error);
          reportStatus(`Failed to create checklist: ${error.message}`, 'error');
          
          // 恢复Create按钮
          createChecklistBtn.disabled = false;
          createChecklistBtn.innerHTML = '<span class="ms-Button-label">📄 Create Checklist</span>';
        }
      });
    }
  }

  // 🔥 新增：显示准备存储界面（第三步：只有Store按钮）
  function showStoreReadyView() {
    const container = qs('crfannotation-container');
    if (!container) return;
    
    container.innerHTML = `
      <div class="crfannotation-wrapper">
        <h3 class="ms-font-l">📋 CRF Annotation</h3>

        <div class="annotation-content" style="text-align: center; padding: 40px 20px;">
          <div class="annotation-initial">
            <i class="ms-Icon ms-Icon--CheckMark ms-font-xxl" style="color: #107c10; margin-bottom: 20px;"></i>
            <h4 class="ms-font-l">Checklist Created Successfully!</h4>
            <p class="ms-font-m" style="color: #605e5c; margin: 20px 0;">
              CRF Annotation Checklist has been created in Excel.<br/>
              Please review the data and store corrections to database.
            </p>
            
            <div style="margin: 30px 0;">
              <p class="ms-font-s" style="color: #323130; margin-bottom: 20px;">
                ✅ Excel checklist created with ${checklistProgress.processedForms} forms<br/>
                📊 ${checklistProgress.totalForms} forms processed successfully<br/>
                🎯 Ready to store corrected data to database
              </p>
            </div>
          </div>
        </div>

        <div style="text-align: center; margin-top: 24px;">
          <button id="store-corrected-data-btn" class="ms-Button ms-Button--primary" style="font-size: 16px; padding: 12px 32px; border-radius: 8px;">
            <span class="ms-Button-label">💾 Store Corrected Annotation to Database</span>
          </button>
        </div>
      </div>
    `;
    
    // 只绑定Store按钮
    const storeDataBtn = qs('store-corrected-data-btn');
    
    if (storeDataBtn) {
      storeDataBtn.disabled = false; // 确保可用
      storeDataBtn.addEventListener('click', storeCorrectedDataToDatabase);
    }
  }

  // 🔥 新增：显示PDF准备界面（第四步：只有Start PDF按钮）
  function showPdfReadyView() {
    const container = qs('crfannotation-container');
    if (!container) return;
    
    container.innerHTML = `
      <div class="crfannotation-wrapper">
        <h3 class="ms-font-l">📋 CRF Annotation</h3>

        <div class="annotation-content" style="text-align: center; padding: 40px 20px;">
          <div class="annotation-initial">
            <i class="ms-Icon ms-Icon--CheckMark ms-font-xxl" style="color: #107c10; margin-bottom: 20px;"></i>
            <h4 class="ms-font-l">Data Stored Successfully!</h4>
            <p class="ms-font-m" style="color: #605e5c; margin: 20px 0;">
              Corrected annotation data has been saved to database.<br/>
              Final step: Generate annotated PDF with SDTM mappings.
            </p>
            
            <div style="margin: 30px 0;">
              <p class="ms-font-s" style="color: #323130; margin-bottom: 20px;">
                ✅ Checklist data stored in database<br/>
                📋 Corrections saved successfully<br/>
                🎯 Ready to generate annotated PDF
              </p>
            </div>
          </div>
        </div>

        <div style="text-align: center; margin-top: 24px;">
          <button id="start-pdf-annotation-btn" class="ms-Button ms-Button--primary" style="font-size: 16px; padding: 12px 32px; border-radius: 8px;">
            <span class="ms-Button-label">🎨 Start PDF Annotation</span>
          </button>
        </div>
      </div>
    `;
    
    // 只绑定Start PDF按钮
    const startPdfBtn = qs('start-pdf-annotation-btn');
    
    if (startPdfBtn) {
      startPdfBtn.addEventListener('click', startPdfAnnotationProcess);
    }
  }

  // 开始PDF注解生成流程（第二阶段）
  async function startPdfAnnotationProcess() {
    console.log('🎨 Starting PDF annotation process...');
    
    try {
      // 🔧 显示PDF生成专用进度界面
      showPdfGenerationProgressView();
      startPdfProgressPolling();
      
      // Create AbortController for timeout handling
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 15 * 60 * 1000); // 15分钟超时
      
      // Call backend API to generate PDF annotation
      const response = await fetch(`${API_BASE_URL}/api/studies/${currentStudyId}/generate-pdf-annotation-only`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        signal: controller.signal
      });
      
      // Clear timeout timer
      clearTimeout(timeoutId);

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      const result = await response.json();
      
      if (result.success) {
        console.log('✅ PDF annotation generation completed successfully!');
        console.log('📊 Statistics:', result.data);

        // Wait for annotation to be fully ready
        await pollUntilAnnotationReady({ intervalMs: 3000, maxMinutes: 10 });
      } else {
        throw new Error(result.message || 'Failed to generate PDF annotation');
      }
      
    } catch (error) {
      console.error('❌ PDF annotation process failed:', error);
      
      // Handle different types of errors
      let errorMessage = error.message;
      if (error.name === 'AbortError') {
        errorMessage = 'PDF annotation timed out after 15 minutes. This may happen with very large CRF files. Please try again or contact support.';
      }
      
      reportStatus(`PDF annotation failed: ${errorMessage}`, 'error');
    }
  }

  // 显示初始界面（带Start Annotation按钮）
  function showInitialView() {
    const container = qs('crfannotation-container');
    if (!container) return;
    
    container.innerHTML = `
      <div class="crfannotation-wrapper">
        <h3 class="ms-font-l">📋 CRF Annotation</h3>

        <div class="annotation-content" style="text-align: center; padding: 40px 20px;">
          <div class="annotation-initial">
            <i class="ms-Icon ms-Icon--Documentation ms-font-xxl" style="color: #0078d4; margin-bottom: 20px;"></i>
            <h4 class="ms-font-l">Ready to Annotate CRF Documents</h4>
            <p class="ms-font-m" style="color: #605e5c; margin: 20px 0;">
              Your CRF documents have been processed and are ready for annotation.<br/>
              Click the button below to begin the annotation process.
            </p>
            
            <div style="margin: 30px 0;">
              <p class="ms-font-s" style="color: #323130; margin-bottom: 20px;">
                📄 Documents detected and processed<br/>
                🎯 Ready to generate annotated PDF
              </p>
            </div>
          </div>
        </div>

        <div style="text-align: center; margin-top: 24px;">
          <button id="crfannotation-start-btn" class="ms-Button ms-Button--primary" style="font-size: 16px; padding: 12px 32px; border-radius: 8px; margin-right: 12px;">
            <span class="ms-Button-label">🚀 Start Annotation</span>
          </button>
          <button id="crfannotation-skip-btn" class="ms-Button" style="font-size: 16px; padding: 12px 32px; border-radius: 8px;">
            <span class="ms-Button-label">Skip for Now</span>
          </button>
        </div>
      </div>
    `;
    
    // 重新绑定按钮事件
    setTimeout(() => {
      const startBtn = qs('crfannotation-start-btn');
      const skipBtn = qs('crfannotation-skip-btn');
      
      if (startBtn) startBtn.addEventListener('click', startAnnotationProcess);
      if (skipBtn) skipBtn.addEventListener('click', () => {
        // Skip按钮直接触发完成逻辑
        const isFromChatFlow = (window.chatFlowState === 'waiting_for_crf_annotation_finish');
        
        console.log('⏭️ CRF annotation skipped', { 
          isFromChatFlow, 
          pendingTaskAfterAnnotation: window.pendingTaskAfterAnnotation 
        });
        
        if (typeof window.showStep === 'function') {
          window.showStep(1);
        }
        
        if (isFromChatFlow && window.pendingTaskAfterAnnotation) {
          setTimeout(() => {
            window.dispatchEvent(new CustomEvent('crfAnnotationComplete', {
              detail: { 
                fromChatFlow: true,
                pendingTaskAfterAnnotation: window.pendingTaskAfterAnnotation
              }
            }));
          }, 300);
        }
      });
    }, 50);
  }

  // 显示进度界面
  function showProgressView() {
    const container = qs('crfannotation-container');
    if (!container) return;
    
    container.innerHTML = `
      <div class="crfannotation-wrapper">
        <h3 class="ms-font-l">📋 CRF Annotation</h3>

        <div class="annotation-content" style="text-align: center; padding: 40px 20px;">
          <div class="annotation-progress">
            <i class="ms-Icon ms-Icon--Processing ms-font-xxl" style="color: #0078d4; margin-bottom: 20px;"></i>
            <h4 class="ms-font-l">Analyzing SDTM Mappings...</h4>
            <p class="ms-font-m" style="color: #605e5c; margin: 20px 0;">
              Processing your CRF documents with GPT to generate SDTM mappings.<br/>
              This may take a few moments to complete.
            </p>
            
            <div class="progress-block" style="max-width:720px;margin:24px auto;text-align:left;">
              <div style="margin:8px 0 4px 0;display:flex;justify-content:space-between;align-items:center;">
                <span class="ms-font-m">📊 GPT Analysis</span>
                <span id="gpt-progress-text" class="ms-font-s" style="color:#605e5c;">0/0 forms</span>
              </div>
              <div class="progress-bar" style="height:10px;background:#edebe9;border-radius:6px;overflow:hidden;">
                <div id="gpt-progress-fill" style="height:100%;width:0%;background:#0078d4;transition:width .3s ease;"></div>
              </div>
              <div id="gpt-percentage" class="ms-font-s" style="text-align:right;color:#605e5c;margin-top:4px;">0%</div>
            </div>

            <div id="progress-current-status" class="ms-font-s" style="color:#323130; margin-top: 8px;">Starting...</div>
            
          </div>
        </div>
      </div>
    `;
  }

  // 轮询进度
  async function pollProgressOnce() {
    try {
      const resp = await fetch(`${API_BASE_URL}/api/studies/${currentStudyId}/crf-annotation-progress`);
      if (!resp.ok) return null;
      const json = await resp.json();
      return json.success ? json.data : null;
    } catch (_) { return null; }
  }

  function applyProgressToUI(progress){
    if (!progress) return;
    const g = progress.gptAnalysis || { totalForms:0, processedForms:0, percentage:0, status:'pending' };
    const p = progress.pdfDrawing || { totalBatches:0, processedBatches:0, percentage:0, status:'pending' };

    const gFill = qs('gpt-progress-fill');
    const gPct = qs('gpt-percentage');
    const gTxt = qs('gpt-progress-text');
    if (gFill) gFill.style.width = `${Math.min(100, Math.max(0, Math.round(g.percentage||0)))}%`;
    if (gPct) gPct.textContent = `${Math.min(100, Math.max(0, Math.round(g.percentage||0)))}%`;
    if (gTxt) gTxt.textContent = `${g.processedForms||0}/${g.totalForms||0} forms`;


    const statusNode = qs('progress-current-status');
    if (statusNode) {
      statusNode.textContent = progress.currentPhase === 'gpt' ? 'Processing...' : 'Completed';
    }
  }

  // PDF注解专用的进度轮询
  async function startPdfProgressPolling(){
    let isDone = false;
    const tick = async () => {
      if (isDone) return;
      const data = await pollProgressOnce();
      if (data) applyPdfProgressToUI(data);
      
      // Check for PDF completion
      if (data && data.currentPhase === 'completed') { 
        isDone = true; 
        return; 
      }
      
      setTimeout(tick, 2000);
    };
    tick();
  }

  // 更新PDF进度UI
  function applyPdfProgressToUI(progress){
    if (!progress) return;
    const p = progress.pdfDrawing || { totalBatches:0, processedBatches:0, percentage:0, status:'pending' };

    // 更新PDF生成进度条
    updatePdfGenerationProgress(p.processedBatches || 0, p.totalBatches || 0, 
      progress.currentPhase === 'completed' ? 'PDF annotation completed!' : 
      progress.currentPhase === 'pdf' ? `Processing batch ${(p.processedBatches||0) + 1}/${p.totalBatches||0}...` : 
      'Starting PDF annotation...'
    );
  }

  async function startProgressPolling(){
    let isDone = false;
    const tick = async () => {
      if (isDone) return;
      const data = await pollProgressOnce();
      if (data) applyProgressToUI(data);
      
      // Check for different completion states
      if (data && data.currentPhase === 'completed') { 
        isDone = true; 
        return; 
      }
      
      // Check if GPT analysis completed (new intermediate state)
      if (data && data.currentPhase === 'gpt_completed') {
        isDone = true;
        showSdtmCompletedView();
        return;
      }
      
      setTimeout(tick, 2000);
    };
    tick();
  }

  // 轮询后端状态直到注解完成
  async function pollUntilAnnotationReady(opts){
    const intervalMs = (opts && opts.intervalMs) || 5000;
    const maxMinutes = (opts && opts.maxMinutes) || 30;
    const deadline = Date.now() + maxMinutes * 60 * 1000;
    
    while (Date.now() < deadline) {
      try {
        const response = await fetch(`${API_BASE_URL}/api/studies/${currentStudyId}/crf-annotation-status`);
        if (response.ok) {
          const result = await response.json();
          const annotationStatus = result.data?.annotationStatus;
          if (annotationStatus?.annotationReady && annotationStatus?.downloadUrl) {
            reportStatus('✅ Annotation completed. Download link is ready.', 'success');
            showCompletedViewWithExistingAnnotation(annotationStatus);
            return;
          }
        }
      } catch (e) {
        // 网络抖动忽略，继续轮询
        console.warn('Polling annotation status failed, will retry...', e);
      }
      await new Promise(resolve => setTimeout(resolve, intervalMs));
    }
    reportStatus('Annotation is taking longer than expected. Please check back later.', 'warning');
  }

  // 显示完成界面
  function showCompletedView() {
    const container = qs('crfannotation-container');
    if (!container) return;
    
    container.innerHTML = `
      <div class="crfannotation-wrapper">
        <h3 class="ms-font-l">📋 CRF Annotation</h3>

        <div class="annotation-content" style="text-align: center; padding: 40px 20px;">
          <div class="annotation-completed">
            <i class="ms-Icon ms-Icon--CheckMark ms-font-xxl" style="color: #107c10; margin-bottom: 20px;"></i>
            <h4 class="ms-font-l">Annotation Completed Successfully!</h4>
            <p class="ms-font-m" style="color: #605e5c; margin: 20px 0;">
              Your CRF documents have been successfully annotated.<br/>
              Click the button below to copy the download link.
            </p>
            
            <div style="margin: 30px 0;">
              <p class="ms-font-s" style="color: #323130; margin-bottom: 20px;">
                ✅ Document processing completed<br/>
                📄 Annotated PDF generated<br/>
                📋 Copy link and paste in your browser to download
              </p>
            </div>
          </div>
        </div>

        <div style="text-align: center; margin-top: 24px;">
          <button id="crfannotation-download-btn" class="ms-Button ms-Button--primary" style="font-size: 16px; padding: 12px 32px; border-radius: 8px; margin-right: 12px;">
            <span class="ms-Button-label">📋 Copy Download Link</span>
          </button>
          <button id="crfannotation-dospec-btn" class="ms-Button ms-Button--primary" style="font-size: 16px; padding: 12px 32px; border-radius: 8px;">
            <span class="ms-Button-label">Do Spec</span>
          </button>
        </div>
      </div>
    `;
    
    // 重新绑定按钮事件
    setTimeout(() => {
      const downloadBtn = qs('crfannotation-download-btn');
      const doSpecBtn = qs('crfannotation-dospec-btn');
      
      if (downloadBtn) downloadBtn.addEventListener('click', async () => {
        await downloadAnnotatedPdf();
      });
      
      if (doSpecBtn) doSpecBtn.addEventListener('click', () => {
        const isFromChatFlow = (window.chatFlowState === 'waiting_for_crf_annotation_finish');
        
        console.log('🔄 Navigating to Spec page', { 
          isFromChatFlow, 
          pendingTaskAfterAnnotation: window.pendingTaskAfterAnnotation 
        });
        
        // 如果是从聊天流程来的，设置等待Spec完成的状态
        if (isFromChatFlow && window.pendingTaskAfterAnnotation) {
          window.chatFlowState = 'waiting_for_spec_finish';
          // pendingTaskAfterAnnotation保持不变，传递给Spec页面
        }
        
        // 跳转到Spec页面 (Step 9)
        if (typeof window.showStep === 'function') {
          window.showStep(9);
        } else if (typeof window.TaskPaneController?.showStep === 'function') {
          window.TaskPaneController.showStep(9);
        }
      });
    }, 50);
  }

  // 🔧 **下载函数**: 复制下载链接到剪贴板
  async function downloadAnnotatedPdf() {
    try {
      // 构建下载URL
      const downloadUrl = `${API_BASE_URL}/api/studies/${currentStudyId}/crf-annotated.pdf`;
      console.log('📋 生成下载链接:', downloadUrl);
      
      reportStatus('Preparing download link...', 'info');
      
      // 首先检查文件是否存在（通过HEAD请求）
      try {
        const checkResponse = await fetch(downloadUrl, { method: 'HEAD' });
        if (!checkResponse.ok) {
          throw new Error(`File not ready or not found (HTTP ${checkResponse.status})`);
        }
      } catch (checkError) {
        console.error('❌ 文件检查失败:', checkError);
        reportStatus('Annotated PDF not ready yet. Please try again later.', 'error');
        return;
      }
      
      // 复制下载链接到剪贴板
      try {
        if (navigator.clipboard && navigator.clipboard.writeText) {
          await navigator.clipboard.writeText(downloadUrl);
          console.log('✅ 下载链接已复制到剪贴板');
          reportStatus('✅ Download link copied to clipboard! Please paste it in your browser to download the annotated PDF.', 'success');
        } else {
          // 回退：使用传统的文本选择复制方式
          const textArea = document.createElement('textarea');
          textArea.value = downloadUrl;
          textArea.style.position = 'fixed';
          textArea.style.left = '-9999px';
          textArea.style.opacity = '0';
          document.body.appendChild(textArea);
          textArea.select();
          textArea.setSelectionRange(0, 99999); // 移动设备兼容
          
          const successful = document.execCommand('copy');
          document.body.removeChild(textArea);
          
          if (successful) {
            console.log('✅ 下载链接已复制到剪贴板 (fallback)');
            reportStatus('✅ Download link copied to clipboard! Please paste it in your browser to download the annotated PDF.', 'success');
          } else {
            throw new Error('Copy command failed');
          }
        }
        
        // 显示用户友好的提示
        setTimeout(() => {
          reportStatus(`📋 Link copied! Open your browser and press Ctrl+V (or Cmd+V on Mac) to paste and download.`, 'info');
        }, 2000);
        
      } catch (copyError) {
        console.error('❌ 复制到剪贴板失败:', copyError);
        
        // 如果复制失败，显示链接让用户手动复制
        const container = qs('crfannotation-container');
        if (container) {
          const linkDisplay = document.createElement('div');
          linkDisplay.innerHTML = `
            <div style="background: #f3f2f1; border: 1px solid #d2d0ce; border-radius: 4px; padding: 15px; margin: 20px 0; font-family: monospace;">
              <p style="margin: 0 0 10px 0; font-weight: bold; color: #323130;">📋 Download Link:</p>
              <input type="text" value="${downloadUrl}" readonly 
                     style="width: 100%; padding: 8px; border: 1px solid #8a8886; border-radius: 2px; font-size: 12px;"
                     onclick="this.select();" />
              <p style="margin: 10px 0 0 0; font-size: 12px; color: #605e5c;">
                Click the text box above to select, then copy and paste into your browser.
              </p>
            </div>
          `;
          container.appendChild(linkDisplay);
        }
        
        reportStatus('Copy failed. Please manually copy the download link above.', 'error');
      }
      
    } catch (error) {
      console.error('❌ 下载链接生成失败:', error);
      reportStatus(`Download failed: ${error.message}`, 'error');
    }
  }


  // 🔥 新增：检查注解状态并初始化相应界面（新的三层逻辑）
  async function checkAnnotationStatusAndInitialize() {
    try {
      console.log('🔍 检查CRF注解状态（新三层逻辑）...');
      
      // 调用后端API获取注解状态
      const response = await fetch(`${API_BASE_URL}/api/studies/${currentStudyId}/crf-annotation-status`);
      
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }
      
      const result = await response.json();
      const annotationStatus = result.data?.annotationStatus;
      
      console.log('📊 CRF注解完整状态:', annotationStatus);
      
      // 🔍 第一层检查：是否有CRF数据
      if (!annotationStatus?.hasCrfData) {
        console.log('❌ 没有CRF数据，显示无数据界面');
        showNoCrfDataView();
        return;
      }
      
      // 🔍 第二层检查：SDTM分析是否完成
      const sdtmReady = annotationStatus?.crfSdtmReadyForAnnotation;
      console.log('🧠 SDTM Ready Status:', sdtmReady);
      
      if (!sdtmReady) {
        console.log('🔄 SDTM分析未完成，显示开始注解界面');
        showInitialView();
        return;
      }
      
      // 🔍 第三层：不管PDF是否完成，都创建Excel表格（覆盖模式）
      const annotationReady = annotationStatus?.annotationReady;
      const downloadUrl = annotationStatus?.downloadUrl;
      console.log('📄 Annotation Ready Status:', annotationReady, 'Download URL:', !!downloadUrl);
      
      // 🔧 新逻辑：根据状态显示相应界面
      if (annotationReady && downloadUrl) {
        console.log('🔄 PDF已完成，显示已完成的注解界面');
        showCompletedViewWithExistingAnnotation(annotationStatus);
      } else {
        console.log('🔄 SDTM已完成，显示Create Checklist界面');
        showSdtmCompletedView();
      }
      
    } catch (error) {
      console.error('❌ 检查注解状态失败:', error);
      // 如果检查失败，回退到初始界面
      showInitialView();
    }
  }

  // 🔥 新增：创建Excel表格后显示完成界面
  /*
  async function createCrfAnnotationChecklistThenShowCompleted(annotationStatus) {
    try {
      console.log('🔄 创建Excel表格后显示完成界面...');
      
      // 先创建Excel表格
      await createCrfAnnotationChecklist();
      
      // 短暂延迟后显示完成界面
      setTimeout(() => {
        console.log('✅ Excel创建完成，显示完成界面');
        showCompletedViewWithExistingAnnotation(annotationStatus);
      }, 1500);
      
    } catch (error) {
      console.error('❌ 创建Excel后显示完成界面失败:', error);
      // 即使Excel创建失败，也显示完成界面
      showCompletedViewWithExistingAnnotation(annotationStatus);
    }
  }
  */

  // 🔥 新增：显示已完成注解的界面（从数据库获取下载链接）
  function showCompletedViewWithExistingAnnotation(annotationStatus) {
    const container = qs('crfannotation-container');
    if (!container) return;
    
    const annotatedDate = annotationStatus.annotatedAt ? 
      new Date(annotationStatus.annotatedAt).toLocaleString() : 'Unknown';
    
    container.innerHTML = `
      <div class="crfannotation-wrapper">
        <h3 class="ms-font-l">📋 CRF Annotation</h3>

        <div class="annotation-content" style="text-align: center; padding: 40px 20px;">
          <div class="annotation-completed">
            <i class="ms-Icon ms-Icon--CheckMark ms-font-xxl" style="color: #107c10; margin-bottom: 20px;"></i>
            <h4 class="ms-font-l">Annotation Already Completed!</h4>
            <p class="ms-font-m" style="color: #605e5c; margin: 20px 0;">
              Your CRF documents were previously annotated.<br/>
              The annotated PDF is ready for download.
            </p>
            
            <div style="margin: 30px 0;">
              <p class="ms-font-s" style="color: #323130; margin-bottom: 20px;">
                ✅ Annotation completed on ${annotatedDate}<br/>
                📄 Original file: ${annotationStatus.originalName || 'Unknown'}<br/>
                📋 Download link ready
              </p>
            </div>
          </div>
        </div>

        <div style="text-align: center; margin-top: 24px;">
          <button id="crfannotation-download-existing-btn" class="ms-Button ms-Button--primary" style="font-size: 16px; padding: 12px 32px; border-radius: 8px; margin-right: 12px;">
            <span class="ms-Button-label">📋 Copy Download Link</span>
          </button>
          <button id="crfannotation-redraw-btn" class="ms-Button" style="font-size: 16px; padding: 12px 32px; border-radius: 8px; margin-right: 12px;">
            <span class="ms-Button-label">🎨 Re-draw PDF</span>
          </button>
          <button id="crfannotation-reannotate-btn" class="ms-Button" style="font-size: 16px; padding: 12px 32px; border-radius: 8px; margin-right: 12px;">
            <span class="ms-Button-label">🔄 Re-annotate</span>
          </button>
          <button id="crfannotation-dospec-existing-btn" class="ms-Button ms-Button--primary" style="font-size: 16px; padding: 12px 32px; border-radius: 8px;">
            <span class="ms-Button-label">Do Spec</span>
          </button>
        </div>
      </div>
    `;
    
    // 绑定按钮事件
    setTimeout(() => {
      const downloadBtn = qs('crfannotation-download-existing-btn');
      const redrawBtn = qs('crfannotation-redraw-btn');
      const reannotateBtn = qs('crfannotation-reannotate-btn');
      const doSpecExistingBtn = qs('crfannotation-dospec-existing-btn');
      
      if (downloadBtn) downloadBtn.addEventListener('click', () => {
        copyDownloadLinkDirectly(annotationStatus.downloadUrl);
      });
      
      if (redrawBtn) redrawBtn.addEventListener('click', () => {
        handleRedrawPdf(); // 🔥 新增：Re-draw PDF逻辑
      });
      
      if (reannotateBtn) reannotateBtn.addEventListener('click', () => {
        showInitialView(); // 切换到重新注解界面
      });
      
      if (doSpecExistingBtn) doSpecExistingBtn.addEventListener('click', () => {
        // Do Spec逻辑（修改自原来的finish按钮）
        const isFromChatFlow = (window.chatFlowState === 'waiting_for_crf_annotation_finish');
        
        console.log('🔄 Navigating to Spec page from existing annotation', { 
          isFromChatFlow, 
          pendingTaskAfterAnnotation: window.pendingTaskAfterAnnotation 
        });
        
        // 如果是从聊天流程来的，设置等待Spec完成的状态
        if (isFromChatFlow && window.pendingTaskAfterAnnotation) {
          window.chatFlowState = 'waiting_for_spec_finish';
          // pendingTaskAfterAnnotation保持不变，传递给Spec页面
        }
        
        // 跳转到Spec页面 (Step 9)
        if (typeof window.showStep === 'function') {
          window.showStep(9);
        } else if (typeof window.TaskPaneController?.showStep === 'function') {
          window.TaskPaneController.showStep(9);
        }
      });
    }, 50);
  }

  // 🔥 新增：显示没有CRF数据的界面
  function showNoCrfDataView() {
    const container = qs('crfannotation-container');
    if (!container) return;
    
    container.innerHTML = `
      <div class="crfannotation-wrapper">
        <h3 class="ms-font-l">📋 CRF Annotation</h3>

        <div class="annotation-content" style="text-align: center; padding: 40px 20px;">
          <div class="annotation-no-data">
            <i class="ms-Icon ms-Icon--Warning ms-font-xxl" style="color: #ff8c00; margin-bottom: 20px;"></i>
            <h4 class="ms-font-l">No CRF Data Found</h4>
            <p class="ms-font-m" style="color: #605e5c; margin: 20px 0;">
              Please upload a CRF document first before attempting annotation.
            </p>
          </div>
        </div>

        <div style="text-align: center; margin-top: 24px;">
          <button id="crfannotation-back-btn" class="ms-Button ms-Button--primary" style="font-size: 16px; padding: 12px 32px; border-radius: 8px;">
            <span class="ms-Button-label">← Back to Upload</span>
          </button>
        </div>
      </div>
    `;
    
    // 绑定返回按钮
    setTimeout(() => {
      const backBtn = qs('crfannotation-back-btn');
      if (backBtn) backBtn.addEventListener('click', () => {
        if (typeof window.showStep === 'function') {
          window.showStep(1); // 返回主页面
        }
      });
    }, 50);
  }

  // 🔥 新增：直接复制已存在的下载链接
  async function copyDownloadLinkDirectly(downloadUrl) {
    try {
      const fullDownloadUrl = `${API_BASE_URL}${downloadUrl}`;
      console.log('📋 复制已存在的下载链接:', fullDownloadUrl);
      
      // 复制到剪贴板
      if (navigator.clipboard && navigator.clipboard.writeText) {
        await navigator.clipboard.writeText(fullDownloadUrl);
        console.log('✅ 下载链接已复制到剪贴板');
        reportStatus('✅ Download link copied to clipboard! Please paste it in your browser to download the annotated PDF.', 'success');
      } else {
        // 回退方法
        const textArea = document.createElement('textarea');
        textArea.value = fullDownloadUrl;
        textArea.style.position = 'fixed';
        textArea.style.left = '-9999px';
        textArea.style.opacity = '0';
        document.body.appendChild(textArea);
        textArea.select();
        textArea.setSelectionRange(0, 99999);
        
        const successful = document.execCommand('copy');
        document.body.removeChild(textArea);
        
        if (successful) {
          console.log('✅ 下载链接已复制到剪贴板 (fallback)');
          reportStatus('✅ Download link copied to clipboard! Please paste it in your browser to download the annotated PDF.', 'success');
        } else {
          throw new Error('Copy command failed');
        }
      }
      
      // 显示用户友好的提示
      setTimeout(() => {
        reportStatus(`📋 Link copied! Open your browser and press Ctrl+V (or Cmd+V on Mac) to paste and download.`, 'info');
      }, 2000);
      
    } catch (copyError) {
      console.error('❌ 复制到剪贴板失败:', copyError);
      
      // 如果复制失败，显示链接让用户手动复制
      const container = qs('crfannotation-container');
      if (container) {
        const linkDisplay = document.createElement('div');
        linkDisplay.innerHTML = `
          <div style="background: #f3f2f1; border: 1px solid #d2d0ce; border-radius: 4px; padding: 15px; margin: 20px 0; font-family: monospace;">
            <p style="margin: 0 0 10px 0; font-weight: bold; color: #323130;">📋 Download Link:</p>
            <input type="text" value="${fullDownloadUrl}" readonly 
                   style="width: 100%; padding: 8px; border: 1px solid #8a8886; border-radius: 2px; font-size: 12px;"
                   onclick="this.select();" />
            <p style="margin: 10px 0 0 0; font-size: 12px; color: #605e5c;">
              Click the text box above to select, then copy and paste into your browser.
            </p>
          </div>
        `;
        container.appendChild(linkDisplay);
      }
      
      reportStatus('Copy failed. Please manually copy the download link above.', 'error');
    }
  }

  // 🔥 **新增**: Re-draw PDF功能（跳过GPT步骤）
  async function handleRedrawPdf() {
    console.log('🎨 开始Re-draw PDF流程...');
    
    try {
      // 1. 首先检查是否有现成的SDTM数据
      reportStatus('Checking existing SDTM data...', 'info');
      
      const checkResponse = await fetch(`${API_BASE_URL}/api/studies/${currentStudyId}/check-existing-sdtm-data`);
      
      if (!checkResponse.ok) {
        throw new Error(`Check failed: HTTP ${checkResponse.status}`);
      }
      
      const checkResult = await checkResponse.json();
      console.log('📊 SDTM数据检查结果:', checkResult);
      
      if (!checkResult.hasExistingData) {
        // 没有现成数据，显示错误弹窗
        showNoDataDialog();
        return;
      }
      
      console.log('✅ 检测到现成SDTM数据，开始Re-draw PDF...');
      reportStatus('Existing SDTM data found. Re-drawing PDF (skipping GPT analysis)...', 'info');
      
      // 2. 切换到进度界面
      showRedrawProgressView();
      
      // 3. 调用Re-draw API
      const redrawResponse = await fetch(`${API_BASE_URL}/api/studies/${currentStudyId}/redraw-crf-annotation-pdf`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        }
      });
      
      if (!redrawResponse.ok) {
        const errorData = await redrawResponse.json();
        if (errorData.code === 'NO_EXISTING_DATA') {
          showNoDataDialog();
          return;
        }
        throw new Error(`Re-draw failed: HTTP ${redrawResponse.status}: ${errorData.message || redrawResponse.statusText}`);
      }
      
      const redrawResult = await redrawResponse.json();
      console.log('✅ Re-draw PDF成功:', redrawResult);
      
      // 4. 开始轮询直到完成
      reportStatus('Re-drawing PDF... This may take a few moments.', 'info');
      await pollUntilAnnotationReady({ intervalMs: 3000, maxMinutes: 15 });
      
    } catch (error) {
      console.error('❌ Re-draw PDF失败:', error);
      reportStatus(`Re-draw failed: ${error.message}`, 'error');
      
      // 失败后返回到之前的界面
      setTimeout(() => {
        checkAnnotationStatusAndInitialize();
      }, 2000);
    }
  }

  // 🔥 **新增**: 显示Re-draw进度界面
  function showRedrawProgressView() {
    const container = qs('crfannotation-container');
    if (!container) return;
    
    container.innerHTML = `
      <div class="crfannotation-wrapper">
        <h3 class="ms-font-l">📋 CRF Annotation</h3>

        <div class="annotation-content" style="text-align: center; padding: 40px 20px;">
          <div class="annotation-progress">
            <i class="ms-Icon ms-Icon--Processing ms-font-xxl" style="color: #0078d4; margin-bottom: 20px;"></i>
            <h4 class="ms-font-l">Re-drawing PDF Annotations...</h4>
            <p class="ms-font-m" style="color: #605e5c; margin: 20px 0;">
              Using existing SDTM mappings to generate annotated PDF.<br/>
              This process skips AI analysis and saves costs.
            </p>
            
            <div class="progress-indicator" style="margin: 30px 0;">
              <div class="ms-Spinner">
                <div class="ms-Spinner-circle ms-Spinner-circle--large"></div>
              </div>
            </div>
            
            <p class="ms-font-s" style="color: #323130; margin-bottom: 30px;">
              🚀 Using existing SDTM data (GPT skipped)<br/>
              🎨 Re-generating annotation coordinates...<br/>
              📄 Creating new annotated PDF...
            </p>
          </div>
        </div>
      </div>
    `;
  }

  // 🔥 **新增**: 显示无数据弹窗
  function showNoDataDialog() {
    console.log('❌ 没有现成SDTM数据，显示错误提示');
    
    // 使用alert作为简单的弹窗实现
    // 在实际生产环境中，可以用更优雅的模态框替代
    const message = `No existing SDTM mapping data found.
    
To use Re-draw PDF, you need to run full annotation first.
This will generate the SDTM mappings needed for re-drawing.

Would you like to run full annotation instead?`;
    
    if (confirm(message)) {
      console.log('✅ 用户选择运行完整注解');
      showInitialView(); // 切换到完整注解界面
    } else {
      console.log('⏭️ 用户取消，保持当前界面');
      // 什么都不做，保持当前界面
    }
  }

  // 已弃用：使用 showInitialView() 代替

  window.initCrfAnnotationPage = function initCrfAnnotationPage(cfg){
    console.log('🚀 Initializing CRF Annotation page with config:', cfg);
    console.log('🔍 调试 - 前端初始化参数:', {
      API_BASE_URL: cfg?.API_BASE_URL,
      studyId: cfg?.studyId,
      container: !!cfg?.container
    });
    
    if (cfg && cfg.API_BASE_URL) API_BASE_URL = cfg.API_BASE_URL;
    if (cfg && cfg.studyId) currentStudyId = cfg.studyId;
    
    console.log('🔍 调试 - 设置后的全局变量:', {
      API_BASE_URL: API_BASE_URL,
      currentStudyId: currentStudyId
    });
    
    // 🔥 新增：先检查注解状态，再决定显示哪个界面
    checkAnnotationStatusAndInitialize();
    
    console.log('✅ CRF Annotation page initialized');
  };
})();

