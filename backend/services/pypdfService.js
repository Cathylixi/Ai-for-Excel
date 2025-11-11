const { execFile } = require('child_process');
const path = require('path');
const fs = require('fs');
const { promisify } = require('util');
const { extractStudyNumber: extractStudyNumberWithAI, identifyAssessmentScheduleForPdfTables } = require('./openaiService');

const execFileAsync = promisify(execFile);

/**
 * PDF processing service using Python pypdf library
 * Simplified version for text extraction only
 */
class PypdfService {
  constructor() {
    this.tempDir = path.join(__dirname, '../temp');
    this.pythonScript = path.join(__dirname, 'pdf_processor.py');
    
    // Ensure temporary directory exists
    this.ensureTempDir();
    
    // Check if Python script exists
    this.validatePythonScript();
  }

  /**
   * Ensure temporary directory exists
   */
  ensureTempDir() {
    if (!fs.existsSync(this.tempDir)) {
      fs.mkdirSync(this.tempDir, { recursive: true });
      console.log(`📁 Created temporary directory: ${this.tempDir}`);
    }
  }

  /**
   * Validate that Python script exists
   */
  validatePythonScript() {
    if (!fs.existsSync(this.pythonScript)) {
      throw new Error(`Python script not found: ${this.pythonScript}`);
    }
  }

  /**
   * Generate temporary file path
   * @returns {string} Temporary file path
   */
  generateTempFilePath() {
    const timestamp = Date.now();
    const randomStr = Math.random().toString(36).substring(7);
    return path.join(this.tempDir, `temp_pdf_${timestamp}_${randomStr}.pdf`);
  }

  /**
   * Clean up temporary file
   * @param {string} filePath - File path to delete
   */
  cleanupTempFile(filePath) {
    try {
      if (fs.existsSync(filePath)) {
        fs.unlinkSync(filePath);
        // // console.log(`🧹 Cleaned up temporary file: ${path.basename(filePath)}`);
      }
    } catch (error) {
      console.warn(`⚠️ Failed to clean up temporary file: ${error.message}`);
    }
  }

  /**
   * Check Python environment availability
   * @returns {Promise<boolean>} Whether Python is available
   */
  async checkPythonEnvironment() {
    try {
      await execFileAsync('python3', ['--version']);
      return true;
    } catch (error) {
      try {
        await execFileAsync('python', ['--version']);
        return true;
      } catch (error2) {
        return false;
      }
    }
  }

  /**
   * Get Python command (use absolute path to ensure correct environment)
   * @returns {Promise<string>} Python command
   */
  async getPythonCommand() {
    // Use absolute path to Anaconda Python to ensure correct environment
    const anacondaPython = '/opt/anaconda3/bin/python3';
    
    try {
      await execFileAsync(anacondaPython, ['--version']);
      // // console.log(`✅ Using Anaconda Python: ${anacondaPython}`);
      return anacondaPython;
    } catch (error) {
      console.warn(`⚠️ Anaconda Python not found, falling back to system Python`);
      
      try {
        await execFileAsync('python3', ['--version']);
        return 'python3';
      } catch (error2) {
        try {
          await execFileAsync('python', ['--version']);
          return 'python';
        } catch (error3) {
          throw new Error('Python environment not found. Please ensure Python is installed and accessible from command line');
        }
      }
    }
  }

  /**
   * Process PDF file using simplified pypdf approach
   * @param {Buffer} fileBuffer - PDF file buffer
   * @returns {Promise<Object>} Processing result
   */
  async processPdfWithPypdf(fileBuffer) {
    let tempFilePath = null;
    
    try {
      // // console.log('🐍 Starting simplified Python pypdf processing...');
      
      // Check Python environment
      const pythonCmd = await this.getPythonCommand();
      // // console.log(`✅ Using Python command: ${pythonCmd}`);
      
      // Create temporary file
      tempFilePath = this.generateTempFilePath();
      fs.writeFileSync(tempFilePath, fileBuffer);
      // // console.log(`📄 Created temporary PDF file: ${path.basename(tempFilePath)} (${(fileBuffer.length / 1024).toFixed(1)} KB)`);
      
      // Call Python script
      const startTime = Date.now();
      const { stdout, stderr } = await execFileAsync(pythonCmd, [this.pythonScript, tempFilePath], {
        maxBuffer: 10 * 1024 * 1024, // 10MB buffer for large files
        timeout: 300000 // 5 minutes timeout for large files
      });
      
      const processTime = Date.now() - startTime;
      // // console.log(`⏱️ Python processing time: ${processTime}ms`);
      
      // Check stderr output
      if (stderr && stderr.trim()) {
        console.warn(`⚠️ Python stderr: ${stderr}`);
      }
      
      // Parse Python output
      let result;
      try {
        result = JSON.parse(stdout);
      } catch (parseError) {
        throw new Error(`Failed to parse Python output: ${parseError.message}\nPython output: ${stdout.substring(0, 500)}`);
      }
      
      // Check processing result
      if (!result.success) {
        throw new Error(`Python processing failed: ${result.error}`);
      }
      
      // Add processing info
      result.processInfo = {
        processingTime: processTime,
        pythonCommand: pythonCmd,
        tempFileSize: fileBuffer.length,
        parseMethod: 'pdfplumber-simple'
      };
      
      // // console.log(`✅ pdfplumber processing completed: pages=${result.total_pages}, text=${result.text.length}, tables=${result.tables ? result.tables.length : 0}, time=${processTime}ms`);
      
      return result;
      
    } catch (error) {
      console.error('❌ pypdf processing failed:', error.message);
      
      // Return error result
      return {
        success: false,
        error: error.message,
        text: '',
        tables: [],
        total_pages: 0,
        processInfo: {
          processingTime: 0,
          pythonCommand: 'unknown',
          tempFileSize: fileBuffer.length,
          parseMethod: 'pdfplumber-failed'
        }
      };
    } finally {
      // Clean up temporary file
      if (tempFilePath) {
        this.cleanupTempFile(tempFilePath);
      }
    }
  }

