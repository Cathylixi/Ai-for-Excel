/**
 * Test script for CRF rows extraction functionality
 */

const fs = require('fs');
const path = require('path');
const { processWordsToRows, analyzeRowDistribution } = require('./backend/services/crf_analysis/words_to_rows_processor');

async function testRowsExtraction() {
  try {
    console.log('🚀 开始测试CRF行提取功能...');
    
    // 读取已有的词位置数据
    const wordsFilePath = path.join(__dirname, 'backend/temp/crf_words_test_words_demo_latest.json');
    
    if (!fs.existsSync(wordsFilePath)) {
      console.error('❌ 词位置文件不存在，请先运行词提取测试');
      return;
    }
    
    console.log('📖 读取词位置数据...');
    const wordsData = JSON.parse(fs.readFileSync(wordsFilePath, 'utf8'));
    
    console.log(`📊 词位置数据: ${wordsData.metadata.total_words} 词, ${wordsData.metadata.total_pages} 页`);
    
    // 测试不同的Y坐标容差
    const tolerances = [1.0, 2.0, 3.0];
    
    for (const tolerance of tolerances) {
      console.log(`\n🔍 测试Y坐标容差: ${tolerance}pt`);
      
      // 处理词位置到行位置
      const rowsResult = processWordsToRows(wordsData, tolerance);
      
      if (rowsResult.success) {
        console.log(`✅ 行提取成功: ${rowsResult.metadata.total_rows} 行`);
        
        // 分析行分布
        const analysis = analyzeRowDistribution(rowsResult);
        console.log(`📈 平均每行词数: ${analysis.avg_words_per_row}`);
        
        // 保存结果
        const outputFileName = `crf_rows_tolerance_${tolerance.toFixed(1)}_latest.json`;
        const outputPath = path.join(__dirname, 'backend/temp', outputFileName);
        fs.writeFileSync(outputPath, JSON.stringify(rowsResult, null, 2));
        console.log(`💾 结果已保存: ${outputFileName}`);
        
        // 显示每页的行统计
        analysis.page_breakdown.forEach(page => {
          console.log(`   Page ${page.page_number}: ${page.row_count} 行, 平均 ${page.avg_words_per_row} 词/行`);
        });
        
        // 显示前3行的示例
        console.log(`📝 前3行示例:`);
        for (let i = 0; i < Math.min(3, rowsResult.pages[0].rows.length); i++) {
          const row = rowsResult.pages[0].rows[i];
          console.log(`   行${row.row_index}: Y=${row.y_center.toFixed(1)}, ${row.word_count}词 - "${row.full_text.substring(0, 60)}..."`);
        }
        
      } else {
        console.error(`❌ 行提取失败: ${rowsResult.error}`);
      }
    }
    
    console.log('\n🎉 行提取测试完成!');
    
  } catch (error) {
    console.error('❌ 测试失败:', error);
  }
}

// 运行测试
testRowsExtraction();
