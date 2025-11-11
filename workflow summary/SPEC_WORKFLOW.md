# Complete Spec Workflow

**Date:** 2025-11-11  
**Purpose:** Detailed explanation of the complete workflow from Protocol upload to ZIP download

---

## 📊 Workflow Overview

```
1. Upload Protocol PDF
   ↓
2. Upload CRF PDF
   ↓
3. Generate Spec (12 tables)
   ↓
4. Generate Dataset-Specific Specs
   ↓
5. Download ZIP (includes Excel + SAS)
```

---

## 1️⃣ Upload Protocol PDF

### **Frontend Operation**
- Page: Upload Documents
- Action: Select Protocol PDF → Click "Upload Clinical Protocol"

### **Backend Processing**
1. **PDF Parsing** (`services/pdf_processor.py`)
   - Extract text (pdfplumber)
   - Extract tables
   - Extract section structure

2. **Study Number Identification** (`services/openaiService.js`)
   - AI identifies Study Number
   - Extract Study Design
   - Extract Objectives
   - Extract Inclusion/Exclusion Criteria

3. **Save to Database**
   ```javascript
   {
     studyNumber: "SPI-611",
     files.protocol: {
       fileName: "m5-3-5-1-spi-611-protocol-amend-6.pdf",
       filePath: "/uploads/...",
       parsedContent: { ... }
     }
   }
   ```

---

## 2️⃣ Upload CRF PDF

### **Frontend Operation**
- Page: Upload Documents
- Action: Select CRF PDF → Click "Upload CRF"

### **Backend Processing**
1. **CRF Word Position Extraction** (`services/crf_analysis/crf_words_extractor.py`)
   - Extract coordinates of all words on each page

2. **Form Recognition** (`services/crf_analysis/crf_form_processor.js`)
   - Identify Form titles
   - Identify question numbers and text

3. **Save to Database**
   ```javascript
   {
     files.crf: {
       fileName: "crf.pdf",
       words_data: [{ page, words: [...] }],
       form_list: [{ form_name, page, questions: [...] }]
     }
   }
   ```

---

## 3️⃣ Generate Spec (12 Tables)

### **Frontend Operation**
- Page: Spec
- Action: Click "Generate" button for each table

### **Backend Processing (in order)**

#### **3.1 Study Table**
- Source: Protocol metadata
- Fields: Attribute, Value
- Storage Location: `Spec.first_version.Study`

#### **3.2 Datasets Table**
- Source: SDTMIG Reference + CRF Form Mapping
- Fields: Dataset, Description, Class, Structure, Purpose, Key Variables
- Storage Location: `Spec.first_version.Datasets`

#### **3.3 Variables Table**
- Source: SDTMIG Variables + CRF Variable Mapping
- Fields: Dataset, Variable, Label, Data Type, Length, Format, Origin, Method Keyword, Source/Derivation, Core
- Storage Location: `Spec.first_version.Variables`

#### **3.4 TESTCD_Details Table**
- Source: CRF Form data + SDTMIG standards
- Fields: 32 fields (TESTCD, TEST, CAT, SCAT, etc.)
- Storage Location: `Spec.first_version.TESTCD_Details`

#### **3.5 SUPP_Details Table**
- Source: SUPP variable identification from CRF
- Fields: Dataset, QNAM, QLABEL, Raw Dataset Name, Selection Criteria, IDVAR, IDVARVAL, QVAL, QORIG, QEVAL
- Storage Location: `Spec.first_version.SUPP_Details`

#### **3.6 TA_Data Table**
- Source: Protocol Study Design
- Fields: STUDYID, DOMAIN, ARMCD, ARM, TAETORD, ETCD, ELEMENT, TABRANCH, TATRANS, EPOCH
- Storage Location: `Spec.first_version.TA_Data`

#### **3.7 TE_Data Table**
- Source: Protocol Study Design + TA_Data
- Fields: STUDYID, DOMAIN, ETCD, ELEMENT, TESTRL, TEENRL, TEDUR
- Storage Location: `Spec.first_version.TE_Data`

#### **3.8 TI_Data Table**
- Source: Protocol Inclusion/Exclusion Criteria
- Fields: STUDYID, DOMAIN, IETESTCD, IETEST, IECAT, TIVERS
- Storage Location: `Spec.first_version.TI_Data`

#### **3.9 TV_Data Table**
- Source: Protocol Assessment Schedule
- Fields: STUDYID, DOMAIN, VISITNUM, VISIT, VISITDY, ARMCD, ARM, TVSTRL, TVENRL
- Storage Location: `Spec.first_version.TV_Data`