  /**
   * Format simplified pypdf result for database storage
   * @param {Object} pypdfResult - pypdf processing result
   * @returns {Promise<Object>} Formatted result for database
   */
  async formatResultForDatabase(pypdfResult) {
    if (!pypdfResult.success) {
      return {
        extractedText: '',
        studyNumber: null,
        sectionedText: [],
        tables: [],
        assessmentSchedule: null,
        parseInfo: {
          hasStructuredContent: false,
          sectionsCount: 0,
          tablesCount: 0,
          parseMethod: pypdfResult.processInfo?.parseMethod || 'pdfplumber-failed',
          hasAssessmentSchedule: false,
          totalPages: 0
        }
      };
    }

    // 🐛 DEBUG: Save original extracted text to local file for inspection
    // this.saveDebugFiles(pypdfResult.text, 'original');

    // Extract Study Number and Header Pattern from text using AI
    const aiResult = await this.extractStudyNumber(pypdfResult.text);
    const studyNumber = aiResult.studyNumber;
    const headerInfo = aiResult.headerInfo;

    // Apply header filtering if header pattern was detected
    let filteredText = pypdfResult.text;
    if (headerInfo && headerInfo.hasHeader && headerInfo.headerPattern) {
      filteredText = this.filterHeaders(pypdfResult.text, headerInfo.headerPattern);
      // // console.log(`🧹 Header filtering applied. Text length: ${pypdfResult.text.length} → ${filteredText.length}`);
      
      // 🐛 DEBUG: Save filtered text for comparison
      // this.saveDebugFiles(filteredText, 'filtered');
    } else {
      // // console.log(`📝 No header pattern detected, using original text`);
    }

    // Extract sections from filtered text using multi-layer algorithm
    const sections = this.extractSectionsFromPdf(filteredText);

    // 🐛 DEBUG: Save sections to local file for inspection
    // this.saveSectionsDebug(sections);

    // Format PDF tables for mixed database schema
    const formattedTables = this.formatPdfTablesForDatabase(pypdfResult.tables);

    // Identify Assessment Schedule directly from PDF tables (array-based)
    let assessmentSchedule = null;
    let sdtmAnalysis = null;
    try {
      if (pypdfResult.tables && Array.isArray(pypdfResult.tables) && pypdfResult.tables.length > 0) {
        const identified = await identifyAssessmentScheduleForPdfTables(pypdfResult.tables);
        if (identified) {
          assessmentSchedule = {
            data: identified.data,
            source: 'pdf',
            tableIndex: identified.tableIndex,
            confidence: identified.confidence,
            identifiedBy: identified.identifiedBy,
            page: identified.page
          };

          // DEBUG: persist identified schedule of assessment to backend/temp for verification
          // this.saveAssessmentScheduleDebug(assessmentSchedule);

          // Extract procedures from first column for CostEstimateDetails.sdtmAnalysis.procedures
          // NOTE: Only extract procedures here, full SDTM analysis will be done in analyzeDocumentForSdtm
          const procedures = this.extractProceduresFromPdfTable(identified);
          if (procedures.length > 0) {
            console.log(`✅ Extracted ${procedures.length} procedures from PDF Assessment Schedule for later analysis`);
            sdtmAnalysis = {
              success: true,
              procedures: procedures,
              summary: {
                total_procedures: procedures.length,
                total_sdtm_domains: 0,
                unique_domains: [],
                highComplexitySdtm: { count: 0, domains: [] },
                mediumComplexitySdtm: { count: 0, domains: [] }
              }
            };
          } else {
            // // console.log('⚠️ No procedures extracted from PDF Assessment Schedule');
            sdtmAnalysis = {
              success: false,
              procedures: [],
              summary: {
                total_procedures: 0,
                total_sdtm_domains: 0,
                unique_domains: [],
                highComplexitySdtm: { count: 0, domains: [] },
                mediumComplexitySdtm: { count: 0, domains: [] }
              }
            };
          }
        }
      }
    } catch (e) {
      console.warn('⚠️ PDF Assessment Schedule identification/analysis failed:', e.message);
    }

    // Identify endpoints from section titles using AI, then attach content from sections
    let endpoints = [];
    try {
      const titles = sections.map(s => s.title || '');
      const ident = await require('./openaiService').identifyEndpoints(titles);
      endpoints = (ident || []).map(it => ({
        category: it.category,
        title: sections[it.index]?.title || titles[it.index] || '',
        cleanedTitle: it.cleaned_title,
        content: sections[it.index]?.content || '',
        level: sections[it.index]?.level || null,
        sectionIndex: it.index,
        extractMethod: 'ai'
      }));
    } catch (e) {
      console.warn('⚠️ Endpoint identification failed (PDF):', e.message);
    }

    return {
      extractedText: filteredText, // Now using filtered text!
      studyNumber: studyNumber,
      sectionedText: sections, // Now includes structured sections!
      tables: formattedTables, // Now formatted for mixed PDF/Word schema!
      assessmentSchedule,
      endpoints,
      sdtmAnalysis,
      parseInfo: {
        hasStructuredContent: sections.length > 0,
        sectionsCount: sections.length,
        tablesCount: formattedTables.length,
        parseMethod: pypdfResult.processInfo?.parseMethod || 'pdfplumber-advanced',
        hasAssessmentSchedule: !!assessmentSchedule,
        totalPages: pypdfResult.total_pages,
        processingTime: pypdfResult.processInfo?.processingTime || 0,
        headerFiltered: headerInfo ? headerInfo.hasHeader : false
      }
    };
  }

  /**
   * Format simplified pypdf result for CRF/SAP database storage (skipping Assessment Schedule)
   * @param {Object} pypdfResult - pypdf processing result
   * @returns {Promise<Object>} Formatted result for database (without assessmentSchedule)
   */
  async formatResultForCrfSap(pypdfResult) {
    if (!pypdfResult.success) {
      return {
        extractedText: '',
        studyNumber: null,
        sectionedText: [],
        tables: [],
        assessmentSchedule: null, // 🔥 CRF/SAP明确不处理
        parseInfo: {
          hasStructuredContent: false,
          sectionsCount: 0,
          tablesCount: 0,
          parseMethod: pypdfResult.processInfo?.parseMethod || 'pdfplumber-failed',
          hasAssessmentSchedule: false,
          totalPages: 0
        }
      };
    }

    // Extract Study Number and Header Pattern from text using AI (保持这个功能)
    const aiResult = await this.extractStudyNumber(pypdfResult.text);
    const studyNumber = aiResult.studyNumber;
    const headerInfo = aiResult.headerInfo;

    // Apply header filtering if header pattern was detected
    let filteredText = pypdfResult.text;
    if (headerInfo && headerInfo.hasHeader && headerInfo.headerPattern) {
      filteredText = this.filterHeaders(pypdfResult.text, headerInfo.headerPattern);
      // // console.log(`🧹 CRF/SAP Header filtering applied. Text length: ${pypdfResult.text.length} → ${filteredText.length}`);
    } else {
      // // console.log(`📝 CRF/SAP No header pattern detected, using original text`);
    }

    // Extract sections from filtered text using multi-layer algorithm
    const sections = this.extractSectionsFromPdf(filteredText);

    // Format PDF tables for mixed database schema
    const formattedTables = this.formatPdfTablesForDatabase(pypdfResult.tables);

    // 🔥 CRF/SAP: 完全跳过 Assessment Schedule 识别和 SDTM procedures 提取
    // // console.log('🚫 CRF/SAP: Skipping Assessment Schedule identification');

    return {
      extractedText: filteredText,
      studyNumber,
      sectionedText: sections,
      tables: formattedTables,
      assessmentSchedule: null, // 🔥 CRF/SAP明确设为null
      sdtmAnalysis: null,       // 🔥 CRF/SAP明确设为null
      parseInfo: {
        hasStructuredContent: sections.length > 0,
        sectionsCount: sections.length,
        tablesCount: formattedTables.length,
        parseMethod: pypdfResult.processInfo?.parseMethod || 'pdfplumber-crf-sap',
        hasAssessmentSchedule: false, // 🔥 CRF/SAP明确设为false
        totalPages: pypdfResult.total_pages,
        processingTime: pypdfResult.processInfo?.processingTime || 0,
        headerFiltered: headerInfo ? headerInfo.hasHeader : false
      }
    };
  }

  /**
   * Format PDF tables for mixed database schema (Word/PDF compatibility)
   * @param {Array} pdfTables - Raw tables from pdfplumber
   * @returns {Array} Formatted tables for database storage
   */
  formatPdfTablesForDatabase(pdfTables) {
    if (!pdfTables || !Array.isArray(pdfTables)) {
      return [];
    }

    return pdfTables.map((table, index) => {
      // Validate table data
      if (!table.data || !Array.isArray(table.data) || table.data.length === 0) {
        console.warn(`⚠️ Table ${index + 1} has no valid data, skipping`);
        return null;
      }

      // Clean and validate each row
      const cleanedData = table.data.map(row => {
        if (!Array.isArray(row)) {
          return [];
        }
        return row.map(cell => {
          // Convert to string and clean up
          if (cell === null || cell === undefined) {
            return '';
          }
          return String(cell).trim();
        });
      }).filter(row => row.length > 0); // Remove empty rows

      if (cleanedData.length === 0) {
        console.warn(`⚠️ Table ${index + 1} has no valid rows after cleaning, skipping`);
        return null;
      }

      // Calculate consistent column count
      const maxColumns = Math.max(...cleanedData.map(row => row.length));
      
      // Pad rows to have consistent column count
      const normalizedData = cleanedData.map(row => {
        while (row.length < maxColumns) {
          row.push('');
        }
        return row;
      });

      // // console.log(`📊 Formatted PDF table ${index + 1}: ${normalizedData.length} rows × ${maxColumns} columns (page ${table.page})`);

      return {
        // PDF-specific fields
        data: normalizedData,
        page: table.page || 1,
        rows: normalizedData.length,
        columns: maxColumns,
        
        // Required common fields
        source: 'pdf',
        tableIndex: table.table_index || index + 1,
        extractedAt: new Date()
      };
    }).filter(table => table !== null); // Remove null entries
  }

