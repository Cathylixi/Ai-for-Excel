/*
 * taskpane.js - 主控制器 (模块化架构)
 * 职责：模块协调、全局状态管理、Excel状态缓存、步骤路由
 */

/* global console, document, Excel, Office */

// ===== 全局配置和常量 =====
const API_BASE_URL = 'https://localhost:4000';

// ===== 全局状态变量 =====
let uploadedProtocol = null;
let currentWizardStep = 1;
let lastParsedCommand = null;
// Upload entry context: 'default' | 'from_chat'
if (typeof window !== 'undefined' && !window.uploadContext) {
  window.uploadContext = 'default';
}

// Excel状态缓存系统 - 用于Back导航时恢复Excel内容
let excelStateCache = {
  step1: null,   // AI Assistant (空白状态)
  step2: null,   // Upload完成后（通常对Excel无改动）
  step3: null,   // Project Selection完成后 + Excel Headers
  step4: null,   // Analysis Progress（占位）
  step5: null,   // SDTM Analysis结果页
  step6: null    // 完成确认页（占位）
};

// Excel变化监听和数据同步
let isTrackingChanges = false;
let changeTimeout = null;

// ===== Office 初始化 =====
Office.onReady(async (info) => {
  if (info.host === Office.HostType.Excel) {
    document.getElementById("sideload-msg").style.display = "none";
    document.getElementById("app-body").style.display = "flex";
    
    // 初始化应用
    await initializeApplication();
  }
});

// ===== 主应用初始化 =====
async function initializeApplication() {
  try {
    console.log('🚀 初始化主控制器...');
    
    // 1. 初始化向导和UI
    initWizard();
    
    // 2. 初始化模块
    await initializeModules();
    
    // 3. 初始化Excel变化监听
    await initExcelChangeTracking();
    
    // 4. 尝试恢复应用状态
    await attemptStateRecovery();
    
    console.log('✅ 主控制器初始化完成');
  } catch (error) {
    console.error('❌ 主控制器初始化失败:', error);
    showStatusMessage('Application initialization failed', 'error');
    showStep(1); // 降级到第一步
  }
}

// ===== 模块初始化 =====
async function initializeModules() {
  try {
    // 检查模块是否已加载
    if (typeof window.MainPageModule === 'undefined') {
      console.warn('⚠️ MainPage 模块未加载');
    } else {
      // 初始化 MainPage 模块，传入需要的依赖
      await window.MainPageModule.init({
        API_BASE_URL,
        showStep,
        showPage,
        showStatusMessage,
        delayedNavigation,

        saveDocumentIdToSettings,
        setCurrentDocumentId: (id) => { window.currentDocumentId = id; },
        setUploadedProtocol: (protocol) => { uploadedProtocol = protocol; }
      });
    }
    
    if (typeof window.CostEstimateModule === 'undefined') {
      console.warn('⚠️ CostEstimate 模块未加载');
    } else {
      // 初始化 CostEstimate 模块
      await window.CostEstimateModule.init({
        API_BASE_URL,
        showStep,
        showStatusMessage,
        cacheExcelState,
        restoreExcelState,
        clearDocumentIdFromSettings,
        setUploadedProtocol: (protocol) => { uploadedProtocol = protocol; },
        getCurrentDocumentId: () => window.currentDocumentId,
        setCurrentDocumentId: (id) => { window.currentDocumentId = id; }
      });
    }
    
    console.log('✅ 所有模块初始化完成');
  } catch (error) {
    console.error('❌ 模块初始化失败:', error);
    throw error;
  }
}

// ===== 向导初始化 =====
function initWizard() {
  currentWizardStep = 1;
  
  // 初始化导航按钮事件
  const backBtn = document.getElementById('wizard-back-btn');
  const nextBtn = document.getElementById('wizard-next-btn');
  
  if (backBtn) {
    backBtn.addEventListener('click', async () => {
      if (currentWizardStep > 1) {
        const previousStep = currentWizardStep - 1;
        await restoreExcelState(previousStep);
        showStep(previousStep);
      }
    });
  }
  
  if (nextBtn) {
    nextBtn.addEventListener('click', async () => {
      await handleNext();
    });
  }
  
  // 缓存初始Excel状态
  cacheExcelState(1);
}

