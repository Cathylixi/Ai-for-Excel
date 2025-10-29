const mongoose = require('mongoose');

async function checkCriterias() {
  try {
    const mongoUri = "mongodb+srv://xixili0818:QWERasdf1234@cluster0.cfd61nz.mongodb.net/llxexcel?retryWrites=true&w=majority&appName=Cluster0";
    
    await mongoose.connect(mongoUri);
    console.log('✅ MongoDB连接成功\n');
    
    const db = mongoose.connection.db;
    const study = await db.collection('studies').findOne({}, { sort: { updatedAt: -1 } });
    
    if (!study) {
      console.log('❌ 未找到study');
      process.exit(0);
    }
    
    console.log(`📋 Study ID: ${study._id}`);
    console.log(`📋 Study Number: ${study.studyNumber || 'N/A'}\n`);
    
    const extraction = study.files?.protocol?.uploadExtraction || {};
    const criterias = extraction.criterias || {};
    const sectionedText = extraction.sectionedText || [];
    
    console.log(`总章节数 (sectionedText): ${sectionedText.length}`);
    console.log(`Criterias字段: ${Object.keys(criterias).length} 个类型\n`);
    
    console.log('========== Criterias内容 ==========\n');
    
    if (Object.keys(criterias).length === 0) {
      console.log('⚠️ Criterias为空\n');
    } else {
      Object.entries(criterias).forEach(([key, sections]) => {
        console.log(`📌 ${key}: ${sections.length} 个sections`);
        sections.forEach((section, idx) => {
          console.log(`   [${idx + 1}] Number:${section.number || 'N/A'} Title:"${section.title.substring(0, 80)}"`);
        });
        console.log('');
      });
    }
    
    // 查找Exclusion相关的所有sections
    console.log(`========== SectionedText中包含"exclusion"的章节 ==========\n`);
    
    const exclusionSections = sectionedText.filter(s => 
      s.title && s.title.toLowerCase().includes('exclusion')
    );
    
    console.log(`找到${exclusionSections.length}个包含'exclusion'的章节:\n`);
    exclusionSections.forEach((s, idx) => {
      console.log(`[${idx + 1}] Number:${s.number || 'N/A'} Title:"${s.title}" (level ${s.level}, index:${s.sectionIndex})`);
    });
    
    // 查找编号为6.x的所有sections
    console.log(`\n========== 编号为6.x的所有章节 ==========\n`);
    
    const section6x = sectionedText.filter(s => 
      s.number && s.number.startsWith('6.')
    ).sort((a, b) => {
      const aParts = a.number.split('.').map(n => parseInt(n));
      const bParts = b.number.split('.').map(n => parseInt(n));
      for (let i = 0; i < Math.max(aParts.length, bParts.length); i++) {
        const aVal = aParts[i] || 0;
        const bVal = bParts[i] || 0;
        if (aVal !== bVal) return aVal - bVal;
      }
      return 0;
    });
    
    console.log(`找到${section6x.length}个编号6.x的章节:\n`);
    section6x.forEach((s) => {
      console.log(`[${s.number}] "${s.title.substring(0, 80)}" (level ${s.level})`);
    });
    
  } catch (error) {
    console.error('❌ 错误:', error.message);
    console.error(error.stack);
  } finally {
    await mongoose.disconnect();
  }
}

checkCriterias();
