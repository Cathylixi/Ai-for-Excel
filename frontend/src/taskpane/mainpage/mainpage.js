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
  // 新增：聊天驱动的流程状态机
  try { window.chatFlowState = null; window.currentTaskContext = {}; } catch (_) {}
  
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
  } else if (actionId === 'navigate_to_otherdocs') {
    // Navigate to Other Documents page
    // 检查是否是新任务流程
    const isNewTaskFlow = (window.uploadContext === 'from_chat_otherdocs_new_task');
    if (isNewTaskFlow) {
      // 设置正确的状态，让 otherdocuments.js 知道这是新任务流程
      try { 
        window.chatFlowState = 'waiting_for_otherdocs_upload_new_task';
      } catch (_) {}
    }
    
    if (moduleConfig && typeof moduleConfig.showPage === 'function') {
      moduleConfig.showPage('otherdocuments');
    } else if (typeof window.showPage === 'function') {
      window.showPage('otherdocuments');
    } else {
      addChatMessage('Opening Other Documents page failed. Please open it manually.', 'ai');
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



  // 🔥 新增：处理"选择另一个任务"的状态
  if (typeof window !== 'undefined' && window.chatFlowState === 'awaiting_another_task_selection') {
    try {
      // 将用户的回复发送给AI解析任务类型
      const parsed = await callAssistantParseCommand(userMessage);
      
      if (parsed && parsed.matchedTask) {
        // AI识别出了任务，直接跳到询问是否上传其他文档
        const taskName = parsed.matchedTask.name;
        const taskKey = parsed.matchedTask.key;
        
        // 🔥 修正：直接设置新任务信息并跳到文档上传询问
        window.pendingNewTask = {
          taskName: taskName,
          taskKey: taskKey,
          studyIdentifier: window.currentStudyContext.studyIdentifier,
          studyNumber: window.currentStudyContext.studyNumber
        };
        
        // 直接显示文档并询问是否上传
        await showExistingDocsAndAskUpload(taskName, window.currentStudyContext.studyIdentifier);
        
      } else {
        // AI没有识别出任务
        addChatMessage("I couldn't understand which task you want to do. Please try again with one of the available tasks.", 'ai');
      }
    } catch (e) {
      addChatMessage("Sorry, I couldn't process your request. Please try again.", 'ai');
    }
    
    document.getElementById('chat-send-btn').disabled = false;
    return;
  }

  // 🔥 注意：原来的"确认另一个任务"状态已移除，因为现在直接跳到文档上传询问

  // 🔥 新增：处理"是否上传其他文档"的状态（针对新任务）
  if (typeof window !== 'undefined' && window.chatFlowState === 'awaiting_other_docs_for_new_task') {
    const intent = parseYesNoIntent(userMessage);
    
    if (intent === 'yes') {
      // 🔥 使用现有的按钮机制跳转到 Other Documents page
      try { window.uploadContext = 'from_chat_otherdocs_new_task'; } catch (_) {}
      addActionBubble('Click to upload other documents', 'navigate_to_otherdocs');
      
      // 设置状态，等待上传完成后回来
      window.chatFlowState = 'waiting_for_otherdocs_upload_new_task';
      
    } else if (intent === 'no') {
      // 用户不想上传，直接开始新任务
      const taskName = window.pendingNewTask.taskName;
      addChatMessage(`Okay. We can start ${taskName} now.`, 'ai');
      
      // 2 秒后自动启动新任务（显示打字指示器更自然）
      showTypingIndicator();
      setTimeout(async () => {
        hideTypingIndicator();
        await startNewTask();
      }, 2000);
      
    } else {
      addChatMessage("Please answer 'yes' or 'no'.", 'ai');
    }
    
    document.getElementById('chat-send-btn').disabled = false;
    return;
  }

  // 🔥 新增：处理“无需上传，是否直接开始任务”状态
  if (typeof window !== 'undefined' && window.chatFlowState === 'awaiting_start_without_upload') {
    const intent = parseYesNoIntent(userMessage);
    window.chatFlowState = null;
    if (intent === 'yes') {
      // 用户直接开始任务
      showTypingIndicator();
      setTimeout(async () => {
        hideTypingIndicator();
        await startNewTask();
      }, 1000);
    } else if (intent === 'no') {
      // 提供上传入口（用于替换已有文件）
      try { window.uploadContext = 'from_chat_otherdocs_new_task'; } catch (_) {}
      addActionBubble('Click to upload other documents', 'navigate_to_otherdocs');
      // 等待上传完成
      window.chatFlowState = 'waiting_for_otherdocs_upload_new_task';
    } else {
      addChatMessage("Please answer 'yes' or 'no'.", 'ai');
    }
    document.getElementById('chat-send-btn').disabled = false;
    return;
  }

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
  // 记录当前任务上下文，用于后续“是否上传其他文档”提问
  try { window.currentTaskContext = { taskKey, taskName, studyIdentifier }; } catch (_) {}
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
    // task从未开始 → 先标记为开始状态，然后跳转到对应task的开始页面
    try {
      // 🔥 新增：调用API标记任务开始（设置为 false）
      const startResponse = await fetch(`${moduleConfig.API_BASE_URL}/api/documents/${data.documentId}/mark-started`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ taskKey: data.taskKey })
      });
      
      if (!startResponse.ok) {
        console.warn('Failed to mark task as started, but continuing...');
      }
      
      // 🔥 统一逻辑：先查询并显示现有文档，然后询问是否上传
      safeSetCurrentDocumentId(data.documentId);
      await safeSaveDocumentIdToSettings(data.documentId);
      
      // 设置pending任务信息，供后续使用
      window.pendingNewTask = {
        taskName: data.taskName,
        taskKey: data.taskKey,
        studyIdentifier: data.studyNumber || data.studyIdentifier,
        studyNumber: data.studyNumber,
        documentId: data.documentId
      };
      
      await showExistingDocsAndAskUpload(data.taskName, data.studyNumber || data.studyIdentifier);
    } catch (error) {
      console.error('Error marking task as started:', error);
      addChatMessage('Failed to start the task. Please try again.', 'ai');
    }
    return;
  }

  if (data.isUnfinished === true && data.documentId) {
    console.log('🔍 [DEBUG] Found unfinished task:');
    console.log('  - taskKey:', data.taskKey);
    console.log('  - currentStatus:', data.currentStatus);
    console.log('  - documentId:', data.documentId);
    
    // 🔥 统一逻辑：任务进行中时也先查询文档并询问是否上传
    addChatMessage(`I found an unfinished '${data.taskName}' for study '${data.studyNumber}'.`, 'ai');
    safeSetCurrentDocumentId(data.documentId);
    await safeSaveDocumentIdToSettings(data.documentId);
    
    // 设置pending任务信息，但包含恢复信息
    window.pendingNewTask = {
      taskName: data.taskName,
      taskKey: data.taskKey,
      studyIdentifier: data.studyNumber || data.studyIdentifier,
      studyNumber: data.studyNumber,
      documentId: data.documentId,
      isResuming: true,  // 标记这是恢复任务
      currentStatus: data.currentStatus  // 保存当前状态用于恢复
    };
    
    await showExistingDocsAndAskUpload(data.taskName, data.studyNumber || data.studyIdentifier);
    return;
  }

  if (data.isUnfinished === false) {
    // 🔥 新逻辑：显示现有文档 + 提供其他任务选择
    await showCompletedTaskAndOfferOthers(data);
    return;
  } else {
    // 状态不明确的情况
    addChatMessage("We could not check the status for this study.", 'ai');
  }
}

