# MongoDB Database Design

**Version**: 1.0  
**Last Updated**: March 2025  
**Application**: AI-for-Excel (LLX Solutions)

This document describes the complete MongoDB database schema, data paths, and file dependencies for the AI-for-Excel application.

---

## 1. Database Overview

The application uses **MongoDB Atlas** with multiple databases:

| Database | Purpose | Size Concern |
| :--- | :--- | :--- |
| `llxexcel` | Primary application data (Studies, Users) | ⚠️ Studies can hit 16MB limit |
| `References` | Static reference data (CDISC standards) | ✅ Stable, rarely updated |

---

## 2. Database: `llxexcel` (Primary)

### 2.1 Collection: `studies`

**Purpose**: Store all study-related data including uploaded files, analysis results, and generated specs.

**Schema File**: `backend/models/studyModel.js`

#### Document Structure (Top Level)
```
{
  _id: ObjectId,
  studyNumber: String,                    // e.g., "SPI-611"
  
  files: {
    protocol: FileSlotSchema,             // Protocol document data
    crf: CrfFileSlotSchema,               // CRF document data (⚠️ LARGEST)
    sap: FileSlotSchema                   // SAP document data
  },
  
  projectDone: {
    isCostEstimate: Boolean,
    isSasAnalysis: Boolean
  },
  
  CostEstimateDetails: CostEstimateDetailsSchema,
  SasAnalysisDetails: Mixed,
  
  Spec: {                                 // Generated Spec tables
    first_version: {
      Study: {...},
      UpdatedTracker: {...},
      Datasets: {...},
      Variables: {...},
      Methods: {...},
      TESTCD_Details: {...},
      SUPP_Details: {...},
      TA_Data: {...},
      TE_Data: {...},
      TI_Data: {...},
      TV_Data: {...},
      TS_Data: {...},
      datasetSpecsExport: {...}
    },
    datasetSlices: {...}
  },
  
  traceability: {
    TFL_generation_adam_to_output: {...},
    dataFlow: {...}
  },
  
  createdAt: Date,
  updatedAt: Date
}
```

#### ⚠️ Critical Path: `files.crf.crfUploadResult` (16MB Risk Zone)

This is the most data-heavy section that can exceed MongoDB's 16MB document limit:

```
files.crf.crfUploadResult: {
  crfFormList: {                          // ⚠️ LARGE - All parsed forms
    "FORM_NAME": {
      title: String,
      filtered_rows: [...],               // ⚠️ Raw row data
      LabelForm: [...],                   // Extracted labels
      OIDForm: [...],                     // Extracted OIDs
      Mapping: [...],                     // Initial mapping
      Mapping_corrected_CRF_Annotation_Checklist: [...]  // User corrections
    }
  },
  crfFormName: {
    names: [String],
    total_forms: Number
  },
  Extract_words_with_position: {...},     // ⚠️ LARGEST - Word coordinates
  Extract_rows_with_position: {...},      // ⚠️ LARGE - Row coordinates
  identified_patterns: {...}              // AI-detected patterns
}
```

#### Key Nested Paths Used in Code

| Path | Used By | Purpose |
| :--- | :--- | :--- |
| `files.protocol.uploadExtraction.sectionedText` | SpecDocumentController | Protocol sections |
| `files.protocol.uploadExtraction.criterias` | SpecDocumentController | I/E Criteria |
| `files.protocol.uploadExtraction.studyDesign` | SpecDocumentController | Study Design |
| `files.protocol.uploadExtraction.objectives` | SpecDocumentController | Objectives |
| `files.crf.sourcePath` | documentController | Original PDF path |
| `files.crf.annotatedPath` | documentController | Annotated PDF path |
| `files.crf.crfUploadResult.crfFormList` | Multiple | Form data |
| `files.crf.crfUploadResult.crfFormList[x].Mapping_corrected_CRF_Annotation_Checklist` | SPEC_internal_spec | Corrected mappings |
| `Spec.first_version.*` | SpecDocumentController | Generated spec tables |
| `CostEstimateDetails.userConfirmedSdtm` | documentController | SDTM analysis |
| `CostEstimateDetails.userConfirmedAdam` | documentController | ADaM analysis |

---

### 2.2 Collection: `sdtmig_reference`

**Purpose**: Store CDISC SDTMIG reference data separately to avoid bloating Studies.

