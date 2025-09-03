/**
 * Words to Rows Processor - Convert word positions to row-grouped data
 * Purpose: Group words by Y-coordinate with tolerance to form rows
 * Author: LLX Solutions
 */

/**
 * Group words into rows based on Y-coordinate proximity
 * @param {Array} words - Array of word objects with position data
 * @param {Number} yTolerance - Y-coordinate tolerance for grouping (default: 2.0)
 * @returns {Array} Array of row objects
 */
function groupWordsIntoRows(words, yTolerance = 2.0) {
  if (!words || words.length === 0) {
    return [];
  }

  // Sort words by y-coordinate first, then by x-coordinate
  const sortedWords = [...words].sort((a, b) => {
    if (Math.abs(a.y0 - b.y0) <= yTolerance) {
      return a.x0 - b.x0; // Same line, sort by x-coordinate
    }
    return a.y0 - b.y0; // Different lines, sort by y-coordinate
  });

  const rows = [];
  let currentRow = null;

  for (const word of sortedWords) {
    // Check if word belongs to current row (within Y tolerance)
    if (currentRow && Math.abs(word.y0 - currentRow.y_center) <= yTolerance) {
      // Add word to current row
      currentRow.words.push(word);
      currentRow.word_count++;
      
      // Update row boundaries
      currentRow.x_min = Math.min(currentRow.x_min, word.x0);
      currentRow.x_max = Math.max(currentRow.x_max, word.x1);
      currentRow.y_min = Math.min(currentRow.y_min, word.y0);
      currentRow.y_max = Math.max(currentRow.y_max, word.y1);
      
      // Recalculate center Y (weighted by word count)
      const totalY = currentRow.words.reduce((sum, w) => sum + w.y0, 0);
      currentRow.y_center = totalY / currentRow.words.length;
      
      // Update full text
      currentRow.full_text = currentRow.words.map(w => w.text).join(' ');
      
    } else {
      // Start new row
      currentRow = {
        row_index: rows.length + 1,
        y_center: word.y0,
        x_min: word.x0,
        x_max: word.x1,
        y_min: word.y0,
        y_max: word.y1,
        width: word.x1 - word.x0,
        height: word.y1 - word.y0,
        word_count: 1,
        words: [word],
        full_text: word.text
      };
      rows.push(currentRow);
    }
  }

  // Final processing: update width and height for each row
  rows.forEach(row => {
    row.width = row.x_max - row.x_min;
    row.height = row.y_max - row.y_min;
  });

  return rows;
}

/**
 * Process words data to extract rows with position information
 * @param {Object} wordsData - Words extraction result from crf_words_extractor
 * @param {Number} yTolerance - Y-coordinate tolerance for row grouping
 * @returns {Object} Rows extraction result
 */
function processWordsToRows(wordsData, yTolerance = 2.0) {
  try {
    if (!wordsData || !wordsData.success || !wordsData.pages) {
      return {
        success: false,
        pages: [],
        metadata: { total_pages: 0, total_rows: 0, total_words: 0 }
      };
    }

    const processedPages = [];
    let totalRows = 0;
    let totalWords = 0;

    for (const page of wordsData.pages) {
      console.log(`🔄 Processing page ${page.page_number} - ${page.words.length} words`);
      
      // Group words into rows for this page
      const rows = groupWordsIntoRows(page.words, yTolerance);
      
      const pageData = {
        page_number: page.page_number,
        page_width: page.page_width,
        page_height: page.page_height,
        rows: rows,
        row_count: rows.length,
        word_count: page.words.length
      };
      
      processedPages.push(pageData);
      totalRows += rows.length;
      totalWords += page.words.length;
      
      console.log(`✅ Page ${page.page_number}: ${rows.length} rows created from ${page.words.length} words`);
    }

    const result = {
      success: true,
      extraction_time: new Date().toISOString(),
      y_tolerance: yTolerance,
      pages: processedPages,
      metadata: {
        total_pages: processedPages.length,
        total_rows: totalRows,
        total_words: totalWords
      }
    };

    console.log(`🎉 Row processing completed: ${totalRows} rows from ${totalWords} words across ${processedPages.length} pages`);
    
    return result;

  } catch (error) {
    console.error('❌ Error in processWordsToRows:', error);
    return {
      success: false,
      pages: [],
      metadata: { total_pages: 0, total_rows: 0, total_words: 0 }
    };
  }
}

/**
 * Analyze row distribution and provide statistics
 * @param {Object} rowsData - Rows extraction result
 * @returns {Object} Analysis results
 */
function analyzeRowDistribution(rowsData) {
  if (!rowsData || !rowsData.success || !rowsData.pages) {
    return { error: 'Invalid rows data' };
  }

  const analysis = {
    total_pages: rowsData.pages.length,
    total_rows: rowsData.metadata.total_rows,
    total_words: rowsData.metadata.total_words,
    avg_words_per_row: Math.round(rowsData.metadata.total_words / rowsData.metadata.total_rows * 100) / 100,
    y_tolerance_used: rowsData.y_tolerance,
    page_breakdown: []
  };

  // Analyze each page
  for (const page of rowsData.pages) {
    const pageAnalysis = {
      page_number: page.page_number,
      row_count: page.row_count,
      word_count: page.word_count,
      avg_words_per_row: Math.round(page.word_count / page.row_count * 100) / 100,
      row_details: page.rows.map(row => ({
        row_index: row.row_index,
        word_count: row.word_count,
        y_center: Math.round(row.y_center * 100) / 100,
        text_preview: row.full_text.substring(0, 50) + (row.full_text.length > 50 ? '...' : '')
      }))
    };
    analysis.page_breakdown.push(pageAnalysis);
  }

  return analysis;
}

module.exports = {
  groupWordsIntoRows,
  processWordsToRows,
  analyzeRowDistribution
};
