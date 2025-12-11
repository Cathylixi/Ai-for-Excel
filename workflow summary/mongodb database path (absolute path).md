# MongoDB Database Path (Absolute Path) Analysis

**Version**: 2.0  
**Last Updated**: March 2025  
**Purpose**: Document ALL backend database interactions, including file paths, database names, collection names, and API routes.

---

## 1. Summary

This document lists **ALL backend code locations** that:
1. Store file paths to MongoDB
2. Read file paths from MongoDB
3. Connect to specific databases
4. Access specific collections
5. Use absolute paths that could be converted to relative paths

---

## 2. Database Connections Overview

### 2.1 Databases Used

| Database | Purpose | Access Method |
|----------|---------|---------------|
| `llxexcel` | **Default** - Main application data (studies, etc.) | Default MongoDB connection |
| `References` | CDISC reference data (SDTMIG, Terminology, TS) | `mongoose.connection.useDb('References')` or `client.db('References')` |

---

## 3. Files Storing Paths to Database

### 3.1 `backend/controllers/documentController.js`

#### CRF Source PDF Path Storage
| Line | Code | Database Field | Path Type |
|------|------|----------------|-----------|
| **3369** | `const fullPath = path.join(CRF_TMP_DIR, filename);` | - | Absolute (Generated) |
| **3372** | `study.files.crf.sourcePath = fullPath;` | `files.crf.sourcePath` | ⚠️ **Absolute** |
| **3536** | `'files.crf.sourcePath': study.files.crf.sourcePath,` | `files.crf.sourcePath` | ⚠️ **Absolute** |

#### CRF Annotated PDF Path Storage
| Line | Code | Database Field | Path Type |
|------|------|----------------|-----------|
| **4448** | `const outputPath = path.join(dir, annotatedFileName);` | - | Absolute (Generated) |
| **4703** | `'files.crf.annotatedPath': finalOutputPath,` | `files.crf.annotatedPath` | ⚠️ **Absolute** |
| **4794** | `'files.crf.annotatedPath': outputPath,` | `files.crf.annotatedPath` | ⚠️ **Absolute** |

#### CRF Download URL Storage (Relative - Good)
| Line | Code | Database Field | Path Type |
|------|------|----------------|-----------|
| **4698** | `const downloadUrl = \`/api/studies/${studyId}/crf-annotated.pdf\`;` | - | Relative URL ✅ |
| **4706** | `'files.crf.downloadUrl': downloadUrl` | `files.crf.downloadUrl` | Relative URL ✅ |
| **4797** | `'files.crf.downloadUrl': downloadUrl` | `files.crf.downloadUrl` | Relative URL ✅ |

---

### 3.2 `backend/services/Spec_dataset_separation.js`

#### Dataset Specs ZIP Path Storage
| Line | Code | Database Field | Path Type |
|------|------|----------------|-----------|
| **226** | `const tempDir = path.join(os.tmpdir(), 'llx_spec_dataset_exports');` | - | Absolute (OS Temp) |
| **228** | `const zipFullPath = path.join(tempDir, zipFileName);` | - | Absolute (Generated) |
| **253** | `zipPath: zipFullPath,` | `Spec.first_version.datasetSpecsExport.zipPath` | ⚠️ **Absolute** |
| **254** | `downloadUrl,` | `Spec.first_version.datasetSpecsExport.downloadUrl` | Relative URL ✅ |

---

### 3.3 `backend/models/sdtmigReferenceModel.js`

| Line | Code | Database Field | Path Type |
|------|------|----------------|-----------|
| **74** | `original_path: { type: String }` | `file_info.original_path` | ⚠️ **Absolute** (optional) |

---

### 3.4 `backend/models/studyModel.js`

| Line | Code | Database Field | Path Type |
|------|------|----------------|-----------|
| **133** | `sourcePath: { type: String }` | `files.crf.sourcePath` | ⚠️ **Absolute** |
| **134** | `annotatedPath: { type: String }` | `files.crf.annotatedPath` | ⚠️ **Absolute** |
| **137** | `downloadUrl: { type: String }` | `files.crf.downloadUrl` | Relative URL ✅ |