#### **3.10 TS_Data Table (AI Streaming Generation)**
- Source: Protocol full text + References.TS reference table
- Fields: STUDYID, DOMAIN, TSSEQ, TSGRPID, TSPARMCD, TSPARM, TSVAL, TSVALNF, TSVALCD, TSVCDREF, TSVCDVER
- Storage Location: `Spec.first_version.TS_Data`
- Feature: Uses OpenAI GPT-4 streaming generation with real-time progress updates

#### **3.11 Methods Table**
- Source: Manual input or extracted from other tables
- Fields: Method Keyword, Name, Description
- Storage Location: `Spec.first_version.Methods`

#### **3.12 Updated Tracker Table**
- Source: Manual input
- Fields: Changed by (initials), Date Specs Updated, Domain Updated, Update Description
- Storage Location: `Spec.first_version.UpdatedTracker`

---

## 4️⃣ Generate Dataset-Specific Specs

### **Frontend Operation**
- Page: Spec
- Action: Click "Generate Dataset-Specific Specs"

### **Backend Processing Flow** (`services/Spec_dataset_separation.js`)

#### **Step 1: Read Overall Spec**
```javascript
const overallSpec = study.Spec.first_version;
```

#### **Step 2: Extract Unique Dataset List**
```javascript
const uniqueDatasets = [...new Set(
  overallSpec.Datasets.table_content
    .map(d => normalizeDatasetName(d.Dataset))
    .filter(d => d !== null)
)];
// Example: ['AE', 'DM', 'VS', 'LB', ...]
```

#### **Step 3: Generate Excel File for Each Dataset (Loop)**

For each dataset (e.g., AE):

**3.1 Filter Data**
```javascript
const datasetSpec = filterSpecByDataset(overallSpec, 'AE');
// Result: Contains only Dataset='AE' or 'SUPPAE' data
```

**3.2 Generate Excel File (ExcelJS, in-memory)**
```javascript
const workbook = new ExcelJS.Workbook();

// Add sheets
addStudySheet(workbook, datasetSpec.Study);
addUpdatedTrackerSheet(workbook, datasetSpec.UpdatedTracker);
addDatasetsSheet(workbook, datasetSpec.Datasets);     // Only AE and SUPPAE rows
addVariablesSheet(workbook, datasetSpec.Variables);   // Only AE and SUPPAE variables
addMethodsSheet(workbook, datasetSpec.Methods);
addTESTCDDetailsSheet(workbook, datasetSpec.TESTCD_Details); // Only AE rows
addSUPPDetailsSheet(workbook, datasetSpec.SUPP_Details);     // Only SUPPAE rows

// Add domain-specific sheets if TA/TE/TI/TV/TS
if (dataset === 'TA') addTADataSheet(workbook, datasetSpec.TA_Data);
if (dataset === 'TE') addTEDataSheet(workbook, datasetSpec.TE_Data);
// ... others

// Generate Buffer
const buffer = await workbook.xlsx.writeBuffer();
```

**3.3 Save Buffer and Metadata**
```javascript
datasetBuffers.push({
  dataset: 'AE',
  fileName: 'AE.xlsx',
  buffer: buffer
});

datasetSlicesToSave['AE'] = {
  Study: datasetSpec.Study,
  Variables: datasetSpec.Variables,
  SUPP_Details: datasetSpec.SUPP_Details,
  // ... other data
  generated_at: new Date()
};
```

**After Loop Completion**:
- `datasetBuffers`: [{ dataset: 'AE', fileName: 'AE.xlsx', buffer: Buffer }, ...]
- `datasetSlicesToSave`: { AE: {...}, DM: {...}, VS: {...}, ... }

#### **Step 4: Save datasetSlices to Database**
```javascript
await Study.findByIdAndUpdate(studyId, {
  $set: {
    'Spec.datasetSlices': datasetSlicesToSave
  }
});
```

**Database Structure**:
```javascript
{
  Spec: {
    first_version: { ... },  // Overall Spec (all datasets)
    datasetSlices: {         // Dataset-specific Spec (split by dataset)
      AE: {
        Study: {...},
        Variables: [...],    // Only AE and SUPPAE variables
        SUPP_Details: [...], // Only SUPPAE rows
        generated_at: Date
      },
      DM: { ... },
      VS: { ... }
    }
  }
}
```

