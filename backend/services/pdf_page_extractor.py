#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
PDF Page Extractor - Extract specific pages from PDF while preserving all content
Purpose: Extract first 5 pages from CRF PDF and create a new PDF file
Author: LLX Solutions
"""

import sys
import os
from PyPDF2 import PdfReader, PdfWriter
import argparse

# Fix Windows Unicode encoding issue
if sys.platform == 'win32':
    import io
    sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8')

def extract_pages(input_pdf_path: str, output_pdf_path: str, start_page: int = 1, end_page: int = 5):
    """
    Extract pages from PDF file while preserving all internal information
    
    Args:
        input_pdf_path: Path to the input PDF file
        output_pdf_path: Path to save the extracted PDF
        start_page: Starting page number (1-based)
        end_page: Ending page number (1-based, inclusive)
        
    Returns:
        Dictionary with extraction results
    """
    result = {
        'success': False,
        'input_file': input_pdf_path,
        'output_file': output_pdf_path,
        'pages_extracted': 0,
        'total_pages': 0,
        'message': '',
        'error': None
    }
    
    try:
        # Check if input file exists
        if not os.path.exists(input_pdf_path):
            raise FileNotFoundError(f"Input PDF file not found: {input_pdf_path}")
        
        print(f"📄 Starting PDF page extraction...")
        print(f"📂 Input file: {input_pdf_path}")
        print(f"📂 Output file: {output_pdf_path}")
        print(f"📄 Extracting pages {start_page} to {end_page}")
        
        # Create PDF reader and writer
        pdf_reader = PdfReader(input_pdf_path)
        pdf_writer = PdfWriter()
        
        total_pages = len(pdf_reader.pages)
        result['total_pages'] = total_pages
        
        print(f"📄 Total pages in source PDF: {total_pages}")
        
        # Validate page range
        if start_page < 1:
            start_page = 1
        if end_page > total_pages:
            end_page = total_pages
            print(f"⚠️  Adjusted end page to {end_page} (total available pages)")
        
        if start_page > total_pages:
            raise ValueError(f"Start page {start_page} exceeds total pages {total_pages}")
        
        # Extract pages (convert to 0-based indexing)
        pages_extracted = 0
        for page_num in range(start_page - 1, end_page):
            if page_num < total_pages:
                page = pdf_reader.pages[page_num]
                pdf_writer.add_page(page)
                pages_extracted += 1
                print(f"✅ Extracted page {page_num + 1}")
            else:
                break
        
        # Preserve metadata from original PDF
        if pdf_reader.metadata:
            pdf_writer.add_metadata(pdf_reader.metadata)
            print("📋 Preserved original PDF metadata")
        
        # Create output directory if it doesn't exist
        output_dir = os.path.dirname(output_pdf_path)
        if output_dir and not os.path.exists(output_dir):
            os.makedirs(output_dir, exist_ok=True)
        
        # Write the new PDF
        with open(output_pdf_path, 'wb') as output_file:
            pdf_writer.write(output_file)
        
        result['success'] = True
        result['pages_extracted'] = pages_extracted
        result['message'] = f"Successfully extracted {pages_extracted} pages to {output_pdf_path}"
        
        print(f"🎉 PDF extraction completed successfully!")
        print(f"📊 Pages extracted: {pages_extracted}")
        print(f"💾 Output saved to: {output_pdf_path}")
        
        # Verify output file
        if os.path.exists(output_pdf_path):
            output_size = os.path.getsize(output_pdf_path)
            print(f"📏 Output file size: {output_size:,} bytes")
        
    except Exception as e:
        result['success'] = False
        result['error'] = str(e)
        result['message'] = f"PDF extraction failed: {str(e)}"
        print(f"❌ Error: {str(e)}")
    
    return result

def main():
    """
    Main function for command line usage
    """
    parser = argparse.ArgumentParser(description='Extract pages from PDF file')
    parser.add_argument('input_file', help='Input PDF file path')
    parser.add_argument('output_file', help='Output PDF file path')
    parser.add_argument('--start', type=int, default=1, help='Start page number (default: 1)')
    parser.add_argument('--end', type=int, default=5, help='End page number (default: 5)')
    
    # If no arguments provided, use default values for CRF extraction
    if len(sys.argv) == 1:
        # Default behavior: extract first 5 pages from crf.pdf
        script_dir = os.path.dirname(os.path.abspath(__file__))
        project_root = os.path.dirname(script_dir)
        input_file = os.path.join(project_root, 'Resource', 'crf', 'crf.pdf')
        output_file = os.path.join(project_root, 'Resource', 'crf', 'crf_new.pdf')
        start_page = 1
        end_page = 5
    else:
        args = parser.parse_args()
        input_file = args.input_file
        output_file = args.output_file
        start_page = args.start
        end_page = args.end
    
    # Execute extraction
    result = extract_pages(input_file, output_file, start_page, end_page)
    
    # Print final result
    if result['success']:
        print(f"\n🎯 EXTRACTION SUMMARY:")
        print(f"   ✅ Status: Success")
        print(f"   📄 Pages extracted: {result['pages_extracted']}/{result['total_pages']}")
        print(f"   📂 Output file: {result['output_file']}")
    else:
        print(f"\n❌ EXTRACTION FAILED:")
        print(f"   💥 Error: {result['error']}")
        sys.exit(1)

if __name__ == "__main__":
    main()
