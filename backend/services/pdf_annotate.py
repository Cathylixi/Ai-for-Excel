#!/usr/bin/env python3
"""
PDF Annotation Script for CRF Documents - FreeText Version
在PDF上绘制FreeText注解

Usage:
    python pdf_annotate.py <source_path> <rects_json> <output_path>
    
    或作为模块调用:
    annotate_pdf(source_path, rects_by_page, output_path)
"""

import sys
import json
import os
from pathlib import Path
try:
    from pypdf import PdfReader, PdfWriter
    from pypdf.annotations import FreeText
except ImportError:
    print("❌ 错误: 需要安装 pypdf 库")
    print("请运行: pip install pypdf")
    sys.exit(1)


def rgb01_to_hex(rgb01):
    """
    把 [r,g,b] (0–1) 转成 'RRGGBB' 十六进制字符串
    
    Args:
        rgb01 (list): RGB值数组，每个值在0-1范围内
        
    Returns:
        str: 十六进制颜色字符串，例如 'ffbe9b'
    """
    if not rgb01 or len(rgb01) != 3:
        return None
    
    r, g, b = [max(0, min(255, round(c * 255))) for c in rgb01]
    return f"{r:02x}{g:02x}{b:02x}"


def annotate_pdf(source_path, rects_by_page, output_path):
    """
    在PDF上添加FreeText注解
    
    Args:
        source_path (str): 原始PDF文件路径
        rects_by_page (dict): 按页码组织的矩形数据
        output_path (str): 输出PDF文件路径
        
    Returns:
        dict: 处理结果统计
    """
    # 验证输入文件
    if not os.path.exists(source_path):
        raise FileNotFoundError(f"源PDF文件不存在: {source_path}")
    
    # 确保输出目录存在
    output_dir = os.path.dirname(output_path)
    if output_dir and not os.path.exists(output_dir):
        os.makedirs(output_dir, exist_ok=True)
    
    try:
        # 读取原PDF
        reader = PdfReader(source_path)
        writer = PdfWriter()
        
        total_rects = 0
        processed_pages = 0
        
        # 复制所有页面到writer
        for page in reader.pages:
            writer.add_page(page)
        
        # 遍历每一页添加注解
        for page_num in range(len(reader.pages)):
            page_number = page_num + 1  # PDF页码从1开始
            
            # 检查该页是否有注解
            page_key = str(page_number)
            if page_key in rects_by_page:
                rects = rects_by_page[page_key]
                print(f"📍 处理第 {page_number} 页 - {len(rects)} 个矩形")
                
                # 为该页添加FreeText注解
                add_annotations_to_page(writer, page_num, rects)
                total_rects += len(rects)
                processed_pages += 1
        
        # 保存注解后的PDF
        with open(output_path, 'wb') as output_file:
            writer.write(output_file)
        
        # 返回处理统计
        result = {
            'success': True,
            'source_path': source_path,
            'output_path': output_path,
            'output_path_absolute': os.path.abspath(output_path),
            'total_pages': len(reader.pages),
            'processed_pages': processed_pages,
            'total_rects': total_rects,
            'file_size': os.path.getsize(output_path)
        }
        
        return result
        
    except Exception as e:
        error_msg = f"PDF注解处理失败: {str(e)}"
        print(f"❌ {error_msg}")
        raise Exception(error_msg)


def add_annotations_to_page(writer, page_index, rects):
    """
    在指定页面添加FreeText注解
    
    Args:
        writer: PdfWriter对象
        page_index: 页面索引 (0-based)
        rects (list): 该页的矩形列表
    """
    for rect_data in rects:
        # 提取矩形参数并确保坐标精度
        rect_raw = rect_data["rect"]  # [x0, y0, x1, y1] pypdf坐标
        rect = [round(coord, 2) for coord in rect_raw]  # 保留2位小数避免精度问题
        text = rect_data.get("text", "")
        
        # 背景颜色转换：从RGB 0-1数组转为十六进制字符串
        bg_hex = None
        if isinstance(rect_data.get("background_color"), (list, tuple)) and len(rect_data["background_color"]) == 3:
            bg_hex = rgb01_to_hex(rect_data["background_color"])
        
        # 创建FreeText注释
        annot = FreeText(
            text=text,
            rect=rect,                     # [x0, y0, x1, y1] pypdf坐标 - 已经设置了Rect
            font="Helvetica",              # 通用字体
            font_size="13pt",              # 与原Widget字段一致的字号
            font_color="000000",           # 黑色字体
            border_color="000000",         # 黑色边框
            background_color=bg_hex,       # 动态背景色或None（透明）
            bold=True,                     # 粗体，与原设计一致
            italic=False
        )
        
        # 添加到指定页面
        writer.add_annotation(page_number=page_index, annotation=annot)


def main():
    """
    命令行入口函数
    """
    if len(sys.argv) != 4:
        print("使用方法:")
        print("python pdf_annotate.py <source_path> <rects_json> <output_path>")
        print("")
        print("参数说明:")
        print("  source_path: 原始PDF文件路径")
        print("  rects_json:  矩形数据JSON字符串或文件路径")
        print("  output_path: 输出PDF文件路径")
        sys.exit(1)
    
    source_path = sys.argv[1]
    rects_input = sys.argv[2]
    output_path = sys.argv[3]
    
    try:
        # 解析矩形数据
        if os.path.exists(rects_input):
            # 从文件读取
            with open(rects_input, 'r', encoding='utf-8') as f:
                rects_by_page = json.load(f)
            print(f"📄 从文件读取矩形数据: {rects_input}")
        else:
            # 直接解析JSON字符串
            rects_by_page = json.loads(rects_input)
        
        # 执行注解
        result = annotate_pdf(source_path, rects_by_page, output_path)
            
    except Exception as e:
        print(f"❌ 处理失败: {e}")
        sys.exit(1)


if __name__ == "__main__":
    main()