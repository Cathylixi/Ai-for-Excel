const { MongoClient } = require('mongodb');
require('dotenv').config();

async function checkTPHASE() {
  const client = new MongoClient(process.env.MONGO_URI);
  
  try {
    await client.connect();
    const db = client.db('References');
    
    console.log('\n========== 1. 查找TPHASE相关的codelist ==========');
    const tphaseDoc = await db.collection('sdtm_terminology').findOne({
      'File_Function': 'CDISC',
      'codelist.name': /phase/i
    });
    
    if (tphaseDoc) {
      console.log('✅ 找到Phase相关codelist:');
      console.log('  - codelist.code:', tphaseDoc.codelist.code);
      console.log('  - codelist.name:', tphaseDoc.codelist.name);
      console.log('  - codelist.codelist_code:', tphaseDoc.codelist.codelist_code);
      console.log('  - Items数量:', tphaseDoc.items ? tphaseDoc.items.length : 0);
      
      if (tphaseDoc.items && tphaseDoc.items.length > 0) {
        console.log('\n前5个items:');
        tphaseDoc.items.slice(0, 5).forEach(item => {
          console.log(`    - ${item.submission_value} (code: ${item.code})`);
        });
      }
    } else {
      console.log('❌ 未找到Phase相关codelist');
    }
    
    console.log('\n========== 2. 精确查找 "Trial Phase Classification" ==========');
    const exactDoc = await db.collection('sdtm_terminology').findOne({
      'File_Function': 'CDISC',
      'codelist.name': 'Trial Phase Classification'
    });
    
    if (exactDoc) {
      console.log('✅ 找到 "Trial Phase Classification"');
      console.log('  - codelist.code:', exactDoc.codelist.code);
    } else {
      console.log('❌ 未找到 "Trial Phase Classification"');
    }
    
    console.log('\n========== 3. 查找所有包含Phase的codelist名称 ==========');
    const allPhase = await db.collection('sdtm_terminology').find({
      'File_Function': 'CDISC',
      'codelist.name': /phase/i
    }).project({ 'codelist.name': 1, 'codelist.code': 1 }).toArray();
    
    console.log(`找到 ${allPhase.length} 个包含"Phase"的codelist:`);
    allPhase.forEach(doc => {
      console.log(`  - ${doc.codelist.name} (${doc.codelist.code})`);
    });
    
    console.log('\n========== 4. 查找codelist_code包含TPHASE的 ==========');
    const byCode = await db.collection('sdtm_terminology').findOne({
      'File_Function': 'CDISC',
      'codelist.codelist_code': /TPHASE/i
    });
    
    if (byCode) {
      console.log('✅ 通过codelist_code找到:');
      console.log('  - codelist.name:', byCode.codelist.name);
      console.log('  - codelist.code:', byCode.codelist.code);
      console.log('  - codelist.codelist_code:', byCode.codelist.codelist_code);
    } else {
      console.log('❌ 未找到codelist_code包含TPHASE的');
    }
    
  } catch (error) {
    console.error('❌ 错误:', error.message);
  } finally {
    await client.close();
  }
}

checkTPHASE();
