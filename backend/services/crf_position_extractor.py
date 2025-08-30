#!/usr/bin/env python3
"""
CRF Position Extractor - Extract text positions from CRF PDF files
Purpose: Extract detailed text position information from CRF PDFs using pdfplumber
Author: LLX Solutions
"""

import pdfplumber
import json
import sys
import os
from typing import Dict, Any, List
import datetime
import re

def identify_form_titles(words: List[Dict]) -> List[Dict]:
    """
    Identify form titles from a list of words
    
    Args:
        words: List of word dictionaries with position information
        
    Returns:
        List of form title information
    """
    form_titles = []
    
    # Look for "Form:" keyword
    for i, word in enumerate(words):
        if word['text'].lower() == 'form:':
            # Extract the form title by collecting subsequent words on the same line
            form_y = word['y0']
            title_words = []
            title_positions = []
            
            # Look for words on the same line (within tolerance)
            y_tolerance = 2.0
            for j in range(i + 1, len(words)):
                next_word = words[j]
                if abs(next_word['y0'] - form_y) <= y_tolerance:
                    title_words.append(next_word['text'])
                    title_positions.append(next_word)
                else:
                    # Stop when we reach a different line
                    break
            
            if title_words:
                # Combine title words
                full_title = ' '.join(title_words)
                
                # Calculate bounding box for the entire title
                all_positions = [word] + title_positions
                min_x0 = min(p['x0'] for p in all_positions)
                max_x1 = max(p['x1'] for p in all_positions)
                min_y0 = min(p['y0'] for p in all_positions)
                max_y1 = max(p['y1'] for p in all_positions)
                
                form_titles.append({
                    'title': full_title,
                    'normalized_title': full_title.upper().replace(' ', '_'),
                    'position': {
                        'x0': float(min_x0),
                        'y0': float(min_y0),
                        'x1': float(max_x1),
                        'y1': float(max_y1)
                    },
                    'page_number': None,  # Will be set by caller
                    'title_y': float(form_y)
                })
    
    return form_titles

def calculate_form_boundaries(form_titles: List[Dict], page_height: float) -> List[Dict]:
    """
    Calculate boundaries for each form based on title positions
    
    Args:
        form_titles: List of form title information
        page_height: Height of the page
        
    Returns:
        List of form information with boundaries
    """
    if not form_titles:
        return []
    
    # Sort forms by Y position (top to bottom)
    sorted_forms = sorted(form_titles, key=lambda f: f['title_y'])
    
    forms_with_boundaries = []
    
    for i, form in enumerate(sorted_forms):
        # Calculate content boundaries
        top_y = form['title_y'] + 15  # Start content area below title
        
        # Bottom boundary is either next form's title or page bottom
        if i + 1 < len(sorted_forms):
            bottom_y = sorted_forms[i + 1]['title_y'] - 5  # Leave some margin
        else:
            bottom_y = page_height - 50  # Leave margin from page bottom
        
        forms_with_boundaries.append({
            **form,
            'content_bounds': {
                'top_y': float(top_y),
                'bottom_y': float(bottom_y),
                'left_x': 90.0,   # Standard left margin
                'right_x': 540.0  # Standard right margin
            }
        })
    
    return forms_with_boundaries

def extract_form_content(words: List[Dict], form_bounds: Dict) -> Dict:
    """
    Extract all content within a form's boundaries
    
    Args:
        words: List of all words on the page
        form_bounds: Form boundary information
        
    Returns:
        Dictionary with form content
    """
    content_words = []
    content_text_parts = []
    
    # Extract words within the form boundaries
    for word in words:
        word_y = word['y0']
        word_x = word['x0']
        
        if (form_bounds['top_y'] <= word_y <= form_bounds['bottom_y'] and
            form_bounds['left_x'] <= word_x <= form_bounds['right_x']):
            content_words.append(word)
            content_text_parts.append(word['text'])
    
    return {
        'words': content_words,
        'full_text': ' '.join(content_text_parts),
        'word_count': len(content_words)
    }

