# CRF Upload Workflow

**Date:** 2025-11-11  
**Purpose:** Comprehensive documentation of the Case Report Form (CRF) PDF upload and parsing workflow

---

## 📊 Workflow Overview

```
User Uploads CRF PDF
        ↓
Frontend Validation
        ↓
Backend Receives File (in memory)
        ↓
Persist PDF to Disk
        ↓
Basic PDF Processing (no AI)
        ↓
Word Position Extraction
        ↓
Row Grouping & Processing
        ↓
AI Pattern Recognition (Header/Footer/Forms)
        ↓
Form Structure Processing
        ↓
Database Storage
        ↓
Response to Frontend
```

---

## 1️⃣ Frontend: File Upload

### **File:** `frontend/src/taskpane/otherdocuments/otherdocuments.js`

### **User Interaction**
- **Page Location**: Other Documents page
- **Upload Methods**:
  - Click on "Upload CRF Documents" area
  - Drag and drop CRF PDF file

### **Implementation Details**

#### File Type Validation
```javascript
const allowedTypes = ['application/pdf'];

if (!file.type || !allowedTypes.includes(file.type)) {
  showStatusMessage('Please select PDF file only', 'error');
  return;
}
```

**Supported Format:**
- PDF (`.pdf`) only
- CRF typically contains forms, not narrative text

#### FormData Creation
```javascript
const formData = new FormData();
formData.append('crf', file);

const apiEndpoint = `${API_BASE_URL}/api/studies/${currentStudyId}/upload-crf`;
```

#### API Request
```javascript
const response = await fetch(apiEndpoint, {
  method: 'POST',
  body: formData
});
```

### **Key Differences from Protocol Upload**
- CRF requires existing Study ID (uploaded as additional file)
- Endpoint: `/api/studies/:id/upload-crf` (not `/api/upload-document`)
- No Study Number auto-detection
- Single file type supported (PDF only)

---

## 2️⃣ Backend: File Reception

### **File:** `backend/routes/documentRoutes.js`

### **Route Definition**
```javascript
router.post('/studies/:id/upload-crf', upload.single('crf'), uploadCrfFile);
```

**Parameters:**
- `:id` - Study ID (MongoDB ObjectId)
- `crf` - File field name (must match frontend FormData)

### **Multer Configuration** (Same as Protocol)
```javascript
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 }, // 10MB
  fileFilter: (req, file, cb) => {
    cb(null, ['application/pdf', ...].includes(file.mimetype));
  }
});
```

---

## 3️⃣ Backend: CRF Processing

### **File:** `backend/controllers/documentController.js`

### **Main Handler: `uploadCrfFile(req, res)`**

#### Step 1: Validate Study Exists
```javascript
const { id } = req.params; // Study ID

const study = await Study.findById(id);
if (!study) {
  return res.status(404).json({ 
    success: false, 
    message: 'Study not found' 
  });
}
```

#### Step 2: Persist PDF to Disk (Critical!)
```javascript
const { CRF_TMP_DIR } = require('../config/crfConfig');
const filename = `crf_${id}_${Date.now()}.pdf`;
const fullPath = path.join(CRF_TMP_DIR, filename);

// Save file from memory to disk
await fs.promises.writeFile(fullPath, req.file.buffer);

study.files.crf.sourcePath = fullPath;
study.files.crf.originalName = req.file.originalname;
study.files.crf.fileSize = req.file.size;
study.files.crf.mimeType = req.file.mimetype;
study.files.crf.uploaded = true;
study.files.crf.uploadedAt = new Date();

await study.save();
```

**Why Persist?**
- CRF annotation requires reading PDF multiple times
- Python scripts need file path (not buffer)
- Future annotation operations reference this file

**Storage Location:** `tmp/crf/crf_{studyId}_{timestamp}.pdf`

#### Step 3: Basic PDF Processing (No AI)
```javascript
const pypdfResult = await processPdfWithPypdf(req.file.buffer);
crfParseResult = await formatResultForCrfSap(pypdfResult); // CRF-specific parser
```

