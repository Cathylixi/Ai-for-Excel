const mongoose = require('mongoose');

async function checkDB() {
  try {
    const mongoUri = "mongodb+srv://xixili0818:QWERasdf1234@cluster0.cfd61nz.mongodb.net/?retryWrites=true&w=majority&appName=Cluster0";
    
    await mongoose.connect(mongoUri);
    console.log('✅ MongoDB连接成功');
    
    const dbName = mongoose.connection.db.databaseName;
    console.log(`\n📋 当前数据库: ${dbName}`);
    
    const collections = await mongoose.connection.db.listCollections().toArray();
    console.log(`\n📊 Collections (${collections.length}):`);
    collections.forEach(c => console.log(`   - ${c.name}`));
    
    // 尝试直接查询llxexcel数据库
    const llxexcelDb = mongoose.connection.client.db('llxexcel');
    const llxCollections = await llxexcelDb.listCollections().toArray();
    console.log(`\n📊 llxexcel 数据库 Collections (${llxCollections.length}):`);
    llxCollections.forEach(c => console.log(`   - ${c.name}`));
    
    // 查询studies collection
    const studiesCount = await llxexcelDb.collection('studies').countDocuments();
    console.log(`\n📊 studies collection 总文档数: ${studiesCount}`);
    
    if (studiesCount > 0) {
      const sample = await llxexcelDb.collection('studies').findOne({});
      console.log(`\n📋 示例study:`);
      console.log(`   _id: ${sample._id}`);
      console.log(`   studyNumber: ${sample.studyNumber}`);
      console.log(`   files.protocol存在: ${!!sample.files?.protocol}`);
    }
    
  } catch (error) {
    console.error('❌ 错误:', error.message);
  } finally {
    await mongoose.disconnect();
  }
}

checkDB();
