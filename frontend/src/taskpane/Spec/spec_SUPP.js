// SUPP_Details模块 - 专门处理SUPP表格的自动生成和填充
(function(){
  let API_BASE_URL = (typeof window !== 'undefined' && window.API_BASE_URL) ? window.API_BASE_URL : '';
  let currentStudyId = (typeof window !== 'undefined' && window.currentDocumentId) ? window.currentDocumentId : null;

  // 🔥 定义关键列：只要这些列中任意一列有值，该行就会被保存
  const KEY_COLUMNS = ['Dataset', 'QNAM', 'QVAL', 'Raw Dataset Name or External Source Name', 'IDVAR'];

  /**
   * 主控制函数 - 初始化SUPP_Details生成流程
   */
  async function initSUPPDetailsGeneration() {
    try {
      console.log('🚀 开始SUPP_Details自动生成流程...');
      
      if (!currentStudyId) {
        console.error('❌ currentStudyId为空，无法生成SUPP数据');
        return;
      }
      
      // Step 1: 生成SUPP_table数据
      console.log('📊 Step 1: 生成SUPP_table数据...');
      const suppData = await generateSUPPTableData();
      
      if (!suppData || suppData.length === 0) {
        console.log('⚠️ 没有找到SUPP相关的映射数据，跳过SUPP_Details填充');
        return;
      }
      
      // Step 2: 分批保存到数据库
      console.log('💾 Step 2: 分批保存SUPP数据到数据库...');
      await saveSUPPDetailsToDatabase(suppData);
      
      // Step 3: 填充到Excel
      console.log('📋 Step 3: 填充SUPP数据到Excel...');
      await fillSUPPDataToExcel(suppData);
      
      console.log('✅ SUPP_Details生成流程完成');
      
    } catch (error) {
      console.error('❌ SUPP_Details生成流程失败:', error);
    }
  }
  
  /**
   * 调用API生成SUPP_table数据
   */
  async function generateSUPPTableData() {
    try {
      console.log('🌐 调用API生成SUPP数据...');
      
      const response = await fetch(`${API_BASE_URL}/api/studies/${currentStudyId}/generate-supp-details`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        }
      });
      
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }
      
      const result = await response.json();
      
      if (!result.success) {
        throw new Error(result.message || 'SUPP数据生成失败');
      }
      
      console.log(`✅ SUPP数据生成成功，共 ${result.data.totalBatches} 批，总计 ${result.data.totalRecords} 条记录`);
      
      // 合并所有批次的数据
      const allSuppData = [];
      result.data.batches.forEach(batch => {
        allSuppData.push(...batch.batchData);
      });
      
      console.log(`📊 前端收到SUPP数据: ${allSuppData.length} 条记录`);
      if (allSuppData.length > 0) {
        console.log('📋 SUPP数据预览:', allSuppData.slice(0, 2));
      }
      
      return allSuppData;
      
    } catch (error) {
      console.error('❌ 生成SUPP数据失败:', error);
      return [];
    }
  }
  
  /**
   * 分批保存SUPP数据到数据库
   */
  async function saveSUPPDetailsToDatabase(suppData) {
    try {
      console.log('💾 开始分批保存SUPP数据到数据库...');
      
      const batchSize = 20; // 每批20条记录
      const totalBatches = Math.ceil(suppData.length / batchSize);
      
      for (let batchIndex = 0; batchIndex < totalBatches; batchIndex++) {
        const start = batchIndex * batchSize;
        const end = Math.min(start + batchSize, suppData.length);
        const batchData = suppData.slice(start, end);
        const isLastBatch = batchIndex === totalBatches - 1;
        const replaceAll = batchIndex === 0; // 第一批替换全部数据
        
        console.log(`💾 保存SUPP批次 ${batchIndex + 1}/${totalBatches}，${batchData.length} 条记录，replaceAll=${replaceAll}`);
        
        const response = await fetch(`${API_BASE_URL}/api/studies/${currentStudyId}/spec-supp-details-data`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            batchData,
            isLastBatch,
            replaceAll
          })
        });
        
        if (!response.ok) {
          throw new Error(`批次 ${batchIndex + 1} 保存失败: HTTP ${response.status}`);
        }
        
        const result = await response.json();
        
        if (!result.success) {
          throw new Error(result.message || `批次 ${batchIndex + 1} 保存失败`);
        }
        
        console.log(`✅ 批次 ${batchIndex + 1} 保存成功，累计已保存: ${result.data.totalCount} 条记录`);
        
        // 🔥 验证table_title保存情况
        if (result.data.tableTitle && result.data.tableTitleLength) {
          console.log(`📋 [Frontend] table_title验证: 长度=${result.data.tableTitleLength}, 内容=`, result.data.tableTitle.slice(0, 3), '...');
        } else {
          console.warn(`⚠️ [Frontend] table_title可能未正确保存: 长度=${result.data.tableTitleLength || 0}`);
        }
      }
      
      console.log('✅ 所有SUPP数据保存完成，开始检查数据库状态...');
      
    } catch (error) {
      console.error('❌ 保存SUPP数据到数据库失败:', error);
      throw error;
    }
  }
  
  /**
   * 分批填充SUPP数据到Excel
   */
  async function fillSUPPDataToExcel(suppData) {
    try {
      console.log('📋 开始填充SUPP数据到Excel...');
      
      if (suppData.length === 0) {
        console.log('⚠️ 没有SUPP数据需要填充');
        return;
      }
      
      await Excel.run(async (context) => {
        const worksheet = context.workbook.worksheets.getItem('SUPP_Details');
        
        // 准备Excel数据格式 (二维数组) - 对IDVAR和IDVARVAL做显示转换
        const excelData = suppData.map(row => [
          row.Dataset,
          row.QNAM,
          row.QLABEL,
          row['Raw Dataset Name or External Source Name'],
          row['Selection Criteria'],
          `Set to '${row.IDVAR}'`, // 🔥 Excel显示格式：Set to 'AESEQ'
          `Value of ${row.IDVARVAL.replace('Value of ', '')}`, // 🔥 Excel显示格式：Value of AE.AESEQ
          row.QVAL,
          row.QORIG,
          row.QEVAL
        ]);
        
        console.log(`📊 准备填充 ${excelData.length} 行SUPP数据到Excel`);
        console.log('📋 Excel数据格式预览:', excelData.slice(0, 2));
        
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
        console.log('✅ SUPP数据填充到Excel完成');
      });
      
    } catch (error) {
      console.error('❌ 填充SUPP数据到Excel失败:', error);
      throw error;
    }
  }
  
  /**
   * 配置初始化函数 - 接收API_BASE_URL和studyId配置
   * @param {Object} cfg - 配置对象 {API_BASE_URL, studyId}
   */
  function init(cfg) {
    try {
      console.log('🔧 [SpecSUPP] 开始配置初始化:', cfg);
      
      if (cfg && cfg.API_BASE_URL) {
        API_BASE_URL = cfg.API_BASE_URL;
        console.log('📍 [SpecSUPP] API_BASE_URL 已更新:', API_BASE_URL);
      }
      
      if (cfg && cfg.studyId) {
        currentStudyId = cfg.studyId;
        console.log('📍 [SpecSUPP] currentStudyId 已更新:', currentStudyId);
      }
      
      console.log('✅ [SpecSUPP] 配置初始化完成:', { API_BASE_URL, currentStudyId });
      
    } catch (error) {
      console.error('❌ [SpecSUPP] 配置初始化失败:', error);
    }
  }
  
  /**
   * 🔥 新增：从Excel读取SUPP数据并保存到数据库
   */
  async function readAndSaveSUPPFromExcel() {
    try {
      console.log('📋 开始从Excel读取SUPP_Details数据...');
      
      const suppTableData = await Excel.run(async (context) => {
        const worksheet = context.workbook.worksheets.getItem('SUPP_Details');
        
        // 读取完整表格数据
        const usedRange = worksheet.getUsedRange();
        usedRange.load(['values']);
        await context.sync();
        
        const allData = usedRange.values;
        
        if (!Array.isArray(allData) || allData.length < 1) {
          throw new Error('SUPP_Details表格数据不完整');
        }
        
        console.log(`📊 读取到 ${allData.length} 行数据，包括表头`);
        
        // 分离表头和数据行
        const table_title = allData[0]; // 表头
        const dataRows = allData.slice(1); // 数据行
        
        console.log(`📋 表头字段数: ${table_title.length}，原始数据行数: ${dataRows.length}`);
        
        // 🔥 新增：建立表头索引映射
        const colIndex = {};
        table_title.forEach((header, index) => {
          if (header && typeof header === 'string') {
            colIndex[header.trim()] = index;
          }
        });
        console.log(`📋 表头映射:`, colIndex);
        
        // 🔥 新增：判断值是否非空的辅助函数
        const hasValue = (value) => {
          return value !== null && value !== undefined && String(value).trim() !== '';
        };
        
        // 🔥 新增：过滤数据行 - 只保留关键列中至少一列有值的行
        const filteredRows = dataRows.filter(row => {
          return KEY_COLUMNS.some(keyCol => {
            const colIdx = colIndex[keyCol];
            if (colIdx === undefined) return false;
            return hasValue(row[colIdx]);
          });
        });
        
        console.log(`🔍 关键列过滤: ${dataRows.length} 行 → ${filteredRows.length} 行 (跳过了 ${dataRows.length - filteredRows.length} 个空行)`);
        console.log(`📋 关键列定义:`, KEY_COLUMNS);
        
        // 转换为对象数组（10个字段）- 使用过滤后的行
        const table_content = filteredRows.map(row => ({
          'Dataset': row[0] || '',
          'QNAM': row[1] || '',
          'QLABEL': row[2] || '',
          'Raw Dataset Name or External Source Name': row[3] || '',
          'Selection Criteria': row[4] || '',
          'IDVAR': row[5] || '',
          'IDVARVAL': row[6] || '',
          'QVAL': row[7] || '',
          'QORIG': row[8] || '',
          'QEVAL': row[9] || ''
        }));
        
        console.log('📋 SUPP数据转换完成');
        if (table_content.length > 0) {
          console.log('📊 数据预览:', table_content.slice(0, 2));
        }
        
        return table_content;
      });
      
      console.log(`📊 准备分批保存 ${suppTableData.length} 条SUPP记录 (User Confirmed整表覆盖模式)...`);
      console.log(`🔄 批次策略: 首批 replaceAll=true 清空旧数据，后续批次追加`);
      
      // 调用现有的分批保存函数（复用saveSUPPDetailsToDatabase的逻辑）
      await saveSUPPDetailsToDatabase(suppTableData);
      
      console.log('✅ SUPP_Details数据从Excel保存成功');
      
    } catch (error) {
      console.error('❌ 从Excel保存SUPP_Details失败:', error);
      throw error;
    }
  }
  
  // 全局暴露函数供spec.js调用
  window.SpecSUPP = {
    init: init,
    initSUPPDetailsGeneration: initSUPPDetailsGeneration,
    readAndSaveSUPPFromExcel: readAndSaveSUPPFromExcel  // 🔥 新增
  };
  
  console.log('✅ SpecSUPP模块已加载');
})();
