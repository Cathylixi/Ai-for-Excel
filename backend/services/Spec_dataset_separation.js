/**
 * Spec Dataset Separation Service
 * 功能：将 Overall Spec 按 Dataset 自动拆分为多个独立的 Excel 文件
 * Author: LLX Solutions
 */

const ExcelJS = require('exceljs');
const JSZip = require('jszip');
const fs = require('fs');
const path = require('path');
const os = require('os');
const Study = require('../models/studyModel');

/**
 * Helper: Normalize dataset name
 * - Skip [NOT SUBMITTED] → return null
 * - Convert SUPP** to base domain (e.g., SUPPAE → AE)
 * - Uppercase and trim
 */
function normalizeDatasetName(name) {
  if (!name) return null;
  const trimmed = String(name).trim().toUpperCase();
  if (trimmed === '[NOT SUBMITTED]') return null;
  if (trimmed.startsWith('SUPP')) return trimmed.slice(4); // SUPPAE → AE
  return trimmed;
}

/**
 * Helper: Check if a row belongs to a target dataset
 * Supports both exact match and SUPP prefix match
 * e.g., isRowForDataset({Dataset: 'SUPPAE'}, 'AE') → true
 */
function isRowForDataset(row, targetDataset) {
  if (!row || !row.Dataset) return false;
  const normalized = normalizeDatasetName(row.Dataset);
  return normalized === targetDataset;
}

/**
 * Main function: Generate dataset-specific specs
 * @param {String} studyId - Study ID
 * @returns {Object} { success, studyNumber, totalDatasets, files }
 */
