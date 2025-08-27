#!/usr/bin/env node

const fs = require('fs');
const FormData = require('form-data');
const fetch = require('node-fetch');

const API_BASE_URL = 'https://localhost:4000';

async function testUploadEndpoints() {
  console.log('🧪 Testing CRF/SAP upload endpoints...\n');
  
  // 创建一个测试PDF文件
  const testPdfContent = Buffer.from('%PDF-1.4\n%EOF\nTest CRF content for parsing test.');
  
  try {
    // 1. 首先获取一个现有的Study ID
    console.log('1. 获取现有Studies...');
    let studies;
    try {
      const studiesResponse = await fetch(`${API_BASE_URL}/api/studies/test-study/documents`, {
        method: 'GET',
        headers: { 'Content-Type': 'application/json' }
      });
      const studiesData = await studiesResponse.json();
      console.log('✅ Studies API response:', JSON.stringify(studiesData, null, 2));
      
      if (studiesData.success && studiesData.data && studiesData.data.studyId) {
        const studyId = studiesData.data.studyId;
        console.log(`📋 使用Study ID: ${studyId}\n`);
        
        // 2. 测试CRF上传端点
        console.log('2. 测试CRF上传端点...');
        const crfForm = new FormData();
        crfForm.append('file', testPdfContent, {
          filename: 'test-crf.pdf',
          contentType: 'application/pdf'
        });
        
        const crfResponse = await fetch(`${API_BASE_URL}/api/studies/${studyId}/upload-crf`, {
          method: 'POST',
          body: crfForm
        });
        const crfData = await crfResponse.json();
        console.log('CRF 上传结果:', JSON.stringify(crfData, null, 2));
        
        // 3. 测试SAP上传端点
        console.log('\n3. 测试SAP上传端点...');
        const sapForm = new FormData();
        sapForm.append('file', testPdfContent, {
          filename: 'test-sap.pdf',
          contentType: 'application/pdf'
        });
        
        const sapResponse = await fetch(`${API_BASE_URL}/api/studies/${studyId}/upload-sap`, {
          method: 'POST',
          body: sapForm
        });
        const sapData = await sapResponse.json();
        console.log('SAP 上传结果:', JSON.stringify(sapData, null, 2));
        
        // 4. 检查数据库中的实际存储
        console.log('\n4. 检查数据库存储结果...');
        const checkResponse = await fetch(`${API_BASE_URL}/api/studies/${studyId}/documents`);
        const checkData = await checkResponse.json();
        console.log('数据库检查结果:', JSON.stringify(checkData, null, 2));
        
      } else {
        console.log('❌ 无法获取有效的Study ID');
      }
    } catch (e) {
      console.log('⚠️ Studies API调用失败，使用默认测试:', e.message);
    }
    
  } catch (error) {
    console.error('❌ 测试失败:', error.message);
    if (error.code === 'CERT_HAS_EXPIRED' || error.code === 'UNABLE_TO_VERIFY_LEAF_SIGNATURE') {
      console.log('💡 证书问题，可能需要添加process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0"');
    }
  }
}

// 忽略自签名证书错误（开发环境）
process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";

testUploadEndpoints().catch(console.error);