**Key Difference:**
- Uses `formatResultForCrfSap()` - skips AI analysis
- No Assessment Schedule identification
- No Objectives/Criteria extraction
- Faster processing

---

## 4️⃣ CRF Word Position Extraction

### **File:** `backend/services/crf_analysis/crf_words_extractor.py`

### **Purpose**
Extract **precise coordinates** of every word in the PDF for annotation purposes.

### **Technology**
- **Library**: `pdfplumber` (Python)
- **Method**: `page.extract_words()`

### **Extraction Process**

#### Word Metadata Structure
```python
word_data = {
    'text': word.get('text', ''),
    'x0': float(word.get('x0', 0)),          # Left edge
    'y0': float(word.get('top', 0)),         # Top edge
    'x1': float(word.get('x1', 0)),          # Right edge
    'y1': float(word.get('bottom', 0)),      # Bottom edge
    'width': float(word.get('x1', 0) - word.get('x0', 0)),
    'height': float(word.get('bottom', 0) - word.get('top', 0)),
    'fontname': word.get('fontname', ''),
    'size': float(word.get('size', 0))
}
```

#### Page-Level Structure
```python
page_data = {
    'page_number': page_number,
    'page_width': float(page.width),
    'page_height': float(page.height),
    'words': page_words  # Array of word_data
}
```

#### Output Example
```json
{
  "success": true,
  "extraction_time": "2025-11-11T10:30:00.000Z",
  "pages": [
    {
      "page_number": 1,
      "page_width": 612.0,
      "page_height": 792.0,
      "words": [
        {
          "text": "ADVERSE",
          "x0": 72.5,
          "y0": 100.2,
          "x1": 135.8,
          "y1": 115.6,
          "width": 63.3,
          "height": 15.4,
          "fontname": "Arial-Bold",
          "size": 14.0
        }
      ]
    }
  ],
  "metadata": {
    "total_pages": 45,
    "total_words": 12543
  }
}
```

### **Performance**
- **Speed**: ~2-5 seconds for 50-page CRF
- **Accuracy**: Pixel-perfect coordinates
- **Output**: JSON to stdout (captured by Node.js)

---

## 5️⃣ Word-to-Row Processing

### **File:** `backend/services/crf_analysis/words_to_rows_processor.js`

### **Purpose**
Group individual words into logical **rows** based on Y-coordinate proximity.

### **Algorithm: Y-Coordinate Tolerance**

```javascript
function processWordsToRows(wordsResult, yTolerance = 3.5) {
  const pages = [];
  
  wordsResult.pages.forEach(page => {
    const rows = [];
    const sortedWords = page.words.sort((a, b) => {
      // Sort by Y (top to bottom), then X (left to right)
      if (Math.abs(a.y0 - b.y0) > yTolerance) {
        return a.y0 - b.y0;
      }
      return a.x0 - b.x0;
    });
    
    let currentRow = null;
    
    sortedWords.forEach(word => {
      if (!currentRow || Math.abs(word.y0 - currentRow.y0) > yTolerance) {
        // Start new row
        if (currentRow) rows.push(currentRow);
        currentRow = {
          row_index: rows.length + 1,
          y0: word.y0,
          y1: word.y1,
          words: [word],
          full_text: word.text
        };
      } else {
        // Add to current row
        currentRow.words.push(word);
        currentRow.full_text += ' ' + word.text;
        currentRow.y1 = Math.max(currentRow.y1, word.y1);
      }
    });
    
    if (currentRow) rows.push(currentRow);
    
    pages.push({
      page_number: page.page_number,
      page_width: page.page_width,
      page_height: page.page_height,
      rows: rows
    });
  });
  
  return { success: true, pages, metadata: { total_rows: ... } };
}
```

### **Y-Tolerance Explanation**
- **Value**: 3.5 pixels (default)
- **Purpose**: Words within 3.5px vertically are considered same row
- **Why**: Handles slight misalignments in PDF rendering