---

## 4. Files Reading Paths from Database

### 4.1 `backend/controllers/documentController.js`

#### Reading CRF Source Path
| Line | Code | Database Field Read |
|------|------|---------------------|
| **4611** | `const sourcePath = studyData?.files?.crf?.sourcePath;` | `files.crf.sourcePath` |
| **4738** | `const sourcePath = studyData?.files?.crf?.sourcePath;` | `files.crf.sourcePath` |

#### Reading CRF Annotated Path
| Line | Code | Database Field Read |
|------|------|---------------------|
| **5062** | `const annotatedPath = study?.files?.crf?.annotatedPath;` | `files.crf.annotatedPath` |
| **5087** | `if (!fs.existsSync(annotatedPath))` | Uses `files.crf.annotatedPath` |
| **5115** | `res.sendFile(path.resolve(annotatedPath), ...)` | Uses `files.crf.annotatedPath` |

---

### 4.2 `backend/controllers/SpecDocumentController.js`

#### Reading Dataset Specs ZIP Path
| Line | Code | Database Field Read |
|------|------|---------------------|
| **3333** | `if (!exportInfo \|\| !exportInfo.zipPath)` | `Spec.first_version.datasetSpecsExport.zipPath` |
| **3340** | `const zipPath = exportInfo.zipPath;` | `Spec.first_version.datasetSpecsExport.zipPath` |
| **3342** | `if (!fs.existsSync(zipPath))` | Uses ZIP path |
| **3357** | `const stream = fs.createReadStream(zipPath);` | Uses ZIP path |

---

## 5. Cross-Database Access (References Database)

### 5.1 `backend/services/SPEC_internal_spec_generation.js`

| Line | Code | Database/Collection |
|------|------|---------------------|
| **17** | `const referencesDb = mongoose.connection.client.db('References');` | `References` database |
| **18** | `const collection = referencesDb.collection('SDTMIG_v3.4');` | `SDTMIG_v3.4` collection |
| **33** | `const studiesDb = mongoose.connection.client.db('llxexcel');` | `llxexcel` database |
| **34** | `const studiesCollection = studiesDb.collection('studies');` | `studies` collection |

---

### 5.2 `backend/controllers/SpecDocumentController.js`

| Line | Code | Database/Collection |
|------|------|---------------------|
| **2345** | `const referencesDb = Study.db.db.client.db('References');` | `References` database |
| **2346** | `referencesDb.collection('sdtm_terminology')` | `sdtm_terminology` collection |
| **2586** | `const referencesDb = Study.db.db.client.db('References');` | `References` database |
| **2587** | `referencesDb.collection('TS')` | `TS` collection |
| **2683** | `referencesDbLocal.collection('sdtm_terminology')` | `sdtm_terminology` collection |
| **2882** | `const referencesDb = Study.db.db.client.db('References');` | `References` database |
| **2883** | `referencesDb.collection('TS')` | `TS` collection |
| **3005** | `referencesDbLocal.collection('sdtm_terminology')` | `sdtm_terminology` collection |

---

### 5.3 `backend/services/Spec_SDTMIG_v3.4_upload.js`

| Line | Code | Database/Collection |
|------|------|---------------------|
| **28** | `const DB_NAME = 'References';` | Configuration |
| **29** | `const COLLECTION_NAME = 'SDTMIG_v3.4';` | Configuration |
| **115** | `const db = mongoose.connection.useDb(DB_NAME);` | Switch to `References` |
| **116** | `const collection = db.collection(COLLECTION_NAME);` | `SDTMIG_v3.4` collection |

---

## 6. Python Scripts with Database Connections

### 6.1 `backend/scripts/import_sdtm_terminology.py`

