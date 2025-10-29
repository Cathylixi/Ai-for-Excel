const mongoose = require('mongoose');
const path = require('path');
const dotenv = require('dotenv');

// 加载环境变量
dotenv.config({ path: path.join(__dirname, '.env') });

const Study = require('./models/studyModel');

async function checkCriteriaStructure() {
  try {
    const uri = process.env.MONGO_URI;
    if (!uri) {
      console.error('❌ MONGO_URI未设置');
      return;
    }
    
    await mongoose.connect(uri);
    console.log('✅ MongoDB连接成功\n');
    
    // 查找最近上传的Study
    const study = await Study.findOne()
      .sort({ 'files.protocol.uploadDate': -1 })
      .select('studyNumber files.protocol.uploadExtraction.sectionedText files.protocol.uploadExtraction.criterias')
      .lean();
    
    if (!study) {
      console.log('❌ 未找到Study');
      return;
    }
    
    console.log(`📋 Study: ${study.studyNumber}`);
    const sectionedText = study.files?.protocol?.uploadExtraction?.sectionedText || [];
    const criterias = study.files?.protocol?.uploadExtraction?.criterias || {};
    
    console.log(`\n========== 1. 查找所有Exclusion相关的section ==========`);
    const exclusionSections = sectionedText.filter(section => 
      section.title && section.title.toLowerCase().includes('exclusion')
    );
    
    console.log(`找到 ${exclusionSections.length} 个Exclusion相关section:\n`);
    exclusionSections.forEach((section, idx) => {
      console.log(`[${idx}] Title: "${section.title}"`);
      console.log(`    Level: ${section.level}, Number: ${section.number || 'N/A'}`);
      console.log(`    Content length: ${section.content?.length || 0} 字符`);
      if (section.content) {
        console.log(`    Content preview: ${section.content.substring(0, 100).replace(/\n/g, ' ')}...`);
      }
      console.log('');
    });
    
    console.log(`\n========== 2. 查找Exclusion Criteria主章节前后的section ==========`);
    const exclusionIndex = sectionedText.findIndex(s => 
      s.title && s.title.toLowerCase().includes('exclusion') && 
      s.title.toLowerCase().includes('criteria')
    );
    
    if (exclusionIndex >= 0) {
      console.log(`主章节索引: ${exclusionIndex}\n`);
      
      // 显示主章节
      const mainSection = sectionedText[exclusionIndex];
      console.log(`[主章节] "${mainSection.title}"`);
      console.log(`  Level: ${mainSection.level}, Number: ${mainSection.number || 'N/A'}`);
      if (mainSection.content) {
        console.log(`  Content (前200字符): ${mainSection.content.substring(0, 200).replace(/\n/g, ' ')}...\n`);
      }
      
      // 查找后续可能的子章节（level更高）
      console.log(`查找后续子章节（level > ${mainSection.level}）:`);
      let count = 0;
      for (let i = exclusionIndex + 1; i < Math.min(exclusionIndex + 20, sectionedText.length); i++) {
        const section = sectionedText[i];
        if (section.level <= mainSection.level) {
          console.log(`\n遇到同级或更高级章节，停止: "${section.title}" (level=${section.level})`);
          break;
        }
        count++;
        console.log(`  [+${count}] "${section.title}" (level=${section.level}, number=${section.number || 'N/A'})`);
        if (section.content) {
          console.log(`       Content (前80字符): ${section.content.substring(0, 80).replace(/\n/g, ' ')}...`);
        }
      }
      
      console.log(`\n✅ 找到 ${count} 个子章节`);
    }
    
    console.log(`\n========== 3. 检查存储的criterias数据 ==========`);
    console.log(`criterias keys: ${Object.keys(criterias).join(', ')}`);
    
    if (criterias.exclusion_criteria) {
      console.log(`\nexclusion_criteria: ${criterias.exclusion_criteria.length} 条`);
      criterias.exclusion_criteria.forEach((item, idx) => {
        console.log(`\n[${idx}] Title: "${item.title}"`);
        console.log(`    Level: ${item.level}`);
        console.log(`    Content length: ${item.content?.length || 0}`);
        if (item.content) {
          console.log(`    Content preview: ${item.content.substring(0, 100).replace(/\n/g, ' ')}...`);
        }
      });
    } else {
      console.log('⚠️ exclusion_criteria未提取或为空');
    }
    
    await mongoose.connection.close();
    console.log('\n✅ 完成');
    
  } catch (error) {
    console.error('❌ 错误:', error.message);
    console.error(error.stack);
  }
}

checkCriteriaStructure();
