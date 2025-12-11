# Internal Spec Generation Workflow

**Version**: 1.1  
**Last Updated**: March 2025  
**Service File**: `backend/services/SPEC_internal_spec_generation.js`

This document outlines the workflow for generating the "Internal Spec" Excel file, which combines standard SDTMIG v3.4 variable definitions with study-specific CRF mapping information.

---

## 1. Overview

The Internal Spec is a dynamic Excel report that serves as a bridge between the standard CDISC SDTMIG definitions and the specific data collection points (CRF) of a study.

- **Base Template**: All rows come from the `SDTMIG_v3.4` standard variables list.
- **Dynamic Content**: Additional columns (Form Name, Question, Variable, Type, Value) are populated based on the user's corrected CRF annotations.

---

## 2. Process Flow

### Step 1: Trigger
- **User Action**: Clicks "Download Internal Spec (SDTMIG v3.4)" on the Spec Taskpane.
- **Endpoint**: `POST /api/studies/:studyId/generate-internal-spec`
- **Controller**: `SpecDocumentController.generateInternalSpec`

### Step 2: Fetch Base Template (SDTMIG)
- **Source**: MongoDB `References` database.
- **Collection**: `SDTMIG_v3.4`
- **Query**: `{ sheet_name: 'Variables' }`
- **Data**: Retrieves ~1900 standard variable definitions (e.g., AE.AETERM, DM.BRTHDTC).
- **Columns**: `Dataset Name`, `Variable Name`, `Variable Label`, `Type`, `Codelist`, `Role`, etc.

### Step 3: Fetch Study Mapping Data
- **Source**: MongoDB `llxexcel` database (default connection).
- **Collection**: `studies`
- **Path**: `study.files.crf.crfUploadResult.crfFormList`
- **Target Array**: `Mapping_corrected_CRF_Annotation_Checklist` inside each Form.
- **Extracted Fields**:
  - `Dataset`: Derived from `Form_Mapping_Abbreviation` (e.g., "AE", "DM").
  - `Variable`: Derived from `Question_Variable` (e.g., "AETERM").
  - `Form`: Derived from `Form_Name` (e.g., "Adverse Events").
  - `Type`: Derived from `type` (sourced from OIDForm DataType).
  - `Value`: Derived from `value` (sourced from LabelForm value text).
  - `Question`: Derived from `Question` (e.g., "Site Number").

### Step 4: Data Enrichment (The Matching Logic)
This is the core logic where Study data meets Standard data.

1.  **Indexing**: An in-memory Map is built from the SDTMIG data for O(1) lookup:
    - Key: `${Dataset Name}_${Variable Name}` (Normalized to Uppercase)
    - Value: Row Index in the SDTMIG array.

2.  **SUPP Handling**:
    - If a CRF mapping points to a Supplemental Qualifier (e.g., `SUPPAE`), it is automatically treated as the parent domain (e.g., `AE`) for matching purposes.
    - *Example*: `SUPPAE.AETERM` -> matches `AE.AETERM` row in SDTMIG.

3.  **Slot Filling**:
    - The system iterates through every valid CRF mapping entry.
    - It locates the corresponding row in the SDTMIG template.
    - It finds the first available slot pair among 10 predefined slot groups:
        - `Form 1 Name`, `Form 1 Question`, `Form 1 Variable`, `Form 1 Type`, `Form 1 Value`
        - ...
        - `Form 10 Name`, `Form 10 Question`, `Form 10 Variable`, `Form 10 Type`, `Form 10 Value`
    - It populates the slot with the CRF data.

### Step 5: Excel Generation
- **Library**: `xlsx` (SheetJS)
- **Format**: `.xlsx`
- **Output**: A single sheet named "Variables".
- **Structure**:
    - Original SDTMIG columns (Left side)
    - Appended 50 columns (Right side): 10 sets of (Name, Question, Variable, Type, Value).

### Step 6: Download
- The file is saved to `backend/temp/`.
- A temporary download URL is returned to the frontend.
- The browser downloads the file.

---

## 3. Data Source Mapping Table

| Internal Spec Column | Source Database Field | Description |
| :--- | :--- | :--- |
| **Dataset Name** | `References.SDTMIG_v3.4.columns["Dataset Name"]` | Standard SDTM Domain (e.g., AE) |
| **Variable Name** | `References.SDTMIG_v3.4.columns["Variable Name"]` | Standard SDTM Variable (e.g., AETERM) |
| **Form i Name** | `studies...Mapping...Form_Name` | The CRF Form Name |
| **Form i Question** | `studies...Mapping...Question` | The Question text (e.g. "Did AE occur?") |
| **Form i Variable** | `studies...Mapping...Question_Variable` | The raw variable name from CRF (e.g. "AETERM") |
| **Form i Type** | `studies...Mapping...type` | Data Type from CRF OID (e.g., "text") |
| **Form i Value** | `studies...Mapping...value` | The CRF Value text or codes |

---

## 4. Key Constraints & Logic

1.  **[NOT SUBMITTED]**: Mappings with Dataset = `[NOT SUBMITTED]` are ignored.
2.  **Unmatched Variables**: If a CRF variable (e.g., `XX.CUSTOMVAR`) does not exist in the SDTMIG v3.4 standard, it is currently **not added** to the file (it only enriches existing rows).
3.  **Slot Limit**: Maximum 10 occurrences of the same variable across different forms can be recorded.

