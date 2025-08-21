/*
 * mainpage.js - Step 1 (AI Assistant) & Step 2 (Protocol Upload) 模块
 * 职责：用户引导和数据输入
 */

// Global variables (injected from controller)
// const API_BASE_URL - 在主文件中定义
// let uploadedProtocol - 在主文件中定义  
// window.currentDocumentId - 全局状态
// window.pendingConfirmation - AI确认状态
// let lastParsedCommand - AI解析结果
// window.uploadContext - upload entry context ('default' | 'from_chat')

// ===== AI Assistant 模块 (Step 1) =====

// 初始化聊天界面
function initChatInterface() {
  const chatInput = document.getElementById('chat-input');
  const chatSendBtn = document.getElementById('chat-send-btn');
  
  if (chatInput && chatSendBtn) {
    // 发送按钮点击事件
    chatSendBtn.addEventListener('click', handleChatSend);
    
    // 输入框回车事件
    chatInput.addEventListener('keypress', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        handleChatSend();
      }
    });
    
    // 输入框焦点事件
    chatInput.addEventListener('input', () => {
      const sendBtn = document.getElementById('chat-send-btn');
      const hasText = chatInput.value.trim().length > 0;
      sendBtn.disabled = !hasText;
    });
  }
}

// 🔥 重置AI聊天界面到初始状态
function resetAIChatInterface() {
  const chatMessages = document.getElementById('chat-messages');
  const chatInput = document.getElementById('chat-input');
  const chatSendBtn = document.getElementById('chat-send-btn');
  
  if (chatMessages) {
    // 清空所有聊天消息
    chatMessages.innerHTML = '';
    
    // 重新添加初始欢迎消息
    const initialMessage = document.createElement('div');
    initialMessage.className = 'message ai-message';
    initialMessage.innerHTML = `
      <div class="message-content">
        Hello! What would you like to do today? 
        <br><br>You can say something like:
        <br>• "I want to do Phase II study cost analysis for study SK123-kbi"
        <br>• "Help me estimate costs for an oncology trial (study number: ABC-123)"
        <br>• "I need SDTM mapping for study SK123-kbi protocol"
      </div>
    `;
    chatMessages.appendChild(initialMessage);
  }
  
  // 清空输入框
  if (chatInput) {
    chatInput.value = '';
  }
  
  // 重置发送按钮状态
  if (chatSendBtn) {
    chatSendBtn.disabled = true;
  }
  
  // 重置相关状态变量
  pendingConfirmation = null;
  lastParsedCommand = null;
  
  console.log('✅ AI聊天界面已重置到初始状态');
}

// Create an action bubble with a primary button inside the chat area
function addActionBubble(label, actionId) {
  const chatMessages = document.getElementById('chat-messages');
  const messageDiv = document.createElement('div');
  messageDiv.className = 'message ai-message';
  messageDiv.innerHTML = `
    <div class="message-content">
      <button class="ms-Button ms-Button--primary" data-action-id="${actionId}">
        <span class="ms-Button-label">${label}</span>
      </button>
    </div>`;
  chatMessages.appendChild(messageDiv);
  chatMessages.scrollTop = chatMessages.scrollHeight;
}

// Delegate click actions for chat action bubbles
document.addEventListener('click', (e) => {
  const target = e.target.closest('[data-action-id]');
  if (!target) return;
  const actionId = target.getAttribute('data-action-id');
  if (actionId === 'navigate_to_upload') {
    // Mark context and navigate to upload step
    try { window.uploadContext = 'from_chat'; } catch (_) {}
    if (moduleConfig && typeof moduleConfig.showStep === 'function') {
      moduleConfig.showStep(2);
    } else if (typeof window.showStep === 'function') {
      window.showStep(2);
    }
  }
});

