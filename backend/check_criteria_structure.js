const mongoose = require('mongoose');
require('dotenv').config();

const Study = require('./models/studyModel');

async function checkCriteriaStructure() {
  try {
    await mongoose.connect(process.env.MONGO_URI);
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
      console.log(`    Level: ${section.level}, Number: ${section.number}`);
      console.log(`    Content length: ${section.content?.length || 0} 字符`);
      console.log(`    Content preview: ${section.content?.substring(0, 100)}...`);
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
      console.log(`  Level: ${mainSection.level}, Number: ${mainSection.number}`);
      console.log(`  Content: ${mainSection.content?.substring(0, 200)}...\n`);
      
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
        console.log(`  [+${count}] "${section.title}" (level=${section.level}, number=${section.number})`);
        console.log(`       Content: ${section.content?.substring(0, 80)}...`);
      }
      
      console.log(`\n找到 ${count} 个子章节`);
    }
    
    console.log(`\n========== 3. 检查存储的criterias数据 ==========`);
    if (criterias.exclusion_criteria) {
      console.log(`exclusion_criteria: ${criterias.exclusion_criteria.length} 条`);
      criterias.exclusion_criteria.forEach((item, idx) => {
        console.log(`\n[${idx}] Title: "${item.title}"`);
        console.log(`    Level: ${item.level}`);
        console.log(`    Content length: ${item.content?.length || 0}`);
        console.log(`    Content preview: ${item.content?.substring(0, 100)}...`);
      });
    } else {
      console.log('⚠️ exclusion_criteria未提取或为空');
    }
    
    await mongoose.connection.close();
    
  } catch (error) {
    console.error('❌ 错误:', error);
  }
}

checkCriteriaStructure();