  /**
   * DEBUG: Save identified Assessment Schedule to backend/temp for human verification.
   * Saves as CSV file for easy viewing in Excel or other tools.
   * @param {{ data?: string[][], htmlContent?: string, source?: string, tableIndex?: number, confidence?: number, identifiedBy?: string, page?: number }} schedule
   */
  saveAssessmentScheduleDebug(schedule) {
    try {
      if (!schedule) return;
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
      const source = schedule.source || (schedule.htmlContent ? 'word' : 'pdf');
      const baseName = `debug_assessment_schedule_${source}_${timestamp}`;

      // Save metadata as JSON
      const metaData = {
        source: source,
        tableIndex: schedule.tableIndex ?? null,
        confidence: schedule.confidence ?? null,
        identifiedBy: schedule.identifiedBy || null,
        page: schedule.page ?? null,
        savedAt: new Date().toISOString()
      };

      const metaPath = path.join(this.tempDir, `${baseName}_meta.json`);
      fs.writeFileSync(metaPath, JSON.stringify(metaData, null, 2), 'utf8');
      // // console.log(`🐛 DEBUG: Assessment Schedule metadata saved to ${metaPath}`);

      // Save table data as CSV
      if (schedule.data && Array.isArray(schedule.data)) {
        // Convert 2D array to CSV format
        const csvContent = schedule.data.map(row => {
          if (!Array.isArray(row)) return '';
          // Escape CSV values: wrap in quotes if contains comma, quote, or newline
          return row.map(cell => {
            const cellStr = String(cell || '');
            if (cellStr.includes(',') || cellStr.includes('"') || cellStr.includes('\n')) {
              // Escape quotes by doubling them, then wrap in quotes
              return `"${cellStr.replace(/"/g, '""')}"`;
            }
            return cellStr;
          }).join(',');
        }).join('\n');

        const csvPath = path.join(this.tempDir, `${baseName}.csv`);
        fs.writeFileSync(csvPath, csvContent, 'utf8');
        // // console.log(`🐛 DEBUG: Assessment Schedule CSV saved to ${csvPath}`);
        // // console.log(`📊 CSV contains ${schedule.data.length} rows × ${schedule.data[0]?.length || 0} columns`);
      }

      // If HTML is available, also save full HTML separately for convenient viewing
      if (schedule.htmlContent) {
        const htmlPath = path.join(this.tempDir, `${baseName}.html`);
        fs.writeFileSync(htmlPath, String(schedule.htmlContent), 'utf8');
        // // console.log(`🐛 DEBUG: Assessment Schedule HTML saved to ${htmlPath}`);
      }
    } catch (err) {
      console.warn('⚠️ Failed to save Assessment Schedule debug file:', err.message);
    }
  }

  /**
   * Extract procedures (first column textual activities) from a PDF Assessment Schedule table (array-based).
   * This mirrors the HTML flow but operates directly on 2D arrays.
   * @param {{ data: string[][] }} pdfTable
   * @returns {string[]} unique procedures list
   */
  extractProceduresFromPdfTable(pdfTable) {
    try {
      if (!pdfTable || !Array.isArray(pdfTable.data)) return [];
      const rows = pdfTable.data;
      const procedures = [];
      let headerSkipped = false;

      for (let r = 0; r < rows.length; r++) {
        const row = Array.isArray(rows[r]) ? rows[r] : [];
        if (row.length === 0) continue;
        const firstCell = String(row[0] ?? '').trim();
        if (!firstCell) continue;

        if (!headerSkipped) {
          const headerKeywords = ['procedure', 'assessment', 'activity', 'visit', 'evaluation', 'test'];
          const isHeader = headerKeywords.some(k => firstCell.toLowerCase().includes(k) && firstCell.length < 50);
          if (isHeader) {
            headerSkipped = true;
            continue;
          }
        }

        if (
          firstCell &&
          firstCell.length > 3 &&
          firstCell.length < 150 &&
          !/^\d+$/.test(firstCell) &&
          !/^[A-Z]\d*$/.test(firstCell) &&
          firstCell !== '-' &&
          firstCell !== 'N/A'
        ) {
          const isTimePoint = /^(Day\s+\d+\s+(Pre|Post)[\s-]?dose|Visit\s+\d+|Week\s+\d+|Month\s+\d+|Screening\s*$|Baseline\s*$|Follow[\s-]?up\s*$|End\s+of\s+Study|EOS\s*$|Cycle\s+\d+\s*$)/i.test(firstCell);
          const isTooDescriptive = firstCell.length > 100 && firstCell.includes(':');
          if (!isTimePoint && !isTooDescriptive) {
            procedures.push(firstCell);
          }
        }
      }

      return Array.from(new Set(procedures));
    } catch (err) {
      console.warn('extractProceduresFromPdfTable failed:', err.message);
      return [];
    }
  }

  /**
   * Filter out repeating headers from PDF text (supports multi-line headers)
   * @param {string} text - Original PDF text
   * @param {string} headerPattern - Header pattern with PAGE_NUM placeholder (can be multi-line)
   * @returns {string} Filtered text
   */
  filterHeaders(text, headerPattern) {
    try {
      // // console.log(`🔍 Original AI header pattern: ${headerPattern}`);
      
      // Step 1: Handle multi-line headers by replacing \n with flexible whitespace
      let regexPattern = headerPattern.replace(/\n/g, '\\s*\\n\\s*');
      
      // Step 2: Replace PAGE_NUM with \d+ for current page number
      regexPattern = regexPattern.replace(/PAGE_NUM/g, '\\d+');
      
      // Step 3: Generalize total page numbers (e.g., "of 56" → "of \d+")
      regexPattern = regexPattern.replace(/of\s+\d+/g, 'of\\s+\\d+');
      
      // Step 4: Handle variable spacing around "Page" and "of"
      regexPattern = regexPattern.replace(/Page\s+/g, 'Page\\s+');
      regexPattern = regexPattern.replace(/\s+of\s+/g, '\\s+of\\s+');
      
      // Step 5: Escape regex special characters carefully
      // First, protect our intentional regex patterns by replacing them with placeholders
      regexPattern = regexPattern.replace(/\\d\+/g, '__DIGIT_PATTERN__');
      regexPattern = regexPattern.replace(/\\s\+/g, '__SPACE_PATTERN__');
      regexPattern = regexPattern.replace(/\\s\*\\n\\s\*/g, '__NEWLINE_PATTERN__');
      
      // Now escape other special characters
      regexPattern = regexPattern.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      
      // Restore our regex patterns
      regexPattern = regexPattern.replace(/__DIGIT_PATTERN__/g, '\\d+');
      regexPattern = regexPattern.replace(/__SPACE_PATTERN__/g, '\\s+');
      regexPattern = regexPattern.replace(/__NEWLINE_PATTERN__/g, '\\s*\\n\\s*');
      
      // // console.log(`🎯 Final header regex pattern: ${regexPattern}`);
      
      const headerRegex = new RegExp(regexPattern, 'gims'); // Added 's' flag for . to match newlines
      const originalLength = text.length;
      
      // Remove all matching headers
      const filteredText = text.replace(headerRegex, '');
      
      const removedChars = originalLength - filteredText.length;
      // // console.log(`🧹 Header filtering successful: removed ${removedChars} characters`);
      
      // Show examples of what was filtered (first few matches)
      const matches = text.match(headerRegex);
      // if (matches && matches.length > 0) {
      //   // console.log(`📋 Filtered header examples (first 3):`);
      //   matches.slice(0, 3).forEach((match, index) => {
      //     // console.log(`  ${index + 1}. "${match.substring(0, 100)}${match.length > 100 ? '...' : ''}"`);
      //   });
      //   // console.log(`  Total ${matches.length} header instances removed`);
      // }
      
      return filteredText;
    } catch (error) {
      console.error(`❌ Header filtering failed: ${error.message}`);
      console.error(`Pattern that failed: ${headerPattern}`);
      console.warn(`⚠️ Using original text without header filtering`);
      return text;
    }
  }

