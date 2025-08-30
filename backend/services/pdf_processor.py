#!/usr/bin/env python3
"""
PDF Processing Script - Enhanced Version with Table Extraction
Purpose: Extract text and table content from PDF files using pdfplumber library
Author: LLX Solutions
"""

import pdfplumber
import json
import sys
import os
from typing import Dict, Any, List
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
        
        # print(f"🐍 DEBUG: Python extracted text saved to {debug_file}", file=sys.stderr)
        # print(f"🐍 Text preview (first 300 chars):", file=sys.stderr)
        # print("-" * 40, file=sys.stderr)
        # print(extracted_text[:300], file=sys.stderr)
        # print("-" * 40, file=sys.stderr)
        
    except Exception as e:
        print(f"🐍 WARNING: Failed to save debug file: {str(e)}", file=sys.stderr)

def save_debug_tables(original_file_path: str, extracted_tables: List[Dict]):
    """
    DEBUG: Save extracted tables to local file for inspection
    
    Args:
        original_file_path: Path to the original PDF file
        extracted_tables: Extracted table data
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
        debug_file = os.path.join(debug_dir, f"debug_python_extracted_tables_{timestamp}.json")
        
        # Write extracted tables to file
        with open(debug_file, 'w', encoding='utf-8') as f:
            json.dump({
                'original_file': original_file_path,
                'extraction_time': timestamp,
                'total_tables': len(extracted_tables),
                'tables': extracted_tables
            }, f, ensure_ascii=False, indent=2)
        
        # print(f"🐍 DEBUG: Python extracted tables saved to {debug_file}", file=sys.stderr)
        # print(f"🐍 Tables summary: {len(extracted_tables)} tables found", file=sys.stderr)
        
    except Exception as e:
        print(f"🐍 WARNING: Failed to save debug tables file: {str(e)}", file=sys.stderr)

def process_pdf_simple(file_path: str) -> Dict[str, Any]:
    """
    Enhanced PDF processing function with table extraction
    Extracts text content and tables separately from PDF file using pdfplumber
    
    Args:
        file_path: Path to the PDF file
        
    Returns:
        Dictionary containing extracted text, tables and basic info
    """
    result = {
        'success': True,
        'text': '',
        'tables': [],
        'total_pages': 0,
        'error': None
    }
    
    try:
        # Check if file exists
        if not os.path.exists(file_path):
            raise FileNotFoundError(f"PDF file not found: {file_path}")
        
        # print(f"🐍 Python: Processing PDF with pdfplumber: {file_path}", file=sys.stderr)
        
        # Open PDF file with pdfplumber
        with pdfplumber.open(file_path) as pdf:
            result['total_pages'] = len(pdf.pages)
            # print(f"🐍 Python: Processing {result['total_pages']} pages", file=sys.stderr)
            
            full_text = ""
            all_tables = []
            
            # Process each page
            for page_number, page in enumerate(pdf.pages, 1):
                try:
                    # Extract text with visual ordering
                    page_text = page.extract_text()
                    
                    if page_text:
                        full_text += page_text + '\n\n'
                        # print(f"🐍 Page {page_number}: {len(page_text)} characters extracted", file=sys.stderr)
                    else:
                        # print(f"🐍 Page {page_number}: No text extracted", file=sys.stderr)
                        pass
                    
                    # Extract tables from this page
                    tables = page.extract_tables()
                    if tables:
                        # print(f"🐍 Page {page_number}: Found {len(tables)} tables", file=sys.stderr)
                        
                        for table_idx, table in enumerate(tables):
                            if table and len(table) > 0 and any(any(cell for cell in row) for row in table):
                                # Clean table data - remove None values and empty strings
                                cleaned_table = []
                                for row in table:
                                    cleaned_row = [str(cell).strip() if cell is not None else "" for cell in row]
                                    cleaned_table.append(cleaned_row)
                                
                                table_data = {
                                    'page': page_number,
                                    'table_index': table_idx + 1,
                                    'data': cleaned_table,
                                    'rows': len(cleaned_table),
                                    'columns': len(cleaned_table[0]) if cleaned_table else 0
                                }
                                all_tables.append(table_data)
                                # print(f"🐍 Table {table_idx + 1}: {len(cleaned_table)} rows x {len(cleaned_table[0]) if cleaned_table else 0} columns", file=sys.stderr)
                    else:
                        # print(f"🐍 Page {page_number}: No tables found", file=sys.stderr)
                        pass
                        
                except Exception as page_error:
                    # Log page processing error but continue with other pages
                    print(f"🐍 ERROR Page {page_number}: {str(page_error)}", file=sys.stderr)
                    error_text = f'[Page {page_number} processing failed: {str(page_error)}]\n\n'
                    full_text += error_text
                    continue
            
            result['text'] = full_text.strip()
            result['tables'] = all_tables
            
            # 🐛 DEBUG: Save extracted data for inspection
            # save_debug_text(file_path, result['text'])
            # save_debug_tables(file_path, result['tables'])
            
            # 🐛 DEBUG: Log final statistics
            # print(f"🐍 Total text extracted: {len(result['text'])} characters", file=sys.stderr)
            # print(f"🐍 Total tables extracted: {len(result['tables'])}", file=sys.stderr)
            
    except Exception as e:
        result['success'] = False
        result['error'] = str(e)
        result['text'] = ''
        result['tables'] = []
        result['total_pages'] = 0
        print(f"🐍 ERROR: {str(e)}", file=sys.stderr)
    
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
            'tables': [],
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

