const Study = require('./models/studyModel');
const mongoose = require('mongoose');

async function checkStudies() {
  try {
    const mongoUri = "mongodb+srv://xixili0818:QWERasdf1234@cluster0.cfd61nz.mongodb.net/?retryWrites=true&w=majority&appName=Cluster0";
    
    await mongoose.connect(mongoUri);
    console.log('✅ MongoDB连接成功\n');
    
    const studies = await Study.find({}).sort({ updatedAt: -1 }).limit(5).lean();
    
    console.log(`📊 找到 ${studies.length} 个studies (最近5个):\n`);
    
    studies.forEach((study, idx) => {
      console.log(`[${idx + 1}] ID: ${study._id}`);
      console.log(`    studyNumber: ${study.studyNumber || 'N/A'}`);
      console.log(`    updatedAt: ${study.updatedAt}`);
      console.log(`    files.protocol存在: ${!!study.files?.protocol}`);
      console.log(`    files.protocol.uploadExtraction存在: ${!!study.files?.protocol?.uploadExtraction}`);
      console.log(`    sectionedText长度: ${study.files?.protocol?.uploadExtraction?.sectionedText?.length || 0}`);
      console.log(`    criterias存在: ${!!study.files?.protocol?.uploadExtraction?.criterias}`);
      console.log('');
    });
    
  } catch (error) {
    console.error('❌ 错误:', error.message);
  } finally {
    await mongoose.disconnect();
  }
}

checkStudies();