async function generateDatasetSpecificSpecs(studyId) {
  console.log(`🚀 开始为 studyId=${studyId} 生成 dataset-specific specs...`);
  
  // ========== Step 1: 读取 Overall Spec ==========
  const study = await Study.findById(studyId)
    .select('studyNumber Spec.first_version')
    .lean();
  
  if (!study || !study.Spec?.first_version) {
    throw new Error('Overall Spec 不存在');
  }
  
  const overallSpec = study.Spec.first_version;
  const studyNumber = study.studyNumber || 'UNKNOWN';
  
  // ========== Step 2: 提取 unique datasets ==========
  const datasetsContent = overallSpec.Datasets?.table_content || [];
  
  if (datasetsContent.length === 0) {
    throw new Error('Datasets sheet 为空，无法拆分');
  }
  
  // Extract unique dataset names (normalized, skip [NOT SUBMITTED], merge SUPP**)
  const uniqueDatasets = [...new Set(
    datasetsContent
      .map(row => normalizeDatasetName(row.Dataset))
      .filter(d => d !== null)
  )];
  
  console.log(`📊 Found ${uniqueDatasets.length} unique datasets (normalized):`, uniqueDatasets);
  
  // ========== Step 3: 为每个 dataset 生成 Excel 文件（内存中） + SAS 代码 ==========
  const datasetBuffers = [];
  const datasetSummaries = [];
  const datasetSlicesToSave = {};
  const datasetSasFiles = []; // Store SAS files for ZIP
  
  for (const dataset of uniqueDatasets) {
    console.log(`\n🔄 处理 dataset: ${dataset}`);
    
    try {
      // 3.1 过滤数据
      const datasetSpec = filterSpecByDataset(overallSpec, dataset);
      
      // 3.2 Generate Excel file (ExcelJS, in-memory)
      const workbook = new ExcelJS.Workbook();
      
      // Add sheets (conditional logic for TA/TE/TI/TV/TS_Data)
      await addStudySheet(workbook, datasetSpec.Study);
      await addUpdatedTrackerSheet(workbook, datasetSpec.UpdatedTracker);
      await addDatasetsSheet(workbook, datasetSpec.Datasets);
      await addVariablesSheet(workbook, datasetSpec.Variables);
      await addMethodsSheet(workbook, datasetSpec.Methods);
      await addTESTCDDetailsSheet(workbook, datasetSpec.TESTCD_Details);
      await addSUPPDetailsSheet(workbook, datasetSpec.SUPP_Details);
      
      // Conditionally add domain-specific sheets (only for TA/TE/TI/TV/TS)
      const domainSpecificSheets = {
        'TA': () => addTADataSheet(workbook, datasetSpec.TA_Data),
        'TE': () => addTEDataSheet(workbook, datasetSpec.TE_Data),
        'TI': () => addTIDataSheet(workbook, datasetSpec.TI_Data),
        'TV': () => addTVDataSheet(workbook, datasetSpec.TV_Data),
        'TS': () => addTSDataSheet(workbook, datasetSpec.TS_Data)
      };
      
      if (domainSpecificSheets[dataset]) {
        await domainSpecificSheets[dataset]();
        console.log(`  ✅ Added ${dataset}_Data sheet`);
      } else {
        console.log(`  ⚪ Skipped TA/TE/TI/TV/TS_Data sheets (not applicable for ${dataset})`);
      }
      
      // 3.3 Generate Buffer (in-memory)
      const buffer = await workbook.xlsx.writeBuffer();

      const fileName = `${dataset}.xlsx`; // Simple naming: AE.xlsx, TA.xlsx, etc.

      datasetBuffers.push({
        dataset,
        fileName,
        buffer
      });

      datasetSummaries.push({
        dataset,
        fileName,
        size: buffer.length,
        variables: Array.isArray(datasetSpec.Variables) ? datasetSpec.Variables.length : 0,
        testcd: Array.isArray(datasetSpec.TESTCD_Details) ? datasetSpec.TESTCD_Details.length : 0,
        supp: Array.isArray(datasetSpec.SUPP_Details) ? datasetSpec.SUPP_Details.length : 0,
        success: true
      });

      console.log(`✅ ${dataset} Excel 生成成功 (${(buffer.length / 1024).toFixed(2)} KB)`);

      // Save dataset slice data for database storage
      datasetSlicesToSave[dataset] = {
        Study: datasetSpec.Study,
        UpdatedTracker: datasetSpec.UpdatedTracker,
        Methods: datasetSpec.Methods,
        Datasets: datasetSpec.Datasets,
        Variables: datasetSpec.Variables,
        TESTCD_Details: datasetSpec.TESTCD_Details,
        SUPP_Details: datasetSpec.SUPP_Details,
        TA_Data: datasetSpec.TA_Data,
        TE_Data: datasetSpec.TE_Data,
        TI_Data: datasetSpec.TI_Data,
        TV_Data: datasetSpec.TV_Data,
        TS_Data: datasetSpec.TS_Data,
        generated_at: new Date(),
        source: 'auto_generated'
      };
      
    } catch (error) {
      console.error(`❌ ${dataset} generation failed:`, error);
      datasetSummaries.push({
        dataset,
        fileName: `${dataset}.xlsx`,
        error: error.message,
        success: false
      });
    }
  }

  const successfulDatasets = datasetBuffers.length;
  console.log(`\n✅ Excel 生成完成，共生成 ${successfulDatasets}/${uniqueDatasets.length} 个文件`);

  if (successfulDatasets === 0) {
    throw new Error('Dataset-specific Excel 文件全部生成失败，无法创建ZIP');
  }

  // ========== Step 4: 保存 datasetSlices 到数据库 ==========
  console.log('💾 保存 datasetSlices 到数据库...');
  await Study.findByIdAndUpdate(studyId, {
    $set: {
      'Spec.datasetSlices': datasetSlicesToSave
    }
  }, { new: false, lean: false });
  console.log('✅ datasetSlices 已保存到数据库');

  // ========== Step 5: 等待 2 秒 ==========
  console.log('⏳ 等待 2 秒后生成 SAS 代码...');
  await new Promise(resolve => setTimeout(resolve, 2000));

  // ========== Step 6: 生成 SAS 代码（从数据库读取 datasetSlices） ==========
  console.log('🔧 开始生成 SAS 代码...');
  for (const dataset of uniqueDatasets) {
    try {
      if (dataset === 'AE') {
        const { generateAEsas } = require('./spec_sas/aeSasGenerator');
        const sasResult = await generateAEsas(studyId);
        datasetSasFiles.push({
          dataset,
          filename: sasResult.filename,
          content: sasResult.content
        });
        console.log(`✅ ${dataset} SAS 代码生成成功 (${(sasResult.content.length / 1024).toFixed(2)} KB)`);
      }
    } catch (sasError) {
      console.warn(`⚠️ ${dataset} SAS 生成失败（非阻塞）:`, sasError.message);
    }
  }

  // ========== Step 7: 打包为 ZIP (Excel + SAS) ==========
  console.log('📦 开始打包 ZIP (Excel + SAS)...');
  const zip = new JSZip();
  
  // Add Excel files
  datasetBuffers.forEach(item => {
    zip.file(item.fileName, item.buffer);
  });

  // Add SAS files
  datasetSasFiles.forEach(item => {
    zip.file(item.filename, item.content);
  });

  console.log(`📦 打包文件: ${datasetBuffers.length} 个 Excel + ${datasetSasFiles.length} 个 SAS`);
  const zipBuffer = await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE', compressionOptions: { level: 6 } });

  const timestamp = Date.now();
  const zipFileName = `Spec_${studyNumber}_dataset_specs_${timestamp}.zip`;
  const tempDir = path.join(os.tmpdir(), 'llx_spec_dataset_exports');
  await fs.promises.mkdir(tempDir, { recursive: true });
  const zipFullPath = path.join(tempDir, zipFileName);

  // 如果已存在旧的 ZIP，先删除
  const existingZipPath = overallSpec?.datasetSpecsExport?.zipPath;
  if (existingZipPath) {
    try {
      await fs.promises.unlink(existingZipPath);
      console.log('🧹 已删除旧的dataset ZIP:', existingZipPath);
    } catch (unlinkErr) {
      console.warn('⚠️ 删除旧ZIP失败（忽略）:', unlinkErr.message);
    }
  }

  await fs.promises.writeFile(zipFullPath, zipBuffer);
  const zipFileSize = zipBuffer.length;

  const downloadUrl = `/api/studies/${studyId}/dataset-specs.zip`;

  // ========== Step 8: 保存 ZIP 元数据到数据库 ==========
  console.log('💾 保存 ZIP 元数据到数据库...');
  await Study.findByIdAndUpdate(studyId, {
    $set: {
      'Spec.first_version.datasetSpecsExport': {
        zipFileName,
        zipFileSize,
        zipPath: zipFullPath,
        downloadUrl,
        generated_at: new Date(),
        datasets_summary: datasetSummaries
      }
    }
  }, { new: false, lean: false });

  console.log('✅ ZIP 文件已生成:', zipFullPath, `${(zipFileSize / 1024).toFixed(2)} KB`);

  return {
    success: true,
    studyNumber: studyNumber,
    totalDatasets: uniqueDatasets.length,
    datasets: datasetSummaries,
    downloadUrl,
    zipFileName,
    zipFileSize
  };
}