// 处理聊天发送（调用后端解析 → 确认 → 查库 → 导航）
async function handleChatSend() {
  const chatInput = document.getElementById('chat-input');
  const userMessage = chatInput.value.trim();
  if (!userMessage) return;

  addChatMessage(userMessage, 'user');
  chatInput.value = '';
  document.getElementById('chat-send-btn').disabled = true;

  // 检查是否在等待确认状态
  if (pendingConfirmation) {
    await handleConfirmationResponse(userMessage);
    return;
  }

  showTypingIndicator();
  try {
    const parsed = await callAssistantParseCommand(userMessage);
    hideTypingIndicator();

    if (!parsed || (!parsed.studyIdentifier && !parsed.matchedTask)) {
      // Generic entry: allow starting a new project quickly
      if (userMessage.toLowerCase().includes('start') || userMessage.toLowerCase().includes('new project') || userMessage.toLowerCase().includes('upload')) {
        addChatMessage("Let me take you to start a new project by uploading your protocol.", 'ai');
        addActionBubble('Click to upload protocol', 'navigate_to_upload');
        return;
      }
      addChatMessage("I couldn't understand the study number or task. Supported tasks are: Cost Estimate, SAS Analysis. Please try e.g. 'I want to do Cost Estimate for study SK123-KBI', or say 'start new project'.", 'ai');
      return;
    }

    lastParsedCommand = parsed;
    const studyText = parsed.studyIdentifier ? parsed.studyIdentifier : '(study number not provided)';
    const taskText = parsed.matchedTask ? parsed.matchedTask.name : '(task not recognized)';
    askForConfirmation(studyText, taskText, parsed.matchedTask ? parsed.matchedTask.key : null);
  } catch (e) {
    hideTypingIndicator();
    addChatMessage('Sorry, parsing failed. Please try again, or click below to upload a protocol.', 'ai');
    addActionBubble('Click to upload protocol', 'navigate_to_upload');
  }
}

// 调用后端AI解析命令
async function callAssistantParseCommand(text) {
  const resp = await fetch(`${moduleConfig.API_BASE_URL}/api/v2/parse-command`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text })
  });
  if (!resp.ok) throw new Error('parse failed');
  const data = await resp.json();
  return data?.data || null;
}

// 请求用户确认
function askForConfirmation(studyIdentifier, taskName, taskKey) {
  const msg = `Did you mean you want ${taskName} for study ${studyIdentifier}?`;
  addChatMessage(msg, 'ai');
  
  // 设置等待确认状态
  pendingConfirmation = {
    studyIdentifier,
    taskName,
    taskKey
  };
}

// 处理确认回复
async function handleConfirmationResponse(userMessage) {
  // 解析用户意向 (现在是同步的)
  const intent = parseYesNoIntent(userMessage);
  
  if (intent === 'yes') {
    const { studyIdentifier, taskKey } = pendingConfirmation;
    pendingConfirmation = null;
    
    if (!taskKey) {
      addChatMessage('Task not recognized. Supported tasks: Cost Estimate, SAS Analysis. Please rephrase your request.', 'ai');
      return;
    }
    
    showTypingIndicator();
    try {
      const lookup = await callAssistantLookupStudyTask(studyIdentifier, taskKey);
      hideTypingIndicator();
      
      // 处理查找结果，包装在try-catch中防止handleLookupResult内部错误影响
      try {
        await handleLookupResult(lookup);
      } catch (handleErr) {
        console.error('HandleLookupResult error:', handleErr);
        // 这里不添加错误消息，因为正确的消息已经添加了
      }
    } catch (err) {
      hideTypingIndicator();
      console.error('Lookup API error:', err);
      addChatMessage('We could not find the corresponding study.', 'ai');
      await safeDelayedNavigation(2); // 跳转到Upload
    }
  } else if (intent === 'no') {
    pendingConfirmation = null;
    addChatMessage("Please tell me again what you want to do. For example: 'I want to do Cost Estimate for study SK123-KBI'.", 'ai');
  } else {
    addChatMessage("Please answer 'yes' or 'no'.", 'ai');
  }
  
  document.getElementById('chat-send-btn').disabled = false;
}