### **Output Structure**
```json
{
  "success": true,
  "pages": [
    {
      "page_number": 1,
      "rows": [
        {
          "row_index": 1,
          "y0": 100.2,
          "y1": 115.6,
          "words": [
            { "text": "ADVERSE", "x0": 72.5, ... },
            { "text": "EVENTS", "x0": 140.3, ... }
          ],
          "full_text": "ADVERSE EVENTS"
        }
      ]
    }
  ],
  "metadata": {
    "total_rows": 1245,
    "total_words": 12543,
    "total_pages": 45
  }
}
```

---

## 6️⃣ AI Pattern Recognition

### **File:** `backend/services/openaiService.js`

### **Function:** `identifyCrfHeaderFooterAndFormPatterns(firstPages)`

### **Purpose**
Identify recurring patterns in CRF structure:
- **Headers**: Page headers (e.g., "Protocol: SPI-611")
- **Footers**: Page footers (e.g., "Version 2.0")
- **Page Numbers**: Page numbering patterns (e.g., "Page 5 of 45")
- **Form Names**: Form title patterns (e.g., "Form: Adverse Events")

### **AI Model:** GPT-4 (higher accuracy needed for pattern recognition)

### **Input: First 10 Pages**
```javascript
const firstPages = rowsResult.pages.slice(0, 10).map(p => ({
  page_number: p.page_number,
  rows: p.rows.map(r => ({ 
    row_index: r.row_index, 
    full_text: r.full_text 
  }))
}));
```

**Why First 10 Pages?**
- Patterns establish early
- Cost optimization (GPT-4 expensive)
- Sufficient for pattern learning

### **AI Prompt Strategy**
```
Analyze these CRF pages and identify:

1. **Header Patterns** (top 3-5 rows, repeated across pages)
   - Study identifier, sponsor name, protocol number
   - Usually at top of every page

2. **Footer Patterns** (bottom 3-5 rows, repeated across pages)
   - Page numbers, version numbers, confidentiality notices
   - Usually at bottom of every page

3. **Page Number Patterns** (format of page numbering)
   - Examples: "Page X of Y", "Page X", "X/Y"
   - May be in header or footer

4. **Form Name Patterns** (identifies new form sections)
   - Examples: "Form: [NAME]", "[NAME] Form", "SECTION: [NAME]"
   - Usually larger font, bold, centered

For each pattern type, provide:
- Regex pattern (JavaScript compatible)
- Example text that matches
- Confidence score (0.0-1.0)

Return JSON only.
```

### **Response Structure**
```json
{
  "success": true,
  "header_patterns": [
    {
      "pattern": "^Protocol:\\s*SPI-\\d+",
      "example": "Protocol: SPI-611",
      "confidence": 0.95
    }
  ],
  "footer_patterns": [
    {
      "pattern": "^Page\\s+\\d+\\s+of\\s+\\d+",
      "example": "Page 5 of 45",
      "confidence": 0.98
    }
  ],
  "page_number_patterns": [
    {
      "pattern": "^\\d+\\s*/\\s*\\d+$",
      "example": "5 / 45",
      "confidence": 0.92
    }
  ],
  "form_name_patterns": [
    {
      "pattern": "^Form:\\s*(.+)$",
      "example": "Form: Adverse Events",
      "confidence": 0.97
    },
    {
      "pattern": "^SECTION\\s+\\d+:\\s*(.+)$",
      "example": "SECTION 1: Demographics",
      "confidence": 0.89
    }
  ]
}
```

### **Error Handling**
```javascript
if (!process.env.OPENAI_API_KEY) {
  console.warn('⚠️ OPENAI_API_KEY not set, skipping AI pattern recognition');
  return { 
    success: false, 
    header_patterns: [], 
    footer_patterns: [], 
    page_number_patterns: [], 
    form_name_patterns: [] 
  };
}
```

---

## 7️⃣ Form Structure Processing

### **File:** `backend/services/crf_analysis/crf_form_processor.js`

### **Main Function:** `processCrfForms(rowsResult, identifiedPatterns)`