/**
 * 按 dataset 过滤数据
 * @param {Object} overallSpec - Overall Spec 数据
 * @param {String} targetDataset - 目标 dataset
 * @returns {Object} 过滤后的 spec 数据
 */
function filterSpecByDataset(overallSpec, targetDataset) {
  return {
    // 不变的sheets（复制表头和内容）
    Study: {
      table_title: overallSpec.Study?.table_title || [],
      table_content: overallSpec.Study?.table_content || []
    },
    
    UpdatedTracker: {
      table_title: overallSpec.UpdatedTracker?.table_title || [],
      table_content: overallSpec.UpdatedTracker?.table_content || []
    },
    
    Methods: {
      table_title: overallSpec.Methods?.table_title || [],
      table_content: overallSpec.Methods?.table_content || []
    },
    
    TA_Data: {
      table_title: overallSpec.TA_Data?.table_title || [],
      table_content: overallSpec.TA_Data?.table_content || []
    },
    
    TE_Data: {
      table_title: overallSpec.TE_Data?.table_title || [],
      table_content: overallSpec.TE_Data?.table_content || []
    },
    
    TI_Data: {
      table_title: overallSpec.TI_Data?.table_title || [],
      table_content: overallSpec.TI_Data?.table_content || []
    },
    
    TV_Data: {
      table_title: overallSpec.TV_Data?.table_title || [],
      table_content: overallSpec.TV_Data?.table_content || []
    },
    
    TS_Data: {
      table_title: overallSpec.TS_Data?.table_title || [],
      table_content: overallSpec.TS_Data?.table_content || [],
      metadata: overallSpec.TS_Data?.metadata || {}
    },
    
    // Filter by Dataset (supports SUPP** merging, e.g., SUPPAE → AE)
    Datasets: (overallSpec.Datasets?.table_content || [])
      .filter(row => isRowForDataset(row, targetDataset)),
    
    Variables: (overallSpec.Variables?.table_content || [])
      .filter(row => isRowForDataset(row, targetDataset)),
    
    TESTCD_Details: (overallSpec.TESTCD_Details?.table_content || [])
      .filter(row => isRowForDataset(row, targetDataset)),
    
    SUPP_Details: (overallSpec.SUPP_Details?.table_content || [])
      .filter(row => isRowForDataset(row, targetDataset))
  };
}