| Line | Code | Database/Collection | Path |
|------|------|---------------------|------|
| **28** | `EXCEL_PATH = '/Users/wgl/Desktop/...'` | - | ⚠️ **Hardcoded Absolute Path** |
| **31** | `MONGO_URI = 'mongodb+srv://...'` | MongoDB Atlas | Hardcoded connection string |
| **32** | `DB_NAME = 'References'` | `References` database | |
| **33** | `COLLECTION_NAME = 'sdtm_terminology'` | `sdtm_terminology` collection | |

---

### 6.2 `backend/services/import_reference_files/TS/import_ts_reference.py`

| Line | Code | Database/Collection | Path |
|------|------|---------------------|------|
| **34** | `EXCEL_PATH = '/Users/wgl/Desktop/...'` | - | ⚠️ **Hardcoded Absolute Path** |
| **37** | `MONGO_URI = 'mongodb+srv://...'` | MongoDB Atlas | Hardcoded connection string |
| **38** | `DB_NAME = 'References'` | `References` database | |
| **39** | `COLLECTION_NAME = 'TS'` | `TS` collection | |

---

## 7. Configuration Files with Path Definitions

### 7.1 `backend/config/crfConfig.js`

| Line | Code | Description |
|------|------|-------------|
| **6** | `const CRF_TMP_DIR = process.env.CRF_TMP_DIR \|\| '/tmp/crf';` | Default temp directory for CRF files |

**Current Default**: `/tmp/crf` (Unix-style absolute path)

**Issue**: This default won't work on Windows without environment variable override.

---

### 7.2 `backend/services/pypdfService.js`

| Line | Code | Description |
|------|------|-------------|
| **15** | `this.tempDir = path.join(__dirname, '../temp');` | Temp directory for PDF processing |
| **16** | `this.pythonScript = path.join(__dirname, 'pdf_processor.py');` | Python script path |
| **1577** | `const tempDir = path.join(__dirname, '../temp');` | CRF position extractor temp |
| **1589** | `const scriptPath = path.join(__dirname, 'crf_position_extractor.py');` | CRF position extractor script |
| **1676** | `const tempDir = path.join(__dirname, '../temp');` | CRF words extractor temp |
| **1690** | `const pythonScript = path.join(__dirname, 'crf_analysis/crf_words_extractor.py');` | CRF words extractor script |

---

## 8. Database Fields Summary

### 8.1 Fields Storing Absolute Paths (Need Modification)

| Database | Collection | Field Path | Used By |
|----------|------------|------------|---------|
| llxexcel | studies | `files.crf.sourcePath` | PDF Annotation Script |
| llxexcel | studies | `files.crf.annotatedPath` | Download Handler |
| llxexcel | studies | `Spec.first_version.datasetSpecsExport.zipPath` | ZIP Download Handler |
| llxexcel | sdtmig_reference | `file_info.original_path` | Reference tracking |

### 8.2 Fields Storing Relative Paths/URLs (Already Good)

| Database | Collection | Field Path | Status |
|----------|------------|------------|--------|
| llxexcel | studies | `files.crf.downloadUrl` | ✅ Relative URL |
| llxexcel | studies | `Spec.first_version.datasetSpecsExport.downloadUrl` | ✅ Relative URL |

---

## 9. Collection Access Summary by Database

### 9.1 `llxexcel` Database (Default)

| Collection | Access Method | Used In Files |
|------------|---------------|---------------|
| `studies` | `mongoose.model('Study')` or `client.db('llxexcel').collection('studies')` | documentController.js, SpecDocumentController.js, SPEC_internal_spec_generation.js, Spec_dataset_separation.js, aeSasGenerator.js, assistantController.js |
| `sdtmig_reference` | `mongoose.model('SDTMIGReference')` | sdtmigReferenceModel.js, documentController.js |

### 9.2 `References` Database