// 🔥 新增：显示已完成任务并提供其他选择
async function showCompletedTaskAndOfferOthers(data) {
  try {
    // 获取该study的所有现有文档与槽位状态
    const docInfo = await getStudyDocuments(data.studyNumber || data.studyIdentifier);
    const studyDocs = Array.isArray(docInfo?.documents) ? docInfo.documents : [];
    const hasProtocol = !!docInfo?.hasProtocol;
    const hasCrf = !!docInfo?.hasCrf;
    const hasSap = !!docInfo?.hasSap;
    
    // 构建消息
    let message = `${data.taskName} for study ${data.studyNumber} analysis is finished.\n\n`;
    
    // 获取可用任务列表
    const availableTasks = getAvailableTasksForStudy(data.taskName);
    if (availableTasks.length > 0) {
      message += `Do you want to start another task for this study? Available tasks are:\n`;
      availableTasks.forEach(task => {
        message += `• ${task}\n`;
      });
    } else {
      message += 'All tasks for this study have been completed.';
    }
    
    addChatMessage(message, 'ai');
    
    // 🔥 设置状态机等待用户选择新任务
    if (availableTasks.length > 0) {
      window.chatFlowState = 'awaiting_another_task_selection';
      window.currentStudyContext = {
        studyIdentifier: data.studyNumber || data.studyIdentifier,
        studyNumber: data.studyNumber,
        completedTask: data.taskName,
        availableTasks: availableTasks,
        existingDocuments: { hasProtocol, hasCrf, hasSap, filesSummary: docInfo?.filesSummary || [] }
      };
    }
    
  } catch (error) {
    console.error('❌ Error showing completed task info:', error);
    // 回退到简单消息
    addChatMessage(`${data.taskName} for study ${data.studyNumber} is already completed.`, 'ai');
  }
}