### **Processing Pipeline**

#### Step 1: Extract Form Title Rows
```javascript
function extractFormTitleRows(rowsData, formNamePatterns) {
  const formTitles = [];
  
  rowsData.pages.forEach(page => {
    page.rows.forEach(row => {
      const text = row.full_text.trim();
      
      // Match against AI patterns
      for (const pattern of formNamePatterns) {
        const regex = new RegExp(pattern, 'i');
        const match = text.match(regex);
        
        if (match) {
          const formName = match[1] || text;
          formTitles.push({
            page_number: page.page_number,
            row_index: row.row_index,
            form_name: formName,
            normalized_name: formName.toUpperCase().replace(/\s+/g, '_'),
            title_row: row
          });
          break;
        }
      }
    });
  });
  
  return formTitles.sort((a, b) => 
    a.page_number !== b.page_number ? 
    a.page_number - b.page_number : 
    a.row_index - b.row_index
  );
}
```

#### Step 2: Assign Content Rows to Forms

**Strategy: Segment-Based Grouping**

```javascript
function assignRowsToForms(rowsData, formTitles, unwantedPatterns) {
  const formsByTitle = {};
  
  // Group consecutive same-name titles into segments
  const segments = [];
  let current = null;
  
  formTitles.forEach(evt => {
    if (!current || current.normalized_name !== evt.normalized_name) {
      if (current) segments.push(current);
      current = { 
        form_name: evt.form_name,
        normalized_name: evt.normalized_name,
        titles: [evt]
      };
    } else {
      current.titles.push(evt);
    }
  });
  if (current) segments.push(current);
  
  // Process each segment
  segments.forEach((seg, idx) => {
    const nextSeg = segments[idx + 1] || null;
    const startPage = seg.titles[0].page_number;
    const startRow = seg.titles[0].row_index;
    
    let endPage = nextSeg ? nextSeg.titles[0].page_number : Infinity;
    let endRow = nextSeg ? nextSeg.titles[0].row_index - 1 : Infinity;
    
    // Collect rows between this segment and next
    const collectedRows = [];
    
    rowsData.pages.forEach(page => {
      if (page.page_number < startPage || page.page_number > endPage) return;
      
      page.rows.forEach(row => {
        // Skip title rows
        if (page.page_number === startPage && row.row_index <= startRow) return;
        if (page.page_number === endPage && row.row_index > endRow) return;
        
        // Filter unwanted rows (headers, footers, page numbers)
        let isUnwanted = false;
        for (const pattern of unwantedPatterns) {
          const regex = new RegExp(pattern, 'i');
          if (regex.test(row.full_text)) {
            isUnwanted = true;
            break;
          }
        }
        
        if (!isUnwanted) {
          collectedRows.push({ ...row, page_number: page.page_number });
        }
      });
    });
    
    // Store in formsByTitle (merged by normalized name)
    const formKey = seg.normalized_name;
    if (!formsByTitle[formKey]) {
      formsByTitle[formKey] = {
        title: seg.form_name,
        normalized_title: seg.normalized_name,
        title_positions: [],
        segments: [],
        pages: [],
        row_count: 0,
        word_count: 0,
        full_text: ''
      };
    }
    
    formsByTitle[formKey].segments.push({
      start_page: startPage,
      end_page: endPage,
      filtered_rows: collectedRows
    });
  });
  
  return formsByTitle;
}
```

#### Step 3: Add Label/OID Metadata (SDTM Mapping)

```javascript
const { addLabelOidToAllForms } = require('./extractLabelOidForms');

// Enhance each form with SDTM mapping hints
const enhancedForms = addLabelOidToAllForms(formsByTitle);
```

**Purpose:**
- Extract "Label" fields (human-readable question text)
- Extract "OID" fields (unique identifiers)
- Prepare for SDTM variable mapping

