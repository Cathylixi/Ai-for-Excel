// TA_Data模块 - 专门处理TA表格的自动生成和填充（基于Study Design使用AI生成）
(function(){
  let API_BASE_URL = (typeof window !== 'undefined' && window.API_BASE_URL) ? window.API_BASE_URL : '';
  let currentStudyId = (typeof window !== 'undefined' && window.currentDocumentId) ? window.currentDocumentId : null;

  /**
   * 主控制函数 - 初始化TA_Data生成流程
   */
  async function initTADataGeneration() {
    try {
      console.log('🚀 开始TA_Data自动生成流程...');
      
      if (!currentStudyId) {
        console.error('❌ currentStudyId为空，无法生成TA数据');
        return;
      }
      
      // Step 1: 调用后端API生成TA数据（基于Study Design使用OpenAI）
      console.log('📊 Step 1: 调用OpenAI生成TA_Data...');
      const taData = await generateTAData();
      
      if (!taData || taData.length === 0) {
        console.log('⚠️ 没有生成TA数据，可能Study Design不存在或为空');
        return;
      }
      
      // Step 2: 保存到数据库
      console.log('💾 Step 2: 保存TA数据到数据库...');
      await saveTADataToDatabase(taData);
      
      // Step 3: 填充到Excel
      console.log('📋 Step 3: 填充TA数据到Excel...');
      await fillTADataToExcel(taData);
      
      console.log('✅ TA_Data生成流程完成');
      
    } catch (error) {
      console.error('❌ TA_Data生成流程失败:', error);
      throw error;
    }
  }
  
  /**
   * 调用API生成TA数据（使用OpenAI基于Study Design）
   */
  async function generateTAData() {
    try {
      console.log('🌐 调用API生成TA数据...');
      console.log(`📍 API端点: ${API_BASE_URL}/api/studies/${currentStudyId}/generate-ta-details`);
      
      const response = await fetch(`${API_BASE_URL}/api/studies/${currentStudyId}/generate-ta-details`, {
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
        throw new Error(result.message || 'TA数据生成失败');
      }
      
      console.log(`✅ TA数据生成成功，总计 ${result.data.totalRecords} 条记录`);
      console.log(`📋 Study Number: ${result.data.studyNumber}`);
      
      if (result.data.taData && result.data.taData.length > 0) {
        console.log('📋 TA数据预览（前2条）:', result.data.taData.slice(0, 2));
      }
      
      return result.data.taData;
      
    } catch (error) {
      console.error('❌ 生成TA数据失败:', error);
      throw error;
    }
  }
  
  /**
   * 保存TA数据到数据库
   */
  async function saveTADataToDatabase(taData) {
    try {
      console.log('💾 开始保存TA数据到数据库...');
      console.log(`📊 准备保存 ${taData.length} 条记录`);
      
      const response = await fetch(`${API_BASE_URL}/api/studies/${currentStudyId}/spec-ta-details-data`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          taData: taData
        })
      });
      
      if (!response.ok) {
        const errorText = await response.text();
        console.error(`❌ 保存失败 HTTP ${response.status}:`, errorText);
        throw new Error(`保存失败: HTTP ${response.status}`);
      }
      
      const result = await response.json();
      
      if (!result.success) {
        throw new Error(result.message || 'TA数据保存失败');
      }
      
      console.log(`✅ TA数据保存成功，总计: ${result.data.totalCount} 条记录`);
      
      // 验证table_title保存情况
      if (result.data.tableTitle && result.data.tableTitleLength) {
        console.log(`📋 [Frontend] table_title验证: 长度=${result.data.tableTitleLength}, 内容=`, result.data.tableTitle.slice(0, 3), '...');
      } else {
        console.warn(`⚠️ [Frontend] table_title可能未正确保存: 长度=${result.data.tableTitleLength || 0}`);
      }
      
    } catch (error) {
      console.error('❌ 保存TA数据到数据库失败:', error);
      throw error;
    }
  }
  
  /**
   * 填充TA数据到Excel
   */
  async function fillTADataToExcel(taData) {
    try {
      console.log('📋 开始填充TA数据到Excel...');
      
      if (!taData || taData.length === 0) {
        console.log('⚠️ 没有TA数据需要填充');
        return;
      }
      
      await Excel.run(async (context) => {
        const worksheet = context.workbook.worksheets.getItem('TA_Data');
        
        // 准备Excel数据格式 (二维数组) - 10个字段
        const excelData = taData.map(row => [
          row.STUDYID || '',
          row.DOMAIN || '',
          row.ARMCD || '',
          row.ARM || '',
          row.TAETORD || '',
          row.ETCD || '',
          row.ELEMENT || '',
          row.TABRANCH || '',
          row.TATRANS || '',
          row.EPOCH || ''
        ]);
        
        console.log(`📊 准备填充 ${excelData.length} 行TA数据到Excel`);
        console.log('📋 Excel数据格式预览（前2行）:', excelData.slice(0, 2));
        
        // 填充数据到Excel (从A2开始，A1是表头)
        const dataRange = worksheet.getRange(`A2:J${1 + excelData.length}`);
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
        const fullRange = worksheet.getRange(`A1:J${1 + excelData.length}`);
        fullRange.format.autofitColumns();
        
        await context.sync();
        console.log('✅ TA数据填充到Excel完成');
      });
      
    } catch (error) {
      console.error('❌ 填充TA数据到Excel失败:', error);
      throw error;
    }
  }
  
  /**
   * 从Excel读取TA数据并保存到数据库
   */
  async function readAndSaveTAFromExcel() {
    try {
      console.log('📋 开始从Excel读取TA_Data数据...');
      
      const taTableData = await Excel.run(async (context) => {
        const worksheet = context.workbook.worksheets.getItem('TA_Data');
        
        // 读取完整表格数据
        const usedRange = worksheet.getUsedRange();
        usedRange.load(['values']);
        await context.sync();
        
        const allData = usedRange.values;
        
        if (!Array.isArray(allData) || allData.length < 1) {
          throw new Error('TA_Data表格数据不完整');
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
        
        // 过滤数据行 - 至少要有ARM或ELEMENT或ARMCD有值
        const filteredRows = dataRows.filter(row => {
          return hasValue(row[3]) || hasValue(row[6]) || hasValue(row[2]); // ARM, ELEMENT, ARMCD
        });
        
        console.log(`🔍 数据过滤: ${dataRows.length} 行 → ${filteredRows.length} 行 (跳过了 ${dataRows.length - filteredRows.length} 个无效行)`);
        
        // 转换为对象数组（10个字段）
        const table_content = filteredRows.map(row => ({
          'STUDYID': row[0] || '',
          'DOMAIN': row[1] || '',
          'ARMCD': row[2] || '',
          'ARM': row[3] || '',
          'TAETORD': row[4] || '',
          'ETCD': row[5] || '',
          'ELEMENT': row[6] || '',
          'TABRANCH': row[7] || '',
          'TATRANS': row[8] || '',
          'EPOCH': row[9] || ''
        }));
        
        console.log('📋 TA数据转换完成');
        if (table_content.length > 0) {
          console.log('📊 数据预览（前2条）:', table_content.slice(0, 2));
        }
        
        return table_content;
      });
      
      console.log(`📊 准备保存 ${taTableData.length} 条TA记录...`);
      
      // 调用保存函数
      await saveTADataToDatabase(taTableData);
      
      console.log('✅ TA_Data数据从Excel保存成功');
      
    } catch (error) {
      console.error('❌ 从Excel保存TA_Data失败:', error);
      throw error;
    }
  }
  
  /**
   * 配置初始化函数 - 接收API_BASE_URL和studyId配置
   * @param {Object} cfg - 配置对象 {API_BASE_URL, studyId}
   */
  function init(cfg) {
    try {
      console.log('🔧 [SpecTA] 开始配置初始化:', cfg);
      
      if (cfg && cfg.API_BASE_URL) {
        API_BASE_URL = cfg.API_BASE_URL;
        console.log('📍 [SpecTA] API_BASE_URL 已更新:', API_BASE_URL);
      }
      
      if (cfg && cfg.studyId) {
        currentStudyId = cfg.studyId;
        console.log('📍 [SpecTA] currentStudyId 已更新:', currentStudyId);
      }
      
      console.log('✅ [SpecTA] 配置初始化完成:', { API_BASE_URL, currentStudyId });
      
    } catch (error) {
      console.error('❌ [SpecTA] 配置初始化失败:', error);
    }
  }
  
  // 全局暴露函数供spec.js调用
  window.SpecTA = {
    init: init,
    initTADataGeneration: initTADataGeneration,
    readAndSaveTAFromExcel: readAndSaveTAFromExcel
  };
  
  console.log('✅ SpecTA模块已加载');
})();

