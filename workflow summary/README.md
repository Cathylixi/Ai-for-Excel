# Workflow Documentation Index

**Last Updated:** 2025-11-11  
**Purpose:** Comprehensive workflow documentation for the Ai-for-Excel project

---

## 📚 Available Workflow Documents

### 1. **PROTOCOL_UPLOAD_WORKFLOW.md** (21 KB)
**Complete documentation of Clinical Protocol PDF/Word upload and parsing workflow**

**Topics Covered:**
- ✅ Frontend file upload and validation
- ✅ Backend file reception with Multer
- ✅ PDF processing using pdfplumber
- ✅ AI analysis with OpenAI GPT-3.5
  - Assessment Schedule identification
  - Study Design extraction
  - Objectives extraction (with GPT fallback)
  - Inclusion/Exclusion Criteria extraction
- ✅ MongoDB database storage
- ✅ Automatic SDTM cost estimate generation
- ✅ Response structure and error handling

**Key Features:**
- In-memory processing (no temporary files)
- Support for PDF and Word documents
- AI-powered content extraction
- Hierarchical section parsing

---

### 2. **CRF_UPLOAD_WORKFLOW.md** (29 KB)
**Comprehensive documentation of Case Report Form (CRF) PDF upload and parsing workflow**

**Topics Covered:**
- ✅ Frontend CRF file upload
- ✅ Backend file reception and validation
- ✅ Persistent PDF storage to disk
- ✅ Basic PDF processing (no AI)
- ✅ Word position extraction (pixel-perfect coordinates)
- ✅ Row grouping with Y-coordinate tolerance
- ✅ AI pattern recognition with GPT-4
  - Header/footer patterns
  - Page number patterns
  - Form name patterns
- ✅ Form structure processing
  - Form title extraction
  - Content row assignment
  - Label/OID metadata extraction
- ✅ Database storage
- ✅ Manual annotation trigger (post-upload)

**Key Features:**
- Pixel-perfect word coordinates for annotation
- AI-powered pattern learning
- Segment-based form grouping
- Persistent storage for future operations

---

### 3. **SPEC_WORKFLOW.md** (16 KB)
**Complete Spec generation workflow from Protocol upload to ZIP download**

**Topics Covered:**
- ✅ 5-step workflow overview
  1. Upload Protocol PDF
  2. Upload CRF PDF
  3. Generate Spec (12 tables)
  4. Generate Dataset-Specific Specs
  5. Download ZIP (includes Excel + SAS)
- ✅ Dataset-specific Excel generation
- ✅ SAS code generation (AE.sas)
- ✅ ZIP packaging and download
- ✅ Database structure for datasetSlices

**Key Features:**
- Dataset slicing for quick access
- SAS code generation with SUPPAE integration
- ZIP archiving with Excel + SAS files
- 2-second wait between database operations

---

## 🔄 Complete Workflow Sequence

```
┌─────────────────────────────────────────────────────────┐
│                  1. PROTOCOL UPLOAD                     │
│  User uploads Protocol PDF/Word → AI analysis →         │
│  Extract Study Design, Objectives, Criteria →           │
│  Save to database → Generate cost estimate              │
└───────────────────────┬─────────────────────────────────┘
                        │
                        ▼
┌─────────────────────────────────────────────────────────┐
│                    2. CRF UPLOAD                        │
│  User uploads CRF PDF → Word extraction →               │
│  Row grouping → AI pattern recognition →                │
│  Form processing → Save to database                     │
└───────────────────────┬─────────────────────────────────┘
                        │
                        ▼
┌─────────────────────────────────────────────────────────┐
│                  3. SPEC GENERATION                     │
│  Generate 12 tables (Study, Datasets, Variables, etc.)  │
│  → Combine SDTMIG Reference + CRF data →                │
│  Save to Spec.first_version                             │
└───────────────────────┬─────────────────────────────────┘
                        │
                        ▼
┌─────────────────────────────────────────────────────────┐
│          4. DATASET-SPECIFIC SPECS + SAS                │
│  Generate Excel files per dataset →                     │
│  Save datasetSlices to database →                       │
│  Wait 2 seconds → Generate SAS code →                   │
│  Package ZIP (Excel + SAS) → Download                   │
└─────────────────────────────────────────────────────────┘
```

---

## 🎯 Quick Reference

### Upload Endpoints

| Endpoint | Method | Purpose | Document |
|----------|--------|---------|----------|
| `/api/upload-document` | POST | Upload Protocol | PROTOCOL_UPLOAD_WORKFLOW.md |
| `/api/studies/:id/upload-crf` | POST | Upload CRF | CRF_UPLOAD_WORKFLOW.md |
| `/api/studies/:id/generate-dataset-specs` | POST | Generate Specs + SAS | SPEC_WORKFLOW.md |
| `/api/studies/:id/dataset-specs.zip` | GET | Download ZIP | SPEC_WORKFLOW.md |

### File Processing Tools

