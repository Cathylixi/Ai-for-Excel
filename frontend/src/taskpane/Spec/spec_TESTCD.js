// TESTCD_Details模块 - 专门处理TESTCD表格的自动生成和填充
(function(){
  let API_BASE_URL = (typeof window !== 'undefined' && window.API_BASE_URL) ? window.API_BASE_URL : '';
  let currentStudyId = (typeof window !== 'undefined' && window.currentDocumentId) ? window.currentDocumentId : null;

  // 🔥 定义关键列：只要这些列中任意一列有值，该行就会被保存
  const KEY_COLUMNS = ['Dataset', '--TESTCD Value', '--ORRES Source/Derivation', 'Raw Dataset Name or External Source Name', 'Selection Criteria'];

  /**
   * 主控制函数 - 初始化TESTCD_Details生成流程
   */
  async function initTESTCDDetailsGeneration() {
    try {
      console.log('🚀 开始TESTCD_Details自动生成流程...');
      
      if (!currentStudyId) {
        console.error('❌ currentStudyId为空，无法生成TESTCD数据');
        return;
      }
      
      // Step 1: 生成TESTCD_table数据
      console.log('📊 Step 1: 生成TESTCD_table数据...');
      const testcdData = await generateTESTCDTableData();
      
      if (!testcdData || testcdData.length === 0) {
        console.log('⚠️ 没有找到TESTCD相关的变量数据，跳过TESTCD_Details填充');
        return;
      }
      
      // Step 2: 分批保存到数据库
      console.log('💾 Step 2: 分批保存TESTCD数据到数据库...');
      await saveTESTCDDetailsToDatabase(testcdData);
      
      // Step 3: 填充到Excel
      console.log('📋 Step 3: 填充TESTCD数据到Excel...');
      await fillTESTCDDataToExcel(testcdData);
      
      console.log('✅ TESTCD_Details生成流程完成');
      
    } catch (error) {
      console.error('❌ TESTCD_Details生成流程失败:', error);
    }
  }
  
  /**
   * 调用API生成TESTCD_table数据
   */
  async function generateTESTCDTableData() {
    try {
      console.log('🌐 调用API生成TESTCD数据...');
      
      const response = await fetch(`${API_BASE_URL}/api/studies/${currentStudyId}/generate-testcd-details`, {
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
        throw new Error(result.message || 'TESTCD数据生成失败');
      }
      
      console.log(`✅ TESTCD数据生成成功，共 ${result.data.totalBatches} 批，总计 ${result.data.totalRecords} 条记录`);
      
      // 合并所有批次的数据
      const allTestcdData = [];
      result.data.batches.forEach(batch => {
        allTestcdData.push(...batch.batchData);
      });
      
      console.log(`📊 前端收到TESTCD数据: ${allTestcdData.length} 条记录`);
      if (allTestcdData.length > 0) {
        console.log('📋 TESTCD数据预览:', allTestcdData.slice(0, 2));
      }
      
      return allTestcdData;
      
    } catch (error) {
      console.error('❌ 生成TESTCD数据失败:', error);
      return [];
    }
  }
  
  /**
   * 分批保存TESTCD数据到数据库
   */
  async function saveTESTCDDetailsToDatabase(testcdData) {
    try {
      console.log('💾 开始分批保存TESTCD数据到数据库...');
      
      const batchSize = 20; // 每批20条记录
      const totalBatches = Math.ceil(testcdData.length / batchSize);
      
      for (let batchIndex = 0; batchIndex < totalBatches; batchIndex++) {
        const start = batchIndex * batchSize;
        const end = Math.min(start + batchSize, testcdData.length);
        const batchData = testcdData.slice(start, end);
        const isLastBatch = batchIndex === totalBatches - 1;
        const replaceAll = batchIndex === 0; // 第一批替换全部数据
        
        console.log(`💾 保存TESTCD批次 ${batchIndex + 1}/${totalBatches}，${batchData.length} 条记录，replaceAll=${replaceAll}`);
        
        const response = await fetch(`${API_BASE_URL}/api/studies/${currentStudyId}/spec-testcd-details-data`, {
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
          throw new Error(`TESTCD批次 ${batchIndex + 1} 保存失败: HTTP ${response.status}`);
        }
        
        const result = await response.json();
        
        if (!result.success) {
          throw new Error(result.message || `TESTCD批次 ${batchIndex + 1} 保存失败`);
        }
        
        console.log(`✅ TESTCD批次 ${batchIndex + 1} 保存成功，累计已保存: ${result.data.totalCount} 条记录`);
        
        // 🔥 验证table_title保存情况
        if (result.data.tableTitle && result.data.tableTitleLength) {
          console.log(`📋 [Frontend] TESTCD table_title验证: 长度=${result.data.tableTitleLength}, 内容=`, result.data.tableTitle.slice(0, 3), '...');
        } else {
          console.warn(`⚠️ [Frontend] TESTCD table_title可能未正确保存: 长度=${result.data.tableTitleLength || 0}`);
        }
      }
      
      console.log('✅ 所有TESTCD数据保存完成，开始检查数据库状态...');
      
    } catch (error) {
      console.error('❌ 保存TESTCD数据到数据库失败:', error);
      throw error;
    }
  }
  
  /**
   * 分批填充TESTCD数据到Excel
   */
  async function fillTESTCDDataToExcel(testcdData) {
    try {
      console.log('📋 开始填充TESTCD数据到Excel...');
      
      if (testcdData.length === 0) {
        console.log('⚠️ 没有TESTCD数据需要填充');
        return;
      }
      
      await Excel.run(async (context) => {
        const worksheet = context.workbook.worksheets.getItem('TESTCD_Details');
        
        // 准备Excel数据格式 (二维数组) - 32个字段
        const excelData = testcdData.map(row => [
          row.Dataset,
          row['--TESTCD Value'],
          row['--TEST Value'],
          row['Raw Dataset Name or External Source Name'],
          row['Selection Criteria'],
          row['--CAT Value'],
          row['--SCAT Value'],
          row['--STAT Source/Derivation'],
          row['--REASND Source/Derivation'],
          row['--ORRES Source/Derivation'],
          row['--ORRESU Source/Derivation'],
          row['--STRESC Source/Derivation'],
          row['--STRESN Source/Derivation'],
          row['--STRESU Source/Derivation'],
          row['--DTC Source/Derivation'],
          row['--CLSIG Source/Derivation'],
          row['--POS Source/Derivation'],
          row['--LAT Source/Derivation'],
          row['--LOC Source/Derivation'],
          row['--DIR Source/Derivation'],
          row['--NAM Source/Derivation'],
          row['--SPEC Source/Derivation'],
          row['--OBJ Value'],
          row['--METHOD Source/Derivation'],
          row.FOCID,
          row['TSTDTL Source/Derivation'],
          row['--EVLINT Source/Derivation'],
          row['--EVINTX Source/Derivation'],
          row['--EVAL Source/Derivation'],
          row['--EVALINT Source/Derivation'],
          row['RAW Variable 1'],
          row['RAW Variable 2']
        ]);
        
        console.log(`📊 准备填充 ${excelData.length} 行TESTCD数据到Excel`);
        console.log('📋 Excel数据格式预览:', excelData.slice(0, 2));
        
        // 填充数据到Excel (从A2开始，A1是表头)
        const dataRange = worksheet.getRange(`A2:AF${1 + excelData.length}`);
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
        const fullRange = worksheet.getRange(`A1:AF${1 + excelData.length}`);
        fullRange.format.autofitColumns();
        
        await context.sync();
        console.log('✅ TESTCD数据填充到Excel完成');
      });
      
    } catch (error) {
      console.error('❌ 填充TESTCD数据到Excel失败:', error);
      throw error;
    }
  }
  
  /**
   * 配置初始化函数 - 接收API_BASE_URL和studyId配置
   * @param {Object} cfg - 配置对象 {API_BASE_URL, studyId}
   */
  function init(cfg) {
    try {
      console.log('🔧 [SpecTESTCD] 开始配置初始化:', cfg);
      
      if (cfg && cfg.API_BASE_URL) {
        API_BASE_URL = cfg.API_BASE_URL;
        console.log('📍 [SpecTESTCD] API_BASE_URL 已更新:', API_BASE_URL);
      }
      
      if (cfg && cfg.studyId) {
        currentStudyId = cfg.studyId;
        console.log('📍 [SpecTESTCD] currentStudyId 已更新:', currentStudyId);
      }
      
      console.log('✅ [SpecTESTCD] 配置初始化完成:', { API_BASE_URL, currentStudyId });
      
    } catch (error) {
      console.error('❌ [SpecTESTCD] 配置初始化失败:', error);
    }
  }
  
  /**
   * 🔥 新增：从Excel读取TESTCD数据并保存到数据库
   */
  async function readAndSaveTESTCDFromExcel() {
    try {
      console.log('📋 开始从Excel读取TESTCD_Details数据...');
      
      const testcdTableData = await Excel.run(async (context) => {
        const worksheet = context.workbook.worksheets.getItem('TESTCD_Details');
        
        // 读取完整表格数据（包括表头）
        const usedRange = worksheet.getUsedRange();
        usedRange.load(['values']);
        await context.sync();
        
        const allData = usedRange.values;
        
        if (!Array.isArray(allData) || allData.length < 1) {
          throw new Error('TESTCD_Details表格数据不完整');
        }
        
        console.log(`📊 读取到 ${allData.length} 行数据，包括表头`);
        
        // 分离表头和数据行
        const table_title = allData[0]; // 第一行表头
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
        
        // 转换为对象数组（32个字段）- 使用过滤后的行
        const table_content = filteredRows.map(row => ({
          'Dataset': row[0] || '',
          '--TESTCD Value': row[1] || '',
          '--TEST Value': row[2] || '',
          'Raw Dataset Name or External Source Name': row[3] || '',
          'Selection Criteria': row[4] || '',
          '--CAT Value': row[5] || '',
          '--SCAT Value': row[6] || '',
          '--STAT Source/Derivation': row[7] || '',
          '--REASND Source/Derivation': row[8] || '',
          '--ORRES Source/Derivation': row[9] || '',
          '--ORRESU Source/Derivation': row[10] || '',
          '--STRESC Source/Derivation': row[11] || '',
          '--STRESN Source/Derivation': row[12] || '',
          '--STRESU Source/Derivation': row[13] || '',
          '--DTC Source/Derivation': row[14] || '',
          '--CLSIG Source/Derivation': row[15] || '',
          '--POS Source/Derivation': row[16] || '',
          '--LAT Source/Derivation': row[17] || '',
          '--LOC Source/Derivation': row[18] || '',
          '--DIR Source/Derivation': row[19] || '',
          '--NAM Source/Derivation': row[20] || '',
          '--SPEC Source/Derivation': row[21] || '',
          '--OBJ Value': row[22] || '',
          '--METHOD Source/Derivation': row[23] || '',
          'FOCID': row[24] || '',
          'TSTDTL Source/Derivation': row[25] || '',
          '--EVLINT Source/Derivation': row[26] || '',
          '--EVINTX Source/Derivation': row[27] || '',
          '--EVAL Source/Derivation': row[28] || '',
          '--EVALINT Source/Derivation': row[29] || '',
          'RAW Variable 1': row[30] || '',
          'RAW Variable 2': row[31] || ''
        }));
        
        console.log('📋 TESTCD数据转换完成');
        if (table_content.length > 0) {
          console.log('📊 数据预览:', table_content.slice(0, 2));
        }
        
        return table_content;
      });
      
      console.log(`📊 准备分批保存 ${testcdTableData.length} 条TESTCD记录 (User Confirmed整表覆盖模式)...`);
      console.log(`🔄 批次策略: 首批 replaceAll=true 清空旧数据，后续批次追加`);
      
      // 调用现有的分批保存函数（复用saveTESTCDDetailsToDatabase的逻辑）
      await saveTESTCDDetailsToDatabase(testcdTableData);
      
      console.log('✅ TESTCD_Details数据从Excel保存成功');
      
    } catch (error) {
      console.error('❌ 从Excel保存TESTCD_Details失败:', error);
      throw error;
    }
  }
  
  // 全局暴露函数供spec.js调用
  window.SpecTESTCD = {
    init: init,
    initTESTCDDetailsGeneration: initTESTCDDetailsGeneration,
    readAndSaveTESTCDFromExcel: readAndSaveTESTCDFromExcel  // 🔥 新增
  };
  
  console.log('✅ SpecTESTCD模块已加载');
})();