def merge_cross_page_forms(raw_forms: List[Dict]) -> Dict[str, Any]:
    """
    Merge forms that span across consecutive pages
    
    Args:
        raw_forms: List of raw form data with page information
        
    Returns:
        Dictionary of merged forms
    """
    # Group forms by normalized title
    form_groups = {}
    for form in raw_forms:
        title = form['normalized_title']
        if title not in form_groups:
            form_groups[title] = []
        form_groups[title].append(form)
    
    merged_forms = {}
    
    for title, forms in form_groups.items():
        if len(forms) == 1:
            # Single page form, use as is
            merged_forms[title] = forms[0]
        else:
            # Multiple forms with same title, check if they should be merged
            # Sort by page number
            forms.sort(key=lambda x: x['page_number'])
            
            # Check if pages are consecutive (allow 1-2 page gaps for flexibility)
            pages = [form['page_number'] for form in forms]
            max_gap = max(pages[i+1] - pages[i] for i in range(len(pages)-1))
            
            if max_gap <= 2:  # Consecutive or near-consecutive pages, merge them
                # Use first form as base
                base_form = forms[0].copy()
                
                # Collect all pages
                all_pages = [form['page_number'] for form in forms]
                
                # Merge content bounds (from first to last page)
                min_top_y = min(form['content_bounds']['top_y'] for form in forms)
                max_bottom_y = max(form['content_bounds']['bottom_y'] for form in forms)
                min_left_x = min(form['content_bounds']['left_x'] for form in forms)
                max_right_x = max(form['content_bounds']['right_x'] for form in forms)
                
                # Merge all words and text
                all_words = []
                all_text_parts = []
                
                for form in forms:
                    all_words.extend(form['all_words'])
                    if form['full_text'].strip():
                        all_text_parts.append(form['full_text'].strip())
                
                # Update merged form
                base_form.update({
                    'pages': all_pages,  # All pages this form spans
                    'page_count': len(all_pages),
                    'content_bounds': {
                        'top_y': min_top_y,
                        'bottom_y': max_bottom_y,
                        'left_x': min_left_x,
                        'right_x': max_right_x
                    },
                    'word_count': len(all_words),
                    'all_words': all_words,
                    'full_text': ' '.join(all_text_parts),
                    'is_multi_page': True
                })
                
                # Keep the page_number as the first page for backward compatibility
                base_form['page_number'] = pages[0]
                
                merged_forms[title] = base_form
                
                print(f"🔗 Merged form '{title}' across pages {pages}", file=sys.stderr)
            else:
                # Pages are too far apart, keep them separate
                # Add suffix to distinguish them
                for i, form in enumerate(forms):
                    key = f"{title}_PAGE_{form['page_number']}"
                    merged_forms[key] = form
                    print(f"📄 Kept separate form '{title}' on page {form['page_number']}", file=sys.stderr)
    
    return merged_forms

def extract_forms_from_pages(pages_data: List[Dict]) -> Dict[str, Any]:
    """
    Extract form information from all pages with cross-page merging
    
    Args:
        pages_data: List of page data with words
        
    Returns:
        Dictionary containing form extraction results
    """
    raw_forms = []  # Collect all forms first
    
    for page_data in pages_data:
        page_number = page_data['page_number']
        words = page_data['words']
        page_height = page_data['page_height']
        
        # Identify form titles on this page
        form_titles = identify_form_titles(words)
        
        if not form_titles:
            continue
            
        # Set page number for each form
        for form_title in form_titles:
            form_title['page_number'] = page_number
        
        # Calculate form boundaries
        forms_with_boundaries = calculate_form_boundaries(form_titles, page_height)
        
        # Extract content for each form
        for form in forms_with_boundaries:
            normalized_title = form['normalized_title']
            
            # Extract form content
            form_content = extract_form_content(words, form['content_bounds'])
            
            # Create form entry
            form_entry = {
                'title': form['title'],
                'normalized_title': normalized_title,
                'title_position': form['position'],
                'content_bounds': form['content_bounds'],
                'page_number': form['page_number'],
                'extracted': True,
                'word_count': form_content['word_count'],
                'all_words': form_content['words'],
                'full_text': form_content['full_text'],
                'is_multi_page': False  # Will be updated if merged
            }
            
            raw_forms.append(form_entry)
    
    # Merge cross-page forms
    merged_forms = merge_cross_page_forms(raw_forms)
    
    # Generate unique form names (without duplicates)
    unique_names = list(merged_forms.keys())
    
    return {
        'crfFormList': merged_forms,
        'crfFormName': {
            'names': unique_names,
            'total_forms': len(unique_names)
        }
    }