/**
 * 添加 Study Sheet
 */
async function addStudySheet(workbook, studyData) {
  const sheet = workbook.addWorksheet('Study');
  
  sheet.columns = [
    { width: 30 },
    { width: 50 }
  ];
  
  const headers = studyData.table_title || ['Attribute', 'Value'];
  const headerRow = sheet.addRow(headers);
  headerRow.font = { bold: true, size: 12 };
  headerRow.fill = {
    type: 'pattern',
    pattern: 'solid',
    fgColor: { argb: 'FF90EE90' }
  };
  
  (studyData.table_content || []).forEach(row => {
    sheet.addRow([row.Attribute || '', row.Value || '']);
  });
  
  return sheet;
}

/**
 * 添加 Updated Tracker Sheet
 */
async function addUpdatedTrackerSheet(workbook, trackerData) {
  const sheet = workbook.addWorksheet('Updated Tracker');
  
  const headers = trackerData.table_title || [
    'Changed by (initials)', 
    'Date Specs Updated', 
    'Domain Updated', 
    'Update Description'
  ];
  
  const headerRow = sheet.addRow(headers);
  headerRow.font = { bold: true, size: 12 };
  headerRow.fill = {
    type: 'pattern',
    pattern: 'solid',
    fgColor: { argb: 'FF90EE90' }
  };
  
  (trackerData.table_content || []).forEach(row => {
    sheet.addRow([
      row['Changed by (initials)'] || '',
      row['Date Specs Updated'] || '',
      row['Domain Updated'] || '',
      row['Update Description'] || ''
    ]);
  });
  // 设置列宽（避免依赖 sheet.columns）
  try {
    sheet.getColumn(1).width = 24;
    sheet.getColumn(2).width = 20;
    sheet.getColumn(3).width = 20;
    sheet.getColumn(4).width = 40;
  } catch (_) {}
  
  return sheet;
}

/**
 * 添加 Datasets Sheet
 */
async function addDatasetsSheet(workbook, datasetsData) {
  const sheet = workbook.addWorksheet('Datasets');
  
  const headers = [
    'Dataset', 
    'Description', 
    'Class', 
    'Structure', 
    'Purpose', 
    'Key Variables'
  ];
  
  const headerRow = sheet.addRow(headers);
  headerRow.font = { bold: true, size: 12 };
  headerRow.fill = {
    type: 'pattern',
    pattern: 'solid',
    fgColor: { argb: 'FF90EE90' }
  };
  
  datasetsData.forEach(row => {
    sheet.addRow([
      row.Dataset || '',
      row.Description || '',
      row.Class || '',
      row.Structure || '',
      row.Purpose || '',
      row['Key Variables'] || ''
    ]);
  });
  // 设置列宽
  try {
    for (let i = 1; i <= headers.length; i++) {
      sheet.getColumn(i).width = 25;
    }
  } catch (_) {}
  
  return sheet;
}

/**
 * 添加 Variables Sheet
 */