#### **Step 5: Wait 2 Seconds**
```javascript
await new Promise(resolve => setTimeout(resolve, 2000));
```

**Purpose**:
- Ensure database write completion
- Avoid concurrent read/write conflicts

#### **Step 6: Generate SAS Code (Read from Database)**

**6.1 AE.sas Generation** (`services/spec_sas/aeSasGenerator.js`)

```javascript
// Read saved datasetSlices from database
const study = await Study.findById(studyId)
  .select('studyNumber Spec.datasetSlices.AE')
  .lean();

const aeSlice = study.Spec.datasetSlices.AE;
const variables = aeSlice.Variables;         // AE + SUPPAE variables
const suppDetails = aeSlice.SUPP_Details;   // SUPPAE details
```

**6.2 Generate metadata.attrib Data Lines**
```javascript
const metadataLines = variables.map(v => {
  const include = (v.Core === 'Req' || v.Core === 'Perm' || v.Origin) ? 'X' : '';
  const isSupp = suppDetails.some(s => s.QNAM === v.Variable) ? 'Y' : 'N';
  
  return `AE|${v.Variable}|${v.Label}|${v['Data Type']}|${v.Length}|${include}|${isSupp}`;
});
```

**6.3 Generate Complete SAS Code**
```javascript
const sasCode = `
/******************************************************************************
 * Program: AE.sas
 * Project: ${studyNumber}
 * Date: ${new Date().toLocaleDateString()}
 ******************************************************************************/

%include "Global_Setup.sas";

/* Create metadata.attrib table */
data metadata.attrib;
    length DATASET $8 VARIABLE_NAME $32 LABEL $200 DATA_TYPE $8 LENGTH $8 INCLUDE $1 IS_SUPP $1;
    infile datalines delimiter='|' missover dsd;
    input DATASET $ VARIABLE_NAME $ LABEL $ DATA_TYPE $ LENGTH $ INCLUDE $ IS_SUPP $;
    datalines;
${metadataLines.join('\n')}
;
run;

/* Import AE data */
proc import datafile="<UPDATE_PATH>" out=work.ae_raw dbms=xlsx replace;
    sheet="AE";
    getnames=yes;
run;

/* Generate keep list */
proc sql noprint;
    select cats(VARIABLE_NAME)
    into :KEEPLIST separated by ' '
    from metadata.attrib
    where DATASET='AE' and INCLUDE='X' and IS_SUPP^='Y';
quit;

/* Create final dataset */
data sdtm.AE;
    set work.ae_raw;
    keep &KEEPLIST;
run;

/* Apply attributes and handle SUPP */
%mattrib4(
    indsn=sdtm.AE,
    outdsn=sdtm.AE,
    suppqual=${suppDetails.length > 0 ? 'SUPPAE' : ''},
    idvar=${suppDetails.length > 0 ? suppDetails[0].IDVAR || 'AESEQ' : ''}
);
`;

return {
  filename: 'AE.sas',
  content: sasCode
};
```

**6.4 Save to Memory**
```javascript
datasetSasFiles.push({
  dataset: 'AE',
  filename: 'AE.sas',
  content: sasCode
});
```

#### **Step 7: Package as ZIP**
```javascript
const zip = new JSZip();

// Add all Excel files
datasetBuffers.forEach(item => {
  zip.file(item.fileName, item.buffer);
});
// → AE.xlsx, DM.xlsx, VS.xlsx, ...

// Add all SAS files
datasetSasFiles.forEach(item => {
  zip.file(item.filename, item.content);
});
// → AE.sas

// Generate ZIP Buffer
const zipBuffer = await zip.generateAsync({
  type: 'nodebuffer',
  compression: 'DEFLATE',
  compressionOptions: { level: 6 }
});
```

#### **Step 8: Save ZIP to Temp Directory**
```javascript
const zipFileName = `Spec_${studyNumber}_dataset_specs_${timestamp}.zip`;
const tempDir = path.join(os.tmpdir(), 'llx_spec_dataset_exports');
const zipFullPath = path.join(tempDir, zipFileName);

await fs.promises.writeFile(zipFullPath, zipBuffer);
```

#### **Step 9: Save ZIP Metadata to Database**
```javascript
await Study.findByIdAndUpdate(studyId, {
  $set: {
    'Spec.first_version.datasetSpecsExport': {
      zipFileName,
      zipFileSize,
      zipPath: zipFullPath,
      downloadUrl: `/api/studies/${studyId}/dataset-specs.zip`,
      generated_at: new Date(),
      datasets_summary: [
        { dataset: 'AE', fileName: 'AE.xlsx', size: 123456, success: true },
        { dataset: 'DM', fileName: 'DM.xlsx', size: 234567, success: true },
        // ...
      ]
    }
  }
});
```