// 解析Yes/No意向 (简化版本，不依赖AI API)
function parseYesNoIntent(text) {
  const lowerText = text.toLowerCase().trim();
  
  // 各种Yes的表达方式
  const yesPatterns = [
    'yes', 'y', 'yeah', 'yep', 'correct', 'right', 'true', 'ok', 'okay', 
    'sure', 'exactly', 'that\'s right', 'confirm', 'confirmed', 'agreed'
  ];
  
  // 各种No的表达方式  
  const noPatterns = [
    'no', 'n', 'nope', 'wrong', 'incorrect', 'false', 'not right', 
    'not correct', 'that\'s wrong', 'cancel', 'redo'
  ];
  
  if (yesPatterns.some(pattern => lowerText.includes(pattern))) {
    return 'yes';
  } else if (noPatterns.some(pattern => lowerText.includes(pattern))) {
    return 'no';
  }
  
  return 'unclear';
}

// 调用后端查找study和task状态
async function callAssistantLookupStudyTask(studyIdentifier, taskKey) {
  console.log('🔍 [DEBUG] API Call - lookup study task:');
  console.log('  - studyIdentifier:', studyIdentifier);
  console.log('  - taskKey:', taskKey);
  console.log('  - API_BASE_URL:', moduleConfig.API_BASE_URL);
  
  const resp = await fetch(`${moduleConfig.API_BASE_URL}/api/v2/lookup-study-task`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ studyIdentifier, taskKey })
  });
  
  console.log('🔍 [DEBUG] API Response status:', resp.status);
  
  if (!resp.ok) throw new Error('lookup failed');
  const data = await resp.json();
  
  console.log('🔍 [DEBUG] API Response data:', JSON.stringify(data, null, 2));
  
  return data?.data || null;
}

// 🔥 根据数据库状态确定目标步骤
function getTargetStepByStatus(currentStatus, taskKey) {
  // 对于Cost Estimate任务，基于sdtmAnalysisStatus进行精确路由
  if (taskKey === 'costEstimate') {
    switch (currentStatus) {
      case null:
      case undefined:
        // 任务刚开始，用户还没有进行项目选择
        return 3; // Step 3: Project Selection
        
      case 'project_selection_done':
        // 用户已完成项目选择，需要进行AI分析
        return 4; // Step 4: Analyzing Protocol (会自动触发分析)
        
      case 'sdtm_ai_analysis_done':
        // AI分析已完成，用户需要查看并确认结果
        return 5; // Step 5: SDTM Analysis Results
        
      case 'user_confirmed_sdtm_done':
        // 用户已确认分析结果，进入最后步骤
        return 6; // Step 6: Completion Confirmation (需要恢复表格)
        
      default:
        console.warn(`⚠️ Unknown status: '${currentStatus}', defaulting to Step 3`);
        return 3; // 默认到项目选择页面
    }
  } else if (taskKey === 'sasAnalysis') {
    // 对于SAS Analysis，暂时保持原有逻辑，直接跳转到第3步
    return 3;
  } else {
    // 未知任务类型，默认跳转到第3步
    console.warn(`⚠️ Unknown taskKey: '${taskKey}', defaulting to Step 3`);
    return 3;
  }
}