async function addVariablesSheet(workbook, variablesData) {
  const sheet = workbook.addWorksheet('Variables');
  
  const headers = [
    'Dataset', 'Variable', 'Label', 'Data Type', 
    'Length', 'Format', 'Origin', 'Method Keyword', 
    'Source/Derivation', 'Core'
  ];
  
  const headerRow = sheet.addRow(headers);
  headerRow.font = { bold: true, size: 12 };
  headerRow.fill = {
    type: 'pattern',
    pattern: 'solid',
    fgColor: { argb: 'FF90EE90' }
  };
  
  variablesData.forEach(row => {
    sheet.addRow([
      row.Dataset || '',
      row.Variable || '',
      row.Label || '',
      row['Data Type'] || '',
      row.Length || '',
      row.Format || '',
      row.Origin || '',
      row['Method Keyword'] || '',
      row['Source/Derivation'] || '',
      row.Core || ''
    ]);
  });
  // 设置列宽
  try {
    for (let i = 1; i <= headers.length; i++) {
      sheet.getColumn(i).width = 15;
    }
  } catch (_) {}
  
  return sheet;
}

/**
 * 添加 Methods Sheet
 */
async function addMethodsSheet(workbook, methodsData) {
  const sheet = workbook.addWorksheet('Methods');
  
  const headers = ['Method Keyword', 'Name', 'Description'];
  
  const headerRow = sheet.addRow(headers);
  headerRow.font = { bold: true, size: 12 };
  headerRow.fill = {
    type: 'pattern',
    pattern: 'solid',
    fgColor: { argb: 'FF90EE90' }
  };
  
  (methodsData.table_content || []).forEach(row => {
    sheet.addRow([
      row['Method Keyword'] || '',
      row.Name || '',
      row.Description || ''
    ]);
  });
  // 设置列宽
  try {
    sheet.getColumn(1).width = 20;
    sheet.getColumn(2).width = 20;
    sheet.getColumn(3).width = 50;
  } catch (_) {}
  
  return sheet;
}

/**
 * 添加 TESTCD_Details Sheet
 */
async function addTESTCDDetailsSheet(workbook, testcdData) {
  const sheet = workbook.addWorksheet('TESTCD_Details');
  
  const headers = [
    'Dataset', '--TESTCD Value', '--TEST Value', 
    'Raw Dataset Name or External Source Name', 'Selection Criteria',
    '--CAT Value', '--SCAT Value', '--STAT Source/Derivation', 
    '--REASND Source/Derivation', '--ORRES Source/Derivation',
    '--ORRESU Source/Derivation', '--STRESC Source/Derivation', 
    '--STRESN Source/Derivation', '--STRESU Source/Derivation',
    '--DTC Source/Derivation', '--CLSIG Source/Derivation', 
    '--POS Source/Derivation', '--LAT Source/Derivation',
    '--LOC Source/Derivation', '--DIR Source/Derivation', 
    '--NAM Source/Derivation', '--SPEC Source/Derivation',
    '--OBJ Value', '--METHOD Source/Derivation', 'FOCID', 
    'TSTDTL Source/Derivation', '--EVLINT Source/Derivation',
    '--EVINTX Source/Derivation', '--EVAL Source/Derivation', 
    '--EVALINT Source/Derivation', 'RAW Variable 1', 'RAW Variable 2'
  ];
  
  const headerRow = sheet.addRow(headers);
  headerRow.font = { bold: true, size: 11 };
  headerRow.fill = {
    type: 'pattern',
    pattern: 'solid',
    fgColor: { argb: 'FF90EE90' }
  };
  
  testcdData.forEach(row => {
    sheet.addRow([
      row.Dataset || '',
      row['--TESTCD Value'] || '',
      row['--TEST Value'] || '',
      row['Raw Dataset Name or External Source Name'] || '',
      row['Selection Criteria'] || '',
      row['--CAT Value'] || '',
      row['--SCAT Value'] || '',
      row['--STAT Source/Derivation'] || '',
      row['--REASND Source/Derivation'] || '',
      row['--ORRES Source/Derivation'] || '',
      row['--ORRESU Source/Derivation'] || '',
      row['--STRESC Source/Derivation'] || '',
      row['--STRESN Source/Derivation'] || '',
      row['--STRESU Source/Derivation'] || '',
      row['--DTC Source/Derivation'] || '',
      row['--CLSIG Source/Derivation'] || '',
      row['--POS Source/Derivation'] || '',
      row['--LAT Source/Derivation'] || '',
      row['--LOC Source/Derivation'] || '',
      row['--DIR Source/Derivation'] || '',
      row['--NAM Source/Derivation'] || '',
      row['--SPEC Source/Derivation'] || '',
      row['--OBJ Value'] || '',
      row['--METHOD Source/Derivation'] || '',
      row.FOCID || '',
      row['TSTDTL Source/Derivation'] || '',
      row['--EVLINT Source/Derivation'] || '',
      row['--EVINTX Source/Derivation'] || '',
      row['--EVAL Source/Derivation'] || '',
      row['--EVALINT Source/Derivation'] || '',
      row['RAW Variable 1'] || '',
      row['RAW Variable 2'] || ''
    ]);
  });
  // 设置列宽
  try {
    for (let i = 1; i <= headers.length; i++) {
      sheet.getColumn(i).width = 18;
    }
  } catch (_) {}
  
  return sheet;
}

