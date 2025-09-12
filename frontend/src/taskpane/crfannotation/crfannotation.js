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
    const finishBtn = qs('crfannotation-finish-btn');
    
    // Start Annotation 按钮事件
    if (startBtn) startBtn.addEventListener('click', startAnnotationProcess);
    
    // I'm Finished 按钮事件
    if (finishBtn) finishBtn.addEventListener('click', () => {
      // 检查是否是从聊天流程来的
      const isFromChatFlow = (window.chatFlowState === 'waiting_for_crf_annotation_finish');
      
      console.log('🏁 CRF annotation finished', { 
        isFromChatFlow, 
        pendingTaskAfterAnnotation: window.pendingTaskAfterAnnotation 
      });
      
      // 先返回到聊天页面
      if (typeof window.showStep === 'function') {
        window.showStep(1);
      } else if (typeof window.TaskPaneController?.showStep === 'function') {
        window.TaskPaneController.showStep(1);
      }
      
      // 如果是从聊天流程来的，触发完成事件
      if (isFromChatFlow && window.pendingTaskAfterAnnotation) {
        setTimeout(() => {
          window.dispatchEvent(new CustomEvent('crfAnnotationComplete', {
            detail: { 
              fromChatFlow: true,
              pendingTaskAfterAnnotation: window.pendingTaskAfterAnnotation
            }
          }));
        }, 300); // 稍微延迟确保页面切换完成
      }
    });
  }

  // 开始注解处理流程
  async function startAnnotationProcess() {
    console.log('🚀 Starting CRF annotation process...');
    
    // 切换到进度界面并启动进度轮询
    showProgressView();
    startProgressPolling();
    
    try {
      // 创建 AbortController 用于处理超时
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 25 * 60 * 1000); // 25分钟超时
      
      // 调用后端API生成注解矩形参数
      const response = await fetch(`${API_BASE_URL}/api/studies/${currentStudyId}/generate-crf-annotation-rects`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        signal: controller.signal
      });
      
      // 清除超时定时器
      clearTimeout(timeoutId);

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      const result = await response.json();
      
      if (result.success) {
        console.log('✅ CRF annotation rectangles generated successfully!');
        console.log('📊 统计信息:', {
          totalPages: result.data.totalPages,
          totalRects: result.data.totalRects,
          studyId: result.data.studyId
        });

        // 开始轮询后端状态，直到 annotationReady 且存在 downloadUrl 再显示完成界面
        reportStatus('Generating annotated PDF... This may take several minutes for large CRFs.', 'info');
        await pollUntilAnnotationReady({ intervalMs: 5000, maxMinutes: 30 });
      } else {
        throw new Error(result.message || 'Failed to generate annotation rectangles');
      }
      
    } catch (error) {
      console.error('❌ CRF annotation process failed:', error);
      
      // 处理不同类型的错误
      let errorMessage = error.message;
      if (error.name === 'AbortError') {
        errorMessage = 'Annotation process timed out after 25 minutes. This may happen with very large CRF files. Please try again or contact support.';
      }
      
      // 即使前端报错，也可能后端仍在继续处理。继续轮询状态，不要过早显示完成界面。
      reportStatus(`Annotation in progress or delayed: ${errorMessage}`, 'warning');
      await pollUntilAnnotationReady({ intervalMs: 5000, maxMinutes: 30 });
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
            <h4 class="ms-font-l">Generating CRF Annotations...</h4>
            <p class="ms-font-m" style="color: #605e5c; margin: 20px 0;">
              Processing your CRF documents and generating annotated PDF.<br/>
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

              <div style="margin:16px 0 4px 0;display:flex;justify-content:space-between;align-items:center;">
                <span class="ms-font-m">🎨 PDF Drawing</span>
                <span id="pdf-progress-text" class="ms-font-s" style="color:#605e5c;">0/0 batches</span>
              </div>
              <div class="progress-bar" style="height:10px;background:#edebe9;border-radius:6px;overflow:hidden;">
                <div id="pdf-progress-fill" style="height:100%;width:0%;background:#107c10;transition:width .3s ease;"></div>
              </div>
              <div id="pdf-percentage" class="ms-font-s" style="text-align:right;color:#605e5c;margin-top:4px;">0%</div>
            </div>

            <div id="progress-current-status" class="ms-font-s" style="color:#323130; margin-top: 8px;">Starting...</div>
            
            <p class="ms-font-s" style="color: #323130; margin-bottom: 30px;">
              🔄 Analyzing document structure...<br/>
              📝 Generating annotation coordinates...<br/>
              🎯 Creating annotated PDF...
            </p>
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

    const pFill = qs('pdf-progress-fill');
    const pPct = qs('pdf-percentage');
    const pTxt = qs('pdf-progress-text');
    if (pFill) pFill.style.width = `${Math.min(100, Math.max(0, Math.round(p.percentage||0)))}%`;
    if (pPct) pPct.textContent = `${Math.min(100, Math.max(0, Math.round(p.percentage||0)))}%`;
    if (pTxt) pTxt.textContent = `${p.processedBatches||0}/${p.totalBatches||0} batches`;

    const statusNode = qs('progress-current-status');
    if (statusNode) {
      statusNode.textContent = progress.currentPhase === 'gpt' ? 'Analyzing SDTM mappings with GPT...' : (progress.currentPhase === 'pdf' ? 'Drawing annotations to PDF...' : 'Completed');
    }
  }

  async function startProgressPolling(){
    let isDone = false;
    const tick = async () => {
      if (isDone) return;
      const data = await pollProgressOnce();
      if (data) applyProgressToUI(data);
      if (data && data.currentPhase === 'completed') { isDone = true; return; }
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
          <button id="crfannotation-finish-btn" class="ms-Button" style="font-size: 16px; padding: 12px 32px; border-radius: 8px;">
            <span class="ms-Button-label">I'm Finished</span>
          </button>
        </div>
      </div>
    `;
    
    // 重新绑定按钮事件
    setTimeout(() => {
      const downloadBtn = qs('crfannotation-download-btn');
      const finishBtn = qs('crfannotation-finish-btn');
      
      if (downloadBtn) downloadBtn.addEventListener('click', async () => {
        await downloadAnnotatedPdf();
      });
      
      if (finishBtn) finishBtn.addEventListener('click', () => {
        const isFromChatFlow = (window.chatFlowState === 'waiting_for_crf_annotation_finish');
        
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


  // 🔥 新增：检查注解状态并初始化相应界面
  async function checkAnnotationStatusAndInitialize() {
    try {
      console.log('🔍 检查CRF注解状态...');
      
      // 调用后端API获取注解状态
      const response = await fetch(`${API_BASE_URL}/api/studies/${currentStudyId}/crf-annotation-status`);
      
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }
      
      const result = await response.json();
      const annotationStatus = result.data?.annotationStatus;
      
      console.log('📊 CRF注解状态:', annotationStatus);
      
      if (annotationStatus?.annotationReady && annotationStatus?.downloadUrl) {
        // 注解已完成，直接显示下载界面
        console.log('✅ 注解已完成，显示下载界面');
        showCompletedViewWithExistingAnnotation(annotationStatus);
      } else if (annotationStatus?.hasCrfData) {
        // 有CRF数据但未注解，显示开始注解界面
        console.log('🔄 有CRF数据但未注解，显示开始注解界面');
        showInitialView();
      } else {
        // 没有CRF数据
        console.log('❌ 没有CRF数据');
        showNoCrfDataView();
      }
      
    } catch (error) {
      console.error('❌ 检查注解状态失败:', error);
      // 如果检查失败，回退到初始界面
      showInitialView();
    }
  }

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
          <button id="crfannotation-finish-existing-btn" class="ms-Button" style="font-size: 16px; padding: 12px 32px; border-radius: 8px;">
            <span class="ms-Button-label">I'm Finished</span>
          </button>
        </div>
      </div>
    `;
    
    // 绑定按钮事件
    setTimeout(() => {
      const downloadBtn = qs('crfannotation-download-existing-btn');
      const redrawBtn = qs('crfannotation-redraw-btn');
      const reannotateBtn = qs('crfannotation-reannotate-btn');
      const finishBtn = qs('crfannotation-finish-existing-btn');
      
      if (downloadBtn) downloadBtn.addEventListener('click', () => {
        copyDownloadLinkDirectly(annotationStatus.downloadUrl);
      });
      
      if (redrawBtn) redrawBtn.addEventListener('click', () => {
        handleRedrawPdf(); // 🔥 新增：Re-draw PDF逻辑
      });
      
      if (reannotateBtn) reannotateBtn.addEventListener('click', () => {
        showInitialView(); // 切换到重新注解界面
      });
      
      if (finishBtn) finishBtn.addEventListener('click', () => {
        // 完成逻辑（同原来的finish按钮）
        const isFromChatFlow = (window.chatFlowState === 'waiting_for_crf_annotation_finish');
        
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
    
    if (cfg && cfg.API_BASE_URL) API_BASE_URL = cfg.API_BASE_URL;
    if (cfg && cfg.studyId) currentStudyId = cfg.studyId;
    
    // 🔥 新增：先检查注解状态，再决定显示哪个界面
    checkAnnotationStatusAndInitialize();
    
    console.log('✅ CRF Annotation page initialized');
  };
})();

