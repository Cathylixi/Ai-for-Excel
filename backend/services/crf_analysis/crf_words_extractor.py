#!/usr/bin/env python3
"""
CRF Words Extractor - Extract only word positions from CRF PDF files
Purpose: Simplified extraction of word positions without form/table processing
Author: LLX Solutions
"""

import pdfplumber
import json
import sys
import os
from typing import Dict, Any, List
import datetime

def extract_words_only(file_path: str, study_id: str = None) -> Dict[str, Any]:
    """
    Extract only word positions from CRF PDF file
    
    Args:
        file_path: Path to the PDF file
        study_id: Optional study ID for metadata
        
    Returns:
        Dictionary containing word extraction results
    """
    try:
        all_pages_words = []
        total_words = 0
        
        with pdfplumber.open(file_path) as pdf:
            for page_number, page in enumerate(pdf.pages, 1):
                print(f"🔍 Processing page {page_number}/{len(pdf.pages)}", file=sys.stderr)
                
                # Extract words from current page
                words = page.extract_words()
                
                # Process word data
                page_words = []
                for word in words:
                    word_data = {
                        'text': word.get('text', ''),
                        'x0': float(word.get('x0', 0)),
                        'y0': float(word.get('top', 0)),        # 使用 'top' 作为上边界
                        'x1': float(word.get('x1', 0)),
                        'y1': float(word.get('bottom', 0)),     # 使用 'bottom' 作为下边界
                        'width': float(word.get('x1', 0) - word.get('x0', 0)),
                        'height': float(word.get('bottom', 0) - word.get('top', 0)),
                        'fontname': word.get('fontname', ''),
                        'size': float(word.get('size', 0))
                    }
                    page_words.append(word_data)
                
                # Create page data structure
                page_data = {
                    'page_number': page_number,
                    'page_width': float(page.width),
                    'page_height': float(page.height),
                    'words': page_words
                }
                
                all_pages_words.append(page_data)
                total_words += len(page_words)
                
                print(f"✅ Page {page_number}: extracted {len(page_words)} words", file=sys.stderr)
        
        # Create final result structure
        result = {
            'success': True,
            'extraction_time': datetime.datetime.now().isoformat(),
            'pages': all_pages_words,
            'metadata': {
                'total_pages': len(all_pages_words),
                'total_words': total_words
            }
        }
        
        print(f"🎉 Extraction completed: {total_words} words from {len(all_pages_words)} pages", file=sys.stderr)
        
        return result
        
    except Exception as e:
        error_msg = f"Error extracting words: {str(e)}"
        print(f"❌ {error_msg}", file=sys.stderr)
        
        return {
            'success': False,
            'extraction_time': datetime.datetime.now().isoformat(),
            'pages': [],
            'metadata': {
                'total_pages': 0,
                'total_words': 0
            }
        }

def main():
    """Main function to run the word extraction"""
    if len(sys.argv) < 3:
        print("Usage: python3 crf_words_extractor.py <pdf_file_path> <output_dir> [study_id]", file=sys.stderr)
        sys.exit(1)
    
    pdf_file_path = sys.argv[1]
    output_dir = sys.argv[2]
    study_id = sys.argv[3] if len(sys.argv) > 3 else None
    
    # Validate input file
    if not os.path.exists(pdf_file_path):
        print(f"❌ Error: PDF file not found: {pdf_file_path}", file=sys.stderr)
        sys.exit(1)
    
    # Create output directory if it doesn't exist
    if not os.path.exists(output_dir):
        os.makedirs(output_dir)
    
    print(f"🚀 Starting CRF words extraction...", file=sys.stderr)
    print(f"📄 Input file: {pdf_file_path}", file=sys.stderr)
    print(f"📁 Output directory: {output_dir}", file=sys.stderr)
    
    # Extract words
    result = extract_words_only(pdf_file_path, study_id)
    
    # Output result to stdout for Node.js to capture (no file saving)
    print(json.dumps(result, ensure_ascii=False))

if __name__ == "__main__":
    main()