/**
 * 添加 SUPP_Details Sheet
 */
async function addSUPPDetailsSheet(workbook, suppData) {
  const sheet = workbook.addWorksheet('SUPP_Details');
  
  const headers = [
    'Dataset', 'QNAM', 'QLABEL', 
    'Raw Dataset Name or External Source Name', 
    'Selection Criteria', 'IDVAR', 'IDVARVAL', 
    'QVAL', 'QORIG', 'QEVAL'
  ];
  
  const headerRow = sheet.addRow(headers);
  headerRow.font = { bold: true, size: 12 };
  headerRow.fill = {
    type: 'pattern',
    pattern: 'solid',
    fgColor: { argb: 'FF90EE90' }
  };
  
  suppData.forEach(row => {
    sheet.addRow([
      row.Dataset || '',
      row.QNAM || '',
      row.QLABEL || '',
      row['Raw Dataset Name or External Source Name'] || '',
      row['Selection Criteria'] || '',
      row.IDVAR || '',
      row.IDVARVAL || '',
      row.QVAL || '',
      row.QORIG || '',
      row.QEVAL || ''
    ]);
  });
  // 设置列宽
  try {
    for (let i = 1; i <= headers.length; i++) {
      sheet.getColumn(i).width = 20;
    }
  } catch (_) {}
  
  return sheet;
}

/**
 * 添加 TA_Data Sheet
 */
async function addTADataSheet(workbook, taData) {
  const sheet = workbook.addWorksheet('TA_Data');
  
  const headers = [
    'STUDYID', 'DOMAIN', 'ARMCD', 'ARM', 'TAETORD', 
    'ETCD', 'ELEMENT', 'TABRANCH', 'TATRANS', 'EPOCH'
  ];
  
  const headerRow = sheet.addRow(headers);
  headerRow.font = { bold: true, size: 12 };
  headerRow.fill = {
    type: 'pattern',
    pattern: 'solid',
    fgColor: { argb: 'FF90EE90' }
  };
  
  (taData.table_content || []).forEach(row => {
    sheet.addRow([
      row.STUDYID || '',
      row.DOMAIN || '',
      row.ARMCD || '',
      row.ARM || '',
      row.TAETORD || '',
      row.ETCD || '',
      row.ELEMENT || '',
      row.TABRANCH || '',
      row.TATRANS || '',
      row.EPOCH || ''
    ]);
  });
  // 设置列宽
  try {
    for (let i = 1; i <= headers.length; i++) {
      sheet.getColumn(i).width = 15;
    }
  } catch (_) {}
  
  return sheet;
}

/**
 * 添加 TE_Data Sheet
 */
async function addTEDataSheet(workbook, teData) {
  const sheet = workbook.addWorksheet('TE_Data');
  
  const headers = [
    'STUDYID', 'DOMAIN', 'ETCD', 'ELEMENT', 
    'TESTRL', 'TEENRL', 'TEDUR'
  ];
  
  const headerRow = sheet.addRow(headers);
  headerRow.font = { bold: true, size: 12 };
  headerRow.fill = {
    type: 'pattern',
    pattern: 'solid',
    fgColor: { argb: 'FF90EE90' }
  };
  
  (teData.table_content || []).forEach(row => {
    sheet.addRow([
      row.STUDYID || '',
      row.DOMAIN || '',
      row.ETCD || '',
      row.ELEMENT || '',
      row.TESTRL || '',
      row.TEENRL || '',
      row.TEDUR || ''
    ]);
  });
  // 设置列宽
  try {
    for (let i = 1; i <= headers.length; i++) {
      sheet.getColumn(i).width = 20;
    }
  } catch (_) {}
  
  return sheet;
}