  /**
   * Extract sections from PDF text using hierarchical structure recognition
   * @param {string} text - PDF text content (after header filtering)
   * @returns {Array} Array of hierarchical section objects
   */
  extractSectionsFromPdf(text) {
    console.log('📚 Starting hierarchical PDF section extraction...');
    
    // Step 1: Identify Table of Contents positions
    const tocInfo = this.identifyTableOfContents(text);
    console.log(`📖 Found ${tocInfo.length} Table of Contents sections`);
    
    // Step 2: Find all numbered titles and their positions (excluding TOC areas)
    const numberedTitles = this.findNumberedTitles(text, tocInfo);
    console.log(`🔢 Found ${numberedTitles.length} numbered titles`);
    
    // Step 3: Handle pre-numbered content (everything before first numbered section, excluding TOC)
    const preNumberedSections = this.extractPreNumberedContent(text, numberedTitles, tocInfo);
    console.log(`📋 Pre-numbered sections: ${preNumberedSections.length}`);
    
    // Step 4: Extract complete Table of Contents sections
    const tocSections = this.extractTableOfContentsSections(text, tocInfo, numberedTitles);
    console.log(`📖 Extracted ${tocSections.length} complete TOC sections`);
    
    // Step 5: Create hierarchical sections with proper content ranges
    const hierarchicalSections = this.createHierarchicalSections(text, numberedTitles);
    console.log(`🏗️ Hierarchical sections: ${hierarchicalSections.length}`);
    
    // Step 6: Combine all sections in proper order
    const allSections = [...preNumberedSections, ...tocSections, ...hierarchicalSections];
    console.log(`✅ Total sections: ${allSections.length}`);
    
    // Step 7: Validate and clean up
    const finalSections = this.validateSections(allSections);
    console.log(`🧹 Final valid sections: ${finalSections.length}`);
    
    return finalSections;
  }

  /**
   * Identify Table of Contents positions in the text
   * @param {string} text - PDF text content
   * @returns {Array} Array of TOC info objects with start and end positions
   */
  identifyTableOfContents(text) {
    const tocSections = [];
    const lines = text.split('\n');
    
    // TOC patterns to look for
    const tocPatterns = [
      /^TABLE\s+OF\s+CONTENTS?$/i,
      /^CONTENTS?$/i,
      /^Table\s+of\s+Contents?$/i
    ];
    
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim();
      
      // Check if this line is a TOC title
      const isTocTitle = tocPatterns.some(pattern => pattern.test(line));
      
      if (isTocTitle) {
        // // console.log(`📖 Found TOC at line ${i}: "${line}"`);
        
        // Find TOC end position
        const tocEnd = this.findTocEndPosition(lines, i);
        
        tocSections.push({
          title: line,
          startLine: i,
          endLine: tocEnd,
          startPosition: this.getLinePosition(text, i),
          endPosition: this.getLinePosition(text, tocEnd)
        });
        
        // // console.log(`📖 TOC spans from line ${i} to line ${tocEnd}`);
      }
    }
    