// ===== 步骤控制 =====
function showStep(step) {
  currentWizardStep = step;
  const pages = document.querySelectorAll('.wizard-page');
  pages.forEach(p => {
    const s = Number(p.getAttribute('data-step'));
    p.style.display = (s === step) ? 'block' : 'none';
  });
  
  // 隐藏独立页面
  hideStandalonePages();
  
  const backBtn = document.getElementById('wizard-back-btn');
  const nextBtn = document.getElementById('wizard-next-btn');
  const navContainer = document.querySelector('.wizard-nav');
  
  if (step === 1) {
    // Step 1 (AI Assistant): 隐藏所有导航按钮，强制通过聊天交互
    if (navContainer) navContainer.style.display = 'none';
  } else if (step === 2 && typeof window !== 'undefined' && window.uploadContext === 'from_chat') {
    // Step 2 in chat-driven flow: hide global nav (Back/Next) completely
    if (navContainer) navContainer.style.display = 'none';
  } else {
    // 其他步骤：显示导航按钮
    if (navContainer) navContainer.style.display = 'flex';
    if (backBtn) backBtn.disabled = false;
    if (nextBtn) {
      nextBtn.disabled = false;
      const label = nextBtn.querySelector('.ms-Button-label');
      if (label) label.textContent = (step === 6) ? 'Done' : 'Next';
    }
  }
  
  // 通知模块步骤变化
  notifyModuleStepChange(step);
}

// ===== 独立页面控制 =====
function showPage(pageName) {
  // 隐藏所有向导步骤
  const pages = document.querySelectorAll('.wizard-page');
  pages.forEach(p => p.style.display = 'none');
  
  // 隐藏导航按钮
  const navContainer = document.querySelector('.wizard-nav');
  if (navContainer) navContainer.style.display = 'none';
  
  // 显示指定的独立页面
  if (pageName === 'otherdocuments') {
    showOtherDocumentsPage();
  } else if (pageName === 'sasanalysis') {
    showSasAnalysisPage();
  }
}

function hideStandalonePages() {
  // 隐藏所有独立页面
  const otherDocsPage = document.getElementById('otherdocuments-container');
  if (otherDocsPage) otherDocsPage.style.display = 'none';
  const sasPage = document.getElementById('sasanalysis-container');
  if (sasPage) sasPage.style.display = 'none';
}

function showOtherDocumentsPage() {
  const container = document.getElementById('otherdocuments-container');
  if (!container) return;
  
  // 显示页面
  container.style.display = 'block';
  
  // 让 otherdocuments.js 自己处理 HTML 生成和事件绑定
  if (typeof window.initOtherDocumentsPage === 'function') {
    window.initOtherDocumentsPage({
      container: container,
      API_BASE_URL,
      studyId: window.currentDocumentId
    });
  }
}

function showSasAnalysisPage() {
  const container = document.getElementById('sasanalysis-container');
  if (!container) return;
  container.style.display = 'block';
  if (typeof window.initSasAnalysisPage === 'function') {
    window.initSasAnalysisPage({ container });
  }
}



// ===== Next按钮处理 =====
async function handleNext() {
  if (currentWizardStep === 1) {
    // Step1 → Step2: 由AI Assistant模块处理，这里不应该被调用
    console.warn('Step 1 Next应该由AI Assistant模块处理');
    return;
  }

  if (currentWizardStep === 2) {
    // Step2 → Step3: 委托给MainPage模块处理
    if (window.MainPageModule && window.MainPageModule.handleNext) {
      await window.MainPageModule.handleNext(currentWizardStep);
    } else {
      await handleNextFallback(currentWizardStep);
    }
    return;
  }

  if (currentWizardStep >= 3 && currentWizardStep <= 6) {
    // Step3-6: 委托给CostEstimate模块处理
    if (window.CostEstimateModule && window.CostEstimateModule.handleNext) {
      await window.CostEstimateModule.handleNext(currentWizardStep);
    } else {
      await handleNextFallback(currentWizardStep);
    }
    return;
  }
}