| Collection | Access Method | Used In Files |
|------------|---------------|---------------|
| `SDTMIG_v3.4` | `client.db('References').collection('SDTMIG_v3.4')` | SPEC_internal_spec_generation.js, Spec_SDTMIG_v3.4_upload.js |
| `sdtm_terminology` | `client.db('References').collection('sdtm_terminology')` | SpecDocumentController.js, import_sdtm_terminology.py |
| `TS` | `client.db('References').collection('TS')` | SpecDocumentController.js, import_ts_reference.py |

---

## 10. Study Model Database Fields (All CRF-Related)

### `files.crf` Sub-document (from `studyModel.js` lines 126-148)

| Field | Type | Purpose |
|-------|------|---------|
| `uploaded` | Boolean | Upload status |
| `originalName` | String | Original file name |
| `fileSize` | Number | File size |
| `mimeType` | String | MIME type |
| `uploadedAt` | Date | Upload timestamp |
| `sourcePath` | String | ⚠️ **Absolute path** to source PDF |
| `annotatedPath` | String | ⚠️ **Absolute path** to annotated PDF |
| `annotationReady` | Boolean | Annotation completion status |
| `annotatedAt` | Date | Annotation timestamp |
| `downloadUrl` | String | ✅ Relative download URL |
| `crf_sdtm_ready_for_annotation` | Boolean | SDTM analysis ready flag |
| `crfUploadResult.crfFormList` | Mixed | Form list data |
| `crfUploadResult.crfFormName` | Mixed | Form name data |
| `crfUploadResult.Extract_words_with_position` | Mixed | Word position data |
| `crfUploadResult.Extract_rows_with_position` | Mixed | Row position data |
| `crfUploadResult.identified_patterns` | Mixed | AI patterns |

---

## 11. Complete File List with Database Interactions

| File Path | Database Operations | Key Functions |
|-----------|---------------------|---------------|
| `backend/controllers/documentController.js` | Study CRUD, CRF path storage | uploadCrfFile, downloadAnnotatedCrf |
| `backend/controllers/SpecDocumentController.js` | Study CRUD, References.sdtm_terminology, References.TS | TS generation, Codelist lookup |
| `backend/controllers/assistantController.js` | Study.findOne | lookupStudyTask |
| `backend/services/SPEC_internal_spec_generation.js` | References.SDTMIG_v3.4, llxexcel.studies | generateInternalSpecExcel |
| `backend/services/Spec_dataset_separation.js` | Study.findByIdAndUpdate | generateDatasetSpecsZip |
| `backend/services/Spec_SDTMIG_v3.4_upload.js` | References.SDTMIG_v3.4 (insert) | uploadSDTMIG |
| `backend/services/spec_sas/aeSasGenerator.js` | Study.findById | generateAEsas |
| `backend/models/studyModel.js` | Schema definition | - |
| `backend/models/sdtmigReferenceModel.js` | Schema definition | - |
| `backend/scripts/import_sdtm_terminology.py` | References.sdtm_terminology (insert) | import script |
| `backend/services/import_reference_files/TS/import_ts_reference.py` | References.TS (insert) | import script |

---

## 12. Recommended Changes for Relative Path Conversion

### 12.1 Define Base Storage Directory

```javascript
// backend/config/storageConfig.js (NEW FILE)
const path = require('path');

// Base directory for all persistent storage
const STORAGE_ROOT = process.env.STORAGE_ROOT || path.join(__dirname, '..', 'storage');

// Subdirectories
const CRF_STORAGE_DIR = path.join(STORAGE_ROOT, 'crf');
const TEMP_STORAGE_DIR = path.join(STORAGE_ROOT, 'temp');
const SPECS_STORAGE_DIR = path.join(STORAGE_ROOT, 'specs');

module.exports = {
  STORAGE_ROOT,
  CRF_STORAGE_DIR,
  TEMP_STORAGE_DIR,
  SPECS_STORAGE_DIR
};
```

### 12.2 Store Relative Paths

**Before** (Current - Absolute):
```javascript
study.files.crf.sourcePath = "C:/Users/Xi.Li/Desktop/Ai-for-Excel/tmp/crf/crf_123.pdf"
```

