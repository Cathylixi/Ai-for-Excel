/**
 * Test complete CRF extraction (words + rows)
 */

const { extractCrfWordsOnly } = require('./backend/services/pypdfService');
const { processWordsToRows } = require('./backend/services/words_to_rows_processor');
const fs = require('fs');

async function testCompleteExtraction() {
  try {
    console.log('🚀 测试完整的CRF提取流程 (词 + 行)...');
    
    // 读取测试PDF文件
    const pdfPath = './backend/Resource/crf/crf_new.pdf';
    const pdfBuffer = fs.readFileSync(pdfPath);
    
    console.log('📄 开始提取词位置...');
    
    // 1. 提取词位置
    const wordsResult = await extractCrfWordsOnly(pdfBuffer, 'complete_test');
    
    if (!wordsResult.success) {
      console.error('❌ 词位置提取失败:', wordsResult.error);
      return;
    }
    
    console.log(`✅ 词位置提取成功: ${wordsResult.metadata.total_words} 词, ${wordsResult.metadata.total_pages} 页`);
    
    // 2. 转换为行位置
    console.log('🔄 开始转换为行位置...');
    const rowsResult = processWordsToRows(wordsResult, 2.0);
    
    if (!rowsResult.success) {
      console.error('❌ 行位置转换失败:', rowsResult.error);
      return;
    }
    
    console.log(`✅ 行位置转换成功: ${rowsResult.metadata.total_rows} 行`);
    
    // 3. 模拟数据库保存格式
    const crfUploadResult = {
      crfFormList: {},
      crfFormName: { names: [], total_forms: 0 },
      Extract_words_with_position: wordsResult,
      Extract_rows_with_position: rowsResult
    };
    
    // 4. 保存完整结果
    const outputPath = './backend/temp/complete_extraction_test.json';
    fs.writeFileSync(outputPath, JSON.stringify(crfUploadResult, null, 2));
    
    console.log('💾 完整结果已保存到:', outputPath);
    
    // 5. 验证数据结构
    console.log('\n📊 数据结构验证:');
    console.log(`   crfUploadResult.Extract_words_with_position:`);
    console.log(`     - 成功: ${crfUploadResult.Extract_words_with_position.success}`);
    console.log(`     - 页数: ${crfUploadResult.Extract_words_with_position.metadata.total_pages}`);
    console.log(`     - 词数: ${crfUploadResult.Extract_words_with_position.metadata.total_words}`);
    
    console.log(`   crfUploadResult.Extract_rows_with_position:`);
    console.log(`     - 成功: ${crfUploadResult.Extract_rows_with_position.success}`);
    console.log(`     - 页数: ${crfUploadResult.Extract_rows_with_position.metadata.total_pages}`);
    console.log(`     - 行数: ${crfUploadResult.Extract_rows_with_position.metadata.total_rows}`);
    console.log(`     - Y容差: ${crfUploadResult.Extract_rows_with_position.y_tolerance}pt`);
    
    // 6. 显示行聚合效果
    console.log('\n🔍 行聚合效果示例 (第2页前5行):');
    const page2Rows = crfUploadResult.Extract_rows_with_position.pages[1].rows;
    for (let i = 0; i < Math.min(5, page2Rows.length); i++) {
      const row = page2Rows[i];
      console.log(`   行${row.row_index}: Y=${row.y_center.toFixed(1)}, ${row.word_count}词 - "${row.full_text.substring(0, 60)}..."`);
    }
    
    console.log('\n🎉 完整提取测试成功！');
    console.log('📋 数据库保存格式符合预期: files.crf.crfUploadResult');
    
  } catch (error) {
    console.error('❌ 测试失败:', error);
  }
}

testCompleteExtraction();