// ===== Next按钮降级处理 =====
async function handleNextFallback(step) {
  console.warn(`模块未实现handleNext，使用降级处理: Step ${step}`);
  
  switch(step) {
    case 2:
      await cacheExcelState(2);
      if (!window.currentDocumentId) {
        showStatusMessage('Please upload a protocol document before proceeding.', 'error');
        return;
      }
      showStep(3);
      break;
    case 3:
      // Step 3 (Project Selection) → Step 4: 先保存项目选择，创建Excel表格，然后自动触发SDTM分析
      if (window.CostEstimateModule && window.CostEstimateModule.saveProjectSelectionDetails) {
        try {
          await window.CostEstimateModule.saveProjectSelectionDetails();
          console.log('✅ 项目选择已保存，状态: project_selection_done');
          
          // 🔥 创建Excel表格结构
          if (window.CostEstimateModule.createStandardCostAnalysisHeaders) {
            await window.CostEstimateModule.createStandardCostAnalysisHeaders();
          }
          
          // 🔥 填充Excel基础表格内容
          if (window.CostEstimateModule.populateExcelWithSelectedProjects) {
            await window.CostEstimateModule.populateExcelWithSelectedProjects();
          }
          
          // 立即触发SDTM分析
          await cacheExcelState(step);
          showStep(step + 1); // 跳转到 Step 4 (分析中页面)
          
          // 自动开始SDTM分析
          await triggerSDTMAnalysis();
          
        } catch (error) {
          console.error('❌ 保存项目选择失败:', error);
          showStatusMessage('Failed to save project selection', 'error');
          return; // 保存失败则不继续
        }
      }
      break;
    case 4:
    case 5:
      await cacheExcelState(step);
      showStep(step + 1);
      break;
    case 6:
      // Done - 标记完成，保存Excel，清空内容，重置应用
      await cacheExcelState(6);
      if (!window.currentDocumentId) {
        showStatusMessage('Missing document id. Please upload again.', 'error');
        return;
      }
      try {
        // 🔥 标记项目为已完成
        const resp = await fetch(`${API_BASE_URL}/api/documents/${window.currentDocumentId}/mark-complete`, { 
          method: 'PATCH' 
        });
        const result = await resp.json();
        if (result?.success) {
          showStatusMessage('Project completed! Saving Excel file and starting fresh...', 'success');
          
          // 保存Excel到本地
          if (window.CostEstimateModule && window.CostEstimateModule.saveExcelToLocal) {
            await window.CostEstimateModule.saveExcelToLocal();
          }
          
          // 清空Excel内容
          if (window.CostEstimateModule && window.CostEstimateModule.clearExcelContent) {
            await window.CostEstimateModule.clearExcelContent();
          }
          
          // 重置状态并回到开始页
          if (window.CostEstimateModule && window.CostEstimateModule.resetToStart) {
            await window.CostEstimateModule.resetToStart();
          }
          
        } else {
          showStatusMessage('Failed to mark as completed: ' + (result?.message || ''), 'error');
        }
      } catch (err) {
        showStatusMessage('Failed to mark as completed: ' + err.message, 'error');
      }
      break;
  }
}

// ===== 延迟导航 =====
async function delayedNavigation(targetStep, delayMs = 2000) {
  await new Promise(resolve => setTimeout(resolve, delayMs));
  showStep(targetStep);
}

// ===== SDTM分析触发 =====
async function triggerSDTMAnalysis() {
  try {
    console.log('🔄 开始自动触发SDTM分析...');
    // 不显示蓝色弹窗，分析状态由Step 4页面本身显示
    
    const documentId = window.currentDocumentId;
    if (!documentId) {
      throw new Error('No document ID available');
    }
    
    const response = await fetch(`${API_BASE_URL}/api/documents/${documentId}/analyze-sdtm`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      }
    });

    if (!response.ok) {
      throw new Error(`SDTM analysis failed: ${response.statusText}`);
    }

    const result = await response.json();
    console.log('✅ SDTM分析完成，状态: sdtm_ai_analysis_done');
    
    // 分析完成后静默跳转到结果页面
    setTimeout(async () => {
      showStep(5); // 跳转到 Step 5 (结果页面)
      
      // 自动加载并显示SDTM分析结果
      if (window.CostEstimateModule && window.CostEstimateModule.loadAndDisplaySDTMResults) {
        await window.CostEstimateModule.loadAndDisplaySDTMResults();
      }
    }, 2000);
    
  } catch (error) {
    console.error('❌ SDTM分析失败:', error);
    showStatusMessage('SDTM Analysis failed: ' + error.message, 'error');
  }
}