**Schema File**: `backend/models/sdtmigReferenceModel.js`

```
{
  _id: ObjectId,
  version: String,                        // "3.4"
  
  Datasets: {
    table_title: [String],
    table_content: [Mixed],
    source_file: String,
    sheet_name: String,
    total_rows: Number
  },
  
  Variables: {
    table_title: [String],
    table_content: [Mixed],
    ...
  },
  
  Variables_Req: {...},                   // Core='Req' filtered
  Variables_Perm: {...},                  // Core='Perm' filtered
  Variables_Exp: {...},                   // Core='Exp' filtered
  
  imported_at: Date
}
```

---

## 3. Database: `References` (Static Data)

### 3.1 Collection: `SDTMIG_v3.4`

**Purpose**: CDISC SDTMIG standard variable definitions (original Excel import).

**Access Pattern**: `mongoose.connection.client.db('References').collection('SDTMIG_v3.4')`

```
{
  _id: ObjectId,
  sheet_name: String,                     // "Variables", "Datasets", etc.
  columns: [String],                      // Column headers
  data: [Mixed]                           // Row data as objects
}
```

**Used By**:
- `SPEC_internal_spec_generation.js` → Fetches Variables sheet for Internal Spec

---

### 3.2 Collection: `TS`

**Purpose**: Trial Summary parameter reference table.

**Access Pattern**: `Study.db.db.client.db('References').collection('TS')`

```
{
  _id: ObjectId,
  // TS parameter definitions with AI flags, codelists, etc.
}
```

**Used By**:
- `SpecDocumentController.js` → TS_Data generation

---

### 3.3 Collection: `sdtm_terminology`

**Purpose**: CDISC Controlled Terminology for code validation.

**Access Pattern**: `Study.db.db.client.db('References').collection('sdtm_terminology')`

```
{
  _id: ObjectId,
  File_Function: String,                  // "CDISC"
  Codelist_Code: String,
  Submission_Value: String,
  ...
}
```

**Used By**:
- `SpecDocumentController.js` → Terminology matching for TS values

---

## 4. Files That Use Database Paths

### 4.1 Core Database Operations

| File | Database/Collection | Operations |
| :--- | :--- | :--- |
| `backend/models/studyModel.js` | llxexcel.studies | Schema Definition |
| `backend/models/sdtmigReferenceModel.js` | llxexcel.sdtmig_reference | Schema Definition |
| `backend/controllers/documentController.js` | llxexcel.studies | CRUD, CRF Upload |
| `backend/controllers/SpecDocumentController.js` | llxexcel.studies, References.* | Spec Generation |
| `backend/services/SPEC_internal_spec_generation.js` | References.SDTMIG_v3.4, llxexcel.studies | Internal Spec |

### 4.2 CRF Processing Pipeline

| File | Data Path Used |
| :--- | :--- |
| `backend/services/crf_analysis/crf_form_processor.js` | `crfFormList`, `filtered_rows` |
| `backend/services/crf_analysis/extractLabelOidForms.js` | `LabelForm`, `OIDForm`, `Mapping` |
| `backend/services/crf_analysis/annotationRectService.js` | `crfFormList`, word positions |
| `backend/services/crf_analysis/sdtmMappingService.js` | `Mapping`, SDTM domains |

### 4.3 Spec Generation Services

| File | Data Path Used |
| :--- | :--- |
| `backend/services/Spec_dataset_separation.js` | `Spec.first_version.*`, `datasetSlices` |
| `backend/services/Spec_SDTMIG_v3.4_upload.js` | `sdtmig_reference` |
| `backend/services/Spec_SDTMIG_Extraction_Service.js` | `Variables_Req`, `Variables_Perm` |
| `backend/services/spec_sas/aeSasGenerator.js` | `Spec.first_version.Variables` |

---

## 5. Known Issues & Recommendations

### 5.1 16MB Document Limit

**Problem**: Long CRF PDFs (300+ pages) can cause `files.crf.crfUploadResult` to exceed 16MB.

**Current Workaround**: Upload fails with `BSONObjectTooLarge` error.

**Recommended Solutions**:
1. **GridFS**: Store `Extract_words_with_position` and `Extract_rows_with_position` as GridFS files.
2. **Separate Collection**: Create `crf_extractions` collection, store by page.
3. **External Storage**: Save raw coordinates as JSON files on disk, store path only.

