/*
 * Copyright (c) Microsoft Corporation. All rights reserved. Licensed under the MIT license.
 * See LICENSE in the project root for license information.
 */

/* global console, document, Excel, Office */

// 后端API基础URL - 使用HTTPS避免混合内容问题
const API_BASE_URL = 'https://localhost:4000';

// 全局变量
let uploadedProtocol = null;

Office.onReady(async (info) => {
  if (info.host === Office.HostType.Excel) {
    document.getElementById("sideload-msg").style.display = "none";
    document.getElementById("app-body").style.display = "flex";
    
    // 初始化文件上传功能
    initFileUpload();
    
    // 🔄 检查并恢复之前的状态
    try {
      const savedDocumentId = await loadDocumentIdFromSettings();
      if (savedDocumentId) {
        console.log('🔄 检测到已保存的文档ID，正在恢复状态...');
        await restoreApplicationState(savedDocumentId);
      }
    } catch (error) {
      console.error('❌ 启动时恢复状态失败:', error);
    }
  }
});

// 初始化文件上传功能
function initFileUpload() {
  // Protocol upload
  const protocolSelectBtn = document.getElementById('protocol-select-btn');
  const protocolFileInput = document.getElementById('protocol-file-input');
  const protocolUploadArea = document.getElementById('protocol-upload-area');
  const protocolCancelBtn = document.getElementById('protocol-cancel-btn');
  const protocolRemoveBtn = document.getElementById('protocol-remove-btn');



  // Protocol upload events
  protocolSelectBtn.addEventListener('click', () => protocolFileInput.click());
  protocolUploadArea.addEventListener('click', () => protocolFileInput.click());
  protocolFileInput.addEventListener('change', (e) => handleProtocolUpload(e.target.files[0]));
  protocolCancelBtn.addEventListener('click', cancelProtocolUpload);
  protocolRemoveBtn.addEventListener('click', removeProtocolFile);

  // Drag and drop for protocol
  protocolUploadArea.addEventListener('dragover', handleDragOver);
  protocolUploadArea.addEventListener('drop', (e) => handleProtocolDrop(e));
  protocolUploadArea.addEventListener('dragenter', handleDragEnter);
  protocolUploadArea.addEventListener('dragleave', handleDragLeave);

  // 🔥 新增：项目选择动态输入框逻辑
  initProjectSelectionLogic();
  


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

  // 验证文件类型
  const allowedTypes = [
    'application/pdf',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
  ];
  
  if (!allowedTypes.includes(file.type)) {
    showStatusMessage('Please select PDF or Word documents only', 'error');
    return;
  }

  // 显示上传进度
  showProtocolProgress();
  
  try {
    // 创建FormData
    const formData = new FormData();
    formData.append('document', file);
    formData.append('documentType', 'ClinicalProtocol'); // 明确标识为Clinical Protocol

    // 上传文件
    const response = await fetch(`${API_BASE_URL}/api/upload-document`, {
      method: 'POST',
      body: formData
    });

    if (!response.ok) {
      throw new Error(`Upload failed: ${response.statusText}`);
    }

    const result = await response.json();
    
    // 保存文件信息
    uploadedProtocol = {
      name: file.name,
      size: file.size,
      type: file.type,
      uploadId: result.uploadId
    };

    // 存储文档ID用于后续的确认操作
    if (result.uploadId) {
      window.currentDocumentId = result.uploadId;
      
      // 🔥 新增：将文档ID保存到Excel设置中实现持久化
      await saveDocumentIdToSettings(result.uploadId);
    }
    
    // 显示上传结果
    showProtocolResult(file);
    
    // 显示SDTM分析结果
    if (result.sdtmAnalysis) {
      displaySDTMAnalysis(result.sdtmAnalysis);
    }
    
    showStatusMessage('Clinical Protocol uploaded successfully!', 'success');
    
    // 🔥 新增：自动保存项目选择详情（如果有选择的话）
    await saveProjectSelectionDetails();
    
    // 🔥 新增：自动填写Excel表格的标准列标题
    await createStandardCostAnalysisHeaders();
    
    // 🔥 新增：根据用户选择填写Excel任务列表
    await populateExcelWithSelectedProjects();
    
  } catch (error) {
    console.error('Protocol upload error:', error);
    showStatusMessage(`Upload failed: ${error.message}`, 'error');
    hideProtocolProgress();
  }
}



// UI更新函数
function showProtocolProgress() {
  document.getElementById('protocol-upload-area').style.display = 'none';
  document.getElementById('protocol-progress').style.display = 'block';
  document.getElementById('protocol-result').style.display = 'none';
}

function hideProtocolProgress() {
  document.getElementById('protocol-upload-area').style.display = 'block';
  document.getElementById('protocol-progress').style.display = 'none';
}

function showProtocolResult(file) {
  document.getElementById('protocol-upload-area').style.display = 'none';
  document.getElementById('protocol-progress').style.display = 'none';
  document.getElementById('protocol-result').style.display = 'block';
  
  document.getElementById('protocol-file-name').textContent = file.name;
  document.getElementById('protocol-file-status').textContent = '✅ Clinical Protocol uploaded to MongoDB';
}

function cancelProtocolUpload() {
  hideProtocolProgress();
  showStatusMessage('Protocol upload cancelled', 'info');
  }

