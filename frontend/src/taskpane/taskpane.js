/*
 * Copyright (c) Microsoft Corporation. All rights reserved. Licensed under the MIT license.
 * See LICENSE in the project root for license information.
 */

/* global console, document, Excel, Office */

// 后端API基础URL - 使用HTTPS避免混合内容问题
const API_BASE_URL = 'https://localhost:4000';

// 全局变量
let uploadedProtocol = null;

Office.onReady((info) => {
  if (info.host === Office.HostType.Excel) {
    document.getElementById("sideload-msg").style.display = "none";
    document.getElementById("app-body").style.display = "flex";
    
    // 初始化项目选择功能
    initProjectSelection();
    // 初始化文件上传功能
    initFileUpload();
  }
});

// 初始化项目选择功能
function initProjectSelection() {
  // 监听特定checkbox的变化，显示/隐藏对应的配置输入框
  const checkboxConfigs = [
    { checkboxId: 'project-2', configId: 'sdtm-config' },    // SDTM
    { checkboxId: 'project-3', configId: 'adam-config' },    // ADaM
    { checkboxId: 'project-8', configId: 'dsur-config' },    // DSUR Rerun
    { checkboxId: 'project-10', configId: 'dsmb-config' }    // DSMB Rerun
  ];

  checkboxConfigs.forEach(({ checkboxId, configId }) => {
    const checkbox = document.getElementById(checkboxId);
    const configDiv = document.getElementById(configId);
    
    if (checkbox && configDiv) {
      checkbox.addEventListener('change', () => {
        if (checkbox.checked) {
          configDiv.style.display = 'flex';
        } else {
          configDiv.style.display = 'none';
        }
      });
    }
  });
}

// 获取项目选择数据
function getProjectSelectionData() {
  const selectedTasks = [];
  const dataTransferTimes = { sdtm: 0, adam: 0 };
  const rerunTimes = { dsur: 0, dsmb: 0 };

  // 收集选中的任务
  const allCheckboxes = document.querySelectorAll('.project-option input[type="checkbox"]');
  allCheckboxes.forEach(checkbox => {
    if (checkbox.checked) {
      const labelText = checkbox.parentNode.querySelector('.ms-CheckBox-text').textContent;
      selectedTasks.push(labelText);
    }
  });

  // 收集配置参数
  const sdtmTransfer = document.getElementById('sdtm-transfer-times');
  const adamTransfer = document.getElementById('adam-transfer-times');
  const dsurRerun = document.getElementById('dsur-rerun-times');
  const dsmbrerun = document.getElementById('dsmb-rerun-times');

  if (document.getElementById('project-2').checked && sdtmTransfer) {
    dataTransferTimes.sdtm = parseInt(sdtmTransfer.value) || 1;
  }
  if (document.getElementById('project-3').checked && adamTransfer) {
    dataTransferTimes.adam = parseInt(adamTransfer.value) || 1;
  }
  if (document.getElementById('project-8').checked && dsurRerun) {
    rerunTimes.dsur = parseInt(dsurRerun.value) || 1;
  }
  if (document.getElementById('project-10').checked && dsmbrerun) {
    rerunTimes.dsmb = parseInt(dsmbrerun.value) || 1;
  }

  return {
    selectedTasks,
    dataTransferTimes,
    rerunTimes,
    configuredAt: new Date()
  };
}

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
    // 获取项目选择数据
    const projectSelectionData = getProjectSelectionData();
    
    // 创建FormData
    const formData = new FormData();
    formData.append('document', file);
    formData.append('documentType', 'ClinicalProtocol'); // 明确标识为Clinical Protocol
    formData.append('projectSelection', JSON.stringify(projectSelectionData)); // 添加项目选择数据

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
    }
    
    // 显示上传结果
    showProtocolResult(file, result);
    
    // 显示SDTM分析结果
    if (result.sdtmAnalysis) {
      displaySDTMAnalysis(result.sdtmAnalysis);
    }
    
    // 显示生成的Excel文件信息
    if (result.autoGeneratedExcel || result.costAnalysisExcel) {
      displayGeneratedExcelInfo(result.autoGeneratedExcel, result.costAnalysisExcel);
    }
    
    showStatusMessage('Clinical Protocol uploaded successfully!', 'success');
    
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

function showProtocolResult(file, result) {
  document.getElementById('protocol-upload-area').style.display = 'none';
  document.getElementById('protocol-progress').style.display = 'none';
  document.getElementById('protocol-result').style.display = 'block';
  
  document.getElementById('protocol-file-name').textContent = file.name;
  
  let statusText = '✅ Clinical Protocol uploaded to MongoDB';
  if (result.projectSelection && result.projectSelection.selectedTasks.length > 0) {
    statusText += ` | 📊 Cost Analysis Excel generated (${result.projectSelection.selectedTasks.length} tasks)`;
  }
  
  document.getElementById('protocol-file-status').textContent = statusText;
}

function cancelProtocolUpload() {
  hideProtocolProgress();
  showStatusMessage('Protocol upload cancelled', 'info');
  }

function removeProtocolFile() {
  uploadedProtocol = null;
  document.getElementById('protocol-upload-area').style.display = 'block';
  document.getElementById('protocol-result').style.display = 'none';
  document.getElementById('protocol-file-input').value = '';
  
  // 隐藏SDTM分析结果
  hideSDTMAnalysis();
  
  // 隐藏Excel信息
  hideGeneratedExcelInfo();
  
  showStatusMessage('Clinical Protocol removed', 'info');
}

// 显示生成的Excel文件信息
function displayGeneratedExcelInfo(assessmentExcel, costExcel) {
  console.log('显示Excel文件信息:', { assessmentExcel, costExcel });
  
  let message = '📊 Generated Excel Files:\n';
  
  if (assessmentExcel) {
    message += `• Assessment Schedule: ${assessmentExcel.fileName}\n`;
  }
  
  if (costExcel) {
    message += `• Cost Analysis: ${costExcel.fileName}\n`;
  }
  
  // 可以在状态消息中显示，或者添加到UI的特定区域
  console.log(message);
  
  // 未来可以在这里添加下载链接等功能
}

// 隐藏Excel信息
function hideGeneratedExcelInfo() {
  // 未来如果有专门的Excel信息显示区域，在这里隐藏
  console.log('隐藏Excel文件信息');
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
    
    // 更新统计数据和域概览
    updateSummaryAndDomainOverview(sdtmAnalysis.summary);
    
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