### 5.2 Path Consistency

**Observation**: Some paths use absolute paths (e.g., `sourcePath`, `annotatedPath`).

**Recommendation**: Consider using relative paths for portability:
```
// Current (Absolute)
sourcePath: "C:/Users/Xi.Li/Desktop/Ai-for-Excel/tmp/crf/crf_123.pdf"

// Recommended (Relative)
sourcePath: "tmp/crf/crf_123.pdf"
```

### 5.3 Database Access Patterns

**Current Pattern** (Direct DB switching):
```javascript
const referencesDb = mongoose.connection.client.db('References');
const collection = referencesDb.collection('SDTMIG_v3.4');
```

**Recommendation**: Create centralized database access helpers for consistency and easier migration.

---

## 6. Entity Relationship Diagram (Conceptual)

```
┌─────────────────────────────────────────────────────────────────────────┐
│                           DATABASE: llxexcel                            │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                         │
│  ┌─────────────────────────────────────────────────────────────────┐   │
│  │                    COLLECTION: studies                           │   │
│  ├─────────────────────────────────────────────────────────────────┤   │
│  │  _id                                                             │   │
│  │  studyNumber ─────────────────────────────────────────────────┐  │   │
│  │                                                               │  │   │
│  │  files.protocol ─────┬─► uploadExtraction                     │  │   │
│  │                      │     ├── sectionedText[]                │  │   │
│  │                      │     ├── criterias                      │  │   │
│  │                      │     ├── studyDesign                    │  │   │
│  │                      │     └── objectives                     │  │   │
│  │                      │                                        │  │   │
│  │  files.crf ──────────┼─► crfUploadResult                      │  │   │
│  │                      │     ├── crfFormList{} ◄────────────────┼──┼───┤
│  │                      │     │     └── [FORM].Mapping_corrected │  │   │
│  │                      │     ├── Extract_words_with_position ⚠️ │  │   │
│  │                      │     └── Extract_rows_with_position ⚠️  │  │   │
│  │                      │                                        │  │   │
│  │  Spec.first_version ─┼─► Study, Variables, TS_Data, etc.      │  │   │
│  │                      │                                        │  │   │
│  │  CostEstimateDetails ┼─► userConfirmedSdtm, userConfirmedAdam │  │   │
│  │                      │                                        │  │   │
│  │  traceability ───────┴─► dataFlow, TFL_generation             │  │   │
│  └─────────────────────────────────────────────────────────────────┘   │
│                                                                         │
│  ┌─────────────────────────────────────────────────────────────────┐   │
│  │               COLLECTION: sdtmig_reference                       │   │
│  ├─────────────────────────────────────────────────────────────────┤   │
│  │  version: "3.4"                                                  │   │
│  │  Datasets, Variables, Variables_Req, Variables_Perm, etc.       │   │
│  └─────────────────────────────────────────────────────────────────┘   │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────────────┐
│                          DATABASE: References                           │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                         │
│  ┌──────────────────────┐  ┌──────────────┐  ┌───────────────────────┐ │
│  │ COLLECTION:          │  │ COLLECTION:  │  │ COLLECTION:           │ │
│  │ SDTMIG_v3.4          │  │ TS           │  │ sdtm_terminology      │ │
│  ├──────────────────────┤  ├──────────────┤  ├───────────────────────┤ │
│  │ sheet_name           │  │ Parameter    │  │ File_Function         │ │
│  │ columns[]            │  │ definitions  │  │ Codelist_Code         │ │
│  │ data[]               │  │ with AI flag │  │ Submission_Value      │ │
│  │                      │  │              │  │ ...                   │ │
│  │ ► Internal Spec Gen  │  │ ► TS_Data    │  │ ► Term Matching       │ │
│  └──────────────────────┘  └──────────────┘  └───────────────────────┘ │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘

Legend:
  ⚠️  = High size risk (can cause 16MB overflow)
  ─►  = Contains / References
  ◄── = Used by Internal Spec Generation
```

---

## 7. Migration Considerations

If redesigning the schema:

1. **Split CRF Data**: Move `Extract_words/rows_with_position` to GridFS or separate collection.
2. **Use Relative Paths**: Change `sourcePath`, `annotatedPath` to relative paths.
3. **Index Optimization**: Add indexes on frequently queried fields.
4. **Versioning**: Add schema version field for future migrations.