// 🔥 暴露给其他模块使用
window.triggerSDTMAnalysis = triggerSDTMAnalysis;

// ===== 模块通知 =====
function notifyModuleStepChange(stepNumber) {
  if (stepNumber <= 2 && window.MainPageModule && window.MainPageModule.onStepEnter) {
    window.MainPageModule.onStepEnter(stepNumber);
  } else if (stepNumber >= 3 && stepNumber <= 6 && window.CostEstimateModule && window.CostEstimateModule.onStepEnter) {
    window.CostEstimateModule.onStepEnter(stepNumber);
  }
}

// ===== Excel状态缓存 =====
async function cacheExcelState(stepNumber) {
  try {
    await Excel.run(async (context) => {
      const worksheet = context.workbook.worksheets.getActiveWorksheet();
      const usedRange = worksheet.getUsedRange();
      
      if (usedRange) {
        usedRange.load(['values', 'formulas']);
        await context.sync();
        
        excelStateCache[`step${stepNumber}`] = {
          values: usedRange.values,
          formulas: usedRange.formulas,
          rowCount: usedRange.rowCount,
          columnCount: usedRange.columnCount
        };
      } else {
        excelStateCache[`step${stepNumber}`] = null;
      }
    });
    console.log(`✅ 缓存Step ${stepNumber} Excel状态成功`);
  } catch (error) {
    console.warn(`⚠️ 缓存Step ${stepNumber} Excel状态失败:`, error);
  }
}

async function restoreExcelState(stepNumber) {
  try {
    const cachedState = excelStateCache[`step${stepNumber}`];
    
    await Excel.run(async (context) => {
      const worksheet = context.workbook.worksheets.getActiveWorksheet();
      
      // 清空当前内容
      const usedRange = worksheet.getUsedRange();
      if (usedRange) {
        usedRange.clear();
        await context.sync();
      }
      
      // 恢复缓存状态
      if (cachedState && cachedState.values) {
        const rowCount = cachedState.rowCount;
        const colCount = cachedState.columnCount;
        const restoreRange = worksheet.getRange(0, 0, rowCount, colCount);
        
        restoreRange.values = cachedState.values;
        if (cachedState.formulas) {
          restoreRange.formulas = cachedState.formulas;
        }
        
        await context.sync();
      }
    });
    console.log(`✅ 恢复Step ${stepNumber} Excel状态成功`);
  } catch (error) {
    console.warn(`⚠️ 恢复Step ${stepNumber} Excel状态失败:`, error);
  }
}

// ===== Excel变化监听 =====
async function initExcelChangeTracking() {
  try {
    await Excel.run(async (context) => {
      const worksheet = context.workbook.worksheets.getActiveWorksheet();
      
      // 监听单元格变化事件
      worksheet.onChanged.add(async (args) => {
        try {
          await Excel.run(async (innerContext) => {
            const sheet = innerContext.workbook.worksheets.getItem(args.worksheetId);
            const changedRange = sheet.getRange(args.address);
            changedRange.load(['columnIndex', 'columnCount']);
            await innerContext.sync();
            
            // 检查是否包含B列（Unit列）
            const startCol = changedRange.columnIndex;
            const endCol = startCol + changedRange.columnCount - 1;
            const includesB = (startCol <= 1 && endCol >= 1);
            if (!includesB) return;
            
            // 防抖保存
            if (changeTimeout) clearTimeout(changeTimeout);
            changeTimeout = setTimeout(async () => {
              if (window.CostEstimateModule && window.CostEstimateModule.saveExcelChangesToDatabase) {
                await window.CostEstimateModule.saveExcelChangesToDatabase();
              }
            }, 1000); // 1秒防抖
          });
        } catch (error) {
          console.warn('Excel变化处理失败:', error);
        }
      });
    });
    
    isTrackingChanges = true;
    console.log('✅ Excel变化监听初始化成功');
  } catch (error) {
    console.error('❌ Excel变化监听初始化失败:', error);
  }
}

