// TS_Data模块 - 专门处理TS表格的自动生成和填充（基于Protocol Cover Page使用AI生成）
(function(){
  let API_BASE_URL = (typeof window !== 'undefined' && window.API_BASE_URL) ? window.API_BASE_URL : '';
  let currentStudyId = (typeof window !== 'undefined' && window.currentDocumentId) ? window.currentDocumentId : null;

  /**
   * 主控制函数 - 初始化TS_Data生成流程（🔥 新版：SSE流式 + 实时进度）
   */
  async function initTSDataGeneration() {
    try {
      console.log('🚀 开始TS_Data自动生成流程（SSE流式）...');
      
      if (!currentStudyId) {
        console.error('❌ currentStudyId为空，无法生成TS数据');
        return;
      }
      
      await generateTSDataStream();
      console.log('✅ TS数据生成并保存完成');
      
      console.log('📊 开始从数据库读取并渲染Excel表格...');
      await renderTSDataFromDatabase();
      
      console.log('✅ TS_Data生成流程完成');
      
    } catch (error) {
      console.error('❌ TS_Data生成流程失败:', error);
      throw error;
    }
  }
  
  async function generateTSDataStream() {
    return new Promise((resolve, reject) => {
      console.log('🌐 开始SSE流式生成TS数据...');
      console.log(`📍 SSE端点: ${API_BASE_URL}/api/studies/${currentStudyId}/generate-ts-details-stream`);
      
      let isDoneReceived = false;
      
      // 创建EventSource
      const eventSource = new EventSource(
        `${API_BASE_URL}/api/studies/${currentStudyId}/generate-ts-details-stream`
      );
      
      eventSource.addEventListener('progress', async (event) => {
        try {
          const data = JSON.parse(event.data);
          console.log(`📊 [进度] ${data.current}/${data.total} - ${data.parmcd} (${data.status})`);
          updateProgressUI(data.current, data.total, data.parmcd);
        } catch (err) {
          console.error('❌ 处理progress事件失败:', err);
        }
      });
      
      eventSource.addEventListener('done', async (event) => {
        try {
          isDoneReceived = true;
          const data = JSON.parse(event.data);
          console.log(`✅ [完成] 总计: ${data.total}, 成功: ${data.processed}, 跳过: ${data.skipped}, 失败: ${data.errors}`);
          console.log(`📊 maxTSVALColumns: ${data.maxTSVALColumns}`);
          
          window.tsMaxColumns = data.maxTSVALColumns || 1;
          
          eventSource.close();
          hideProgressUI();
          resolve();
          
        } catch (err) {
          console.error('❌ 处理done事件失败:', err);
          eventSource.close();
          hideProgressUI();
          reject(err);
        }
      });
      
      // 监听error事件
      eventSource.addEventListener('error', (event) => {
        console.error('❌ SSE连接错误:', event);
        let errorData = null;
        try {
          errorData = JSON.parse(event.data);
        } catch (_) {}
        
        eventSource.close();
        hideProgressUI();
        reject(new Error(errorData?.message || 'SSE连接失败'));
      });
      
      // EventSource自身的error事件（连接错误）
      eventSource.onerror = (err) => {
        // 🔥 如果已经收到done事件，忽略连接关闭错误（这是正常的）
        if (isDoneReceived) {
          console.log('✅ SSE连接正常关闭（done事件已接收）');
          return;
        }
        
        console.error('❌ EventSource error:', err);
        eventSource.close();
        hideProgressUI();
        reject(new Error('SSE连接中断'));
      };
    });
  }
  
  async function renderTSDataFromDatabase() {
    try {
      console.log('📖 从数据库读取TS_Data...');
      
      const response = await fetch(
        `${API_BASE_URL}/api/studies/${currentStudyId}/ts-details`,
        { method: 'GET' }
      );
      
      if (!response.ok) {
        throw new Error(`读取失败: ${response.statusText}`);
      }
      
      const result = await response.json();
      if (!result.success) {
        throw new Error(result.message || '读取失败');
      }
      
      const { table_content, metadata } = result.data;
      const maxTSVALColumns = metadata.maxTSVALColumns || 1;
      
      console.log(`✅ 读取成功: ${table_content.length} 条记录`);
      console.log(`📊 maxTSVALColumns: ${maxTSVALColumns}`);
      
      const baseHeaders = [
        'STUDYID', 'DOMAIN', 'TSSEQ', 'TSGRPID', 
        'TSPARMCD', 'TSPARM', 'TSVAL'
      ];
      
      for (let i = 1; i < maxTSVALColumns; i++) {
        baseHeaders.push(`TSVAL${i}`);
      }
      
      baseHeaders.push('TSVALNF', 'TSVALCD', 'TSVCDREF', 'TSVCDVER');
      
      console.log(`📋 动态列头 (${baseHeaders.length}列):`, baseHeaders);
      
      await Excel.run(async (context) => {
        const sheet = context.workbook.worksheets.getItem('TS_Data');
        
        const headerRange = sheet.getRange(`A1:${getColumnLetter(baseHeaders.length)}1`);
        headerRange.values = [baseHeaders];
        headerRange.format.font.bold = true;
        await context.sync();
        
        const BATCH_SIZE = 50;
        for (let i = 0; i < table_content.length; i += BATCH_SIZE) {
          const batch = table_content.slice(i, i + BATCH_SIZE);
          const startRow = i + 2;
          
          const rowsData = batch.map(record => {
            const row = [];
            for (const header of baseHeaders) {
              const value = record[header];
              row.push(value !== undefined && value !== null ? String(value) : '');
            }
            return row;
          });
          
          const dataRange = sheet.getRangeByIndexes(
            startRow - 1, 0,
            batch.length, baseHeaders.length
          );
          dataRange.values = rowsData;
          
          await context.sync();
          console.log(`📋 已写入 ${i + batch.length}/${table_content.length} 行`);
        }
        
        console.log('✅ Excel表格渲染完成');
      });
      
    } catch (error) {
      console.error('❌ 渲染Excel失败:', error);
      throw error;
    }
  }
  
  function getColumnLetter(columnNumber) {
    let letter = '';
    while (columnNumber > 0) {
      const remainder = (columnNumber - 1) % 26;
      letter = String.fromCharCode(65 + remainder) + letter;
      columnNumber = Math.floor((columnNumber - 1) / 26);
    }
    return letter;
  }
  
  /**
   * 更新进度条UI
   */
  function updateProgressUI(current, total, parmcd) {
    try {
      // 尝试找到进度条元素（如果存在）
      let progressContainer = document.getElementById('ts-progress-container');
      
      if (!progressContainer) {
        // 创建进度条容器
        progressContainer = document.createElement('div');
        progressContainer.id = 'ts-progress-container';
        progressContainer.style.cssText = `
          position: fixed;
          top: 50%;
          left: 50%;
          transform: translate(-50%, -50%);
          background: white;
          padding: 20px;
          border-radius: 8px;
          box-shadow: 0 4px 12px rgba(0,0,0,0.15);
          z-index: 9999;
          min-width: 300px;
        `;
        progressContainer.innerHTML = `
          <div style="font-size: 14px; font-weight: 600; margin-bottom: 10px; color: #333;">
            生成 TS_Data...
          </div>
          <div style="width: 100%; background: #e0e0e0; border-radius: 4px; height: 8px; overflow: hidden; margin-bottom: 8px;">
            <div id="ts-progress-bar" style="width: 0%; background: #0078d4; height: 100%; transition: width 0.3s;"></div>
          </div>
          <div id="ts-progress-text" style="font-size: 12px; color: #666;"></div>
        `;
        document.body.appendChild(progressContainer);
      }
      
      // 更新进度条
      const progressBar = document.getElementById('ts-progress-bar');
      const progressText = document.getElementById('ts-progress-text');
      
      if (progressBar && progressText) {
        const percentage = Math.round((current / total) * 100);
        progressBar.style.width = `${percentage}%`;
        progressText.textContent = `${current}/${total} - ${parmcd || '处理中...'}`;
      }
      
    } catch (err) {
      console.warn('⚠️ 更新进度UI失败:', err);
    }
  }
  
  /**
   * 隐藏进度条UI
   */
  function hideProgressUI() {
    try {
      const progressContainer = document.getElementById('ts-progress-container');
      if (progressContainer) {
        progressContainer.remove();
      }
    } catch (err) {
      console.warn('⚠️ 隐藏进度UI失败:', err);
    }
  }
  
  /**
   * 调用API生成TS数据（旧版：一次性返回，保留用于兼容）
   */
  async function generateTSData() {
    try {
      console.log('🌐 调用API生成TS数据...');
      console.log(`📍 API端点: ${API_BASE_URL}/api/studies/${currentStudyId}/generate-ts-details`);
      
      const response = await fetch(`${API_BASE_URL}/api/studies/${currentStudyId}/generate-ts-details`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        }
      });
      
      if (!response.ok) {
        const errorText = await response.text();
        console.error(`❌ HTTP ${response.status}:`, errorText);
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }
      
      const result = await response.json();
      
      if (!result.success) {
        throw new Error(result.message || 'TS数据生成失败');
      }
      
      console.log(`✅ TS数据生成成功，总计 ${result.data.totalRecords} 条记录`);
      console.log(`📋 Study Number: ${result.data.studyNumber}`);
      
      if (result.data.tsData && result.data.tsData.length > 0) {
        console.log('📋 TS数据预览（前2条）:', result.data.tsData.slice(0, 2));
      }
      
      return result.data.tsData;
      
    } catch (error) {
      console.error('❌ 生成TS数据失败:', error);
      throw error;
    }
  }
  
  /**
   * 保存TS数据到数据库
   */
  async function saveTSDataToDatabase(tsData) {
    try {
      console.log('💾 开始保存TS数据到数据库...');
      console.log(`📊 准备保存 ${tsData.length} 条记录`);
      
      const response = await fetch(`${API_BASE_URL}/api/studies/${currentStudyId}/spec-ts-details-data`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          tsData: tsData
        })
      });
      
      if (!response.ok) {
        const errorText = await response.text();
        console.error(`❌ 保存失败 HTTP ${response.status}:`, errorText);
        throw new Error(`保存失败: HTTP ${response.status}`);
      }
      
      const result = await response.json();
      
      if (!result.success) {
        throw new Error(result.message || 'TS数据保存失败');
      }
      
      console.log(`✅ TS数据保存成功，总计: ${result.data.totalCount} 条记录`);
      
      // 验证table_title保存情况
      if (result.data.tableTitle && result.data.tableTitleLength) {
        console.log(`📋 [Frontend] table_title验证: 长度=${result.data.tableTitleLength}, 内容=`, result.data.tableTitle.slice(0, 3), '...');
      } else {
        console.warn(`⚠️ [Frontend] table_title可能未正确保存: 长度=${result.data.tableTitleLength || 0}`);
      }
      
    } catch (error) {
      console.error('❌ 保存TS数据到数据库失败:', error);
      throw error;
    }
  }
  
  /**
   * 填充TS数据到Excel
   */
  async function fillTSDataToExcel(tsData) {
    try {
      console.log('📋 开始填充TS数据到Excel...');
      
      if (!tsData || tsData.length === 0) {
        console.log('⚠️ 没有TS数据需要填充');
        return;
      }
      
      await Excel.run(async (context) => {
        const worksheet = context.workbook.worksheets.getItem('TS_Data');
        
        // 准备Excel数据格式 (二维数组) - 11个字段
        const excelData = tsData.map(row => [
          row.STUDYID || '',
          row.DOMAIN || '',
          row.TSSEQ || '',
          row.TSGRPID || '',
          row.TSPARMCD || '',
          row.TSPARM || '',
          row.TSVAL || '',
          row.TSVALNF || '',
          row.TSVALCD || '',
          row.TSVCDREF || '',
          row.TSVCDVER || ''
        ]);
        
        console.log(`📊 准备填充 ${excelData.length} 行TS数据到Excel`);
        console.log('📋 Excel数据格式预览（前2行）:', excelData.slice(0, 2));
        
        // 填充数据到Excel (从A2开始，A1是表头)
        const dataRange = worksheet.getRange(`A2:K${1 + excelData.length}`);
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
        const fullRange = worksheet.getRange(`A1:K${1 + excelData.length}`);
        fullRange.format.autofitColumns();
        
        await context.sync();
        console.log('✅ TS数据填充到Excel完成');
      });
      
    } catch (error) {
      console.error('❌ 填充TS数据到Excel失败:', error);
      throw error;
    }
  }
  
  /**
   * 从Excel读取TS数据并保存到数据库
   */
  async function readAndSaveTSFromExcel() {
    try {
      console.log('📋 开始从Excel读取TS_Data数据...');
      
      const tsTableData = await Excel.run(async (context) => {
        const worksheet = context.workbook.worksheets.getItem('TS_Data');
        
        // 读取完整表格数据
        const usedRange = worksheet.getUsedRange();
        usedRange.load(['values']);
        await context.sync();
        
        const allData = usedRange.values;
        
        if (!Array.isArray(allData) || allData.length < 1) {
          throw new Error('TS_Data表格数据不完整');
        }
        
        console.log(`📊 读取到 ${allData.length} 行数据，包括表头`);
        
        // 分离表头和数据行
        const table_title = allData[0]; // 表头
        const dataRows = allData.slice(1); // 数据行
        
        console.log(`📋 表头字段数: ${table_title.length}，原始数据行数: ${dataRows.length}`);
        
        // 判断值是否非空的辅助函数
        const hasValue = (value) => {
          return value !== null && value !== undefined && String(value).trim() !== '';
        };
        
        // 过滤数据行 - TSPARMCD必须有值，且至少有TSVAL或TSVALCD或TSVALNF有值
        const filteredRows = dataRows.filter(row => {
          return hasValue(row[4]) && (hasValue(row[6]) || hasValue(row[7]) || hasValue(row[8])); // TSPARMCD, TSVAL, TSVALNF, TSVALCD
        });
        
        console.log(`🔍 数据过滤: ${dataRows.length} 行 → ${filteredRows.length} 行 (跳过了 ${dataRows.length - filteredRows.length} 个无效行)`);
        
        // 转换为对象数组（11个字段）
        const table_content = filteredRows.map(row => ({
          'STUDYID': row[0] || '',
          'DOMAIN': row[1] || '',
          'TSSEQ': row[2] || '',
          'TSGRPID': row[3] || '',
          'TSPARMCD': row[4] || '',
          'TSPARM': row[5] || '',
          'TSVAL': row[6] || '',
          'TSVALNF': row[7] || '',
          'TSVALCD': row[8] || '',
          'TSVCDREF': row[9] || '',
          'TSVCDVER': row[10] || ''
        }));
        
        console.log('📋 TS数据转换完成');
        if (table_content.length > 0) {
          console.log('📊 数据预览（前2条）:', table_content.slice(0, 2));
        }
        
        return table_content;
      });
      
      console.log(`📊 准备保存 ${tsTableData.length} 条TS记录...`);
      
      // 调用保存函数
      await saveTSDataToDatabase(tsTableData);
      
      console.log('✅ TS_Data数据从Excel保存成功');
      
    } catch (error) {
      console.error('❌ 从Excel保存TS_Data失败:', error);
      throw error;
    }
  }
  
  /**
   * 配置初始化函数 - 接收API_BASE_URL和studyId配置
   * @param {Object} cfg - 配置对象 {API_BASE_URL, studyId}
   */
  function init(cfg) {
    try {
      console.log('🔧 [SpecTS] 开始配置初始化:', cfg);
      
      if (cfg && cfg.API_BASE_URL) {
        API_BASE_URL = cfg.API_BASE_URL;
        console.log('📍 [SpecTS] API_BASE_URL 已更新:', API_BASE_URL);
      }
      
      if (cfg && cfg.studyId) {
        currentStudyId = cfg.studyId;
        console.log('📍 [SpecTS] currentStudyId 已更新:', currentStudyId);
      }
      
      console.log('✅ [SpecTS] 配置初始化完成:', { API_BASE_URL, currentStudyId });
      
    } catch (error) {
      console.error('❌ [SpecTS] 配置初始化失败:', error);
    }
  }
  
  // 全局暴露函数供spec.js调用
  window.SpecTS = {
    init: init,
    initTSDataGeneration: initTSDataGeneration,
    readAndSaveTSFromExcel: readAndSaveTSFromExcel
  };
  
  console.log('✅ SpecTS模块已加载');
})();