**After** (Recommended - Relative):
```javascript
study.files.crf.sourcePath = "crf/crf_123.pdf"  // Relative to STORAGE_ROOT
```

### 12.3 Resolve Paths When Reading

```javascript
// Helper function to resolve stored relative path to absolute
function resolveStoragePath(relativePath) {
  const { STORAGE_ROOT } = require('../config/storageConfig');
  return path.join(STORAGE_ROOT, relativePath);
}

// Usage
const absolutePath = resolveStoragePath(study.files.crf.sourcePath);
```

---

## 13. Files Requiring Modification (Summary)

| File | Lines to Modify | Change Description |
|------|-----------------|-------------------|
| `backend/config/crfConfig.js` | 6 | Use project-relative default instead of `/tmp/crf` |
| `backend/controllers/documentController.js` | 3372, 4703, 4794 | Store relative path instead of absolute |
| `backend/controllers/documentController.js` | 4611, 4738, 5062, 5087, 5115 | Resolve relative path to absolute before use |
| `backend/services/Spec_dataset_separation.js` | 253 | Store relative path for zipPath |
| `backend/controllers/SpecDocumentController.js` | 3340, 3342, 3357 | Resolve relative path before file operations |
| `backend/scripts/import_sdtm_terminology.py` | 28 | Use environment variable or relative path |
| `backend/services/import_reference_files/TS/import_ts_reference.py` | 34 | Use environment variable or relative path |

---

## 14. Migration Considerations

1. **Existing Data**: Old documents have absolute paths; need migration script or fallback logic.
2. **Backward Compatibility**: Check if path is absolute or relative before resolving.
3. **Cross-Platform**: Ensure path separators work on both Windows and Unix.

```javascript
// Backward-compatible path resolver
function resolveStoragePath(storedPath) {
  if (!storedPath) return null;
  
  // If already absolute, return as-is (backward compatibility)
  if (path.isAbsolute(storedPath)) {
    return storedPath;
  }
  
  // Otherwise, resolve relative to STORAGE_ROOT
  const { STORAGE_ROOT } = require('../config/storageConfig');
  return path.join(STORAGE_ROOT, storedPath);
}
```

---

## 15. Frontend Database Interactions

### 15.1 Overview

**Frontend 不直接连接数据库**。所有数据库操作通过后端 API 进行。

### 15.2 API Base URL Configuration

| File | Line | Code |
|------|------|------|
| `frontend/src/taskpane/taskpane.js` | 9 | `const API_BASE_URL = 'https://localhost:4000';` |
| Other files | - | `let API_BASE_URL = window.API_BASE_URL` (inherited) |

### 15.3 Files Making API Calls (Indirect Database Access)

| File | Purpose | Key API Endpoints Called |
|------|---------|-------------------------|
| `spec.js` | Spec page operations | `/api/studies/{id}/spec-*`, `/api/sdtmig-*`, `/api/studies/{id}/generate-internal-spec` |
| `crfannotation.js` | CRF annotation operations | `/api/studies/{id}/crf-*`, `/api/studies/{id}/crf-annotated.pdf` |
| `spec_dataset_separation.js` | Dataset specs generation | `/api/studies/{id}/generate-dataset-specs` |
| `spec_TS.js` | TS generation | `/api/studies/{id}/spec-ts-*` |
| `costestimate.js` | Cost estimation | `/api/studies/{id}/sdtm-*`, `/api/studies/{id}/adam-*` |
| `mainpage.js` | Document upload | `/api/upload-document`, `/api/studies/{id}/upload-*` |
| `otherdocuments.js` | Additional file upload | `/api/studies/{id}/upload-*` |

### 15.4 Download URLs Used in Frontend