// 处理查找结果并路由
async function handleLookupResult(data) {
  console.log('🔍 [DEBUG] handleLookupResult received data:', JSON.stringify(data, null, 2));
  
  if (!data || data.foundStudy === false) {
    console.log('🔍 [DEBUG] Study not found, offering upload action in chat');
    addChatMessage("We could not find the corresponding study.", 'ai');
    addActionBubble('Click to upload protocol', 'navigate_to_upload');
    return;
  }

  // 找到study了
  if (data.isUnfinished === null) {
    // task从未开始 → 跳转到对应task的开始页面
    if (data.taskKey === 'costEstimate') {
      addChatMessage(`Starting Cost Estimate for study ${data.studyNumber}...`, 'ai');
      safeSetCurrentDocumentId(data.documentId);
      await safeSaveDocumentIdToSettings(data.documentId);
      await safeDelayedNavigation(3); // 跳转到Step 3 Project Selection
    } else if (data.taskKey === 'sasAnalysis') {
      addChatMessage(`Starting SAS Analysis for study ${data.studyNumber}...`, 'ai');
      safeSetCurrentDocumentId(data.documentId);
      await safeSaveDocumentIdToSettings(data.documentId);
      await safeDelayedNavigation(3); // 跳转到对应的SAS页面
    }
    return;
  }

  if (data.isUnfinished === true && data.documentId) {
    console.log('🔍 [DEBUG] Found unfinished task:');
    console.log('  - taskKey:', data.taskKey);
    console.log('  - currentStatus:', data.currentStatus);
    console.log('  - documentId:', data.documentId);
    
    // task进行中 → 根据currentStatus精确路由到正确的步骤
    addChatMessage(`I found an unfinished '${data.taskName}' for study '${data.studyNumber}'. Continuing from where you left off...`, 'ai');
    safeSetCurrentDocumentId(data.documentId);
    await safeSaveDocumentIdToSettings(data.documentId);
    
    // 🔥 实现精确路由逻辑
    const targetStep = getTargetStepByStatus(data.currentStatus, data.taskKey);
    console.log(`📍 [DEBUG] Status: '${data.currentStatus}' → Routing to Step ${targetStep}`);
    
    // 根据目标步骤进行特殊处理
    if (targetStep === 4 && data.taskKey === 'costEstimate') {
      // Step 4: 自动触发SDTM分析
      await safeDelayedNavigation(targetStep);
      setTimeout(async () => {
        try {
          if (window.triggerSDTMAnalysis && typeof window.triggerSDTMAnalysis === 'function') {
            console.log('🔄 自动触发SDTM分析（从状态恢复）...');
            await window.triggerSDTMAnalysis();
          } else {
            console.warn('⚠️ triggerSDTMAnalysis函数不可用');
          }
        } catch (error) {
          console.error('❌ 自动触发SDTM分析失败:', error);
        }
      }, 1000);
    } else if (targetStep === 5 && data.taskKey === 'costEstimate') {
      // Step 5: 自动加载并显示SDTM分析结果
      await safeDelayedNavigation(targetStep);
      setTimeout(async () => {
        try {
          if (window.CostEstimateModule && window.CostEstimateModule.loadAndDisplaySDTMResults) {
            console.log('🔄 自动加载SDTM分析结果（从状态恢复）...');
            await window.CostEstimateModule.loadAndDisplaySDTMResults();
          } else {
            console.warn('⚠️ loadAndDisplaySDTMResults函数不可用');
          }
        } catch (error) {
          console.error('❌ 自动加载SDTM结果失败:', error);
        }
      }, 1000);
    } else if (targetStep === 6 && data.taskKey === 'costEstimate') {
      // Step 6: 完成页面，恢复完整的Excel表格
      await safeDelayedNavigation(targetStep);
      setTimeout(async () => {
        try {
          if (window.CostEstimateModule && window.CostEstimateModule.loadAndDisplaySDTMResults) {
            console.log('🔄 恢复完成项目的Excel表格（Step 6）...');
            await window.CostEstimateModule.loadAndDisplaySDTMResults();
          } else {
            console.warn('⚠️ loadAndDisplaySDTMResults函数不可用');
          }
        } catch (error) {
          console.error('❌ 恢复Step 6 Excel表格失败:', error);
        }
      }, 1000);
    } else {
      // 其他情况，直接跳转
      await safeDelayedNavigation(targetStep);
    }
    return;
  }

  if (data.isUnfinished === false) {
    // task已完成 → 暂不考虑，给出提示
    addChatMessage(`The '${data.taskName}' for study '${data.studyNumber}' is already completed.`, 'ai');
  } else {
    // 状态不明确的情况
    addChatMessage("We could not check the status for this study.", 'ai');
  }
}

// 注意：这些函数已移至主控制器，使用 moduleConfig.delayedNavigation 替代

// 添加聊天消息
function addChatMessage(message, sender) {
  const chatMessages = document.getElementById('chat-messages');
  const messageDiv = document.createElement('div');
  messageDiv.className = `message ${sender}-message`;
  
  const contentDiv = document.createElement('div');
  contentDiv.className = 'message-content';
  contentDiv.innerHTML = message;
  
  messageDiv.appendChild(contentDiv);
  chatMessages.appendChild(messageDiv);
  chatMessages.scrollTop = chatMessages.scrollHeight;
}