async function removeProtocolFile() {
  uploadedProtocol = null;
  window.currentDocumentId = null;
  currentSDTMData = null;
  
  document.getElementById('protocol-upload-area').style.display = 'block';
  document.getElementById('protocol-result').style.display = 'none';
  document.getElementById('protocol-file-input').value = '';
  
  // 隐藏SDTM分析结果
  hideSDTMAnalysis();
  
  // 🔥 新增：清除Excel设置中的持久化存储
  await clearDocumentIdFromSettings();
  
  // 重置项目选择状态
  const checkboxes = document.querySelectorAll('.project-options input[type="checkbox"]');
  checkboxes.forEach(checkbox => {
    checkbox.checked = false;
    const dataAttr = checkbox.getAttribute('data-requires-count');
    if (dataAttr) {
      const container = document.getElementById(`${dataAttr}-container`);
      const input = document.getElementById(`${dataAttr}-count`);
      if (container) container.style.display = 'none';
      if (input) input.value = '';
    }
  });
  
  showStatusMessage('Clinical Protocol removed', 'info');
}





// 工具函数
function formatFileSize(bytes) {
  if (bytes === 0) return '0 Bytes';
  const k = 1024;
  const sizes = ['Bytes', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

function showStatusMessage(message, type) {
  const statusElement = document.getElementById('status-message');
  statusElement.textContent = message;
  statusElement.className = `status-message ${type}`;
  
  if (type === 'success' || type === 'info') {
    setTimeout(() => {
  statusElement.className = 'status-message';
    }, 3000);
  }
}

// 📁 持久化存储函数 - 用于在Excel文件中保存/恢复文档ID
async function saveDocumentIdToSettings(documentId) {
  try {
    await Excel.run(async (context) => {
      const settings = context.workbook.settings;
      
      // 尝试删除现有设置（如果存在）
      try {
        settings.getItem("currentDocumentId").delete();
      } catch (e) {
        // 设置不存在，忽略错误
      }
      
      // 添加新的设置
      settings.add("currentDocumentId", documentId);
      await context.sync();
      console.log('✅ 文档ID已保存到Excel设置:', documentId);
    });
  } catch (error) {
    console.error('❌ 保存文档ID失败:', error);
  }
}

async function loadDocumentIdFromSettings() {
  try {
    return await Excel.run(async (context) => {
      const settings = context.workbook.settings;
      const documentIdSetting = settings.getItem("currentDocumentId");
      context.load(documentIdSetting, "value");
      await context.sync();
      
      if (documentIdSetting.value) {
        console.log('✅ 从Excel设置中恢复文档ID:', documentIdSetting.value);
        return documentIdSetting.value;
      }
      return null;
    });
  } catch (error) {
    console.error('❌ 读取文档ID失败:', error);
    return null;
  }
}

async function clearDocumentIdFromSettings() {
  try {
    await Excel.run(async (context) => {
      context.workbook.settings.getItem("currentDocumentId").delete();
      await context.sync();
      console.log('✅ 已清除Excel设置中的文档ID');
    });
  } catch (error) {
    console.error('❌ 清除文档ID失败:', error);
  }
}

// 🔄 状态恢复函数 - 根据文档ID恢复所有界面状态
async function restoreApplicationState(documentId) {
  try {
    window.currentDocumentId = documentId;
    showStatusMessage('正在恢复数据状态...', 'info');
    
    // 1. 获取文档数据
    const response = await fetch(`${API_BASE_URL}/api/documents/${documentId}/content`);
    if (!response.ok) {
      throw new Error('Failed to fetch document data');
    }
    
    const docData = await response.json();
    if (!docData.success) {
      throw new Error(docData.message || 'Failed to get document content');
    }
    
    const document = docData.document;
    
    // 2. 恢复SDTM数据显示
    if (document.sdtmData && (document.sdtmData.confirmed || document.sdtmData.original)) {
      const sdtmData = document.sdtmData.confirmed || document.sdtmData.original;
      if (sdtmData && sdtmData.procedures) {
        currentSDTMData = {
          procedures: sdtmData.procedures,
          mappings: sdtmData.mappings || [],
          summary: sdtmData.summary || {}
        };
        
        // 显示SDTM分析结果
        displaySDTMAnalysis(currentSDTMData);
        showStatusMessage('SDTM分析数据已恢复', 'success');
      }
    }
    
    // 3. 恢复项目选择状态
    if (document.projectSelectionDetails) {
      restoreProjectSelections(document.projectSelectionDetails);
    }
    
    // 4. 重新填充Excel表格
    await createStandardCostAnalysisHeaders();
    await populateExcelWithSelectedProjects();
    
    showStatusMessage('所有数据状态已成功恢复！', 'success');
    
  } catch (error) {
    console.error('❌ 恢复应用状态失败:', error);
    showStatusMessage('恢复数据状态失败: ' + error.message, 'error');
  }
}

// 🎯 恢复项目选择状态
function restoreProjectSelections(projectSelectionDetails) {
  try {
    // 清除所有现有的选择
    const checkboxes = document.querySelectorAll('.project-options input[type="checkbox"]');
    checkboxes.forEach(checkbox => {
      checkbox.checked = false;
      // 隐藏相关的计数输入框
      const dataAttr = checkbox.getAttribute('data-requires-count');
      if (dataAttr) {
        const container = document.getElementById(`${dataAttr}-container`);
        if (container) {
          container.style.display = 'none';
        }
      }
    });
    
    // 根据保存的数据恢复选择状态
    Object.entries(projectSelectionDetails).forEach(([projectName, count]) => {
      if (projectName === 'lastUpdated') return;
      
      // 查找对应的checkbox
      const checkbox = Array.from(checkboxes).find(cb => {
        const label = cb.nextElementSibling;
        if (label && label.classList.contains('ms-CheckBox-label')) {
          const textSpan = label.querySelector('.ms-CheckBox-text');
          return textSpan && textSpan.textContent.trim() === projectName;
        }
        return false;
      });
      
      if (checkbox) {
        checkbox.checked = true;
        
        // 如果有计数信息，显示输入框并填充数值
        const dataAttr = checkbox.getAttribute('data-requires-count');
        if (dataAttr && count && count > 0) {
          const container = document.getElementById(`${dataAttr}-container`);
          const input = document.getElementById(`${dataAttr}-count`);
          if (container && input) {
            container.style.display = 'flex';
            input.value = count;
          }
        }
      }
    });
    
    console.log('✅ 项目选择状态已恢复');
  } catch (error) {
    console.error('❌ 恢复项目选择状态失败:', error);
  }
}

// 全局变量来存储当前的SDTM数据和状态
let currentSDTMData = null;
let isEditMode = false;
let selectedProcedureIndex = 0;

// SDTM分析结果显示函数
function displaySDTMAnalysis(sdtmAnalysis) {
  console.log('显示SDTM分析结果:', sdtmAnalysis);
  
  // 存储当前数据
  currentSDTMData = {
    procedures: [...(sdtmAnalysis.procedures || [])],
    mappings: [...(sdtmAnalysis.mappings || [])],
    summary: { ...(sdtmAnalysis.summary || {}) }
  };
  
  const sdtmSection = document.getElementById('sdtm-analysis-section');
  const sdtmStatus = document.getElementById('sdtm-status');
  const sdtmStatusText = document.getElementById('sdtm-status-text');
  const sdtmMappingsContainer = document.getElementById('sdtm-mappings-container');
  
  // 显示SDTM分析区域
  sdtmSection.style.display = 'block';
  
  if (sdtmAnalysis.success) {
    // 显示成功状态
    sdtmStatus.style.display = 'block';
    sdtmStatus.className = 'sdtm-status success';
    sdtmStatusText.textContent = 'SDTM analysis completed successfully - Please review and confirm';
    
    // 🔥 修复：立即重新计算正确的去重统计数据
    updateSummaryStats();
    
    // 显示主要的编辑界面
    if (sdtmAnalysis.mappings && sdtmAnalysis.mappings.length > 0) {
      sdtmMappingsContainer.style.display = 'block';
      displayFlatMappingsList(currentSDTMData);
      setupSDTMEventListeners();
    }
    
  } else {
    // 显示错误状态
    sdtmStatus.style.display = 'block';
    sdtmStatus.className = 'sdtm-status error';
    sdtmStatusText.textContent = sdtmAnalysis.message || 'SDTM analysis failed';
  }
}

// 更新统计数据和域概览
function updateSummaryAndDomainOverview(summary) {
  // 更新统计数据
  document.getElementById('total-procedures').textContent = summary.total_procedures || 0;
  document.getElementById('total-domains').textContent = summary.total_sdtm_domains || 0;
  
  // 更新域概览
  const domainsOverview = document.getElementById('domains-list-overview');
  domainsOverview.innerHTML = '';
  
  if (summary.unique_domains && summary.unique_domains.length > 0) {
    summary.unique_domains.forEach(domain => {
      const domainTag = document.createElement('span');
      domainTag.className = 'domain-overview-tag';
      domainTag.textContent = domain;
      domainsOverview.appendChild(domainTag);
    });
  }
}

// 显示平铺式映射列表
function displayFlatMappingsList(data) {
  const flatMappingsList = document.getElementById('flat-mappings-list');
  flatMappingsList.innerHTML = '';
  
  if (!data.procedures || data.procedures.length === 0) {
    flatMappingsList.innerHTML = '<div style="text-align: center; color: #666; padding: 20px;">No procedures found</div>';
    return;
  }
  
  // 🔥 重要改变：遍历所有procedures，而不是只遍历mappings
  data.procedures.forEach((procedure, index) => {
    // 查找这个procedure对应的mapping
    const mapping = data.mappings ? data.mappings.find(m => m.procedure === procedure) : null;
    
    // 创建映射对象（如果没有找到mapping，创建一个空的）
    const procedureMapping = {
      procedure: procedure,
      sdtm_domains: mapping ? mapping.sdtm_domains : []
    };
    
    const mappingRow = createMappingRow(procedureMapping, index);
    flatMappingsList.appendChild(mappingRow);
  });
}

// 创建单个映射行
function createMappingRow(mapping, index) {
  const row = document.createElement('div');
  row.className = 'mapping-row';
  row.dataset.index = index;
  
  // Procedure名称
  const procedureName = document.createElement('div');
  procedureName.className = 'procedure-name';
  procedureName.textContent = mapping.procedure;
  
  // Domains区域
  const domainsArea = document.createElement('div');
  domainsArea.className = 'domains-area';
  
  // 添加现有的domain标签
  if (mapping.sdtm_domains && mapping.sdtm_domains.length > 0) {
    mapping.sdtm_domains.forEach((domain, domainIndex) => {
      const domainTag = createEditableDomainTag(domain, index, domainIndex);
      domainsArea.appendChild(domainTag);
    });
  }
  
  // 添加"添加Domain"按钮
  const addBtn = document.createElement('div');
  addBtn.className = 'add-domain-btn';
  addBtn.innerHTML = '+ Add';
  addBtn.addEventListener('click', () => addNewDomain(index));
  domainsArea.appendChild(addBtn);
  
  row.appendChild(procedureName);
  row.appendChild(domainsArea);
  
  return row;
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
    removeDomain(mappingIndex, domainIndex);
  });
  tag.appendChild(removeBtn);
  
  // 点击编辑功能
  tag.addEventListener('click', () => {
    if (isEditMode) {
      makeTagEditable(tag);
    }
  });
  
  return tag;
}