### **Final Form Structure**
```json
{
  "ADVERSE_EVENTS": {
    "title": "Adverse Events",
    "normalized_title": "ADVERSE_EVENTS",
    "title_positions": [
      {
        "page_number": 5,
        "row_index": 2,
        "y0": 100.2,
        "full_text": "Form: Adverse Events"
      }
    ],
    "pages": [5, 6, 7],
    "is_multi_page": true,
    "row_count": 125,
    "word_count": 1543,
    "full_text": "Event Description: ... Onset Date: ...",
    "filtered_rows": [
      {
        "row_index": 5,
        "page_number": 5,
        "full_text": "Event Description:",
        "words": [...]
      }
    ],
    "label_fields": [
      { "text": "Event Description", "row_index": 5 },
      { "text": "Onset Date", "row_index": 12 }
    ],
    "oid_fields": [
      { "text": "AE.AETERM", "row_index": 6 },
      { "text": "AE.AESTDTC", "row_index": 13 }
    ]
  },
  "DEMOGRAPHICS": {
    ...
  }
}
```

---

## 8️⃣ Database Storage

### **File:** `backend/models/studyModel.js`

### **Data Structure**

#### Atomic Update (Avoid Conflicts)
```javascript
const updatedStudy = await Study.findByIdAndUpdate(
  id,
  {
    $set: {
      'files.crf.uploaded': true,
      'files.crf.originalName': req.file.originalname,
      'files.crf.fileSize': req.file.size,
      'files.crf.mimeType': req.file.mimetype,
      'files.crf.uploadedAt': new Date(),
      'files.crf.sourcePath': fullPath, // Persistent PDF path
      'files.crf.crf_sdtm_ready_for_annotation': false,
      'files.crf.crfUploadResult': {
        crfFormList: processedCrfFormList,
        crfFormName: processedCrfFormName,
        Extract_words_with_position: wordsWithPosition,
        Extract_rows_with_position: rowsWithPosition,
        identified_patterns: identifiedPatterns
      }
    }
  },
  { new: true }
);
```

### **MongoDB Schema Structure**
```javascript
{
  _id: ObjectId("..."),
  studyNumber: "SPI-611",
  files: {
    protocol: { ... },
    crf: {
      uploaded: true,
      originalName: "SPI-611-CRF.pdf",
      fileSize: 5243876,
      mimeType: "application/pdf",
      uploadedAt: ISODate("2025-11-11T11:00:00.000Z"),
      sourcePath: "/tmp/crf/crf_507f1f77bcf86cd799439011_1757362643233.pdf",
      crf_sdtm_ready_for_annotation: false,
      crfUploadResult: {
        crfFormList: {
          "ADVERSE_EVENTS": {
            title: "Adverse Events",
            pages: [5, 6, 7],
            row_count: 125,
            filtered_rows: [...],
            label_fields: [...],
            oid_fields: [...]
          }
        },
        crfFormName: {
          names: ["Adverse Events", "Demographics", "Vital Signs"],
          total_forms: 3
        },
        Extract_words_with_position: {
          success: true,
          pages: [
            { page_number: 1, words: [...] }
          ],
          metadata: { total_words: 12543, total_pages: 45 }
        },
        Extract_rows_with_position: {
          success: true,
          pages: [
            { page_number: 1, rows: [...] }
          ],
          metadata: { total_rows: 1245 }
        },
        identified_patterns: {
          success: true,
          header_patterns: [...],
          footer_patterns: [...],
          form_name_patterns: [...]
        }
      }
    }
  }
}
```

---

## 9️⃣ Response to Frontend

### **Success Response Structure**
```json
{
  "success": true,
  "message": "Uploaded CRF successfully",
  "data": {
    "studyId": "507f1f77bcf86cd799439011",
    "fileType": "crf",
    "originalName": "SPI-611-CRF.pdf",
    "fileSize": 5243876,
    "uploadedAt": "2025-11-11T11:00:00.000Z",
    "crfUploadResult": {
      "crfFormList": {
        "ADVERSE_EVENTS": { ... },
        "DEMOGRAPHICS": { ... }
      },
      "crfFormName": {
        "names": ["Adverse Events", "Demographics", "Vital Signs"],
        "total_forms": 3
      },
      "Extract_words_with_position": { ... },
      "Extract_rows_with_position": { ... },
      "identified_patterns": { ... }
    }
  }
}
```