// 显示打字指示器
function showTypingIndicator() {
  const chatMessages = document.getElementById('chat-messages');
  const typingDiv = document.createElement('div');
  typingDiv.className = 'message ai-message';
  typingDiv.innerHTML = `
    <div class="typing-indicator">
      <span class="dot"></span>
      <span class="dot"></span>
      <span class="dot"></span>
    </div>
  `;
  typingDiv.id = 'typing-indicator';
  chatMessages.appendChild(typingDiv);
  chatMessages.scrollTop = chatMessages.scrollHeight;
}

// 隐藏打字指示器
function hideTypingIndicator() {
  const typingIndicator = document.getElementById('typing-indicator');
  if (typingIndicator) {
    typingIndicator.remove();
  }
}

// ===== Protocol Upload 模块 (Step 2) =====

// 初始化文件上传功能
function initFileUpload() {
  // Protocol upload elements
  const protocolSelectBtn = document.getElementById('protocol-select-btn');
  const protocolFileInput = document.getElementById('protocol-file-input');
  const protocolUploadArea = document.getElementById('protocol-upload-area');
  const protocolCancelBtn = document.getElementById('protocol-cancel-btn');
  const protocolRemoveBtn = document.getElementById('protocol-remove-btn');

  // Protocol upload events
  if (protocolSelectBtn) protocolSelectBtn.addEventListener('click', () => protocolFileInput.click());
  if (protocolUploadArea) protocolUploadArea.addEventListener('click', () => protocolFileInput.click());
  if (protocolFileInput) protocolFileInput.addEventListener('change', (e) => handleProtocolUpload(e.target.files[0]));
  if (protocolCancelBtn) protocolCancelBtn.addEventListener('click', cancelProtocolUpload);
  if (protocolRemoveBtn) protocolRemoveBtn.addEventListener('click', removeProtocolFile);

  // Drag and drop for protocol
  if (protocolUploadArea) {
    protocolUploadArea.addEventListener('dragover', handleDragOver);
    protocolUploadArea.addEventListener('drop', (e) => handleProtocolDrop(e));
    protocolUploadArea.addEventListener('dragenter', handleDragEnter);
    protocolUploadArea.addEventListener('dragleave', handleDragLeave);
  }
}

// 拖拽处理函数
function handleDragOver(e) {
  e.preventDefault();
  e.dataTransfer.dropEffect = 'copy';
}

function handleDragEnter(e) {
  e.preventDefault();
  e.currentTarget.classList.add('dragover');
}

function handleDragLeave(e) {
  e.preventDefault();
  e.currentTarget.classList.remove('dragover');
}

function handleProtocolDrop(e) {
  e.preventDefault();
  e.currentTarget.classList.remove('dragover');
  const files = e.dataTransfer.files;
  if (files.length > 0) {
    handleProtocolUpload(files[0]);
  }
}