// ===== 状态消息显示 =====
function showStatusMessage(message, type = 'info') {
  console.log(`[${type.toUpperCase()}] ${message}`);
  
  // 在UI中显示状态消息
  let statusElement = document.getElementById('status-message');
  if (!statusElement) {
    // 创建状态消息元素
    statusElement = document.createElement('div');
    statusElement.id = 'status-message';
    statusElement.className = 'status-message';
    document.body.appendChild(statusElement);
  }
  
  statusElement.textContent = message;
  statusElement.className = `status-message ${type}`;
  statusElement.style.display = 'block';
  
  // 3秒后自动隐藏
  setTimeout(() => {
    statusElement.style.display = 'none';
  }, 3000);
}

// ===== Excel设置存储 =====
async function saveDocumentIdToSettings(documentId) {
  try {
    await Excel.run(async (context) => {
      const settings = context.workbook.settings;
      settings.add('currentDocumentId', documentId);
      await context.sync();
      
      // 更新全局状态
      window.currentDocumentId = documentId;
      console.log(`✅ 文档ID已保存: ${documentId}`);
    });
  } catch (error) {
    console.error('❌ 保存文档ID失败:', error);
  }
}

async function loadDocumentIdFromSettings() {
  try {
    return await Excel.run(async (context) => {
      const settings = context.workbook.settings;
      const setting = settings.getItemOrNullObject('currentDocumentId');
      setting.load('value');
      await context.sync();
      
      if (setting.isNullObject) {
        return null;
      }
      
      const documentId = setting.value;
      window.currentDocumentId = documentId;
      console.log(`✅ 文档ID已加载: ${documentId}`);
      return documentId;
    });
  } catch (error) {
    console.error('❌ 加载文档ID失败:', error);
    return null;
  }
}

async function clearDocumentIdFromSettings() {
  try {
    await Excel.run(async (context) => {
      const settings = context.workbook.settings;
      const setting = settings.getItemOrNullObject('currentDocumentId');
      await context.sync();
      
      if (!setting.isNullObject) {
        setting.delete();
        await context.sync();
      }
      
      window.currentDocumentId = null;
      console.log('✅ 文档ID已清除');
    });
  } catch (error) {
    console.error('❌ 清除文档ID失败:', error);
  }
}

// ===== 应用状态恢复 =====
async function attemptStateRecovery() {
  try {
    const savedDocumentId = await loadDocumentIdFromSettings();
    if (savedDocumentId) {
      console.log('🔄 发现已保存的文档ID，尝试恢复状态...');
      if (window.CostEstimateModule && window.CostEstimateModule.restoreApplicationState) {
        await window.CostEstimateModule.restoreApplicationState(savedDocumentId);
      }
      showStep(5); // 跳转到结果页
    } else {
      showStep(1); // 开始新会话
    }
  } catch (error) {
    console.error('❌ 状态恢复失败:', error);
    showStep(1); // 降级到第一步
  }
}

// ===== 全局接口暴露 =====
window.TaskPaneController = {
  // 核心控制函数
  showStep,
  showPage,
  showStatusMessage,
  delayedNavigation,

  
  // Excel状态管理
  cacheExcelState,
  restoreExcelState,
  
  // 应用状态
  getCurrentStep: () => currentWizardStep,
  getUploadedProtocol: () => uploadedProtocol,
  setUploadedProtocol: (protocol) => { uploadedProtocol = protocol; },
  
  // 设置存储
  saveDocumentIdToSettings,
  loadDocumentIdFromSettings,
  clearDocumentIdFromSettings,
  
  // 全局常量
  API_BASE_URL
};

// 暴露showPage到全局
window.showPage = showPage;