// 🔥 新增：获取Study的所有文档与槽位状态
async function getStudyDocuments(studyIdentifier) {
  try {
    const response = await fetch(`${moduleConfig.API_BASE_URL}/api/studies/${encodeURIComponent(studyIdentifier)}/documents`);
    if (!response.ok) {
      throw new Error(`Failed to get study documents: ${response.statusText}`);
    }
    const data = await response.json();
    return data.success ? (data.data || {}) : {};
  } catch (error) {
    console.error('❌ Error fetching study documents:', error);
    return {};
  }
}

// 🔥 新增：获取可用任务列表
function getAvailableTasksForStudy(completedTaskName) {
  const allTasks = ['Cost Estimate', 'SAS Analysis'];
  return allTasks.filter(task => task !== completedTaskName);
}

// 🔥 统一函数：显示现有文档(不包括Protocol)并询问上传
async function showExistingDocsAndAskUpload(taskName, studyIdentifier) {
  try {
    if (!studyIdentifier) {
      console.error('❌ No study identifier available');
      return;
    }
    
    // 获取最新的文档与槽位状态
    const docInfo = await getStudyDocuments(studyIdentifier);
    let message = "";
    const hasCrf = !!docInfo?.hasCrf;
    const hasSap = !!docInfo?.hasSap;
    const fs = Array.isArray(docInfo?.filesSummary) ? docInfo.filesSummary : [];
    
    // 只显示CRF和SAP，不显示Protocol
    if (hasCrf || hasSap) {
      message += "Here are the documents we have for this study:\n";
      const c = fs.find(x => x.slot === 'CRF');
      const s = fs.find(x => x.slot === 'SAP');
      if (c) message += `• CRF - ${(c.originalName||'')}${c.size?` (${c.size})`:''}\n`;
      if (s) message += `• SAP - ${(s.originalName||'')}${s.size?` (${s.size})`:''}\n`;
      message += "\n";
    } else {
      message += "No additional documents found for this study.\n\n";
    }
    // 如果CRF和SAP都已上传，直接询问是否开始任务
    if (hasCrf && hasSap) {
      message += `All required documents are uploaded. Do you want to start ${taskName} now?`;
      addChatMessage(message, 'ai');
      window.chatFlowState = 'awaiting_start_without_upload';
    } else {
      // 否则维持现有逻辑：询问是否上传其他文档
      message += `Upload other documents to help to do ${taskName}?`;
      addChatMessage(message, 'ai');
      window.chatFlowState = 'awaiting_other_docs_for_new_task';
    }
    
  } catch (error) {
    console.error('❌ Error showing existing docs and asking upload:', error);
    // 回退到简单询问
    addChatMessage(`Upload other documents to help to do ${taskName}?`, 'ai');
    window.chatFlowState = 'awaiting_other_docs_for_new_task';
  }
}