// Protocol文件上传处理
async function handleProtocolUpload(file) {
  if (!file) return;

  const allowedTypes = [ 
    'application/pdf', 
    'application/msword', 
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document' 
  ];
  
  if (!allowedTypes.includes(file.type)) {
    moduleConfig.showStatusMessage('Please select PDF or Word documents only', 'error');
    return;
  }

  showProtocolProgress();
  try {
    const formData = new FormData();
    formData.append('document', file);
    formData.append('documentType', 'ClinicalProtocol');

    const response = await fetch(`${moduleConfig.API_BASE_URL}/api/upload-document`, { 
      method: 'POST', 
      body: formData 
    });
    
    if (!response.ok) { 
      throw new Error(`Upload failed: ${response.statusText}`); 
    }
    
    const result = await response.json();

    // 更新全局状态
    const protocolData = { 
      name: file.name, 
      size: file.size, 
      type: file.type, 
      uploadId: result.uploadId 
    };
    safeSetUploadedProtocol(protocolData);

    if (result.uploadId) {
      safeSetCurrentDocumentId(result.uploadId);
      await safeSaveDocumentIdToSettings(result.uploadId);
    }

    showProtocolResult(file);
    // Context-aware success UX
    const fromChat = (typeof window !== 'undefined' && window.uploadContext === 'from_chat');
    if (fromChat) {
      // In chat-driven flow: reveal a lightweight "Upload Finished" button area
      // Create button below the entire file box (centered)
      let finishBtn = document.getElementById('protocol-finish-btn');
      if (!finishBtn) {
        const step2Container = document.getElementById('mainpage-step2-container');
        const btn = document.createElement('button');
        btn.id = 'protocol-finish-btn';
        btn.className = 'ms-Button ms-Button--primary';
        btn.innerHTML = '<span class="ms-Button-label">Upload Finished</span>';
        btn.style.marginTop = '15px';
        btn.style.display = 'block';
        btn.style.marginLeft = 'auto';
        btn.style.marginRight = 'auto';
        btn.style.fontSize = '16px';
        btn.style.padding = '12px 24px';
        btn.style.minWidth = '160px';
        btn.style.transform = 'scale(1.2)';
        btn.style.borderRadius = '8px';
        btn.addEventListener('click', () => {
          try { window.uploadContext = 'default'; } catch (_) {}
          // Navigate back to AI chat (Step 1)
          if (moduleConfig && typeof moduleConfig.showStep === 'function') {
            moduleConfig.showStep(1);
          } else if (typeof window.showStep === 'function') {
            window.showStep(1);
          }
          // Post a confirmation message into chat
          setTimeout(() => {
            try {
              addChatMessage('✅ Your protocol has been uploaded successfully! I can access the document now.', 'ai');
            } catch (e) { console.log('post-upload chat message failed:', e); }
          }, 200);
        });
        if (step2Container) step2Container.appendChild(btn);
      }
      moduleConfig.showStatusMessage('Clinical Protocol uploaded. Click "Upload Finished" to return to chat.', 'success');
    } else {
      moduleConfig.showStatusMessage('Clinical Protocol uploaded. Click Next to select projects.', 'success');
    }
  } catch (error) {
    console.error('Protocol upload error:', error);
    moduleConfig.showStatusMessage(`Upload failed: ${error.message}`, 'error');
    hideProtocolProgress();
  }
}

// UI更新函数
function showProtocolProgress() {
  const uploadArea = document.getElementById('protocol-upload-area');
  const progress = document.getElementById('protocol-progress');
  const result = document.getElementById('protocol-result');
  
  if (uploadArea) uploadArea.style.display = 'none';
  if (progress) progress.style.display = 'block';
  if (result) result.style.display = 'none';
}

function hideProtocolProgress() {
  const uploadArea = document.getElementById('protocol-upload-area');
  const progress = document.getElementById('protocol-progress');
  
  if (uploadArea) uploadArea.style.display = 'block';
  if (progress) progress.style.display = 'none';
}

function showProtocolResult(file) {
  const uploadArea = document.getElementById('protocol-upload-area');
  const progress = document.getElementById('protocol-progress');
  const result = document.getElementById('protocol-result');
  const fileName = document.getElementById('protocol-file-name');
  const fileStatus = document.getElementById('protocol-file-status');
  
  if (uploadArea) uploadArea.style.display = 'none';
  if (progress) progress.style.display = 'none';
  if (result) result.style.display = 'block';
  if (fileName) fileName.textContent = file.name;
  if (fileStatus) fileStatus.textContent = '✅ Clinical Protocol uploaded to MongoDB';
}

function cancelProtocolUpload() {
  hideProtocolProgress();
  moduleConfig.showStatusMessage('Protocol upload cancelled', 'info');
}

async function removeProtocolFile() {
  // 重置全局状态
  safeSetUploadedProtocol(null);
  safeSetCurrentDocumentId(null);
  
  // 重置UI
  const uploadArea = document.getElementById('protocol-upload-area');
  const result = document.getElementById('protocol-result');
  const fileInput = document.getElementById('protocol-file-input');
  
  if (uploadArea) uploadArea.style.display = 'block';
  if (result) result.style.display = 'none';
  if (fileInput) fileInput.value = '';
  
  moduleConfig.showStatusMessage('Protocol file removed', 'info');
}

// ===== 模块导出接口 =====

// 全局依赖变量 - 由主控制器传入
let moduleConfig = {};