| File | Line | Code | Purpose |
|------|------|------|---------|
| `spec.js` | 598 | `const downloadUrl = \`${API_BASE_URL}${result.downloadUrl}\`` | Internal Spec download |
| `crfannotation.js` | 2076 | `const downloadUrl = \`${API_BASE_URL}/api/studies/${currentStudyId}/crf-annotated.pdf\`` | Annotated CRF download |
| `spec_dataset_separation.js` | 216 | `const downloadUrl = \`${API_BASE_URL}${result.downloadUrl}\`` | Dataset specs ZIP download |

### 15.5 UI Strings Mentioning Database

| File | Line | Text | Context |
|------|------|------|---------|
| `mainpage.js` | 1145 | `'✅ Clinical Protocol uploaded to MongoDB'` | Upload success message |
| `otherdocuments.js` | 118, 203 | `'✅ ... uploaded to MongoDB'` | Upload success message |

**Note**: These are only UI display strings, not actual database operations.

---

## 16. Complete Backend File Checklist

### 16.1 Files WITH Database Interactions ✅

| File | Has DB Access | Notes |
|------|---------------|-------|
| `controllers/documentController.js` | ✅ Yes | Main document operations, CRF paths |
| `controllers/SpecDocumentController.js` | ✅ Yes | Spec operations, References DB access |
| `controllers/assistantController.js` | ✅ Yes | Study lookup |
| `services/SPEC_internal_spec_generation.js` | ✅ Yes | Cross-database access (References, llxexcel) |
| `services/Spec_dataset_separation.js` | ✅ Yes | Study updates |
| `services/Spec_SDTMIG_v3.4_upload.js` | ✅ Yes | References.SDTMIG_v3.4 |
| `services/spec_sas/aeSasGenerator.js` | ✅ Yes | Study read |
| `scripts/import_sdtm_terminology.py` | ✅ Yes | References.sdtm_terminology |
| `services/import_reference_files/TS/import_ts_reference.py` | ✅ Yes | References.TS |
| `models/studyModel.js` | ✅ Yes | Schema definition |
| `models/sdtmigReferenceModel.js` | ✅ Yes | Schema definition |
| `server.js` | ✅ Yes | MongoDB connection |
| `server-simple.js` | ✅ Yes | MongoDB connection |

### 16.2 Files WITHOUT Database Interactions ❌

| File | Has DB Access | Notes |
|------|---------------|-------|
| `config/crfConfig.js` | ❌ No | Config only (but has CRF_TMP_DIR path) |
| `routes/documentRoutes.js` | ❌ No | Route definitions only |
| `routes/assistantRoutes.js` | ❌ No | Route definitions only |
| `services/openaiService.js` | ❌ No | OpenAI API only |
| `services/wordParserService.js` | ❌ No | Document parsing only |
| `services/pypdfService.js` | ❌ No | PDF processing only |
| `services/sdtmAnalysisService.js` | ❌ No | OpenAI analysis only |
| `services/adamAnalysisService.js` | ❌ No | OpenAI analysis only |
| `services/commandParserService.js` | ❌ No | OpenAI parsing only |
| `services/Spec_SDTMIG_Extraction_Service.js` | ❌ No | File extraction only |
| `services/crf_analysis/crf_form_processor.js` | ❌ No | Data processing only |
| `services/crf_analysis/extractLabelOidForms.js` | ❌ No | Data processing only |
| `services/crf_analysis/words_to_rows_processor.js` | ❌ No | Data processing only |
| `services/crf_analysis/sdtmMappingService.js` | ❌ No | OpenAI mapping only |
| `services/crf_analysis/annotationRectService.js` | ❌ No | Coordinate calculation only |
| `models/documentModel.js` | ❌ No | Deprecated (exports null) |

---

## 17. Summary Statistics

| Category | Count |
|----------|-------|
| **Backend files with DB access** | 13 |
| **Backend files without DB access** | 17 |
| **Frontend files (API calls only)** | 17 |
| **Database fields storing absolute paths** | 4 |
| **Database fields storing relative URLs** | 2 |
| **Python scripts with hardcoded paths** | 2 |
