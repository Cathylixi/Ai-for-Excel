// Spec Dataset Separation 模块 - 处理 dataset-specific specs 的生成和下载（ZIP 方式）
(function(){
  let API_BASE_URL = (typeof window !== 'undefined' && window.API_BASE_URL) ? window.API_BASE_URL : '';
  let currentStudyId = (typeof window !== 'undefined' && window.currentDocumentId) ? window.currentDocumentId : null;

  /**
   * 主函数：生成 dataset-specific specs ZIP
   */
  async function generateDatasetSpecificSpecs() {
    try {
      console.log('🚀 Starting dataset-specific specs ZIP generation...');
      
      if (!currentStudyId) {
        console.error('❌ currentStudyId is empty, cannot generate');
        showErrorMessage('Error: Unable to retrieve current Study ID');
        return;
      }
      
      // 显示加载UI
      showLoadingUI(true);
      
      // 调用后端 API
      const response = await fetch(
        `${API_BASE_URL}/api/studies/${currentStudyId}/generate-dataset-specs`,
        { 
          method: 'POST',
          headers: {
            'Content-Type': 'application/json'
          }
        }
      );
      
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }
      
      const result = await response.json();
      
      if (!result.success) {
        throw new Error(result.message || 'Generation failed');
      }
      
      console.log(`✅ Generation successful: ${result.totalDatasets} datasets`);
      console.log('📊 ZIP info:', result);
      
      // 显示下载链接
      displayDownloadLink(result);
      
    } catch (error) {
      console.error('❌ Dataset-specific specs generation failed:', error);
      showErrorMessage(`Generation failed: ${error.message}`);
    } finally {
      showLoadingUI(false);
    }
  }
  
  /**
   * 显示错误消息（兼容 Office Add-ins 环境，不使用 alert）
   */
  function showErrorMessage(message) {
    console.error('❌', message);
    
    // 尝试使用全局的 showStatusMessage
    if (window.TaskPaneController && typeof window.TaskPaneController.showStatusMessage === 'function') {
      window.TaskPaneController.showStatusMessage(message, 'error');
      return;
    }
    if (typeof window.showStatusMessage === 'function') {
      window.showStatusMessage(message, 'error');
      return;
    }
    
    // Fallback: 创建内联错误提示
    let container = document.getElementById('dataset-specs-download-container') || document.body;
    let errorBanner = document.createElement('div');
    errorBanner.style.cssText = `
      margin: 12px 0;
      padding: 12px 16px;
      background: #fde7e9;
      color: #a80000;
      border-radius: 6px;
      font-size: 14px;
      border-left: 4px solid #d13438;
    `;
    errorBanner.innerHTML = `<strong>❌ 错误</strong><br>${message}`;
    container.insertBefore(errorBanner, container.firstChild);
    
    // 5秒后自动移除
    setTimeout(() => {
      if (errorBanner.parentNode) {
        errorBanner.parentNode.removeChild(errorBanner);
      }
    }, 5000);
  }
  
  /**
   * 显示/隐藏加载UI
   */
  function showLoadingUI(show) {
    let loadingUI = document.getElementById('dataset-separation-loading-ui');
    
    if (!loadingUI) {
      // 创建加载UI
      loadingUI = document.createElement('div');
      loadingUI.id = 'dataset-separation-loading-ui';
      loadingUI.style.cssText = `
        position: fixed;
        top: 50%;
        left: 50%;
        transform: translate(-50%, -50%);
        background: white;
        padding: 30px;
        border-radius: 8px;
        box-shadow: 0 4px 12px rgba(0,0,0,0.15);
        z-index: 10000;
        text-align: center;
        min-width: 300px;
      `;
      loadingUI.innerHTML = `
        <div style="font-size: 16px; font-weight: 600; margin-bottom: 15px; color: #333;">
          🔄 Generating Dataset-Specific Specs...
        </div>
        <div class="spinner" style="
          border: 4px solid #f3f3f3;
          border-top: 4px solid #0078d4;
          border-radius: 50%;
          width: 40px;
          height: 40px;
          animation: spin 1s linear infinite;
          margin: 0 auto;
        "></div>
        <style>
          @keyframes spin {
            0% { transform: rotate(0deg); }
            100% { transform: rotate(360deg); }
          }
        </style>
        <div style="margin-top: 15px; font-size: 12px; color: #666;">
          Packaging all Excel files into ZIP, please wait...
        </div>
      `;
      document.body.appendChild(loadingUI);
    }
    
    loadingUI.style.display = show ? 'block' : 'none';
    
    // 禁用生成按钮
    const generateBtn = document.getElementById('generate-dataset-specs-btn');
    if (generateBtn) {
      generateBtn.disabled = show;
    }
  }
  
  /**
   * Display download link (single ZIP file, copy link approach)
   * 🔥 New logic: Remove intro card, replace with clean download UI + "I'm Finished" button
   */
  function displayDownloadLink(result) {
    // 🔥 Step 1: Remove the "Spec Processing Completed Successfully!" intro card
    const introCard = document.getElementById('spec-intro-card');
    if (introCard) {
      introCard.remove();
      console.log('✅ Removed intro card (#spec-intro-card)');
    } else {
      // Fallback: hide .annotation-content if #spec-intro-card doesn't exist
      const annotationContent = document.querySelector('.annotation-content');
      if (annotationContent) {
        annotationContent.remove();
        console.log('✅ Removed fallback intro card (.annotation-content)');
      }
    }
    
    // 🔥 Step 2: Hide "Generate Dataset-Specific Specs" button
    const generateBtn = document.getElementById('generate-dataset-specs-btn');
    if (generateBtn) {
      generateBtn.style.display = 'none';
      console.log('✅ Hidden "Generate Dataset-Specific Specs" button');
    }
    
    // 🔥 Step 3: 获取或创建下载容器（放在原白色框位置）
    let container = document.getElementById('dataset-specs-download-container');
    
    if (!container) {
      container = document.createElement('div');
      container.id = 'dataset-specs-download-container';
      
      // 插入到 spec-wrapper 的顶部（替换掉白色框位置）
      const specWrapper = document.querySelector('.spec-wrapper');
      if (specWrapper) {
        const h3 = specWrapper.querySelector('h3');
        if (h3 && h3.nextSibling) {
          specWrapper.insertBefore(container, h3.nextSibling);
        } else {
          specWrapper.appendChild(container);
        }
      } else {
        const mainContainer = document.getElementById('spec-completion-page') || document.body;
        mainContainer.appendChild(container);
      }
    }
    
    // 清空并重新填充
    container.innerHTML = '';
    
    // 🔥 简洁样式：白色框，居中，清爽
    container.style.cssText = `
      text-align: center;
      padding: 40px 20px;
      background: white;
      border-radius: 12px;
      box-shadow: 0 2px 8px rgba(0,0,0,0.1);
      margin: 20px 0;
    `;
    
    // 构建下载 URL
    const downloadUrl = `${API_BASE_URL}${result.downloadUrl}`;
    
    // 🔥 极简标题
    const header = document.createElement('div');
    header.style.cssText = 'margin-bottom: 30px;';
    header.innerHTML = `
      <div style="font-size: 48px; margin-bottom: 15px;">📦</div>
      <h4 style="font-size: 18px; font-weight: 600; color: #107c10; margin-bottom: 10px;">
        Dataset-Specific Specs Ready
      </h4>
      <p style="font-size: 13px; color: #666; margin: 0;">
        Study: ${result.studyNumber || 'N/A'} | 
        Datasets: ${result.totalDatasets} | 
        ZIP Size: ${(result.zipFileSize / 1024).toFixed(2)} KB
      </p>
    `;
    container.appendChild(header);
    
    // 🔥 极简下载按钮（大而突出）
    const downloadDiv = document.createElement('div');
    downloadDiv.innerHTML = `
      <button 
        id="copy-zip-link-btn"
        style="
          width: 100%;
          max-width: 400px;
          padding: 16px 32px;
          background: #0078d4;
          color: white;
          border: none;
          border-radius: 8px;
          font-size: 16px;
          font-weight: 600;
          cursor: pointer;
          transition: background 0.2s;
          box-shadow: 0 2px 6px rgba(0,120,212,0.3);
        "
        onmouseover="this.style.background='#005a9e'"
        onmouseout="this.style.background='#0078d4'"
      >
        📋 Copy Download Link
      </button>
      <div id="link-status" style="margin-top: 12px; font-size: 13px; color: #107c10; font-weight: 500; min-height: 20px;"></div>
    `;
    container.appendChild(downloadDiv);
    
    // 绑定复制按钮事件
    setTimeout(() => {
      const copyBtn = document.getElementById('copy-zip-link-btn');
      const statusDiv = document.getElementById('link-status');
      
      if (copyBtn) {
        copyBtn.addEventListener('click', async () => {
          await copyDownloadLink(downloadUrl, statusDiv);
        });
      }
    }, 100);
    
    // 🔥 简洁的链接显示区（Fallback）
    const linkDisplay = document.createElement('div');
    linkDisplay.style.cssText = 'margin-top: 25px; padding-top: 20px; border-top: 1px solid #edebe9;';
    linkDisplay.innerHTML = `
      <p style="margin: 0 0 10px 0; font-size: 12px; color: #605e5c;">
        Download Link:
      </p>
      <input 
        type="text" 
        value="${downloadUrl}" 
        readonly 
        id="manual-copy-input"
        style="
          width: 100%; 
          padding: 10px; 
          border: 1px solid #d2d0ce; 
          border-radius: 4px; 
          font-size: 12px;
          font-family: 'Consolas', 'Monaco', monospace;
          background: #faf9f8;
          color: #323130;
        "
        onclick="this.select();" 
      />
      <p style="margin: 8px 0 0 0; font-size: 11px; color: #8a8886;">
        Click to select, then Ctrl+C / Cmd+C to copy
      </p>
    `;
    container.appendChild(linkDisplay);
    
    // 🔥 Step 4: Add "I'm Finished" button at the bottom
    const finishButtonContainer = document.createElement('div');
    finishButtonContainer.style.cssText = 'margin-top: 30px; padding-top: 25px; border-top: 1px solid #edebe9; text-align: center;';
    finishButtonContainer.innerHTML = `
      <button id="spec-finish-btn" class="ms-Button ms-Button--primary" 
        style="font-size: 16px; padding: 12px 32px; border-radius: 8px;">
        <span class="ms-Button-label">I'm Finished</span>
      </button>
    `;
    container.appendChild(finishButtonContainer);
    
    // 🔥 Step 5: Bind "I'm Finished" button event
    setTimeout(() => {
      if (window.SpecModule && typeof window.SpecModule.bindFinishButton === 'function') {
        window.SpecModule.bindFinishButton();
        console.log('✅ "I\'m Finished" button bound successfully');
      } else {
        console.warn('⚠️ window.SpecModule.bindFinishButton not found');
      }
    }, 100);
  }
  
  /**
   * 复制下载链接到剪贴板
   */
  async function copyDownloadLink(downloadUrl, statusDiv) {
    try {
      // 尝试使用 Clipboard API
      if (navigator.clipboard && navigator.clipboard.writeText) {
        await navigator.clipboard.writeText(downloadUrl);
        console.log('✅ Download link copied to clipboard');
        if (statusDiv) {
          statusDiv.innerHTML = '✅ Link copied! Paste in browser to download';
          statusDiv.style.color = '#107c10';
        }
        
        // 3秒后清空提示
        setTimeout(() => {
          if (statusDiv) {
            statusDiv.innerHTML = '';
          }
        }, 3000);
        
      } else {
        // Fallback: 使用传统的文本选择复制方式
        const textArea = document.createElement('textarea');
        textArea.value = downloadUrl;
        textArea.style.position = 'fixed';
        textArea.style.left = '-9999px';
        textArea.style.opacity = '0';
        document.body.appendChild(textArea);
        textArea.select();
        textArea.setSelectionRange(0, 99999);
        
        const successful = document.execCommand('copy');
        document.body.removeChild(textArea);
        
        if (successful) {
          console.log('✅ Download link copied to clipboard (fallback)');
          if (statusDiv) {
            statusDiv.innerHTML = '✅ Link copied! Paste in browser to download';
            statusDiv.style.color = '#107c10';
          }
          setTimeout(() => {
            if (statusDiv) statusDiv.innerHTML = '';
          }, 3000);
        } else {
          throw new Error('Copy command failed');
        }
      }
      
    } catch (error) {
      console.error('❌ Copy to clipboard failed:', error);
      if (statusDiv) {
        statusDiv.innerHTML = '⚠️ Auto-copy failed. Please manually copy below';
        statusDiv.style.color = '#d13438';
      }
      
      // 高亮手动复制输入框
      const manualInput = document.getElementById('manual-copy-input');
      if (manualInput) {
        manualInput.focus();
        manualInput.select();
      }
    }
  }
  
  /**
   * 初始化函数
   */
  function init(config) {
    if (config && config.API_BASE_URL) {
      API_BASE_URL = config.API_BASE_URL;
    }
    if (config && config.studyId) {
      currentStudyId = config.studyId;
    }
    
    console.log('✅ SpecDatasetSeparation module initialized');
    console.log(`   API_BASE_URL: ${API_BASE_URL}`);
    console.log(`   currentStudyId: ${currentStudyId}`);
  }
  
  // 全局暴露函数供其他模块调用
  window.SpecDatasetSeparation = {
    init: init,
    generateDatasetSpecificSpecs: generateDatasetSpecificSpecs
  };
  
  console.log('✅ SpecDatasetSeparation module loaded (ZIP mode)');
})();