    return tocSections;
  }

  /**
   * Find the end position of a Table of Contents section
   * @param {Array} lines - Array of text lines
   * @param {number} tocStartLine - Line where TOC starts
   * @returns {number} Line number where TOC ends
   */
  findTocEndPosition(lines, tocStartLine) {
    // Look for the next real Level 1 section after TOC
    const level1Patterns = [
      /^(\d+)\s*\.?\s+([A-Z][A-Z\s]+[A-Z]|[A-Z][a-zA-Z\s,]+)$/,  // "1 INTRODUCTION"
      /^(APPENDIX|REFERENCES?|BIBLIOGRAPHY)$/i                    // Other major sections
    ];
    
    for (let i = tocStartLine + 1; i < lines.length; i++) {
      const line = lines[i].trim();
      
      // Check if this is a real Level 1 section (not a TOC entry)
      for (const pattern of level1Patterns) {
        if (pattern.test(line)) {
          // Double check this isn't a TOC entry by looking at context
          if (!this.isTocEntry(lines, i)) {
            // console.log(`📖 TOC ends at line ${i-1}, next section: "${line}"`);
            return i - 1;
          }
        }
      }
    }
    
    // If no clear end found, TOC extends to end of document
    return lines.length - 1;
  }

  /**
   * Check if a line is a TOC entry (vs. a real section title)
   * @param {Array} lines - Array of text lines
   * @param {number} lineIndex - Index of line to check
   * @returns {boolean} True if this appears to be a TOC entry
   */
  isTocEntry(lines, lineIndex) {
    const line = lines[lineIndex].trim();
    
    // TOC entries usually have dots and page numbers
    if (line.match(/\.{3,}/)) return true;  // Contains "..."
    if (line.match(/\.\s*\d+\s*$/)) return true;  // Ends with ".15" or similar
    
    // Check surrounding lines for TOC-like pattern
    const context = lines.slice(Math.max(0, lineIndex - 2), lineIndex + 3).join('\n');
    if (context.match(/\.{3,}/)) return true;  // Context has TOC dots
    
    return false;
  }

  /**
   * Get character position of a line in the text
   * @param {string} text - Full text
   * @param {number} lineNumber - Line number (0-based)
   * @returns {number} Character position
   */
  getLinePosition(text, lineNumber) {
    const lines = text.split('\n');
    let position = 0;
    for (let i = 0; i < lineNumber && i < lines.length; i++) {
      position += lines[i].length + 1; // +1 for newline
    }
    return position;
  }

  /**
   * Extract complete Table of Contents sections
   * @param {string} text - PDF text content
   * @param {Array} tocInfo - Array of TOC position info
   * @param {Array} numberedTitles - Array of numbered titles (for context)
   * @returns {Array} Array of complete TOC sections
   */
  extractTableOfContentsSections(text, tocInfo, numberedTitles) {
    const tocSections = [];
    
    for (const toc of tocInfo) {
      // Extract the complete TOC content
      const tocContent = text.substring(toc.startPosition, toc.endPosition).trim();
      
      // Determine TOC level based on context
      let tocLevel = 1;
      
      // If there are numbered titles before this TOC, it might be a sub-TOC
      const titlesBeforeToc = numberedTitles.filter(title => 
        title.startPosition < toc.startPosition
      );
      
      if (titlesBeforeToc.length > 0) {
        // This is a TOC in the middle of document, keep it as level 1
        tocLevel = 1;
      }
      
      const tocSection = {
        title: toc.title,
        level: tocLevel,
        content: tocContent,
        source: "table-of-contents",
        type: "toc",
        originalLine: toc.title,
        startPosition: toc.startPosition,
        endPosition: toc.endPosition
      };
      
      tocSections.push(tocSection);
      // // console.log(`📖 Created TOC section: "${toc.title}" (${tocContent.length} chars)`);
    }
    
    return tocSections;
  }

  /**
   * 🔥 辅助函数：解析编号字符串为路径数组
   * @param {string} numberStr - 编号字符串，如 "5.2.1"
   * @returns {Array<number>} 路径数组，如 [5, 2, 1]
   */
  parseNumberPath(numberStr) {
    return numberStr.split('.').map(n => parseInt(n, 10));
  }

  /**
   * 🔥 辅助函数：检查新编号是否是合法的下一个编号（符合继承约束）
   * @param {Array<number>} currentPath - 当前路径，如 [5, 2]
   * @param {Array<number>} newPath - 新候选路径，如 [5, 3]
   * @returns {boolean} 是否合法
   */
  isValidNextNumber(currentPath, newPath) {
    const m = newPath.length;     // 新路径深度
    const n = currentPath.length; // 当前路径深度
    
    // ========== 规则1：同级兄弟 (next sibling) ==========
    // 示例：5.2 → 5.3
    // 要求：深度相同，前缀相同，最后一段递增
    if (m === n) {
      // 检查前缀是否完全相同（除了最后一段）
      for (let i = 0; i < n - 1; i++) {
        if (newPath[i] !== currentPath[i]) {
          return false; // 前缀不同，不合法
        }
      }
      
      // 检查最后一段是否递增（严格 +1，防止跳号）
      return newPath[m - 1] === currentPath[n - 1] + 1;
    }
    
    // ========== 规则2：首个子节点 (first child) ==========
    // 示例：5.2 → 5.2.1
    // 要求：深度+1，前缀完全相同，新段为1
    if (m === n + 1) {
      // 检查前缀是否完全相同
      for (let i = 0; i < n; i++) {
        if (newPath[i] !== currentPath[i]) {
          return false;
        }
      }
      
      // 检查新最后一段是否为1
      return newPath[m - 1] === 1;
    }
    
    // ========== 规则3：跳回祖先级 (ancestor sibling) ==========
    // 示例：5.2.3 → 5.3 或 5.2.3 → 6
    // 要求：深度减少，回到某个祖先级并递增
    if (m < n) {
      // 前缀（除最后一段外）必须保持一致
      for (let i = 0; i < m - 1; i++) {
        if (newPath[i] !== currentPath[i]) {
          return false;
        }
      }

      const ancestorIndex = m - 1;
      return newPath[ancestorIndex] === currentPath[ancestorIndex] + 1;
    }
    
    // ========== 其他情况：不合法 ==========
    // 例如：深度跳跃增加（5 → 5.2.1，跳过了 5.1）
    return false;
  }

  /**
   * Find all numbered titles in the text with their positions and hierarchy levels
   * @param {string} text - PDF text content
   * @param {Array} tocInfo - Array of TOC position info to exclude
   * @returns {Array} Array of numbered title objects
   */
  /**
   * 🔥 新增：检测文本是否像"内容"而非"标题"
   * @param {string} cleanTitle - 清理后的标题文本
   * @returns {boolean} true = 像内容（应拒绝），false = 像标题（可接受）
   */
  looksLikeContentNotHeading(cleanTitle) {
    // 1. 包含问号（问句通常是列表项内容，不是标题）
    if (cleanTitle.includes('?')) {
      return true;
    }
    
    // 2. 以疑问词或常见动词开头（典型的句子/列表项）
    if (/^(Does|Is|Has|Have|Will|Can|Should|Must|May|Do|Are|Was|Were|Perform|Complete|Review|Provide|Include|Exclude)\b/i.test(cleanTitle)) {
      return true;
    }
    
    // 3. 包含多个逗号（复杂句子，不太可能是标题）
    const commaCount = (cleanTitle.match(/,/g) || []).length;
    if (commaCount >= 2) {
      return true;
    }
    
    // 4. 标题过长且包含连词（典型的句子）
    if (cleanTitle.length > 80 && /\b(and|or|but|if|when|that|which|because|while|since|unless)\b/i.test(cleanTitle)) {
      return true;
    }
    
    // 5. 以等号开头（如 "1 = Mild AE: ..."）
    if (/^[=:]/.test(cleanTitle.trim())) {
      return true;
    }
    
    return false;
  }

  findNumberedTitles(text, tocInfo = []) {
    const numberedTitles = [];
    const lines = text.split('\n');
    
    // 🔥 维护当前已接受的编号路径
    let currentPath = null;  // 初始为null，表示还没有接受任何标题
    
    // 🔥 标题长度限制
    const MIN_TITLE_LEN = 4;
    const MAX_TITLE_LEN = 120;
    
    // 🔥 地址/页脚关键词（用于过滤噪音）
    const ADDRESS_KEYWORDS = /\b(?:Drive|Street|Avenue|Road|Blvd|Boulevard|Suite|Zip|CA|USA|Tel|Telephone|Fax|Email|Inc|LLC|Ltd|Corporation|Corp)\b/i;
    
    let currentPosition = 0;
    const numericHeadingRegex = /^(\d+(?:\.\d+)*)(?:[.)])?\s+(.+?)(?:\.{2,}\s*(\d+))?$/;
    const appendixHeadingRegex = /^(Appendix\s+[A-Z](?:\.\d+)*)(?:[.)])?\s+(.+?)(?:\.{2,}\s*(\d+))?$/i;
    
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim();
      const lineStartPos = currentPosition;
      currentPosition += lines[i].length + 1; // +1 for newline
      
      if (!line) continue;
      
      // Check if this line is within any TOC area
      const isInToc = tocInfo.some(toc => 
        i >= toc.startLine && i <= toc.endLine
      );
      
      if (isInToc) {
        // Skip numbered titles that are inside TOC
        continue;
      }
      
      let match = line.match(numericHeadingRegex);
      let headingType = null;

      if (match) {
        headingType = 'numeric-heading';
      } else {
        match = line.match(appendixHeadingRegex);
        if (match) {
          headingType = 'appendix-heading';
        }
      }

      if (!match) {
        continue;
      }

      const numberPart = match[1];
      const rawTitlePart = match[2] ? match[2].trim() : '';
      const pagePart = match[3] ? parseInt(match[3], 10) : null;

      const cleanTitle = rawTitlePart
        .replace(/\.{3,}.*$/, '')
        .replace(/\s+\d+\s*$/, '')
        .trim();

      // 🔥 标题长度限制
      if (cleanTitle.length < MIN_TITLE_LEN) {
        console.log(`⚠️ [REJECTED] "${numberPart} ${cleanTitle}" - Title too short (${cleanTitle.length} < ${MIN_TITLE_LEN})`);
        continue;
      }
      if (cleanTitle.length > MAX_TITLE_LEN) {
        console.log(`⚠️ [REJECTED] "${numberPart} ${cleanTitle.substring(0, 50)}..." - Title too long (${cleanTitle.length} > ${MAX_TITLE_LEN})`);
        continue;
      }

      // 🔥 新增：内容特征检测（拒绝问句、列表项等）
      if (this.looksLikeContentNotHeading(cleanTitle)) {
        console.log(`⚠️ [REJECTED] "${numberPart} ${cleanTitle.substring(0, 60)}..." - Looks like content, not heading (contains question/verb/commas)`);
        continue;
      }

      let level = 1;
      let newPath = null;
      const isNumericHeading = headingType === 'numeric-heading';

      if (isNumericHeading) {
        level = numberPart.split('.').length;
        newPath = this.parseNumberPath(numberPart);
        
        const isSingleLevel = level === 1;
        const singleNumber = isSingleLevel ? newPath[0] : null;

        // 🔥 过滤单段大数字（≥50，通常是地址/页码等噪音）
        if (isSingleLevel && singleNumber >= 50) {
          console.log(`⚠️ [REJECTED] "${numberPart} ${cleanTitle}" - Single-level number too large (${singleNumber} ≥ 50, likely address/footer)`);
          continue;
        }

        // 🔥 过滤地址/页脚特征
        if (isSingleLevel && ADDRESS_KEYWORDS.test(cleanTitle)) {
          console.log(`⚠️ [REJECTED] "${numberPart} ${cleanTitle}" - Contains address/footer keywords`);
          continue;
        }

        // 🔥 首章必须从 1 开始
        if (currentPath === null) {
          if (!(isSingleLevel && singleNumber === 1)) {
            console.log(`⚠️ [REJECTED] "${numberPart} ${cleanTitle}" - First chapter must be "1", not "${numberPart}"`);
            continue;
          }
          // 通过：这是第一个有效的章节标题 "1 ..."
        }

        // 🔥 保持原有的严格编号继承约束
        if (currentPath !== null) {
          if (!this.isValidNextNumber(currentPath, newPath)) {
            console.log(`⚠️ [REJECTED] "${numberPart} ${cleanTitle}" - Invalid numbering sequence (current: ${currentPath.join('.')}, new: ${newPath.join('.')})`);
            continue;
          }
        }
      } else {
        // Appendix 标题处理
        const appendixId = numberPart.replace(/^Appendix\s+/i, '');
        const appendixSegments = appendixId.split('.');
        level = appendixSegments.length;
      }

      numberedTitles.push({
        number: numberPart,
        title: cleanTitle,
        level,
        type: headingType,
        page: pagePart || null,
        lineIndex: i,
        startPosition: lineStartPos,
        originalLine: line
      });

      if (isNumericHeading) {
        currentPath = newPath;
        console.log(`✅ [ACCEPTED] "${numberPart} ${cleanTitle}" (level ${level})`);
      }
    }
    
    console.log(`🎯 Total numbered titles accepted: ${numberedTitles.length}`);
    return numberedTitles;
  }

  /**
   * Extract content before the first numbered section (excluding TOC areas)
   * @param {string} text - PDF text content
   * @param {Array} numberedTitles - Array of numbered titles
   * @param {Array} tocInfo - Array of TOC position info to exclude
   * @returns {Array} Array of pre-numbered sections
   */
  extractPreNumberedContent(text, numberedTitles, tocInfo = []) {
    const preNumberedSections = [];
    
    if (numberedTitles.length === 0) {
      // No numbered sections found, need to exclude TOC from entire text
      if (tocInfo.length > 0) {
        // Extract content excluding TOC areas
        let cleanContent = '';
        let lastPos = 0;
        
        for (const toc of tocInfo) {
          // Add content before this TOC
          cleanContent += text.substring(lastPos, toc.startPosition);
          lastPos = toc.endPosition + 1;
        }
        
        // Add remaining content after last TOC
        cleanContent += text.substring(lastPos);
        
        if (cleanContent.trim().length > 0) {
          return [{
            title: "Document Content",
            level: 1,
            content: cleanContent.trim(),
            source: "pre-numbered",
            type: "document-content"
          }];
        }
      } else {
        // No TOC, treat entire text as one section
        return [{
          title: "Document Content",
          level: 1,
          content: text.trim(),
          source: "pre-numbered",
          type: "document-content"
        }];
      }
    }
    
    const firstNumberedPosition = numberedTitles[0].startPosition;
    let preContent = text.substring(0, firstNumberedPosition);
    
    // Remove TOC areas from pre-numbered content
    for (const toc of tocInfo) {
      if (toc.endPosition < firstNumberedPosition) {
        // This TOC is within the pre-numbered area, exclude it
        const beforeToc = text.substring(0, toc.startPosition);
        const afterToc = text.substring(toc.endPosition + 1, firstNumberedPosition);
        preContent = beforeToc + afterToc;
        // // console.log(`📋 Excluded TOC "${toc.title}" from pre-numbered content`);
      }
    }
    
    preContent = preContent.trim();
    
    if (preContent.length === 0) {
      return []; // No pre-numbered content after excluding TOC
    }
    
    // Split pre-numbered content into logical sections (excluding TOC patterns)
    const sections = this.splitPreNumberedContent(preContent, true); // Pass flag to exclude TOC
    // // console.log(`📋 Pre-numbered content split into ${sections.length} sections`);
    
    return sections;
  }

  /**
   * Split pre-numbered content into logical sections
   * @param {string} content - Pre-numbered content
   * @param {boolean} excludeToc - Whether to exclude TOC-related triggers
   * @returns {Array} Array of sections
   */
  splitPreNumberedContent(content, excludeToc = false) {
    const sections = [];
    const lines = content.split('\n');
    
    let currentSection = null;
    let sectionTriggers = [
      'Clinical Protocol',
      'List of',
      'Synopsis',
      'Background',
      'Abbreviations'
    ];
    
    // Only include TOC trigger if not excluding TOC
    if (!excludeToc) {
      sectionTriggers.push('Table of Contents');
    }
    
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim();
      
      if (!line) continue;
      
      // Check if this line starts a new section
      const isNewSection = sectionTriggers.some(trigger => 
        line.toUpperCase().includes(trigger.toUpperCase()) && line.length < 100
      );
      
      if (isNewSection) {
        // Save previous section
        if (currentSection) {
          const cleanContent = currentSection.content.trim();
          currentSection.content = cleanContent.length > 0 ? cleanContent : null;
          sections.push(currentSection);
        }
        
        // Start new section
        currentSection = {
          title: line.length > 50 ? "Document Information" : line,
          level: 1,
          content: '',
          source: "pre-numbered",
          type: "document-header"
        };
      } else if (currentSection) {
        // Add to current section content
        currentSection.content += line + '\n';
      } else {
        // First section (no specific trigger found)
        if (!currentSection) {
          currentSection = {
            title: "Document Information",
            level: 1,
            content: line + '\n',
            source: "pre-numbered",
            type: "document-header"
          };
        } else {
          currentSection.content += line + '\n';
        }
      }
    }
    
    // Add final section
    if (currentSection) {
      const cleanContent = currentSection.content.trim();
      currentSection.content = cleanContent.length > 0 ? cleanContent : null;
      sections.push(currentSection);
    }
    
    // If no sections were created, create one default section
    if (sections.length === 0 && content.trim()) {
      sections.push({
        title: "Document Information",
        level: 1,
        content: content.trim(),
        source: "pre-numbered",
        type: "document-header"
      });
    }
    
    return sections;
  }

  /**
   * Create hierarchical sections with proper content ranges
   * @param {string} text - PDF text content
   * @param {Array} numberedTitles - Array of numbered titles
   * @returns {Array} Array of hierarchical sections
   */
  createHierarchicalSections(text, numberedTitles) {
    const sections = [];
    
    if (numberedTitles.length === 0) {
      return sections;
    }
    
    for (let i = 0; i < numberedTitles.length; i++) {
      const currentTitle = numberedTitles[i];
      const nextTitle = numberedTitles[i + 1];
      
      // Calculate content start position (after the title line)
      const lines = text.split('\n');
      const contentStartLine = currentTitle.lineIndex + 1;
      
      // Calculate content end position
      let contentEndLine = lines.length - 1;
      
      if (nextTitle) {
        // Find the next title at same or higher level (lower level number)
        for (let j = i + 1; j < numberedTitles.length; j++) {
          const checkTitle = numberedTitles[j];
          if (checkTitle.level <= currentTitle.level) {
            contentEndLine = checkTitle.lineIndex - 1;
            break;
          }
        }
      }
      
      // Check if there's a direct child title immediately following
      const immediateChild = numberedTitles.find(title => 
        title.level > currentTitle.level && 
        title.lineIndex > currentTitle.lineIndex &&
        title.lineIndex <= contentStartLine + 2  // Allow 1-2 empty lines between parent and child
      );
      
      let content = '';
      
      if (immediateChild) {
        // If there's an immediate child, this parent has no direct content
        // // console.log(`📋 Parent "${currentTitle.number}" has immediate child "${immediateChild.number}" - no direct content`);
        content = '';
      } else {
        // Extract content between start and end
        const contentLines = lines.slice(contentStartLine, contentEndLine + 1);
        content = contentLines.join('\n').trim();
        
        // Remove sub-section titles and their content from parent content
        const subTitles = numberedTitles.slice(i + 1).filter(title => 
          title.level > currentTitle.level && title.lineIndex <= contentEndLine
        );
        
        if (subTitles.length > 0) {
          // Find content only up to the first sub-title
          const firstSubTitle = subTitles[0];
          const firstSubTitleLine = firstSubTitle.lineIndex;
          
          // Get content only up to (but not including) the first sub-title
          const parentContentLines = lines.slice(contentStartLine, firstSubTitleLine);
          content = parentContentLines.join('\n').trim();
          
          // console.log(`📋 Parent "${currentTitle.number}" content ends before child "${firstSubTitle.number}"`);
        }
      }
      
      // Create section object
      const cleanContent = content.trim();
      const finalContent = cleanContent.length > 0 ? cleanContent : null;
      
      const section = {
        title: currentTitle.title,
        level: currentTitle.level,
        content: finalContent,
        source: "pattern",
        patternType: currentTitle.type,
        originalLine: currentTitle.originalLine,
        number: currentTitle.number,
        page: currentTitle.page || null
      };
      
      sections.push(section);
      
      // // console.log(`  📄 Section: [L${section.level}] ${section.number} ${section.title} (${finalContent ? `${finalContent.length} chars` : 'null content'})`);
    }
    
    return sections;
  }

  /**
   * Validate and clean up sections
   * @param {Array} sections - Array of sections to validate
   * @returns {Array} Array of validated sections
   */
  validateSections(sections) {
    const validSections = sections.filter(section => {
      // Filter out sections with no title
      if (!section.title || section.title.trim().length < 2) {
        return false;
      }
      
      // Filter out sections that are just page numbers or artifacts
      if (section.title.match(/^Page\s+\d+/i) || 
          section.title.match(/^\d+\s*$/) ||
          section.title.match(/^\.{3,}/) ||
          section.title.length > 200) {
        return false;
      }
      
      return true;
    });
    
    // Clean up content and set empty content to null
    validSections.forEach(section => {
      if (section.content) {
        // Remove excessive whitespace
        section.content = section.content
          .replace(/\n\s*\n\s*\n/g, '\n\n')  // Max 2 consecutive newlines
          .replace(/\s+/g, ' ')               // Normalize spaces
          .trim();
      }
      
      // Final check: set empty content to null
      if (!section.content || section.content.length === 0) {
        section.content = null;
        // // console.log(`📝 Section "${section.title}" has no content, set to null`);
      }
    });
    
    return validSections;
  }




  /**
   * DEBUG: Save extracted text to local file for inspection
   * @param {string} text - Extracted text content
   * @param {string} type - Type of text (original, filtered, etc.)
   */
  saveDebugFiles(text, type = 'extracted') {
    try {
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
      const debugFile = path.join(this.tempDir, `debug_${type}_text_${timestamp}.txt`);
      
      fs.writeFileSync(debugFile, text, 'utf8');
      // // console.log(`🐛 DEBUG: Node.js ${type} text saved to ${debugFile}`);
      // // console.log(`📏 ${type} text length: ${text.length} characters`);
      
      if (type === 'original') {
        // // console.log(`📄 First 500 characters preview:`);
        // // console.log('-'.repeat(50));
        // // console.log(text.substring(0, 500));
        // // console.log('-'.repeat(50));
      } else if (type === 'filtered') {
        // // console.log(`🧹 Header filtering result preview (first 300 chars):`);
        // // console.log('-'.repeat(50));
        // // console.log(text.substring(0, 300));
        // // console.log('-'.repeat(50));
      }
    } catch (error) {
      console.error(`⚠️ Failed to save Node.js ${type} debug file:`, error.message);
    }
  }

  /**
   * DEBUG: Save sections to local file for inspection
   * @param {Array} sections - Extracted sections
   */
  saveSectionsDebug(sections) {
    try {
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
      const debugFile = path.join(this.tempDir, `debug_sections_${timestamp}.json`);
      
      // Create enhanced debug data with hierarchical structure info
      const debugData = {
        totalSections: sections.length,
        sectionsByLevel: {
          level1: sections.filter(s => s.level === 1).length,
          level2: sections.filter(s => s.level === 2).length,
          level3: sections.filter(s => s.level === 3).length,
          level4: sections.filter(s => s.level === 4).length
        },
        sectionsBySource: {
          pattern: sections.filter(s => s.source === 'pattern').length,
          preNumbered: sections.filter(s => s.source === 'pre-numbered').length,
          tableOfContents: sections.filter(s => s.source === 'table-of-contents').length,
          content: sections.filter(s => s.source === 'content').length
        },
        sections: sections.map((section, index) => ({
          index: index,
          title: section.title,
          level: section.level,
          source: section.source,
          patternType: section.patternType || section.type || 'N/A',
          number: section.number || 'N/A',
          contentPreview: section.content ? section.content.substring(0, 300) + '...' : 'No content',
          contentLength: section.content ? section.content.length : 0,
          originalLine: section.originalLine || 'N/A'
        }))
      };
      
      fs.writeFileSync(debugFile, JSON.stringify(debugData, null, 2), 'utf8');
      // // console.log(`🐛 DEBUG: Node.js hierarchical sections saved to ${debugFile}`);
      // // console.log(`📚 Total sections found: ${sections.length}`);
      // // console.log(`📊 Level distribution: L1:${debugData.sectionsByLevel.level1} L2:${debugData.sectionsByLevel.level2} L3:${debugData.sectionsByLevel.level3} L4:${debugData.sectionsByLevel.level4}`);
      // // console.log(`🎯 Source distribution: Pattern:${debugData.sectionsBySource.pattern} Pre-numbered:${debugData.sectionsBySource.preNumbered} TOC:${debugData.sectionsBySource.tableOfContents} Content:${debugData.sectionsBySource.content}`);
      
      // Log hierarchical section summary
      // // console.log('📋 Hierarchical Section Summary:');
      // sections.forEach((section, index) => {
      //   const indent = '  '.repeat(section.level);
      //   const number = section.number ? `${section.number} ` : '';
      //   const source = section.source === 'pre-numbered' ? '📄' : 
      //                  section.source === 'pattern' ? '🔢' : 
      //                  section.source === 'table-of-contents' ? '📖' : '📝';
      //   // console.log(`${indent}${index + 1}. [L${section.level}] ${source} ${number}${section.title}`);
        
      //   if (index >= 19) { // Show first 20 sections
      //     // console.log(`  ... and ${sections.length - 20} more sections`);
      //     return;
      //   }
      // });
      
    } catch (error) {
      console.error('⚠️ Failed to save Node.js sections debug file:', error.message);
    }
  }

  /**
   * Extract Study Number and Header Pattern from PDF text using AI (with regex fallback)
   * @param {string} text - PDF text content
   * @returns {Promise<Object>} Object with studyNumber and headerInfo
   */
  async extractStudyNumber(text) {
    // First try AI extraction (returns both studyNumber and headerInfo)
    try {
      const aiResult = await extractStudyNumberWithAI(text);
      if (aiResult && aiResult.studyNumber) {
        // // console.log(`🤖 AI extracted Study Number: ${aiResult.studyNumber}`);
        // // console.log(`🤖 AI detected header: ${aiResult.headerInfo ? aiResult.headerInfo.hasHeader : false}`);
        return aiResult;
      } else if (aiResult) {
        // AI ran but found no study number, still use header info if available
        // // console.log('🤖 AI found no Study Number, trying regex...');
        const regexStudyNumber = await this.extractStudyNumberRegex(text);
        return {
          studyNumber: regexStudyNumber,
          headerInfo: aiResult.headerInfo || null
        };
      }
    } catch (error) {
      console.warn('⚠️ AI Study Number extraction failed, falling back to regex:', error.message);
    }

    // Fallback to regex patterns for study number only
    const regexStudyNumber = await this.extractStudyNumberRegex(text);
    return {
      studyNumber: regexStudyNumber,
      headerInfo: null
    };
  }

  /**
   * Extract Study Number using regex patterns (fallback method)
   * @param {string} text - PDF text content
   * @returns {Promise<string|null>} Study Number if found, null otherwise
   */
  async extractStudyNumberRegex(text) {
    // // console.log('🔍 Using regex Study Number extraction...');
    const patterns = [
      /Protocol\s+(?:Number\s*[:\-]?\s*)?([A-Z0-9\-]{3,20})/i,
      /Study\s+(?:Number\s*[:\-]?\s*)?([A-Z0-9\-]{3,20})/i,
      /Study\s+ID\s*[:\-]?\s*([A-Z0-9\-]{3,20})/i
    ];

    for (const pattern of patterns) {
      const match = text.match(pattern);
      if (match && match[1]) {
        // // console.log(`🔎 Regex extracted Study Number: ${match[1]}`);
        return match[1].trim();
      }
    }

    // // console.log('⚠️ No Study Number found in PDF text');
    return null;
  }


}