def extract_text_positions(file_path: str, study_id: str = None) -> Dict[str, Any]:
    """
    Extract detailed text position information from CRF PDF file
    
    Args:
        file_path: Path to the CRF PDF file
        study_id: Study ID for file naming (optional)
        
    Returns:
        Dictionary containing text position data and metadata
    """
    result = {
        'success': True,
        'study_id': study_id,
        'file_path': file_path,
        'extraction_time': datetime.datetime.now().isoformat(),
        'total_pages': 0,
        'pages': [],
        'metadata': {
            'total_chars': 0,
            'total_words': 0,
            'total_text_lines': 0
        },
        'error': None
    }
    
    try:
        # Check if file exists
        if not os.path.exists(file_path):
            raise FileNotFoundError(f"CRF PDF file not found: {file_path}")
        
        print(f"🔍 CRF Position Extractor: Processing {file_path}", file=sys.stderr)
        
        # Open PDF file with pdfplumber
        with pdfplumber.open(file_path) as pdf:
            result['total_pages'] = len(pdf.pages)
            print(f"🔍 CRF Position: Extracting positions from {result['total_pages']} pages", file=sys.stderr)
            
            total_words = 0
            
            # Process each page
            for page_number, page in enumerate(pdf.pages, 1):
                try:
                    page_data = {
                        'page_number': page_number,
                        'page_width': float(page.width),
                        'page_height': float(page.height),
                        'words': []
                    }
                    
                    # Extract word-level positions using pdfplumber's built-in function
                    words = page.extract_words()
                    for word in words:
                        word_data = {
                            'text': word.get('text', ''),
                            'x0': float(word.get('x0', 0)),
                            'y0': float(word.get('top', 0)),        # 修正：使用 'top' 作為上邊界
                            'x1': float(word.get('x1', 0)),
                            'y1': float(word.get('bottom', 0)),     # 修正：使用 'bottom' 作為下邊界
                            'width': float(word.get('x1', 0) - word.get('x0', 0)),
                            'height': float(word.get('bottom', 0) - word.get('top', 0)),  # 修正：使用 bottom - top
                            'fontname': word.get('fontname', ''),
                            'size': float(word.get('size', 0))
                        }
                        page_data['words'].append(word_data)
                    
                    # Update counters
                    total_words += len(page_data['words'])
                    
                    result['pages'].append(page_data)
                    
                    # Log progress for each page
                    print(f"🔍 CRF Page {page_number}: {len(page_data['words'])} words", file=sys.stderr)
                    
                except Exception as page_error:
                    # Log page processing error but continue with other pages
                    print(f"🔍 CRF ERROR Page {page_number}: {str(page_error)}", file=sys.stderr)
                    continue
            
            # Extract form information from all pages
            print(f"🔍 CRF Form extraction: Processing {len(result['pages'])} pages", file=sys.stderr)
            form_data = extract_forms_from_pages(result['pages'])
            
            # Add form information to result
            result['forms'] = form_data
            
            print(f"🔍 CRF Forms found: {form_data['crfFormName']['total_forms']} forms", file=sys.stderr)
            if form_data['crfFormName']['total_forms'] > 0:
                print(f"🔍 CRF Form names: {', '.join(form_data['crfFormName']['names'])}", file=sys.stderr)
            
            # Update metadata
            result['metadata'] = {
                'total_words': total_words,
                'total_forms': form_data['crfFormName']['total_forms']
            }
            
            print(f"🔍 CRF Position extraction completed: {total_words} words, {form_data['crfFormName']['total_forms']} forms", file=sys.stderr)
            
    except Exception as e:
        result['success'] = False
        result['error'] = str(e)
        result['pages'] = []
        result['metadata'] = {'total_words': 0}
        print(f"🔍 CRF ERROR: {str(e)}", file=sys.stderr)
    
    return result

def save_positions_to_file(positions_data: Dict[str, Any], output_dir: str, study_id: str = None) -> str:
    """
    Save position data to JSON file in the specified directory
    
    Args:
        positions_data: Position extraction result
        output_dir: Output directory path
        study_id: Study ID for file naming
        
    Returns:
        Path to the saved file
    """
    try:
        # Ensure output directory exists
        os.makedirs(output_dir, exist_ok=True)
        
        # Generate filename
        timestamp = datetime.datetime.now().strftime("%Y%m%d_%H%M%S")
        if study_id:
            filename = f"crf_positions_{study_id}_{timestamp}.json"
            latest_filename = f"crf_positions_{study_id}_latest.json"
        else:
            filename = f"crf_positions_{timestamp}.json"
            latest_filename = f"crf_positions_latest.json"
        
        # Save main file
        output_path = os.path.join(output_dir, filename)
        with open(output_path, 'w', encoding='utf-8') as f:
            json.dump(positions_data, f, ensure_ascii=False, indent=2)
        
        # Save latest file (for quick access)
        latest_path = os.path.join(output_dir, latest_filename)
        with open(latest_path, 'w', encoding='utf-8') as f:
            json.dump(positions_data, f, ensure_ascii=False, indent=2)
        
        print(f"🔍 CRF Positions saved to: {output_path}", file=sys.stderr)
        print(f"🔍 CRF Latest saved to: {latest_path}", file=sys.stderr)
        
        return output_path
        
    except Exception as e:
        print(f"🔍 CRF ERROR saving positions: {str(e)}", file=sys.stderr)
        raise

def main():
    """
    Main function: Extract CRF positions and save to file
    Usage: python crf_position_extractor.py <pdf_file_path> <output_dir> [study_id]
    """
    if len(sys.argv) < 3:
        error_response = {
            'success': False,
            'error': 'Usage: python crf_position_extractor.py <pdf_file_path> <output_dir> [study_id]',
            'pages': [],
            'metadata': {'total_words': 0}
        }
        print(json.dumps(error_response, ensure_ascii=False))
        sys.exit(1)
    
    file_path = sys.argv[1]
    output_dir = sys.argv[2]
    study_id = sys.argv[3] if len(sys.argv) > 3 else None
    
    # Extract positions
    result = extract_text_positions(file_path, study_id)
    
    # Save to file if extraction was successful
    if result['success']:
        try:
            saved_file = save_positions_to_file(result, output_dir, study_id)
            result['saved_file'] = saved_file
        except Exception as save_error:
            result['success'] = False
            result['error'] = f"Extraction successful but failed to save: {str(save_error)}"
    
    # Output JSON result (for Node.js integration)
    print(json.dumps(result, ensure_ascii=False))

if __name__ == "__main__":
    main()