// 🔥 新增：启动新任务的核心函数
async function startNewTask() {
  if (!window.pendingNewTask) {
    console.error('No pending new task to start');
    return;
  }
  
  const { taskKey, studyIdentifier, studyNumber, isResuming, currentStatus } = window.pendingNewTask;
  
  try {
    // 清理状态
    window.chatFlowState = null;
    const pendingTask = window.pendingNewTask; // 保存一份
    window.pendingNewTask = null;
    window.currentStudyContext = null;
    
    if (isResuming) {
      // 这是恢复任务
      if (taskKey === 'sasAnalysis') {
        // SAS Analysis 恢复：始终跳转独立页面，而不是 Step 3
        addChatMessage(`Continuing SAS Analysis from where you left off...`, 'ai');
        setTimeout(() => {
          if (moduleConfig && typeof moduleConfig.showPage === 'function') {
            moduleConfig.showPage('sasanalysis');
          } else if (typeof window.showPage === 'function') {
            window.showPage('sasanalysis');
          }
        }, 2000);
        return;
      }

      // Cost Estimate 恢复：根据状态精确路由
      addChatMessage(`Continuing from where you left off...`, 'ai');
      const targetStep = getTargetStepByStatus(currentStatus, taskKey);
      console.log(`📍 [DEBUG] Resuming - Status: '${currentStatus}' → Routing to Step ${targetStep}`);

      // 根据目标步骤进行特殊处理
      if (targetStep === 4 && taskKey === 'costEstimate') {
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
      } else if (targetStep === 5 && taskKey === 'costEstimate') {
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
      } else if (targetStep === 6 && taskKey === 'costEstimate') {
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
    } else {
      // 这是新任务，直接开始，不要重新lookup（避免循环）
      if (taskKey === 'costEstimate') {
        addChatMessage(`Starting Cost Estimate...`, 'ai');
        await safeDelayedNavigation(3); // 跳转到Step 3 Project Selection
      } else if (taskKey === 'sasAnalysis') {
        addChatMessage(`Starting SAS Analysis...`, 'ai');
        // 🔥 跳转到独立的SAS Analysis页面，不是Step 3
        setTimeout(() => {
          if (moduleConfig && typeof moduleConfig.showPage === 'function') {
            moduleConfig.showPage('sasanalysis');
          } else if (typeof window.showPage === 'function') {
            window.showPage('sasanalysis');
          }
        }, 2000);
      }
    }
    
  } catch (error) {
    console.error('Failed to start new task:', error);
    addChatMessage('Sorry, failed to start the new task. Please try again.', 'ai');
  }
}

// 🔥 处理 other documents 上传完成事件
async function handleOtherDocsUploadComplete(event) {
  console.log('📨 Received otherdocs upload complete event:', event.detail);
  
  if (!event.detail.fromChatFlow || !event.detail.pendingTask) {
    console.log('❌ Not from chat flow or no pending task, ignoring event');
    return;
  }
  
  const { taskName } = event.detail.pendingTask;
  
  try {
    // 清理上传相关状态
    window.uploadContext = 'default';
    
    // 发送确认消息
    setTimeout(() => {
      addChatMessage(`✅ Upload successfully! We can do ${taskName} now.`, 'ai');
      
      // 显示打字指示器并在2秒后启动新任务
      showTypingIndicator();
      setTimeout(async () => {
        hideTypingIndicator();
        await startNewTask();
      }, 2000);
      
    }, 200); // 稍微延迟确保页面已完全显示
    
  } catch (error) {
    console.error('❌ Error handling otherdocs upload complete:', error);
    addChatMessage('Upload completed, but there was an error starting the task. Please try again.', 'ai');
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
  // 将 \n 转换为 <br/> 以支持换行
  contentDiv.innerHTML = message.replace(/\n/g, '<br/>');
  
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
          setTimeout(async () => {
            try {
              const ctx = (typeof window !== 'undefined' && window.currentTaskContext) ? window.currentTaskContext : {};
              const taskName = ctx.taskName || 'your project';
              const taskKey = ctx.taskKey || null;
              const studyIdentifier = ctx.studyIdentifier || null;

              addChatMessage(`✅ Protocol uploaded successfully!`, 'ai');

              // 为“从聊天去上传其他文档”设置 pendingNewTask，便于上传完成后自动开始任务
              try {
                window.pendingNewTask = {
                  taskName,
                  taskKey,
                  studyIdentifier,
                  studyNumber: ctx.studyNumber || null,
                  documentId: (typeof window !== 'undefined' && window.currentDocumentId) ? window.currentDocumentId : null,
                  isResuming: false
                };
              } catch (_) {}

              // 🔥 统一逻辑：查询并显示现有文档，然后询问是否上传
              if (studyIdentifier) {
                await showExistingDocsAndAskUpload(taskName, studyIdentifier);
              } else {
                // 回退逻辑
                addChatMessage(`Upload other documents to help to do ${taskName}?`, 'ai');
                window.chatFlowState = 'awaiting_other_docs_for_new_task';
              }
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
    showPage: config.showPage || (() => console.warn('showPage not provided')),
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
  
  // 🔥 添加 other documents 上传完成事件监听器
  window.addEventListener('otherdocsUploadComplete', handleOtherDocsUploadComplete);
  
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
    handleProtocolUpload,
    addChatMessage
  };
   
  // 暴露addChatMessage到全局，供其他模块使用
  window.addChatMessage = addChatMessage;
}


