// Create singleton instance
const pypdfService = new PypdfService();

// 🔥 新增：CRF专用位置提取函数
async function extractCrfPositions(fileBuffer, studyId = null) {
  const { spawn } = require('child_process');
  const fs = require('fs');
  const path = require('path');
  const os = require('os');

  return new Promise((resolve, reject) => {
    try {
      // Create temporary file for PDF
      const tempDir = path.join(__dirname, '../temp');
      if (!fs.existsSync(tempDir)) {
        fs.mkdirSync(tempDir, { recursive: true });
      }
      
      const timestamp = Date.now();
      const tempPdfPath = path.join(tempDir, `temp_crf_${timestamp}_${Math.random().toString(36).substr(2, 5)}.pdf`);
      
      // Write buffer to temporary file
      fs.writeFileSync(tempPdfPath, fileBuffer);
      
      // Path to CRF position extractor script
      const scriptPath = path.join(__dirname, 'crf_position_extractor.py');
      const outputDir = tempDir;
      
      // Prepare arguments
      const args = [scriptPath, tempPdfPath, outputDir];
      if (studyId) {
        args.push(studyId);
      }
      
      console.log('🔍 Calling CRF position extractor:', scriptPath);
      
      // Spawn Python process
      const pythonProcess = spawn('python3', args);
      
      let stdout = '';
      let stderr = '';
      
      pythonProcess.stdout.on('data', (data) => {
        stdout += data.toString();
      });
      
      pythonProcess.stderr.on('data', (data) => {
        stderr += data.toString();
      });
      
      pythonProcess.on('close', (code) => {
        // Clean up temporary PDF file
        try {
          fs.unlinkSync(tempPdfPath);
        } catch (cleanupErr) {
          console.warn('⚠️ Failed to clean up temp CRF file:', cleanupErr.message);
        }
        
        if (code !== 0) {
          console.error('❌ CRF position extractor failed with code:', code);
          console.error('❌ CRF position extractor stderr:', stderr);
          reject(new Error(`CRF position extraction failed with exit code ${code}: ${stderr}`));
          return;
        }
        
        try {
          // Parse JSON result
          const result = JSON.parse(stdout);
          
          if (result.success) {
            console.log(`✅ CRF position extraction completed for Study ${studyId || 'unknown'}`);
            console.log(`📊 CRF positions: ${result.metadata.total_chars} chars, ${result.metadata.total_words} words, ${result.metadata.total_text_lines} lines`);
            resolve(result);
          } else {
            console.error('❌ CRF position extraction failed:', result.error);
            reject(new Error(`CRF position extraction failed: ${result.error}`));
          }
        } catch (parseErr) {
          console.error('❌ Failed to parse CRF position extraction result:', parseErr);
          console.error('❌ Raw stdout:', stdout);
          reject(new Error(`Failed to parse CRF position extraction result: ${parseErr.message}`));
        }
      });
      
      pythonProcess.on('error', (err) => {
        // Clean up temporary PDF file
        try {
          fs.unlinkSync(tempPdfPath);
        } catch (cleanupErr) {
          console.warn('⚠️ Failed to clean up temp CRF file:', cleanupErr.message);
        }
        
        console.error('❌ Failed to spawn CRF position extractor process:', err);
        reject(new Error(`Failed to spawn CRF position extractor: ${err.message}`));
      });
      
    } catch (err) {
      console.error('❌ CRF position extraction setup failed:', err);
      reject(new Error(`CRF position extraction setup failed: ${err.message}`));
    }
  });
}