// 安全导航辅助：即使依赖未注入也不报错
async function safeDelayedNavigation(targetStep, delayMs = 2000) {
  const fn = moduleConfig && moduleConfig.delayedNavigation;
  if (typeof fn === 'function') {
    return fn(targetStep, delayMs);
  }
  // 兜底：本地等待后调用已注入/全局的 showStep
  if (delayMs) await new Promise(resolve => setTimeout(resolve, delayMs));
  if (moduleConfig && typeof moduleConfig.showStep === 'function') {
    return moduleConfig.showStep(targetStep);
  }
  if (typeof window !== 'undefined' && typeof window.showStep === 'function') {
    return window.showStep(targetStep);
  }
  console.warn('Navigation fallback could not find showStep; targetStep =', targetStep);
}

// 安全设置已上传协议：即使依赖未注入也不报错
function safeSetUploadedProtocol(protocolData) {
  const fn = moduleConfig && moduleConfig.setUploadedProtocol;
  if (typeof fn === 'function') {
    try {
      return fn(protocolData);
    } catch (e) {
      console.warn('moduleConfig.setUploadedProtocol failed:', e);
    }
  }
  // 兜底：直接设置全局变量
  try {
    if (typeof window !== 'undefined') {
      window.uploadedProtocol = protocolData;
      console.log('fallback: set window.uploadedProtocol =', protocolData);
      return;
    }
  } catch (e) {
    console.warn('fallback set window.uploadedProtocol failed:', e);
  }
  console.warn('No way to set uploadedProtocol; value =', protocolData);
}

// 安全设置当前文档ID
function safeSetCurrentDocumentId(documentId) {
  const fn = moduleConfig && moduleConfig.setCurrentDocumentId;
  if (typeof fn === 'function') {
    try {
      return fn(documentId);
    } catch (e) {
      console.warn('moduleConfig.setCurrentDocumentId failed:', e);
    }
  }
  // 兜底：直接设置全局变量
  try {
    if (typeof window !== 'undefined') {
      window.currentDocumentId = documentId;
      console.log('fallback: set window.currentDocumentId =', documentId);
    }
  } catch (e) {
    console.warn('fallback set window.currentDocumentId failed:', e);
  }
}

// 安全保存文档ID到设置
async function safeSaveDocumentIdToSettings(documentId) {
  const fn = moduleConfig && moduleConfig.saveDocumentIdToSettings;
  if (typeof fn === 'function') {
    try {
      return await fn(documentId);
    } catch (e) {
      console.warn('moduleConfig.saveDocumentIdToSettings failed:', e);
    }
  }
  console.warn('saveDocumentIdToSettings not available; documentId =', documentId);
}


// 模块内部状态
let pendingConfirmation = null;

