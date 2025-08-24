// Other Documents Upload Page (Temporarily reusing Protocol upload logic as-is)
(function(){
  let API_BASE_URL = (typeof window !== 'undefined' && window.API_BASE_URL) ? window.API_BASE_URL : '';
  let currentStudyId = (typeof window !== 'undefined' && window.currentDocumentId) ? window.currentDocumentId : null;

  function qs(id){ return document.getElementById(id); }
  function formatBytes(bytes){ if(!bytes&&bytes!==0)return ''; const s=['Bytes','KB','MB','GB']; if(bytes===0)return '0 Byte'; const i=parseInt(Math.floor(Math.log(bytes)/Math.log(1024)),10); return Math.round(bytes/Math.pow(1024,i),2)+' '+s[i]; }

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
    let host = document.getElementById('otherdocuments-container') || document.body;
    let banner = document.getElementById('otherdocs-status-banner');
    if (!banner) {
      banner = document.createElement('div');
      banner.id = 'otherdocs-status-banner';
      banner.style.cssText = 'margin:12px 0;padding:10px 14px;border-radius:6px;font-size:13px;';
      host.insertBefore(banner, host.firstChild);
    }
    banner.style.background = (type === 'error') ? '#fde7e9' : (type === 'success') ? '#e6f4ea' : '#f3f2f1';
    banner.style.color = '#323130';
    banner.textContent = message;
  }

  function initBindings(){
    // CRF bindings
    const crfSelectBtn = qs('crf-select-btn');
    const crfFileInput = qs('crf-file-input');
    const crfUploadArea = qs('crf-upload-area');
    const crfCancelBtn = qs('crf-cancel-btn');
    const crfRemoveBtn = qs('crf-remove-btn');
    if (crfSelectBtn && crfFileInput) crfSelectBtn.addEventListener('click', () => crfFileInput.click());
    if (crfUploadArea && crfFileInput) crfUploadArea.addEventListener('click', () => crfFileInput.click());
    if (crfFileInput) crfFileInput.addEventListener('change', (e) => handleUpload(e.target.files[0], 'crf'));
    if (crfCancelBtn) crfCancelBtn.addEventListener('click', () => cancelUpload('crf'));
    if (crfRemoveBtn) crfRemoveBtn.addEventListener('click', () => removeFile('crf'));

    // SAP bindings
    const sapSelectBtn = qs('sap-select-btn');
    const sapFileInput = qs('sap-file-input');
    const sapUploadArea = qs('sap-upload-area');
    const sapCancelBtn = qs('sap-cancel-btn');
    const sapRemoveBtn = qs('sap-remove-btn');
    if (sapSelectBtn && sapFileInput) sapSelectBtn.addEventListener('click', () => sapFileInput.click());
    if (sapUploadArea && sapFileInput) sapUploadArea.addEventListener('click', () => sapFileInput.click());
    if (sapFileInput) sapFileInput.addEventListener('change', (e) => handleUpload(e.target.files[0], 'sap'));
    if (sapCancelBtn) sapCancelBtn.addEventListener('click', () => cancelUpload('sap'));
    if (sapRemoveBtn) sapRemoveBtn.addEventListener('click', () => removeFile('sap'));

    const finishBtn = qs('otherdocs-finish-btn');
    if (finishBtn) finishBtn.addEventListener('click', () => {
      // 检查是否是从聊天流程来的
      const isFromChatFlow = (window.chatFlowState === 'waiting_for_otherdocs_upload_new_task');
      const uploadContext = window.uploadContext;
      
      console.log('🏁 Other documents upload finished', { 
        isFromChatFlow, 
        uploadContext, 
        pendingTask: window.pendingNewTask 
      });
      
      // 先返回到聊天页面
      if (typeof window.showStep === 'function') {
        window.showStep(1);
      } else if (typeof window.TaskPaneController?.showStep === 'function') {
        window.TaskPaneController.showStep(1);
      }
      
      // 如果是从聊天流程来的，触发完成事件
      if (isFromChatFlow && window.pendingNewTask) {
        setTimeout(() => {
          window.dispatchEvent(new CustomEvent('otherdocsUploadComplete', {
            detail: { 
              fromChatFlow: true,
              pendingTask: window.pendingNewTask,
              uploadContext: uploadContext
            }
          }));
        }, 300); // 稍微延迟确保页面切换完成
      }
    });
  }

  function showProgress(kind){
    const uploadArea = qs(`${kind}-upload-area`);
    const progress = qs(`${kind}-progress`);
    const result = qs(`${kind}-result`);
    if (uploadArea) uploadArea.style.display='none';
    if (progress) progress.style.display='block';
    if (result) result.style.display='none';
  }
  function hideProgress(kind){
    const uploadArea = qs(`${kind}-upload-area`);
    const progress = qs(`${kind}-progress`);
    if (uploadArea) uploadArea.style.display='block';
    if (progress) progress.style.display='none';
  }
  function showResult(kind, file){
    const uploadArea = qs(`${kind}-upload-area`);
    const progress = qs(`${kind}-progress`);
    const result = qs(`${kind}-result`);
    const fileName = qs(`${kind}-file-name`);
    const fileStatus = qs(`${kind}-file-status`);
    if (uploadArea) uploadArea.style.display='none';
    if (progress) progress.style.display='none';
    if (result) result.style.display='block';
    if (fileName) fileName.textContent = file.name;
    if (fileStatus) fileStatus.textContent = `✅ ${kind.toUpperCase()} uploaded to MongoDB`;
  }

  async function handleUpload(file, kind){
    if (!file) return;
    if (!currentStudyId) currentStudyId = (typeof window !== 'undefined' && window.currentDocumentId) ? window.currentDocumentId : null;
    showProgress(kind);
    try{
      const form = new FormData();
      form.append('file', file);
      // Send the correct fileType so backend stores into files.crf / files.sap
      form.append('fileType', kind);
      const resp = await fetch(`${API_BASE_URL}/api/documents/${currentStudyId || ''}/additional-file`, { method:'POST', body:form });
      const data = await resp.json();
      if (!resp.ok || !data?.success) throw new Error(data?.message || 'Upload failed');
      showResult(kind, file);
      reportStatus(`${kind.toUpperCase()} uploaded successfully.`, 'success');
    }catch(e){
      console.error('Protocol upload (otherdocs) failed:', e);
      hideProgress(kind);
      reportStatus(`Upload ${kind.toUpperCase()} failed: ${e.message}`, 'error');
    }
  }

  function cancelUpload(kind){ hideProgress(kind); }
  function removeFile(kind){
    hideProgress(kind);
    const input = qs(`${kind}-file-input`);
    const result = qs(`${kind}-result`);
    const area = qs(`${kind}-upload-area`);
    if (input) input.value = '';
    if (result) result.style.display='none';
    if (area) area.style.display='block';
  }

  // 检查已存在的文件（使用 studyIdentifier / studyNumber）
  async function checkExistingFiles() {
    try {
      // 优先使用标准化的 studyNumber；退化到 currentStudyId 仅当两者一致时
      const ctx = (typeof window !== 'undefined' && window.currentStudyContext) ? window.currentStudyContext : null;
      const identifier = (ctx && (ctx.studyNumber || ctx.studyIdentifier)) || currentStudyId;
      if (!identifier) return;

      const url = `${API_BASE_URL}/api/studies/${encodeURIComponent(identifier)}/documents`;
      const resp = await fetch(url);
      const data = await resp.json();
      if (!resp.ok || !data?.success) return;

      const info = data.data || data; // 兼容两种返回结构
      // 覆盖 currentStudyId 为后端返回的 studyId，便于后续上传使用
      if (info.studyId) currentStudyId = info.studyId;
      const hasCrf = !!(info.hasCrf);
      const hasSap = !!(info.hasSap);
      const filesSummary = Array.isArray(info.filesSummary) ? info.filesSummary : [];

      if (hasCrf) {
        const c = filesSummary.find(x => x.slot === 'CRF') || {};
        showExistingFile('crf', { originalName: c.originalName || c.name || 'CRF', size: c.size || c.fileSize });
      }
      if (hasSap) {
        const s = filesSummary.find(x => x.slot === 'SAP') || {};
        showExistingFile('sap', { originalName: s.originalName || s.name || 'SAP', size: s.size || s.fileSize });
      }
    } catch (e) {
      console.warn('checkExistingFiles failed:', e);
    }
  }

  function showExistingFile(kind, fileInfo) {
    const uploadArea = qs(`${kind}-upload-area`);
    const result = qs(`${kind}-result`);
    const fileName = qs(`${kind}-file-name`);
    const fileStatus = qs(`${kind}-file-status`);
    if (uploadArea) uploadArea.style.display = 'none';
    if (result) result.style.display = 'block';
    if (fileName) fileName.textContent = fileInfo.originalName || 'filename.*';
    if (fileStatus) fileStatus.textContent = `✅ ${kind.toUpperCase()} uploaded to MongoDB${fileInfo.size ? ` (${formatBytes(fileInfo.size)})` : ''}`;
  }

  // 生成 Other Documents 页面的 HTML 内容
  function insertOtherDocumentsHTML(container) {
    if (!container) return;
    // 始终覆盖容器内容，避免占位注释或空白导致不渲染
    container.innerHTML = `
      <div class="otherdocs-protocol-wrapper">
        <h3 class="ms-font-l">📁 Other Document Upload</h3>

        <!-- CRF Upload Section -->
        <div class="upload-area" id="crf-upload-area" style="min-height: 120px; padding: 20px 24px;">
          <div class="upload-content">
            <i class="ms-Icon ms-Icon--CloudUpload ms-font-xxl upload-icon"></i>
            <h4 class="ms-font-l">Upload CRF Documents</h4>
            <p class="ms-font-m">Support PDF and Word documents</p>
            <div class="ms-Button ms-Button--primary" id="crf-select-btn">
              <span class="ms-Button-label">Select File</span>
            </div>
            <input type="file" id="crf-file-input" accept=".pdf,.doc,.docx" style="display: none;">
          </div>
        </div>

        <div class="upload-progress" id="crf-progress" style="display: none;">
          <div class="ms-Spinner">
            <div class="ms-Spinner-circle ms-Spinner-circle--large"></div>
          </div>
          <p class="ms-font-m" id="crf-progress-text">Uploading CRF...</p>
          <div class="ms-Button" id="crf-cancel-btn">
            <span class="ms-Button-label">Cancel Upload</span>
          </div>
        </div>

        <div class="upload-result" id="crf-result" style="display: none;">
          <div class="file-info">
            <i class="ms-Icon ms-Icon--Document ms-font-l file-icon"></i>
            <div class="file-details">
              <span class="file-name" id="crf-file-name">filename.pdf</span>
              <span class="file-status" id="crf-file-status">✅ Uploaded successfully</span>
            </div>
            <div class="file-actions">
              <div class="ms-Button ms-Button--secondary" id="crf-remove-btn">
                <span class="ms-Button-label">Remove</span>
              </div>
            </div>
          </div>
        </div>

        <!-- SAP Upload Section -->
        <div class="upload-area" id="sap-upload-area" style="min-height: 120px; padding: 20px 24px; margin-top: 16px;">
          <div class="upload-content">
            <i class="ms-Icon ms-Icon--CloudUpload ms-font-xxl upload-icon"></i>
            <h4 class="ms-font-l">Upload SAP Documents</h4>
            <p class="ms-font-m">Support PDF and Word documents</p>
            <div class="ms-Button ms-Button--primary" id="sap-select-btn">
              <span class="ms-Button-label">Select File</span>
            </div>
            <input type="file" id="sap-file-input" accept=".pdf,.doc,.docx" style="display: none;">
          </div>
        </div>

        <div class="upload-progress" id="sap-progress" style="display: none;">
          <div class="ms-Spinner">
            <div class="ms-Spinner-circle ms-Spinner-circle--large"></div>
          </div>
          <p class="ms-font-m" id="sap-progress-text">Uploading SAP...</p>
          <div class="ms-Button" id="sap-cancel-btn">
            <span class="ms-Button-label">Cancel Upload</span>
          </div>
        </div>

        <div class="upload-result" id="sap-result" style="display: none;">
          <div class="file-info">
            <i class="ms-Icon ms-Icon--Document ms-font-l file-icon"></i>
            <div class="file-details">
              <span class="file-name" id="sap-file-name">filename.pdf</span>
              <span class="file-status" id="sap-file-status">✅ Uploaded successfully</span>
            </div>
            <div class="file-actions">
              <div class="ms-Button ms-Button--secondary" id="sap-remove-btn">
                <span class="ms-Button-label">Remove</span>
              </div>
            </div>
          </div>
        </div>

        <div style="text-align: center; margin-top: 24px;">
          <button id="otherdocs-finish-btn" class="ms-Button ms-Button--primary" style="font-size: 16px; padding: 12px 32px; border-radius: 8px;">
            <span class="ms-Button-label">I'm Finished Uploading</span>
          </button>
        </div>
      </div>
    `;
  }

  window.initOtherDocumentsPage = function initOtherDocumentsPage(cfg){
    console.log('🚀 Initializing Other Documents page with config:', cfg);
    
    if (cfg && cfg.API_BASE_URL) API_BASE_URL = cfg.API_BASE_URL;
    if (cfg && cfg.studyId) currentStudyId = cfg.studyId;
    
    // 生成 HTML 内容
    if (cfg && cfg.container) {
      insertOtherDocumentsHTML(cfg.container);
    }
    
    // 绑定事件
    setTimeout(() => {
      initBindings();
      // 进入页面后检查是否已有上传的 CRF/SAP，并直接回显为绿色完成卡片
      checkExistingFiles();
    }, 50); // 短暂延迟确保 DOM 已渲染
    
    console.log('✅ Other Documents page initialized');
  };
})();