/**
 * 添加 TI_Data Sheet
 */
async function addTIDataSheet(workbook, tiData) {
  const sheet = workbook.addWorksheet('TI_Data');
  
  const headers = [
    'STUDYID', 'DOMAIN', 'IETESTCD', 
    'IETEST', 'IECAT', 'TIVERS'
  ];
  
  const headerRow = sheet.addRow(headers);
  headerRow.font = { bold: true, size: 12 };
  headerRow.fill = {
    type: 'pattern',
    pattern: 'solid',
    fgColor: { argb: 'FF90EE90' }
  };
  
  (tiData.table_content || []).forEach(row => {
    sheet.addRow([
      row.STUDYID || '',
      row.DOMAIN || '',
      row.IETESTCD || '',
      row.IETEST || '',
      row.IECAT || '',
      row.TIVERS || ''
    ]);
  });
  // 设置列宽
  try {
    for (let i = 1; i <= headers.length; i++) {
      sheet.getColumn(i).width = 25;
    }
  } catch (_) {}
  
  return sheet;
}

/**
 * 添加 TV_Data Sheet（留空）
 */
async function addTVDataSheet(workbook, tvData) {
  const sheet = workbook.addWorksheet('TV_Data');
  
  const headers = [
    'STUDYID', 'DOMAIN', 'VISITNUM', 'VISIT', 
    'ARMCD', 'TVSTRL', 'TVENRL'
  ];
  
  const headerRow = sheet.addRow(headers);
  headerRow.font = { bold: true, size: 12 };
  headerRow.fill = {
    type: 'pattern',
    pattern: 'solid',
    fgColor: { argb: 'FF90EE90' }
  };
  
  (tvData.table_content || []).forEach(row => {
    sheet.addRow([
      row.STUDYID || '',
      row.DOMAIN || '',
      row.VISITNUM || '',
      row.VISIT || '',
      row.ARMCD || '',
      row.TVSTRL || '',
      row.TVENRL || ''
    ]);
  });
  // 设置列宽
  try {
    for (let i = 1; i <= headers.length; i++) {
      sheet.getColumn(i).width = 15;
    }
  } catch (_) {}
  
  return sheet;
}

/**
 * 添加 TS_Data Sheet（动态列头）
 */
async function addTSDataSheet(workbook, tsData) {
  const sheet = workbook.addWorksheet('TS_Data');
  
  const maxTSVALColumns = tsData.metadata?.maxTSVALColumns || 1;
  
  const headers = [
    'STUDYID', 'DOMAIN', 'TSSEQ', 'TSGRPID', 
    'TSPARMCD', 'TSPARM', 'TSVAL'
  ];
  
  for (let i = 1; i < maxTSVALColumns; i++) {
    headers.push(`TSVAL${i}`);
  }
  
  headers.push('TSVALNF', 'TSVALCD', 'TSVCDREF', 'TSVCDVER');
  
  const headerRow = sheet.addRow(headers);
  headerRow.font = { bold: true, size: 12 };
  headerRow.fill = {
    type: 'pattern',
    pattern: 'solid',
    fgColor: { argb: 'FF90EE90' }
  };
  
  (tsData.table_content || []).forEach(row => {
    const rowData = [
      row.STUDYID || '',
      row.DOMAIN || '',
      row.TSSEQ || '',
      row.TSGRPID || '',
      row.TSPARMCD || '',
      row.TSPARM || '',
      row.TSVAL || ''
    ];
    
    for (let i = 1; i < maxTSVALColumns; i++) {
      rowData.push(row[`TSVAL${i}`] || '');
    }
    
    rowData.push(
      row.TSVALNF || '',
      row.TSVALCD || '',
      row.TSVCDREF || '',
      row.TSVCDVER || ''
    );
    
    sheet.addRow(rowData);
  });
  // 设置列宽
  try {
    for (let i = 1; i <= headers.length; i++) {
      sheet.getColumn(i).width = 18;
    }
  } catch (_) {}
  
  return sheet;
}

module.exports = {
  generateDatasetSpecificSpecs
};