// 动态插入MainPage HTML内容
function insertMainPageHTML() {
  // 插入 Step 1 内容
  const step1Container = document.getElementById('mainpage-step1-container');
  if (step1Container) {
    step1Container.innerHTML = `
      <div class="mainpage-step1">
        <h3 class="ms-font-l">🤖 AI Assistant</h3>
        
        <!-- Chat Interface -->
        <div class="chat-container" id="chat-container">
          <div class="chat-messages" id="chat-messages">
            <div class="message ai-message">
              <div class="message-content">
                Hello! What would you like to do today? 
                <br><br>You can say something like:
                <br>• "I want to do Phase II study cost analysis for study SK123-kbi"
                <br>• "Help me estimate costs for an oncology trial (study number: ABC-123)"
                <br>• "I need SDTM mapping for study SK123-kbi protocol"
              </div>
            </div>
          </div>
          
          <div class="chat-input-area">
            <div class="input-group">
              <input type="text" 
                     id="chat-input" 
                     class="chat-input" 
                     placeholder="e.g. I want to do Phase II study cost analysis for study SK123-kbi" 
                     maxlength="500">
              <button id="chat-send-btn" class="chat-send-btn">
                <span class="ms-Icon ms-Icon--Send"></span>
              </button>
            </div>
          </div>
        </div>
      </div>
    `;
  }

  // 插入 Step 2 内容
  const step2Container = document.getElementById('mainpage-step2-container');
  if (step2Container) {
    step2Container.innerHTML = `
      <div class="mainpage-step2">
        <h3 class="ms-font-l">📋 Protocol Upload</h3>
        <div class="upload-area" id="protocol-upload-area" style="min-height: 120px; padding: 20px 24px;">
          <div class="upload-content">
            <i class="ms-Icon ms-Icon--CloudUpload ms-font-xxl upload-icon"></i>
            <h4 class="ms-font-l">Upload Protocol Document</h4>
            <p class="ms-font-m">Support PDF and Word documents</p>
            <div class="ms-Button ms-Button--primary" id="protocol-select-btn">
              <span class="ms-Button-label">Select File</span>
            </div>
            <input type="file" id="protocol-file-input" accept=".pdf,.doc,.docx" style="display: none;">
          </div>
        </div>

        <!-- Upload Progress -->
        <div class="upload-progress" id="protocol-progress" style="display: none;">
          <div class="ms-Spinner">
            <div class="ms-Spinner-circle ms-Spinner-circle--large"></div>
          </div>
          <p class="ms-font-m" id="protocol-progress-text">Uploading protocol...</p>
          <div class="ms-Button" id="protocol-cancel-btn">
            <span class="ms-Button-label">Cancel Upload</span>
          </div>
        </div>

        <!-- Upload Result -->
        <div class="upload-result" id="protocol-result" style="display: none;">
          <div class="file-info">
            <i class="ms-Icon ms-Icon--Document ms-font-l file-icon"></i>
            <div class="file-details">
              <span class="file-name" id="protocol-file-name">filename.pdf</span>
              <span class="file-status" id="protocol-file-status">✅ Uploaded successfully</span>
            </div>
            <div class="file-actions">
              <div class="ms-Button ms-Button--secondary" id="protocol-remove-btn">
                <span class="ms-Button-label">Remove</span>
              </div>
            </div>
          </div>
        </div>
      </div>
    `;
  }
}

// 初始化mainpage模块的所有功能
function initMainPageModule(config = {}) {
  console.log('🚀 初始化 mainpage 模块...');
  
  // 保存配置
  moduleConfig = {
    API_BASE_URL: config.API_BASE_URL || 'https://localhost:4000',
    showStep: config.showStep || (() => console.warn('showStep not provided')),
    showStatusMessage: config.showStatusMessage || ((msg, type) => console.warn('showStatusMessage not provided:', msg)),
    delayedNavigation: config.delayedNavigation || (() => console.warn('delayedNavigation not provided')),

    saveDocumentIdToSettings: config.saveDocumentIdToSettings || (() => console.warn('saveDocumentIdToSettings not provided')),
    setCurrentDocumentId: config.setCurrentDocumentId || (() => console.warn('setCurrentDocumentId not provided')),
    setUploadedProtocol: config.setUploadedProtocol || (() => console.warn('setUploadedProtocol not provided'))
  };

  // 防御性兜底：确保导航函数可用，避免 undefined is not a function
  if (typeof moduleConfig.delayedNavigation !== 'function') {
    moduleConfig.delayedNavigation = async (targetStep, delayMs = 2000) => {
      try {
        await new Promise(resolve => setTimeout(resolve, delayMs));
      } finally {
        if (typeof moduleConfig.showStep === 'function') {
          moduleConfig.showStep(targetStep);
        } else {
          console.warn('showStep not available to navigate to step:', targetStep);
        }
      }
    };
  }

  
  // 动态插入HTML内容
  insertMainPageHTML();
  
  initChatInterface();
  initFileUpload();
  console.log('✅ mainpage 模块初始化完成');
}

// 重置mainpage模块状态
function resetMainPageModule() {
  console.log('🔄 重置 mainpage 模块...');
  
  // 重置模块内部状态
  pendingConfirmation = null;
  
  resetAIChatInterface();
  removeProtocolFile();
  console.log('✅ mainpage 模块重置完成');
}

// 暴露给主控制器的接口
if (typeof window !== 'undefined') {
  window.MainPageModule = {
    init: initMainPageModule,
    reset: resetMainPageModule,
    // 导出主要函数供主控制器调用
    initChatInterface,
    initFileUpload,
    resetAIChatInterface,
    handleChatSend,
    handleProtocolUpload
  };
}


