---

## 5️⃣ Download ZIP

### **Frontend Operation**
- Page: Spec
- Action: Click "Download ZIP" button

### **Backend Processing** (`controllers/SpecDocumentController.js`)

#### **5.1 Find ZIP Path**
```javascript
const study = await Study.findById(studyId)
  .select('Spec.first_version.datasetSpecsExport')
  .lean();

const zipPath = study.Spec.first_version.datasetSpecsExport.zipPath;
```

#### **5.2 Verify File Exists**
```javascript
if (!fs.existsSync(zipPath)) {
  return res.status(404).json({
    success: false,
    message: 'ZIP file not found'
  });
}
```

#### **5.3 Stream File**
```javascript
res.setHeader('Content-Type', 'application/zip');
res.setHeader('Content-Length', stats.size);
res.setHeader('Content-Disposition', `attachment; filename="${zipFileName}"`);

const stream = fs.createReadStream(zipPath);
stream.pipe(res);
```

### **User Receives ZIP Contents**
```
Spec_SPI-611_dataset_specs_1762888785318.zip
├── AE.xlsx       ← Excel file
├── AE.sas        ← SAS code (new)
├── DM.xlsx
├── VS.xlsx
├── LB.xlsx
├── ...
```

---

## 📊 Data Flow Diagram

```
Protocol PDF → Parse → Study Design/Objectives
                          ↓
CRF PDF → Parse → Form List/Variable Mappings
                          ↓
                    Generate Spec
                          ↓
          Spec.first_version (Overall Spec)
          ├── Study
          ├── Datasets
          ├── Variables
          ├── TESTCD_Details
          ├── SUPP_Details
          ├── TA_Data
          ├── TE_Data
          ├── TI_Data
          ├── TV_Data
          ├── TS_Data
          ├── Methods
          └── Updated Tracker
                          ↓
            Generate Dataset-Specific Specs
                          ↓
          ┌─────────────────────────────────┐
          │ For each dataset (AE, DM, VS):  │
          │ 1. Filter data → datasetSpec    │
          │ 2. Generate Excel → Buffer      │
          │ 3. Save slice → datasetSlices   │
          └─────────────────────────────────┘
                          ↓
          Save to Database: Spec.datasetSlices
          {
            AE: { Study, Variables, SUPP_Details, ... },
            DM: { ... },
            VS: { ... }
          }
                          ↓
                    Wait 2 seconds
                          ↓
          ┌─────────────────────────────────┐
          │ Generate SAS Code (from DB):    │
          │ 1. Read Spec.datasetSlices.AE   │
          │ 2. Generate metadata.attrib     │
          │ 3. Generate SAS code            │
          │ 4. Save to datasetSasFiles      │
          └─────────────────────────────────┘
                          ↓
                    Create ZIP
          ├── Excel files (from datasetBuffers)
          └── SAS files (from datasetSasFiles)
                          ↓
          Save to temp directory
                          ↓
          Save ZIP metadata to Database
                          ↓
          Download ZIP (stream to browser)
```

---

## 🎯 Key Timing Points

1. **Excel Generation**: In-memory, not saved to disk
2. **datasetSlices Save**: Immediately saved to database
3. **Wait 2 Seconds**: Ensure database write completion
4. **SAS Generation**: Read from database datasetSlices
5. **ZIP Packaging**: All files packaged in memory
6. **ZIP Save**: Saved to temp directory
7. **ZIP Download**: Streamed to client

---

## 🔑 Key Files

| File | Purpose |
|------|---------|
| `services/Spec_dataset_separation.js` | Main logic: Generate Excel + SAS + ZIP |
| `services/spec_sas/aeSasGenerator.js` | AE SAS code generator |
| `controllers/SpecDocumentController.js` | API controller (generation and download) |
| `routes/documentRoutes.js` | API route definitions |
| `models/studyModel.js` | Database Schema |

---

## 🚀 API Endpoints

| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/api/studies/:studyId/generate-dataset-specs` | POST | Generate dataset-specific specs + ZIP |
| `/api/studies/:studyId/dataset-specs.zip` | GET | Download ZIP file |

---

**Last Updated:** 2025-11-11  
**Author:** AI Assistant  
**Status:** Production Ready ✅

