#!/usr/bin/env python3
"""
PDF Processing Script - Simplified Version
Purpose: Extract only text content from PDF files using pypdf library
Author: LLX Solutions
"""

import pypdf
import json
import sys
import os
from typing import Dict, Any
import datetime

def save_debug_text(original_file_path: str, extracted_text: str):
    """
    DEBUG: Save extracted text to local file for inspection
    
    Args:
        original_file_path: Path to the original PDF file
        extracted_text: Extracted text content
    """
    try:
        # Create debug directory in the same location as the temp directory
        temp_dir = os.path.dirname(original_file_path)
        if temp_dir.endswith('temp'):
            debug_dir = temp_dir
        else:
            debug_dir = os.path.join(os.path.dirname(original_file_path), 'temp')
        
        # Create timestamp
        timestamp = datetime.datetime.now().strftime("%Y-%m-%d_%H-%M-%S")
        
        # Create debug filename
        debug_file = os.path.join(debug_dir, f"debug_python_extracted_text_{timestamp}.txt")
        
        # Write extracted text to file
        with open(debug_file, 'w', encoding='utf-8') as f:
            f.write("=== PDF TEXT EXTRACTION DEBUG ===\n")
            f.write(f"Original file: {original_file_path}\n")
            f.write(f"Extraction time: {timestamp}\n")
            f.write(f"Text length: {len(extracted_text)} characters\n")
            f.write("=" * 50 + "\n\n")
            f.write(extracted_text)
        
        print(f"🐍 DEBUG: Python extracted text saved to {debug_file}", file=sys.stderr)
        print(f"🐍 Text preview (first 300 chars):", file=sys.stderr)
        print("-" * 40, file=sys.stderr)
        print(extracted_text[:300], file=sys.stderr)
        print("-" * 40, file=sys.stderr)
        
    except Exception as e:
        print(f"🐍 WARNING: Failed to save debug file: {str(e)}", file=sys.stderr)

def process_pdf_simple(file_path: str) -> Dict[str, Any]:
    """
    Simplified PDF processing function
    Extracts only text content from PDF file
    
    Args:
        file_path: Path to the PDF file
        
    Returns:
        Dictionary containing extracted text and basic info
    """
    result = {
        'success': True,
        'text': '',
        'total_pages': 0,
        'error': None
    }
    
    try:
        # Check if file exists
        if not os.path.exists(file_path):
            raise FileNotFoundError(f"PDF file not found: {file_path}")
        
        # Read PDF file
        with open(file_path, 'rb') as file:
            reader = pypdf.PdfReader(file)
            
            # Get basic information
            result['total_pages'] = len(reader.pages)
            print(f"🐍 Python: Processing {result['total_pages']} pages", file=sys.stderr)
            
            # Extract text from all pages
            for page_number, page in enumerate(reader.pages, 1):
                try:
                    # Extract text from current page
                    page_text = page.extract_text()
                    
                    # 🐛 DEBUG: Log page processing info
                    print(f"🐍 Page {page_number}: {len(page_text)} characters extracted", file=sys.stderr)
                    
                    # Append to total text with page separation
                    result['text'] += page_text + '\n\n'
                    
                except Exception as page_error:
                    # Log page processing error but continue with other pages
                    print(f"🐍 ERROR Page {page_number}: {str(page_error)}", file=sys.stderr)
                    error_text = f'[Page {page_number} processing failed: {str(page_error)}]\n\n'
                    result['text'] += error_text
                    continue
            
            # 🐛 DEBUG: Save raw extracted text for inspection
            save_debug_text(file_path, result['text'])
            
            # 🐛 DEBUG: Log final statistics
            print(f"🐍 Total text extracted: {len(result['text'])} characters", file=sys.stderr)
            
    except Exception as e:
        result['success'] = False
        result['error'] = str(e)
        result['text'] = ''
        result['total_pages'] = 0
    
    return result

def main():
    """
    Main function: Get file path from command line arguments and process PDF
    """
    if len(sys.argv) != 2:
        error_response = {
            'success': False,
            'error': 'Usage: python pdf_processor.py <pdf_file_path>',
            'text': '',
            'total_pages': 0
        }
        print(json.dumps(error_response, ensure_ascii=False))
        sys.exit(1)
    
    file_path = sys.argv[1]
    result = process_pdf_simple(file_path)
    
    # Output JSON result
    print(json.dumps(result, ensure_ascii=False))

if __name__ == "__main__":
    main()

