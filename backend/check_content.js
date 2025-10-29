const mongoose = require('mongoose');

async function checkContent() {
  try {
    const mongoUri = "mongodb+srv://xixili0818:QWERasdf1234@cluster0.cfd61nz.mongodb.net/llxexcel?retryWrites=true&w=majority&appName=Cluster0";
    
    await mongoose.connect(mongoUri);
    console.log('✅ MongoDB连接成功\n');
    
    const db = mongoose.connection.db;
    const study = await db.collection('studies').findOne({});
    
    const criterias = study.files?.protocol?.uploadExtraction?.criterias || {};
    
    console.log('========== Exclusion Criteria的Content内容 ==========\n');
    
    if (criterias.exclusion_criteria && criterias.exclusion_criteria.length > 0) {
      const section = criterias.exclusion_criteria[0];
      console.log(`标题: "${section.title}"`);
      console.log(`编号: ${section.number}`);
      console.log(`Level: ${section.level}`);
      console.log(`Content长度: ${section.content?.length || 0} 字符\n`);
      console.log(`Content内容:\n`);
      console.log(section.content);
      console.log('\n========================================\n');
      
      // 统计content中的编号列表
      const lines = (section.content || '').split('\n');
      console.log(`Content总行数: ${lines.length}\n`);
      
      // 查找编号模式
      const numberedLines = lines.filter(line => /^\s*\d+[\.\)]\s+/.test(line));
      console.log(`包含编号的行数: ${numberedLines.length}\n`);
      
      if (numberedLines.length > 0) {
        console.log('前15个编号行:');
        numberedLines.slice(0, 15).forEach(line => {
          console.log(`  ${line.trim().substring(0, 100)}`);
        });
      }
    } else {
      console.log('⚠️ 未找到exclusion_criteria\n');
    }
    
    console.log('\n========== Inclusion Criteria的Content内容 ==========\n');
    
    if (criterias.inclusion_criteria && criterias.inclusion_criteria.length > 0) {
      const section = criterias.inclusion_criteria[0];
      console.log(`标题: "${section.title}"`);
      console.log(`编号: ${section.number}`);
      console.log(`Level: ${section.level}`);
      console.log(`Content长度: ${section.content?.length || 0} 字符\n`);
      
      // 统计编号列表
      const lines = (section.content || '').split('\n');
      const numberedLines = lines.filter(line => /^\s*\d+[\.\)]\s+/.test(line));
      console.log(`包含编号的行数: ${numberedLines.length}\n`);
      
      if (numberedLines.length > 0) {
        console.log('所有编号行:');
        numberedLines.forEach(line => {
          console.log(`  ${line.trim().substring(0, 100)}`);
        });
      }
    }
    
  } catch (error) {
    console.error('❌ 错误:', error.message);
  } finally {
    await mongoose.disconnect();
  }
}

checkContent();