// 使标签进入可编辑状态
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
  
  // 处理编辑完成
  const finishEditing = () => {
    tag.contentEditable = 'false';
    tag.classList.remove('editing');
    
    const newText = tag.textContent.trim();
    const mappingIndex = parseInt(tag.dataset.mappingIndex);
    const domainIndex = parseInt(tag.dataset.domainIndex);
    
    // 更新数据
    if (newText && currentSDTMData.mappings[mappingIndex]) {
      currentSDTMData.mappings[mappingIndex].sdtm_domains[domainIndex] = newText;
    }
    
    // 重新创建标签（包含删除按钮）
    const newTag = createEditableDomainTag(newText, mappingIndex, domainIndex);
    tag.parentNode.replaceChild(newTag, tag);
    
    updateSummaryStats();
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

// 删除Domain
function removeDomain(procedureIndex, domainIndex) {
  const procedureName = currentSDTMData.procedures[procedureIndex];
  if (!procedureName) return;
  
  // 查找或创建对应的mapping
  let mapping = currentSDTMData.mappings.find(m => m.procedure === procedureName);
  if (mapping && mapping.sdtm_domains && mapping.sdtm_domains[domainIndex] !== undefined) {
    // 从数据中删除
    mapping.sdtm_domains.splice(domainIndex, 1);
    
    // 重新渲染映射列表
    displayFlatMappingsList(currentSDTMData);
    
    // 更新编辑模式显示
    if (isEditMode) {
      toggleEditMode();
      toggleEditMode();
    }
    
    updateSummaryStats();
  }
}

// 添加新Domain
function addNewDomain(procedureIndex) {
  if (!isEditMode) return;
  
  const procedureName = currentSDTMData.procedures[procedureIndex];
  if (!procedureName) return;
  
  // 查找或创建对应的mapping
  let mapping = currentSDTMData.mappings.find(m => m.procedure === procedureName);
  if (!mapping) {
    // 如果mapping不存在，创建一个新的
    mapping = {
      procedure: procedureName,
      sdtm_domains: []
    };
    currentSDTMData.mappings.push(mapping);
  }
  
  // 添加空domain
  mapping.sdtm_domains.push('');
  const newDomainIndex = mapping.sdtm_domains.length - 1;
  
  // 重新渲染映射列表
  displayFlatMappingsList(currentSDTMData);
  
  // 重新设置编辑模式
  if (isEditMode) {
    toggleEditMode();
    toggleEditMode();
  }
  
  // 找到新添加的标签并开始编辑
  setTimeout(() => {
    const newTag = document.querySelector(`[data-mapping-index="${procedureIndex}"][data-domain-index="${newDomainIndex}"]`);
    if (newTag) {
      makeTagEditable(newTag);
    }
  }, 100);
}

// 设置SDTM相关的事件监听器
function setupSDTMEventListeners() {
  // 编辑按钮
  const editBtn = document.getElementById('edit-mappings-btn');
  if (editBtn) {
    editBtn.addEventListener('click', toggleEditMode);
  }
  
  // 确认按钮
  const confirmBtn = document.getElementById('confirm-mappings-btn');
  if (confirmBtn) {
    confirmBtn.addEventListener('click', confirmSDTMAnalysis);
  }
}

// 切换编辑模式
function toggleEditMode() {
  isEditMode = !isEditMode;
  const editBtn = document.getElementById('edit-mappings-btn');
  const flatMappingsList = document.getElementById('flat-mappings-list');
  
  if (editBtn) {
    const btnLabel = editBtn.querySelector('.ms-Button-label');
    btnLabel.textContent = isEditMode ? 'View Mode' : 'Edit';
  }
  
  // 更新容器的编辑模式样式
  if (isEditMode) {
    flatMappingsList.classList.add('edit-mode');
    // 为所有映射行添加编辑模式样式
    document.querySelectorAll('.mapping-row').forEach(row => {
      row.classList.add('edit-mode');
    });
  } else {
    flatMappingsList.classList.remove('edit-mode');
    // 移除所有映射行的编辑模式样式
    document.querySelectorAll('.mapping-row').forEach(row => {
      row.classList.remove('edit-mode');
    });
  }
}

// 更新统计数据
function updateSummaryStats() {
  // 重新计算所有唯一的domains
  const allDomains = new Set();
  let totalMappings = 0;
  
  currentSDTMData.mappings.forEach(mapping => {
    if (mapping.sdtm_domains && mapping.sdtm_domains.length > 0) {
      mapping.sdtm_domains.forEach(domain => {
        if (domain.trim()) {
          allDomains.add(domain.trim());
        }
      });
      totalMappings += mapping.sdtm_domains.length;
    }
  });
  
  // 更新summary对象 - 🔥 确保procedures数量是真实的
  currentSDTMData.summary.total_procedures = currentSDTMData.procedures ? currentSDTMData.procedures.length : 0;
  currentSDTMData.summary.unique_domains = Array.from(allDomains);
  currentSDTMData.summary.total_sdtm_domains = allDomains.size;
  
  // 更新显示
  updateSummaryAndDomainOverview(currentSDTMData.summary);
  
  console.log('统计数据已更新:', {
    total_procedures: currentSDTMData.summary.total_procedures,
    total_sdtm_domains: allDomains.size,
    unique_domains: Array.from(allDomains)
  });
}

// 确认SDTM分析结果
async function confirmSDTMAnalysis() {
  if (!window.currentDocumentId) {
    alert('No document ID found. Please re-upload the document.');
    return;
  }
  
  try {
    console.log('发送确认请求到服务器...');
    
    const response = await fetch(`${API_BASE_URL}/api/documents/${window.currentDocumentId}/confirm-sdtm`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        procedures: currentSDTMData.procedures,
        mappings: currentSDTMData.mappings,
        summary: currentSDTMData.summary
      })
    });
    
    const result = await response.json();
    
    if (result.success) {
      console.log('SDTM分析已确认并保存');
      
      // 显示确认状态
      const confirmationStatus = document.getElementById('confirmation-status');
      if (confirmationStatus) {
        confirmationStatus.style.display = 'flex';
      }
      
      // 隐藏编辑按钮，显示已确认状态
      const editBtn = document.getElementById('edit-mappings-btn');
      const confirmBtn = document.getElementById('confirm-mappings-btn');
      if (editBtn) editBtn.style.display = 'none';
      if (confirmBtn) confirmBtn.style.display = 'none';
      
      showStatusMessage('SDTM analysis confirmed and saved successfully!', 'success');
    } else {
      console.error('确认失败:', result.message);
      showStatusMessage('Failed to confirm SDTM analysis: ' + result.message, 'error');
    }
    
  } catch (error) {
    console.error('确认请求失败:', error);
    showStatusMessage('Network error: Failed to confirm SDTM analysis', 'error');
  }
}

