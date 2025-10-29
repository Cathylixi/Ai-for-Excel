// TI_Data模块 - 专门处理TI表格的自动生成和填充（基于Inclusion/Exclusion Criteria使用AI生成）
(function(){
  let API_BASE_URL = (typeof window !== 'undefined' && window.API_BASE_URL) ? window.API_BASE_URL : '';
  let currentStudyId = (typeof window !== 'undefined' && window.currentDocumentId) ? window.currentDocumentId : null;

  /**
   * 主控制函数 - 初始化TI_Data生成流程
   */
  async function initTIDataGeneration() {
    try {
      console.log('🚀 开始TI_Data自动生成流程...');
      
      if (!currentStudyId) {
        console.error('❌ currentStudyId为空，无法生成TI数据');
        return;
      }
      
      // Step 1: 调用后端API生成TI数据（基于Inclusion/Exclusion Criteria使用OpenAI）
      console.log('📊 Step 1: 调用OpenAI生成TI_Data（基于Criterias）...');
      const tiData = await generateTIData();
      
      if (!tiData || tiData.length === 0) {
        console.log('⚠️ 没有生成TI数据，可能Criterias不存在');
        return;
      }
      
      // Step 2: 保存到数据库
      console.log('💾 Step 2: 保存TI数据到数据库...');
      await saveTIDataToDatabase(tiData);
      
      // Step 3: 填充到Excel
      console.log('📋 Step 3: 填充TI数据到Excel...');
      await fillTIDataToExcel(tiData);
      
      console.log('✅ TI_Data生成流程完成');
      
    } catch (error) {
      console.error('❌ TI_Data生成流程失败:', error);
      throw error;
    }
  }
  
  /**
   * 调用API生成TI数据（使用OpenAI基于Inclusion/Exclusion Criteria）
   */
  async function generateTIData() {
    try {
      console.log('🌐 调用API生成TI数据...');
      console.log(`📍 API端点: ${API_BASE_URL}/api/studies/${currentStudyId}/generate-ti-details`);
      
      const response = await fetch(`${API_BASE_URL}/api/studies/${currentStudyId}/generate-ti-details`, {
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
        throw new Error(result.message || 'TI数据生成失败');
      }
      
      console.log(`✅ TI数据生成成功，总计 ${result.data.totalRecords} 条记录`);
      console.log(`📋 Study Number: ${result.data.studyNumber}`);
      console.log(`📊 Inclusion: ${result.data.inclusionCount}, Exclusion: ${result.data.exclusionCount}`);
      
      if (result.data.tiData && result.data.tiData.length > 0) {
        console.log('📋 TI数据预览（前2条）:', result.data.tiData.slice(0, 2));
      }
      
      return result.data.tiData;
      
    } catch (error) {
      console.error('❌ 生成TI数据失败:', error);
      throw error;
    }
  }
  
  /**
   * 保存TI数据到数据库
   */
  async function saveTIDataToDatabase(tiData) {
    try {
      console.log('💾 开始保存TI数据到数据库...');
      console.log(`📊 准备保存 ${tiData.length} 条记录`);
      
      const response = await fetch(`${API_BASE_URL}/api/studies/${currentStudyId}/spec-ti-details-data`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          tiData: tiData
        })
      });
      
      if (!response.ok) {
        const errorText = await response.text();
        console.error(`❌ 保存失败 HTTP ${response.status}:`, errorText);
        throw new Error(`保存失败: HTTP ${response.status}`);
      }
      
      const result = await response.json();
      
      if (!result.success) {
        throw new Error(result.message || 'TI数据保存失败');
      }
      
      console.log(`✅ TI数据保存成功，总计: ${result.data.totalCount} 条记录`);
      
      // 验证table_title保存情况
      if (result.data.tableTitle && result.data.tableTitleLength) {
        console.log(`📋 [Frontend] table_title验证: 长度=${result.data.tableTitleLength}, 内容=`, result.data.tableTitle.slice(0, 3), '...');
      } else {
        console.warn(`⚠️ [Frontend] table_title可能未正确保存: 长度=${result.data.tableTitleLength || 0}`);
      }
      
    } catch (error) {
      console.error('❌ 保存TI数据到数据库失败:', error);
      throw error;
    }
  }
  
  /**
   * 填充TI数据到Excel
   */
  async function fillTIDataToExcel(tiData) {
    try {
      console.log('📋 开始填充TI数据到Excel...');
      
      if (!tiData || tiData.length === 0) {
        console.log('⚠️ 没有TI数据需要填充');
        return;
      }
      
      await Excel.run(async (context) => {
        const worksheet = context.workbook.worksheets.getItem('TI_Data');
        
        // 准备Excel数据格式 (二维数组) - 6个字段
        const excelData = tiData.map(row => [
          row.STUDYID || '',
          row.DOMAIN || '',
          row.IETESTCD || '',
          row.IETEST || '',
          row.IECAT || '',
          row.TIVERS || ''
        ]);
        
        console.log(`📊 准备填充 ${excelData.length} 行TI数据到Excel`);
        console.log('📋 Excel数据格式预览（前2行）:', excelData.slice(0, 2));
        
        // 填充数据到Excel (从A2开始，A1是表头)
        const dataRange = worksheet.getRange(`A2:F${1 + excelData.length}`);
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
        const fullRange = worksheet.getRange(`A1:F${1 + excelData.length}`);
        fullRange.format.autofitColumns();
        
        await context.sync();
        console.log('✅ TI数据填充到Excel完成');
      });
      
    } catch (error) {
      console.error('❌ 填充TI数据到Excel失败:', error);
      throw error;
    }
  }
  
  /**
   * 从Excel读取TI数据并保存到数据库
   */
  async function readAndSaveTIFromExcel() {
    try {
      console.log('📋 开始从Excel读取TI_Data数据...');
      
      const tiTableData = await Excel.run(async (context) => {
        const worksheet = context.workbook.worksheets.getItem('TI_Data');
        
        // 读取完整表格数据
        const usedRange = worksheet.getUsedRange();
        usedRange.load(['values']);
        await context.sync();
        
        const allData = usedRange.values;
        
        if (!Array.isArray(allData) || allData.length < 1) {
          throw new Error('TI_Data表格数据不完整');
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
        
        // 过滤数据行 - IETEST必须有值
        const filteredRows = dataRows.filter(row => {
          return hasValue(row[3]); // IETEST
        });
        
        console.log(`🔍 数据过滤: ${dataRows.length} 行 → ${filteredRows.length} 行 (跳过了 ${dataRows.length - filteredRows.length} 个无效行)`);
        
        // 转换为对象数组（6个字段）
        const table_content = filteredRows.map(row => ({
          'STUDYID': row[0] || '',
          'DOMAIN': row[1] || '',
          'IETESTCD': row[2] || '',
          'IETEST': row[3] || '',
          'IECAT': row[4] || '',
          'TIVERS': row[5] || ''
        }));
        
        console.log('📋 TI数据转换完成');
        if (table_content.length > 0) {
          console.log('📊 数据预览（前2条）:', table_content.slice(0, 2));
        }
        
        return table_content;
      });
      
      console.log(`📊 准备保存 ${tiTableData.length} 条TI记录...`);
      
      // 调用保存函数
      await saveTIDataToDatabase(tiTableData);
      
      console.log('✅ TI_Data数据从Excel保存成功');
      
    } catch (error) {
      console.error('❌ 从Excel保存TI_Data失败:', error);
      throw error;
    }
  }
  
  /**
   * 配置初始化函数 - 接收API_BASE_URL和studyId配置
   * @param {Object} cfg - 配置对象 {API_BASE_URL, studyId}
   */
  function init(cfg) {
    try {
      console.log('🔧 [SpecTI] 开始配置初始化:', cfg);
      
      if (cfg && cfg.API_BASE_URL) {
        API_BASE_URL = cfg.API_BASE_URL;
        console.log('📍 [SpecTI] API_BASE_URL 已更新:', API_BASE_URL);
      }
      
      if (cfg && cfg.studyId) {
        currentStudyId = cfg.studyId;
        console.log('📍 [SpecTI] currentStudyId 已更新:', currentStudyId);
      }
      
      console.log('✅ [SpecTI] 配置初始化完成:', { API_BASE_URL, currentStudyId });
      
    } catch (error) {
      console.error('❌ [SpecTI] 配置初始化失败:', error);
    }
  }
  
  // 全局暴露函数供spec.js调用
  window.SpecTI = {
    init: init,
    initTIDataGeneration: initTIDataGeneration,
    readAndSaveTIFromExcel: readAndSaveTIFromExcel
  };
  
  console.log('✅ SpecTI模块已加载');
})();