// 🔥 新增：CRF专用词位置提取函数（简化版）
async function extractCrfWordsOnly(fileBuffer, studyId = null) {
  const { spawn } = require('child_process');
  const fs = require('fs');
  const path = require('path');

  return new Promise((resolve, reject) => {
    try {
      // Create temporary file for PDF
      const tempDir = path.join(__dirname, '../temp');
      if (!fs.existsSync(tempDir)) {
        fs.mkdirSync(tempDir, { recursive: true });
      }

      const timestamp = Date.now();
      const randomSuffix = Math.random().toString(36).substring(7);
      const tempFileName = `temp_crf_words_${timestamp}_${randomSuffix}.pdf`;
      const tempFilePath = path.join(tempDir, tempFileName);

      // Write buffer to temporary file
      fs.writeFileSync(tempFilePath, fileBuffer);

      // Prepare arguments for Python script
      const pythonScript = path.join(__dirname, 'crf_analysis/crf_words_extractor.py');
      const outputDir = tempDir;
      const args = [pythonScript, tempFilePath, outputDir];
      
      if (studyId) {
        args.push(studyId);
      }

      console.log(`🐍 Calling CRF Words Python script: python3 ${args.join(' ')}`);

      // Execute Python script
      const pythonProcess = spawn('python3', args, {
        stdio: ['pipe', 'pipe', 'pipe'],
        env: { ...process.env }
      });

      let stdout = '';
      let stderr = '';

      pythonProcess.stdout.on('data', (data) => {
        stdout += data.toString();
      });

      pythonProcess.stderr.on('data', (data) => {
        stderr += data.toString();
      });

      pythonProcess.on('close', (code) => {
        // Clean up temporary file
        try {
          if (fs.existsSync(tempFilePath)) {
            fs.unlinkSync(tempFilePath);
          }
        } catch (cleanupErr) {
          console.warn('⚠️ Failed to cleanup temp file:', cleanupErr.message);
        }

        if (code === 0) {
          try {
            // Parse the JSON result from stdout
            const result = JSON.parse(stdout.trim());
            console.log(`✅ CRF words extraction completed successfully`);
            console.log(`📊 Results: ${result.metadata?.total_words || 0} words from ${result.metadata?.total_pages || 0} pages`);
            resolve(result);
          } catch (parseErr) {
            console.error('❌ Failed to parse Python script output:', parseErr.message);
            console.error('📄 Raw stdout:', stdout);
            reject(new Error(`Failed to parse extraction results: ${parseErr.message}`));
          }
        } else {
          console.error(`❌ Python script failed with exit code ${code}`);
          console.error('📄 stderr:', stderr);
          console.error('📄 stdout:', stdout);
          reject(new Error(`CRF words extraction failed: ${stderr || 'Unknown error'}`));
        }
      });

      pythonProcess.on('error', (err) => {
        // Clean up temporary file
        try {
          if (fs.existsSync(tempFilePath)) {
            fs.unlinkSync(tempFilePath);
          }
        } catch (cleanupErr) {
          console.warn('⚠️ Failed to cleanup temp file:', cleanupErr.message);
        }
        
        console.error('❌ Failed to spawn Python process:', err.message);
        reject(new Error(`Failed to start CRF words extraction: ${err.message}`));
      });

    } catch (error) {
      console.error('❌ CRF words extraction setup failed:', error.message);
      reject(error);
    }
  });
}

module.exports = {
  pypdfService,
  processPdfWithPypdf: (fileBuffer) => pypdfService.processPdfWithPypdf(fileBuffer),
  formatResultForDatabase: (pypdfResult) => pypdfService.formatResultForDatabase(pypdfResult),
  // 🔥 新增：CRF/SAP专用格式化函数（跳过Assessment Schedule识别）
  formatResultForCrfSap: (pypdfResult) => pypdfService.formatResultForCrfSap(pypdfResult),
  // 🔥 新增：CRF专用位置提取函数
  extractCrfPositions,
  // 🔥 新增：CRF专用词位置提取函数（简化版）
  extractCrfWordsOnly
};