// 隐藏SDTM分析区域（在移除文件时调用）
function hideSDTMAnalysis() {
  const sdtmSection = document.getElementById('sdtm-analysis-section');
  const sdtmMappingsContainer = document.getElementById('sdtm-mappings-container');
  
  if (sdtmSection) {
    sdtmSection.style.display = 'none';
  }
  
  if (sdtmMappingsContainer) {
    sdtmMappingsContainer.style.display = 'none';
  }
  
  // 重置状态
  currentSDTMData = null;
  window.currentDocumentId = null;
  isEditMode = false;
  selectedProcedureIndex = 0;
}

// 🔥 新增：自动创建标准成本分析表格标题
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
      showStatusMessage('Excel table headers created successfully!', 'success');
    });
  } catch (error) {
    console.error('❌ 创建Excel标题时出错:', error);
    showStatusMessage('Failed to create Excel headers: ' + error.message, 'error');
  }
}

// 🔥 新增：根据项目选择填写Excel任务列表
async function populateExcelWithSelectedProjects() {
  try {
    // 从MongoDB获取已保存的项目选择详情和SDTM数据
    let savedProjectDetails = {};
    let sdtmInfo = null;
    if (window.currentDocumentId) {
      try {
        const response = await fetch(`${API_BASE_URL}/api/documents/${window.currentDocumentId}/content`);
        if (response.ok) {
          const docData = await response.json();
          if (docData.document && docData.document.projectSelectionDetails) {
            savedProjectDetails = docData.document.projectSelectionDetails;
          }
          // 获取SDTM数据
          if (docData.document && docData.document.sdtmData) {
            // 优先使用用户确认的SDTM数据，其次使用原始AI分析结果
            sdtmInfo = docData.document.sdtmData.confirmed || docData.document.sdtmData.original;
          }
        }
      } catch (error) {
        console.warn('无法获取已保存的项目详情，使用当前选择:', error);
      }
    }
    
    // 如果没有从数据库获取到，则使用当前表单数据
            if (Object.keys(savedProjectDetails).length === 0) {
          const { projectSelectionDetails } = collectProjectSelectionDetails();
          savedProjectDetails = projectSelectionDetails;
        }

        // 生成SDTM信息字符串
        let sdtmNotesText = "";
        // 🔥 修复：优先使用数据库数据，其次使用当前SDTM数据
        const sdtmSource = sdtmInfo || currentSDTMData;
        if (sdtmSource && sdtmSource.summary) {
          const totalSDTM = sdtmSource.summary.total_procedures || 0;
          const domains = sdtmSource.summary.unique_domains || [];
          sdtmNotesText = `total number of SDTM: ${totalSDTM}; SDTM categories: ${domains.join('/')}`;
        }

        await Excel.run(async (context) => {
      const worksheet = context.workbook.worksheets.getActiveWorksheet();
      
      let currentRow = 2; // 从第2行开始（第1行是表头）
      
      // 第一部分：用户选择的项目
      if (Object.keys(savedProjectDetails).length > 0) {
        for (const [projectName, count] of Object.entries(savedProjectDetails)) {
          // 跳过 lastUpdated 字段
          if (projectName === 'lastUpdated') continue;
          
          // 根据项目类型确定处理方式
          const isSDTM = projectName.toLowerCase().includes("sdtm");
          const isADAM = projectName.toLowerCase().includes("adam");
          const isDSUR = projectName.toLowerCase().includes("dsur");
          const isDSMB = projectName.toLowerCase().includes("dsmb");
          const isStatisticalAnalysisPlan = projectName.toLowerCase().includes("statistical analysis plan");
          
          if (isSDTM || isADAM || isStatisticalAnalysisPlan) {
            // SDTM/ADAM/SAP: 主项目 + 详细子项目 + subtotal + (仅SDTM/ADAM: Transfer + Transfer详细子项目 + subtotal)
            
            // 1. 添加主项目名称行（只填写项目名称，其他列为空）
            const projectNameRange = worksheet.getRange(`A${currentRow}:G${currentRow}`);
            projectNameRange.values = [[projectName, "", "", "", "", "", ""]];
            projectNameRange.format.font.bold = true; // 主项目名称要加粗
            projectNameRange.format.horizontalAlignment = "Left";
            currentRow++;
            
            // 2. 添加主项目的详细子项目
            if (isSDTM) {
              const sdtmSubItems = [
                { name: "SDTM Annotated CRFs (aCRF)", unit: 1, costPerHour: 1.0, hoursPerUnit: 32, costPerUnit: 32.0, estimatedCost: 32.0 },
                { name: "SDTM Dataset Specs (High Complexity)", unit: 5, costPerHour: 1.0, hoursPerUnit: 3, costPerUnit: 3.0, estimatedCost: 15.0 },
                { name: "SDTM Dataset Specs (Medium Complexity)", unit: 20, costPerHour: 1.0, hoursPerUnit: 2, costPerUnit: 2.0, estimatedCost: 40.0 },
                { name: "SDTM Production and Validation: Programs and Datasets (High Complexity)", unit: 5, costPerHour: 1.0, hoursPerUnit: 16, costPerUnit: 16.0, estimatedCost: 80.0 },
                { name: "SDTM Production and Validation: Programs and Datasets (Medium Complexity)", unit: 20, costPerHour: 1.0, hoursPerUnit: 10, costPerUnit: 10.0, estimatedCost: 200.0 },
                { name: "SDTM Pinnacle 21 Report Creation and Review", unit: 2, costPerHour: 1.0, hoursPerUnit: 6, costPerUnit: 6.0, estimatedCost: 12.0 },
                { name: "SDTM Reviewer's Guide", unit: 1, costPerHour: 1.0, hoursPerUnit: 32, costPerUnit: 32.0, estimatedCost: 32.0 },
                { name: "SDTM Define.xml", unit: 1, costPerHour: 1.0, hoursPerUnit: 32, costPerUnit: 32.0, estimatedCost: 32.0 },
                { name: "SDTM Dataset File xpt Conversion and Review", unit: 25, costPerHour: 1.0, hoursPerUnit: 0.2, costPerUnit: 0.2, estimatedCost: 5.0 }
              ];
              
              for (const subItem of sdtmSubItems) {
                // 为"SDTM Dataset Specs (High Complexity)"添加SDTM信息到Notes列
                let notesText = "";
                if (subItem.name === "SDTM Dataset Specs (High Complexity)" && sdtmNotesText) {
                  notesText = sdtmNotesText;
                }
                
                const subItemRange = worksheet.getRange(`A${currentRow}:G${currentRow}`);
                subItemRange.values = [[
                  subItem.name,
                  "", // Unit列不填写
                  `$${subItem.costPerHour}`,
                  subItem.hoursPerUnit,
                  `$${subItem.costPerUnit}`,
                  "", // Estimated Cost列不填写
                  notesText // Notes列：SDTM信息
                ]];
                subItemRange.format.font.bold = false; // 不加粗
                subItemRange.format.horizontalAlignment = "Left";
                // 数字列右对齐
                const numberColumns = worksheet.getRange(`B${currentRow}:F${currentRow}`);
                numberColumns.format.horizontalAlignment = "Right";
                currentRow++;
              }
            } else if (isADAM) {
              const adamSubItems = [
                { name: "ADaM Dataset Specs (High Complexity)", unit: 5, costPerHour: 1.0, hoursPerUnit: 3, costPerUnit: 3.0, estimatedCost: 15.0 },
                { name: "ADaM Dataset Specs (Medium Complexity)", unit: 10, costPerHour: 1.0, hoursPerUnit: 2, costPerUnit: 2.0, estimatedCost: 20.0 },
                { name: "ADaM Production and Validation: Programs and Datasets (High Complexity)", unit: 5, costPerHour: 1.0, hoursPerUnit: 18, costPerUnit: 18.0, estimatedCost: 90.0 },
                { name: "ADaM Production and Validation: Programs and Datasets (Medium Complexity)", unit: 10, costPerHour: 1.0, hoursPerUnit: 10, costPerUnit: 10.0, estimatedCost: 100.0 },
                { name: "ADaM Pinnacle 21 Report Creation and Review", unit: 1, costPerHour: 1.0, hoursPerUnit: 4, costPerUnit: 4.0, estimatedCost: 4.0 },
                { name: "ADaM Reviewer's Guide", unit: 1, costPerHour: 1.0, hoursPerUnit: 32, costPerUnit: 32.0, estimatedCost: 32.0 },
                { name: "ADaM Define.xml", unit: 1, costPerHour: 1.0, hoursPerUnit: 32, costPerUnit: 32.0, estimatedCost: 32.0 },
                { name: "ADaM Dataset Program xpt Conversion and Review", unit: 15, costPerHour: 1.0, hoursPerUnit: 0.2, costPerUnit: 0.2, estimatedCost: 3.0 },
                { name: "ADaM Program txt Conversion and Review", unit: 15, costPerHour: 1.0, hoursPerUnit: 0.2, costPerUnit: 0.2, estimatedCost: 3.0 }
              ];
              
              for (const subItem of adamSubItems) {
                const subItemRange = worksheet.getRange(`A${currentRow}:G${currentRow}`);
                subItemRange.values = [[
                  subItem.name,
                  "", // Unit列不填写
                  `$${subItem.costPerHour}`,
                  subItem.hoursPerUnit,
                  `$${subItem.costPerUnit}`,
                  "", // Estimated Cost列不填写
                  "" // Notes列为空
                ]];
                subItemRange.format.font.bold = false; // 不加粗
                subItemRange.format.horizontalAlignment = "Left";
                // 数字列右对齐
                const numberColumns = worksheet.getRange(`B${currentRow}:F${currentRow}`);
                numberColumns.format.horizontalAlignment = "Right";
                currentRow++;
              }
            } else if (isStatisticalAnalysisPlan) {
              // Statistical Analysis Plan的子项目
              const sapSubItems = [
                { name: "Statistical Analysis Plan Draft 1", unit: 1, costPerHour: 1.0, hoursPerUnit: 40, costPerUnit: 40.0, estimatedCost: 40.0 },
                { name: "Statistical Analysis Plan Draft 2", unit: 1, costPerHour: 1.0, hoursPerUnit: 30, costPerUnit: 30.0, estimatedCost: 30.0 },
                { name: "Statistical Analysis Plan Final", unit: 1, costPerHour: 1.0, hoursPerUnit: 20, costPerUnit: 20.0, estimatedCost: 20.0 },
                { name: "Analysis Shells Development", unit: 1, costPerHour: 1.0, hoursPerUnit: 60, costPerUnit: 60.0, estimatedCost: 60.0 },
                { name: "Mock Tables, Listings, and Figures", unit: 1, costPerHour: 1.0, hoursPerUnit: 40, costPerUnit: 40.0, estimatedCost: 40.0 }
              ];
              
              for (const subItem of sapSubItems) {
                const subItemRange = worksheet.getRange(`A${currentRow}:G${currentRow}`);
                subItemRange.values = [[
                  subItem.name,
                  "", // Unit列不填写
                  `$${subItem.costPerHour}`,
                  subItem.hoursPerUnit,
                  `$${subItem.costPerUnit}`,
                  "", // Estimated Cost列不填写
                  "" // Notes列为空
                ]];
                subItemRange.format.font.bold = false; // 不加粗
                subItemRange.format.horizontalAlignment = "Left";
                // 数字列右对齐
                const numberColumns = worksheet.getRange(`B${currentRow}:F${currentRow}`);
                numberColumns.format.horizontalAlignment = "Right";
                currentRow++;
              }
            }
            
            // 3. 添加主项目的Subtotal行
            const mainSubtotalRange = worksheet.getRange(`A${currentRow}:G${currentRow}`);
            mainSubtotalRange.values = [["Subtotal", "", "", "", "", "", ""]];
            mainSubtotalRange.format.font.bold = true;
            mainSubtotalRange.format.horizontalAlignment = "Right";
            currentRow++;
            
            // 4. 如果有次数且是SDTM/ADAM，添加Transfer子项目
            if (count && count > 0 && (isSDTM || isADAM)) {
              const transferSubsection = isSDTM ? 
                `SDTM Dataset Transfer (${count} times)` : 
                `ADAM Dataset Transfer (${count} times)`;
              
              const transferRange = worksheet.getRange(`A${currentRow}:G${currentRow}`);
              transferRange.values = [[transferSubsection, "", "", "", "", "", ""]];
              transferRange.format.font.bold = true; // Transfer subtitle要加粗
              transferRange.format.horizontalAlignment = "Left";
              currentRow++;
              
              // 5. 添加Transfer的详细子项目
              const transferSubItems = isSDTM ? [
                { name: `Production and Validation, the first 2 times`, unit: 2, costPerHour: 1.0, hoursPerUnit: 25, costPerUnit: 25.0, estimatedCost: 50.0 },
                { name: `Production and Validation, the last ${count - 2} times`, unit: count - 2, costPerHour: 1.0, hoursPerUnit: 12.5, costPerUnit: 12.5, estimatedCost: (count - 2) * 12.5 }
              ] : [
                { name: `Production and Validation, the first 2 times`, unit: 2, costPerHour: 1.0, hoursPerUnit: 15, costPerUnit: 15.0, estimatedCost: 30.0 },
                { name: `Production and Validation, the last ${count - 2} times`, unit: count - 2, costPerHour: 1.0, hoursPerUnit: 7.5, costPerUnit: 7.5, estimatedCost: (count - 2) * 7.5 }
              ];
              
              for (const transferSubItem of transferSubItems) {
                const transferSubItemRange = worksheet.getRange(`A${currentRow}:G${currentRow}`);
                transferSubItemRange.values = [[
                  transferSubItem.name,
                  "", // Unit列不填写
                  `$${transferSubItem.costPerHour}`,
                  transferSubItem.hoursPerUnit,
                  `$${transferSubItem.costPerUnit}`,
                  "", // Estimated Cost列不填写
                  "" // Notes列为空
                ]];
                transferSubItemRange.format.font.bold = false; // 不加粗
                transferSubItemRange.format.horizontalAlignment = "Left";
                // 数字列右对齐
                const transferNumberColumns = worksheet.getRange(`B${currentRow}:F${currentRow}`);
                transferNumberColumns.format.horizontalAlignment = "Right";
                currentRow++;
              }
              
              // 6. 添加Transfer的Subtotal行
              const transferSubtotalRange = worksheet.getRange(`A${currentRow}:G${currentRow}`);
              transferSubtotalRange.values = [["Subtotal", "", "", "", "", "", ""]];
              transferSubtotalRange.format.font.bold = true;
              transferSubtotalRange.format.horizontalAlignment = "Right";
              currentRow++;
            }
            
          } else if (isDSUR || isDSMB) {
            // DSUR/DSMB: 只显示带次数的行 + subtotal
            
            if (count && count > 0) {
              const rerunSubsection = isDSUR ? 
                `DSUR Rerun (${count} times)` : 
                `DSMB Rerun (${count} times)`;
              
              // 1. 添加Rerun行（带次数）
              const rerunRange = worksheet.getRange(`A${currentRow}:G${currentRow}`);
              rerunRange.values = [[rerunSubsection, "", "", "", "", "", ""]];
              rerunRange.format.font.bold = true; // Rerun subtitle要加粗
              rerunRange.format.horizontalAlignment = "Left";
              currentRow++;
              
              // 2. 添加Rerun的Subtotal行
              const rerunSubtotalRange = worksheet.getRange(`A${currentRow}:G${currentRow}`);
              rerunSubtotalRange.values = [["Subtotal", "", "", "", "", "", ""]];
              rerunSubtotalRange.format.font.bold = true;
              rerunSubtotalRange.format.horizontalAlignment = "Right";
              currentRow++;
            }
            
          } else {
            // 其他项目: 正常处理（项目名 + subtotal）
            
            // 1. 添加项目名称行
            const projectNameRange = worksheet.getRange(`A${currentRow}:G${currentRow}`);
            projectNameRange.values = [[projectName, "", "", "", "", "", ""]];
            projectNameRange.format.font.bold = true; // 主项目名称要加粗
            projectNameRange.format.horizontalAlignment = "Left";
            currentRow++;
            
            // 2. 添加Subtotal行
            const subtotalRange = worksheet.getRange(`A${currentRow}:G${currentRow}`);
            subtotalRange.values = [["Subtotal", "", "", "", "", "", ""]];
            subtotalRange.format.font.bold = true;
            subtotalRange.format.horizontalAlignment = "Right";
            currentRow++;
          }
        }
      }
      
      // 第二部分：默认的固定子项目
      const defaultSubsections = [
        "License Fees",
        "Adhoc Analysis", 
        "Project Management/Administration(12 Months)"
      ];
      
      for (const subsection of defaultSubsections) {
        // 添加子项目名称行（加粗，左对齐）
        const subsectionRange = worksheet.getRange(`A${currentRow}:G${currentRow}`);
        subsectionRange.values = [[subsection, "", "", "", "", "", ""]];
        subsectionRange.format.font.bold = true; // 默认subsection要加粗
        subsectionRange.format.horizontalAlignment = "Left";
        currentRow++;
        
        // 添加该子项目的Subtotal行（加粗，右对齐）
        const subtotalRange = worksheet.getRange(`A${currentRow}:G${currentRow}`);
        subtotalRange.values = [["Subtotal", "", "", "", "", "", ""]];
        subtotalRange.format.font.bold = true;
        subtotalRange.format.horizontalAlignment = "Right";
        currentRow++;
      }
      
      // 自动调整列宽
      // 添加Grand Total行（最后一行，右对齐且加粗）
      const grandTotalRange = worksheet.getRange(`A${currentRow}:G${currentRow}`);
      grandTotalRange.values = [["Grand Total", "", "", "", "", "", ""]];
      grandTotalRange.format.font.bold = true;
      grandTotalRange.format.horizontalAlignment = "Right";
      currentRow++;

      // 自动调整列A的宽度
      const taskColumn = worksheet.getRange("A:A");
      taskColumn.format.autofitColumns();

      await context.sync();
      console.log('✅ Excel任务列表已填充');
      showStatusMessage('Project tasks added to Excel successfully!', 'success');
    });
    
  } catch (error) {
    console.error('❌ 填充Excel任务列表时出错:', error);
    showStatusMessage('Failed to populate Excel with projects: ' + error.message, 'error');
  }
}

// 🔥 新增：项目选择动态输入框逻辑
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

// 🔥 新增：收集项目选择详细信息 (简化格式: 项目名->次数)
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

// 🔥 新增：保存项目选择详细信息到后端
async function saveProjectSelectionDetails() {
  try {
    if (!window.currentDocumentId) {
      console.warn('没有当前文档ID，跳过保存项目选择详情');
      return;
    }
    
    const { projectSelectionDetails } = collectProjectSelectionDetails();
    
    // 检查是否有任何项目选择
    if (Object.keys(projectSelectionDetails).length === 0) {
      console.log('没有项目选择，跳过保存');
      return;
    }
    
    const response = await fetch(`${API_BASE_URL}/api/documents/${window.currentDocumentId}/project-selection`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ projectSelectionDetails })
    });
    
    if (response.ok) {
      console.log('✅ 项目选择详情已自动保存');
      showStatusMessage('Project selection automatically saved with document!', 'success');
    } else {
      throw new Error('保存项目选择详情失败');
    }
    
  } catch (error) {
    console.error('❌ 保存项目选择详情时出错:', error);
    // 不显示错误消息，因为这是自动保存，不应该干扰用户体验
  }
}