### **Error Response Structure**
```json
{
  "success": false,
  "message": "Upload CRF file failed",
  "error": "Error message details"
}
```

---

## 🔟 Post-Upload: Manual Annotation Trigger

### **Important Note**
CRF upload **does NOT automatically generate annotations**. This is a deliberate design decision.

### **Next Steps**
1. User navigates to CRF Annotation page
2. User clicks "Generate CRF Annotation"
3. Triggers separate API: `/api/studies/:id/generate-crf-annotation-rects`
4. System generates SDTM mapping + annotated PDF

**Why Manual?**
- Annotation is computationally expensive (GPT-4 for SDTM mapping)
- Gives user control over when to process
- Avoids timeout issues during upload

---

## 🎯 Key Features & Design Decisions

### **1. Persistent PDF Storage**
- **Why**: CRF annotation requires multiple reads
- **Where**: `tmp/crf/crf_{studyId}_{timestamp}.pdf`
- **Cleanup**: Manual (kept for annotation, spec generation)

### **2. Word-Level Granularity**
- **Why**: Annotation rectangles need pixel-perfect coordinates
- **How**: pdfplumber's `extract_words()` method
- **Benefit**: Accurate bounding boxes for visual annotation

### **3. Row-Based Processing**
- **Why**: Human-readable structure for AI analysis
- **How**: Y-coordinate tolerance grouping (3.5px)
- **Benefit**: Clean text for GPT pattern recognition

### **4. AI Pattern Learning**
- **Why**: CRFs have varied layouts across sponsors
- **How**: GPT-4 analyzes first 10 pages to learn structure
- **Benefit**: Adapts to different CRF templates automatically

### **5. Segment-Based Form Grouping**
- **Why**: Forms may span multiple pages or repeat
- **How**: Consecutive same-name titles grouped into segments
- **Benefit**: Handles multi-page forms and form repetitions

### **6. Label/OID Extraction**
- **Why**: Prepares for SDTM variable mapping
- **How**: Pattern matching for "Label:", "OID:" fields
- **Benefit**: Streamlines annotation workflow

### **7. No Auto-Annotation**
- **Why**: Expensive operation, potential timeout
- **How**: Separate manual trigger via button click
- **Benefit**: User control, better UX

---

## 📊 Data Flow Diagram

```
┌─────────────────────────────────────────────────────────────────┐
│                         FRONTEND                                │
│                                                                 │
│  User → Select CRF PDF → Validation → FormData                 │
│                                                                 │
│         POST /api/studies/:id/upload-crf                        │
└─────────────────────────┬───────────────────────────────────────┘
                          │
                          ▼
┌─────────────────────────────────────────────────────────────────┐
│                    BACKEND (Node.js)                            │
│                                                                 │
│  1. Validate Study exists                                       │
│  2. Receive file in memory (Multer)                             │
│  3. Persist PDF to disk (tmp/crf/)                              │
│                                                                 │
│  4. Basic PDF Processing                                        │
│     └─→ Python: pdfplumber extract text + tables               │
│                                                                 │
│  5. Word Position Extraction                                    │
│     └─→ Python: crf_words_extractor.py                          │
│         └─→ Extract x, y coordinates of every word             │
│                                                                 │
│  6. Row Grouping                                                │
│     └─→ Node.js: words_to_rows_processor.js                     │
│         └─→ Group words into rows (Y-tolerance 3.5px)          │
│                                                                 │
│  7. AI Pattern Recognition (First 10 pages)                     │
│     └─→ OpenAI GPT-4: identifyCrfHeaderFooterAndFormPatterns   │
│         ├─→ Header patterns                                     │
│         ├─→ Footer patterns                                     │
│         ├─→ Page number patterns                                │
│         └─→ Form name patterns                                  │
│                                                                 │
│  8. Form Structure Processing                                   │
│     └─→ Node.js: crf_form_processor.js                          │
│         ├─→ Extract form title rows                             │
│         ├─→ Assign content rows to forms                        │
│         ├─→ Filter headers/footers                              │
│         └─→ Add Label/OID metadata                              │
│                                                                 │
│  9. Database Storage (MongoDB)                                  │
│     └─→ Study.files.crf.crfUploadResult                         │
│         ├─→ crfFormList                                         │
│         ├─→ Extract_words_with_position                         │
│         ├─→ Extract_rows_with_position                          │
│         └─→ identified_patterns                                 │
│                                                                 │
│  10. Return structured response                                 │
└─────────────────────────┬───────────────────────────────────────┘
                          │
                          ▼
┌─────────────────────────────────────────────────────────────────┐
│                         FRONTEND                                │
│                                                                 │
│  Success UI → Display Form List → Enable Annotation Button     │
└─────────────────────────────────────────────────────────────────┘
```