| Tool | Language | Purpose | Used By |
|------|----------|---------|---------|
| `pdfplumber` | Python | Text + table extraction | Protocol, CRF |
| `multer` | Node.js | File upload handling | Protocol, CRF |
| `openai` | Node.js | AI analysis | Protocol (GPT-3.5), CRF (GPT-4) |
| `exceljs` | Node.js | Excel generation | Spec |
| `jszip` | Node.js | ZIP archiving | Spec |

### AI Models

| Model | Purpose | Used For |
|-------|---------|----------|
| GPT-3.5-turbo | Fast, cost-effective | Protocol: Assessment Schedule, Objectives |
| GPT-4 | High accuracy | CRF: Pattern recognition (headers, footers, forms) |

---

## 📊 Data Storage Locations

### MongoDB Collections

| Collection | Documents | Purpose |
|------------|-----------|---------|
| `studies` | Study documents | Main data storage |
| `sdtmig_reference` | CDISC reference data | SDTMIG standards |

### Study Document Structure

```javascript
{
  _id: ObjectId,
  studyNumber: String,
  files: {
    protocol: {
      uploaded: Boolean,
      originalName: String,
      uploadExtraction: {
        extractedText: String,
        sectionedText: Array,
        tables: Array,
        assessmentSchedule: Object,
        criterias: Object,
        studyDesign: Object,
        objectives: Object
      }
    },
    crf: {
      uploaded: Boolean,
      sourcePath: String,
      crfUploadResult: {
        crfFormList: Object,
        Extract_words_with_position: Object,
        Extract_rows_with_position: Object,
        identified_patterns: Object
      }
    }
  },
  Spec: {
    first_version: {
      Study: Object,
      Datasets: Object,
      Variables: Object,
      // ... 9 more tables
      datasetSpecsExport: Object
    },
    datasetSlices: {
      AE: Object,
      DM: Object,
      // ... other datasets
    }
  }
}
```

---

## 🚀 Performance Benchmarks

| Operation | Time | File Size | Notes |
|-----------|------|-----------|-------|
| Protocol Upload | 2-5s | 2-5 MB | Includes AI analysis |
| CRF Upload | 5-10s | 3-8 MB | Includes pattern recognition |
| Spec Generation | 10-30s | N/A | Depends on dataset count |
| Dataset-Specific Specs | 15-45s | N/A | Excel + SAS generation |

---

## 🔧 Environment Setup

### Required Environment Variables

```env
# MongoDB
MONGODB_URI=mongodb+srv://...

# OpenAI
OPENAI_API_KEY=sk-...

# Server
PORT=4000
NODE_ENV=development

# CRF Storage
CRF_TMP_DIR=./tmp/crf
```

### Python Dependencies

```
pdfplumber>=0.11.8
pdfminer.six>=20251107
Pillow>=12.0.0
pypdfium2>=5.0.0
pandas>=2.0.3
pymongo>=4.5.0
openpyxl>=3.1.2
```

### Node.js Dependencies

```
express@^4.18.2
multer@^2.0.2
mongoose@^8.17.0
openai@^5.11.0
exceljs@^4.4.0
jszip@^3.10.1
```

---

## 📝 Document Reading Order

**For New Developers:**

1. Start with **SPEC_WORKFLOW.md** to understand the overall system
2. Read **PROTOCOL_UPLOAD_WORKFLOW.md** to understand data input
3. Read **CRF_UPLOAD_WORKFLOW.md** to understand form processing
4. Review code files referenced in each document

**For Troubleshooting:**

1. Identify which upload step is failing
2. Open the relevant workflow document
3. Find the section describing that step
4. Check error handling section
5. Review related code files

---

## 🎓 Key Concepts

### Protocol Upload
- **In-Memory Processing**: Files processed in memory for speed
- **AI Analysis**: GPT-3.5 extracts key protocol sections
- **Hierarchical Parsing**: Nested section structure preserved
- **Cost Automation**: SDTM cost estimates generated automatically

### CRF Upload
- **Persistent Storage**: PDF saved to disk for future annotation
- **Word Coordinates**: Pixel-perfect positions for annotation rectangles
- **Row Grouping**: Words grouped by Y-coordinate tolerance (3.5px)
- **AI Pattern Learning**: GPT-4 learns CRF structure from first 10 pages

### Spec Generation
- **Dataset Slicing**: Pre-filtered data stored for quick access
- **SAS Generation**: Automated SAS code with SUPPAE integration
- **ZIP Packaging**: Excel + SAS files bundled for download
- **Database Persistence**: All generated data saved for version control

---

## 🔗 Related Documentation

- **DEPENDENCIES.md** - Full Node.js dependency documentation
- **requirements.txt** - Python dependency list
- **backend/scripts/README_SDTM_Import.md** - SDTM import instructions
- **backend/config/crfConfig.js** - CRF configuration

---

## 📞 Support

For questions or issues:
1. Check the relevant workflow document
2. Review error handling sections
3. Check environment variable configuration
4. Verify Python and Node.js dependencies
5. Review MongoDB connection

---

**Project:** Ai-for-Excel  
**Author:** AI Assistant  
**Status:** Production Ready ✅  
**Documentation Version:** 1.0

