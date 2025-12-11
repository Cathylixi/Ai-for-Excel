/**
 * Internal Spec Generation Service
 * Exports SDTMIG v3.4 Variables data from MongoDB References database
 * Enriched with CRF Mapping data from current Study
 */

const mongoose = require('mongoose');
const XLSX = require('xlsx');
const path = require('path');
const fs = require('fs');

/**
 * Fetch SDTMIG v3.4 Variables sheet from References database
 * @returns {Promise<Object>} Variables sheet document
 */
async function fetchSDTMIGVariables() {
  const referencesDb = mongoose.connection.client.db('References');
  const collection = referencesDb.collection('SDTMIG_v3.4');
  
  // Only retrieve the Variables sheet (contains the actual variable definitions)
  const variablesDoc = await collection.findOne({ sheet_name: 'Variables' });
  
  return variablesDoc;
}

/**
 * Fetch CRF Mapping data from current Study (llxexcel database)
 * @param {string} studyId - Study ID
 * @returns {Promise<Array>} Array of mapping objects
 */
async function fetchCrfMappingData(studyId) {
  // Connect to llxexcel database (default database)
  const studiesDb = mongoose.connection.client.db('llxexcel');
  const studiesCollection = studiesDb.collection('studies');
  
  // Query current Study - only fetch the crfFormList field
  const study = await studiesCollection.findOne(
    { _id: new mongoose.Types.ObjectId(studyId) },
    { projection: { 'files.crf.crfUploadResult.crfFormList': 1 } }
  );
  
  const crfFormList = study?.files?.crf?.crfUploadResult?.crfFormList || {};
  const formKeys = Object.keys(crfFormList);
  
  // Extract and flatten all Mapping_corrected_CRF_Annotation_Checklist entries
  const allMappings = [];
  
  formKeys.forEach(formKey => {
    const form = crfFormList[formKey];
    const mappings = form?.Mapping_corrected_CRF_Annotation_Checklist || [];
    
    mappings.forEach(item => {
      // Only process items with valid abbreviation and variable
      if (item.Form_Mapping_Abbreviation && item.Question_Variable) {
        allMappings.push({
          dataset: item.Form_Mapping_Abbreviation,  // "AE" or "SUPPAE"
          variable: item.Question_Variable,          // "AETERM"
          form: item.Form_Name || '',                // "Adverse Events"
          type: item.type || '',                     // "Char"
          value: item.value || '',                   // "Severe|Moderate|Mild"
          question: item.Question || ''              // "Site Number"
        });
      }
    });
  });
  
  return allMappings;
}

/**
 * Enrich Variables data with CRF Mapping information
 * Fills Form/Type/Value columns based on Dataset+Variable matching
 * @param {Array} variablesData - Array of variable objects from SDTMIG
 * @param {Array} crfMappings - Array of CRF mapping objects
 * @returns {Array} Enriched variables data (modified in-place)
 */
function enrichVariablesWithCrfMapping(variablesData, crfMappings) {
  
  // Step 1: Build index for fast lookup - Map<"DATASET_VARIABLE", rowIndex>
  const variablesMap = new Map();
  variablesData.forEach((row, index) => {
    const dataset = (row['Dataset Name'] || '').toUpperCase().trim();
    const variable = (row['Variable Name'] || '').toUpperCase().trim();
    const key = `${dataset}_${variable}`;
    variablesMap.set(key, index);
  });
  
  // Step 2: Group mappings by Form for logging
  const mappingsByForm = {};
  crfMappings.forEach(mapping => {
    const formName = mapping.form || 'Unknown Form';
    if (!mappingsByForm[formName]) {
      mappingsByForm[formName] = [];
    }
    mappingsByForm[formName].push(mapping);
  });

  // Step 3: Iterate through Forms and Questions, log and fill
  Object.keys(mappingsByForm).forEach(formName => {
    console.log(`Start accessing form: ${formName}`);
    
    const formQuestions = mappingsByForm[formName];
    
    formQuestions.forEach((mapping, index) => {
      let dataset = (mapping.dataset || '').toUpperCase().trim();
      const variable = (mapping.variable || '').toUpperCase().trim();
      const type = mapping.type || 'N/A';
      // Truncate value for display if too long
      let valueDisplay = mapping.value || 'N/A';
      if (valueDisplay.length > 50) valueDisplay = valueDisplay.substring(0, 47) + '...';
      
      // Handle SUPPxx -> xx conversion (e.g., "SUPPAE" -> "AE")
      if (dataset.startsWith('SUPP') && dataset.length > 4) {
        dataset = dataset.substring(4); // Remove "SUPP" prefix
      }
      
      // Skip [Not Submitted] entries
      if (dataset === '[NOT SUBMITTED]' || !dataset || !variable) {
        console.log(`Question ${index + 1}: Type=${type}, Value=${valueDisplay}, Mapping=NO (Skipped [NOT SUBMITTED])`);
        return;
      }
      
      const key = `${dataset}_${variable}`;
      const rowIndex = variablesMap.get(key);
      
      if (rowIndex !== undefined) {
        // Found matching row - fill the first empty slot
        const targetRow = variablesData[rowIndex];
        
        let filledSlot = null;
        
        for (let i = 1; i <= 10; i++) {
          const formNameKey = `Form ${i} Name`;
          const formQuestionKey = `Form ${i} Question`;
          const formVariableKey = `Form ${i} Variable`;
          const formTypeKey = `Form ${i} Type`;
          const formValueKey = `Form ${i} Value`;
          
          // Check if slot is empty (undefined, null, or empty string) - check Name key as indicator
          if (!targetRow[formNameKey]) {
            targetRow[formNameKey] = mapping.form;
            targetRow[formQuestionKey] = mapping.question;
            targetRow[formVariableKey] = mapping.variable;
            targetRow[formTypeKey] = mapping.type;
            targetRow[formValueKey] = mapping.value;
            filledSlot = i;
            break; // Move to next mapping after filling one slot
          }
        }
        
        if (filledSlot) {
          console.log(`Question ${index + 1}: Type=${type}, Value=${valueDisplay}, Mapping=YES (${dataset}.${variable})`);
        } else {
          console.log(`Question ${index + 1}: Type=${type}, Value=${valueDisplay}, Mapping=NO (Slots Full)`);
        }
        
      } else {
        console.log(`Question ${index + 1}: Type=${type}, Value=${valueDisplay}, Mapping=NO (${dataset}.${variable} not found in SDTMIG)`);
      }
    });
  });
  
  return variablesData;
}