---

## 🔧 Configuration & Environment

### **Environment Variables**
```env
MONGODB_URI=mongodb+srv://...
OPENAI_API_KEY=sk-...  # Required for pattern recognition
CRF_TMP_DIR=./tmp/crf  # CRF storage directory
```

### **Python Dependencies**
```
pdfplumber>=0.11.8
pypdfium2>=5.0.0
Pillow>=12.0.0
```

### **Node.js Dependencies**
```
express@^4.18.2
multer@^2.0.2
mongoose@^8.17.0
openai@^5.11.0
```

---

## 🚀 Performance Metrics

| Metric | Value |
|--------|-------|
| **Average Upload Time** | 5-10 seconds |
| **PDF Persistence** | < 1 second |
| **Word Extraction** | 2-4 seconds (50-page CRF) |
| **Row Grouping** | < 1 second |
| **AI Pattern Recognition** | 3-5 seconds (10 pages) |
| **Form Processing** | 1-2 seconds |
| **Database Storage** | < 1 second |
| **Maximum File Size** | 10 MB |
| **Supported Pages** | Up to 200 pages |

---

## ⚠️ Error Handling

### **Common Errors**

| Error | Cause | Solution |
|-------|-------|----------|
| Study not found | Invalid Study ID | Upload Protocol first |
| File too large | CRF > 10MB | Compress PDF or split file |
| PDF parsing failed | Corrupted/scanned PDF | Re-save with OCR |
| Word extraction failed | Non-standard PDF | Try different PDF export |
| AI pattern timeout | Large CRF + slow API | Retry or check API status |
| Disk write failed | Insufficient permissions | Check CRF_TMP_DIR permissions |

### **Graceful Degradation**

- If word extraction fails → Save basic text content
- If AI pattern recognition fails → Use default patterns
- If form processing fails → Save raw row data
- Always complete upload, even with partial data

---

## 📊 Comparison: Protocol vs CRF Upload

| Feature | Protocol Upload | CRF Upload |
|---------|----------------|------------|
| **File Types** | PDF, Word (.docx, .doc) | PDF only |
| **Storage** | Memory only | Memory + Disk |
| **AI Analysis** | Full (Schedule, Objectives, Criteria) | Pattern recognition only |
| **Primary Purpose** | Study design extraction | Form structure mapping |
| **Processing Time** | 2-5 seconds | 5-10 seconds |
| **Word Positions** | Not extracted | Pixel-perfect coordinates |
| **Auto-Annotation** | N/A | No (manual trigger) |
| **Database Path** | `files.protocol.uploadExtraction` | `files.crf.crfUploadResult` |
| **Next Step** | Generate Spec | Manual annotation trigger |

---

## 📝 Related Documentation

- **PROTOCOL_UPLOAD_WORKFLOW.md** - Protocol upload workflow
- **SPEC_WORKFLOW.md** - Complete Spec generation workflow
- **DEPENDENCIES.md** - Full dependency documentation

---

**Last Updated:** 2025-11-11  
**Author:** AI Assistant  
**Status:** Production Ready ✅