/**
 * Generate additional columns: Form 1 Name, Form 1 Question, Form 1 Variable, Form 1 Type, Form 1 Value ...
 * @returns {Array<string>} Array of 50 column headers
 */
function generateFormTypeValueHeaders() {
  const headers = [];
  for (let i = 1; i <= 10; i++) {
    headers.push(
      `Form ${i} Name`,
      `Form ${i} Question`,
      `Form ${i} Variable`,
      `Form ${i} Type`,
      `Form ${i} Value`
    );
  }
  return headers;
}

/**
 * Convert Variables data to 2D array format for Excel
 * Reads both original columns and Form/Type/Value columns from data objects
 * @param {Object} variablesDoc - MongoDB document containing Variables data
 * @returns {Array<Array>} 2D array with header row and data rows
 */
function variablesToAOA(variablesDoc) {
  const { columns, data } = variablesDoc;
  
  // Generate additional Form/Type/Value column headers
  const additionalHeaders = generateFormTypeValueHeaders();
  
  // First row is the header (original columns + additional columns)
  const fullHeaders = [...columns, ...additionalHeaders];
  const aoa = [fullHeaders];
  
  // Convert each data object to array following column order
  for (const row of data) {
    // Original columns
    const rowArray = columns.map(col => {
      const value = row[col];
      return value !== null && value !== undefined ? value : '';
    });
    
    // Additional Form/Type/Value columns - read actual values from row object
    additionalHeaders.forEach(header => {
      const value = row[header];
      rowArray.push(value !== null && value !== undefined ? value : '');
    });
    
    aoa.push(rowArray);
  }
  
  return aoa;
}

/**
 * Generate Internal Spec Excel file from database
 * Enriched with CRF Mapping data from current Study
 * @param {string} studyId - Study ID
 * @returns {Promise<string>} Path to generated Excel file
 */
async function generateInternalSpecExcel(studyId) {
  // Step 1: Fetch SDTMIG Variables (base skeleton)
  const variablesDoc = await fetchSDTMIGVariables();
  
  // Step 2: Fetch CRF Mapping data from current Study
  const crfMappingData = await fetchCrfMappingData(studyId);
  
  // Step 3: Enrich Variables with CRF Mapping (in-place modification)
  if (crfMappingData.length > 0) {
    enrichVariablesWithCrfMapping(variablesDoc.data, crfMappingData);
  }
  
  // Step 4: Convert to Excel format
  const aoa = variablesToAOA(variablesDoc);
  
  // Step 5: Create workbook and worksheet
  const workbook = XLSX.utils.book_new();
  const worksheet = XLSX.utils.aoa_to_sheet(aoa);
  
  // Set column widths for better readability
  const additionalHeaders = generateFormTypeValueHeaders();
  const allColumns = [...variablesDoc.columns, ...additionalHeaders];
  const colWidths = allColumns.map(col => ({ 
    wch: Math.max(String(col).length, 15) 
  }));
  worksheet['!cols'] = colWidths;
  
  // Add worksheet to workbook
  XLSX.utils.book_append_sheet(workbook, worksheet, 'Variables');
  
  // Step 6: Write to file
  const timestamp = Date.now();
  const filename = `Internal_Spec_SDTMIG_v3.4_${timestamp}.xlsx`;
  const tempDir = path.join(__dirname, '..', 'temp');
  const filePath = path.join(tempDir, filename);
  
  // Ensure temp directory exists
  fs.mkdirSync(tempDir, { recursive: true });
  
  // Write workbook to file
  XLSX.writeFile(workbook, filePath);
  
  return filePath;
}

/**
 * Get relative download URL from file path
 * @param {string} filePath - Absolute file path
 * @returns {string} Relative URL path for download
 */
function getDownloadUrl(filePath) {
  const filename = path.basename(filePath);
  return `/api/download-internal-spec/${filename}`;
}

module.exports = {
  generateInternalSpecExcel,
  getDownloadUrl,
  fetchSDTMIGVariables,
  fetchCrfMappingData,
  enrichVariablesWithCrfMapping
};
