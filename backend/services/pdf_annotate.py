#!/usr/bin/env python3
"""
PDF Annotation Script for CRF Documents
在PDF上绘制注解矩形和索引数字

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
    from pypdf.generic import RectangleObject, NameObject, DictionaryObject, ArrayObject, NumberObject, TextStringObject
except ImportError:
    print("❌ 错误: 需要安装 pypdf 库")
    print("请运行: pip install pypdf")
    sys.exit(1)


def annotate_pdf(source_path, rects_by_page, output_path):
    """
    在PDF上添加注解矩形和索引数字
    
    Args:
        source_path (str): 原始PDF文件路径
        rects_by_page (dict): 按页码组织的矩形数据
        output_path (str): 输出PDF文件路径
        
    Returns:
        dict: 处理结果统计
    """
    # print(f"🎨 开始PDF注解处理...")
    # print(f"📄 源文件: {source_path}")
    # print(f"💾 输出文件: {output_path}")
    
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
        
        # print(f"📊 PDF页数: {len(reader.pages)}")
        # print(f"📊 注解页数: {len(rects_by_page)}")
        
        # 遍历每一页
        for page_num in range(len(reader.pages)):
            page = reader.pages[page_num]
            page_number = page_num + 1  # PDF页码从1开始
            
            # 检查该页是否有注解
            page_key = str(page_number)
            if page_key in rects_by_page:
                rects = rects_by_page[page_key]
                print(f"📍 处理第 {page_number} 页 - {len(rects)} 个矩形")
                
                # 为该页添加注解
                add_annotations_to_page(page, rects)
                total_rects += len(rects)
                processed_pages += 1
            # 🔥 移除了"无注解"的打印，只打印需要处理的页面
            
            # 添加页面到输出
            writer.add_page(page)
        
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
        
        # print(f"✅ PDF注解完成!")
        # print(f"📊 处理统计: {processed_pages}/{len(reader.pages)} 页, {total_rects} 个矩形")
        # print(f"📦 输出文件大小: {result['file_size']:,} bytes")
        # print(f"📁 注解PDF保存路径: {output_path}")
        # print(f"🗂️  绝对路径: {result['output_path_absolute']}")
        
        return result
        
    except Exception as e:
        error_msg = f"PDF注解处理失败: {str(e)}"
        print(f"❌ {error_msg}")
        raise Exception(error_msg)


def add_annotations_to_page(page, rects):
    """
    在指定页面添加矩形注解
    
    Args:
        page: pypdf Page对象
        rects (list): 该页的矩形列表
    """
    if not hasattr(page, '/Annots'):
        page[NameObject('/Annots')] = ArrayObject()
    elif page['/Annots'] is None:
        page[NameObject('/Annots')] = ArrayObject()
    
    annots = page['/Annots']
    
    for rect_data in rects:
        # 提取矩形参数
        x = rect_data['x']
        y = rect_data['y'] 
        width = rect_data['width']
        height = rect_data['height']
        text = str(rect_data['text'])
        rect_type = rect_data.get('type', 'Unknown')
        
        # 创建矩形注解
        rect_obj = RectangleObject([x, y, x + width, y + height])
        
        # 设置颜色：黑边蓝底
        border_color = [0, 0, 0]  # 黑色边框
        if rect_type == 'Label':
            # 淺藍色内部 (RGB: 173, 216, 230)
            fill_color = [0.678, 0.847, 0.902]  # Light Blue
        elif rect_type == 'OID':
            # 淺藍色内部 (RGB: 173, 216, 230) - 统一为蓝色
            fill_color = [0.678, 0.847, 0.902]  # Light Blue
        else:
            # 淺藍色内部 (RGB: 173, 216, 230)
            fill_color = [0.678, 0.847, 0.902]  # Light Blue
        
        # 创建简化的方形注解 - 使用基本属性确保兼容性
        annotation = DictionaryObject({
            NameObject('/Type'): NameObject('/Annot'),
            NameObject('/Subtype'): NameObject('/Square'),
            NameObject('/Rect'): rect_obj,
            NameObject('/C'): ArrayObject([NumberObject(c) for c in border_color]),  # 边框颜色：黑色
            NameObject('/IC'): ArrayObject([NumberObject(c) for c in fill_color]),   # 内部填充颜色：蓝色
            NameObject('/BS'): DictionaryObject({
                NameObject('/W'): NumberObject(3),  # 增加边框宽度使其更明显
                NameObject('/S'): NameObject('/S')  # 边框样式：实线
            }),
            NameObject('/F'): NumberObject(4),  # 可打印标志
            NameObject('/Contents'): TextStringObject(f"{rect_type} {text}"),
            NameObject('/T'): TextStringObject(f"CRF_{rect_type}_{text}"),
        })
        
        # 🔧 新方案：只使用黄色背景的可编辑文字字段
        # 🆕 区分FormDomain和问题标注类型
        if rect_data.get('type') == 'FormDomain':
            # Form域标注：使用特殊的字段名格式
            form_name = rect_data.get('form_name', 'UNKNOWN')
            domain_index = rect_data.get('domain_index', 0)
            page_number = rect_data.get('page_number', 1)
            bg = rect_data.get('background_color', None)
            
            # 创建Form域可编辑文字字段
            editable_text_field = create_form_domain_text_field(
                rect_obj, text, form_name, domain_index, page_number, bg
            )
        else:
            # 问题标注：使用原有的字段名格式
            form_name = rect_data.get('form_name', 'UNKNOWN')
            original_index = rect_data.get('original_index', 0)
            variable_index = rect_data.get('variable_index', 0)
            bg = rect_data.get('background_color', None)
            
            # 创建问题可编辑文字字段（黄色背景）
            editable_text_field = create_editable_text_field(
                rect_obj, text, rect_type, form_name, original_index, variable_index, bg
            )
        
        # 添加到页面注解列表 - 只添加文字字段
        annots.append(editable_text_field)


def create_form_domain_text_field(rect_obj, text, form_name, domain_index, page_number, background_color=None):
    """
    创建Form域可编辑文字字段（左上角域标注）
    
    Args:
        rect_obj: 矩形对象
        text: 域文本，如 "DM (Demographics)"
        form_name: Form名称
        domain_index: 域索引
        page_number: 页面号
        
    Returns:
        DictionaryObject: 可编辑文字字段PDF对象
    """
    # rect_obj 为 [x0, y0, x1, y1]，不是 [x, y, width, height]
    x0, y0, x1, y1 = rect_obj
    width = x1 - x0
    height = y1 - y0
    
    # 文本框矩形：直接使用传入的矩形范围
    text_rect = rect_obj
    
    # Form域字段名格式：FORM_DOMAIN_{formName}_{domainIndex}_{pageNumber}
    field_name = f"FORM_DOMAIN_{form_name}_{domain_index}_{page_number}"
    
    # 创建Form域文字字段（动态背景色；若background_color为None则无背景色）
    text_field = DictionaryObject({
        NameObject('/Type'): NameObject('/Annot'),
        NameObject('/Subtype'): NameObject('/Widget'),
        NameObject('/Rect'): text_rect,
        NameObject('/FT'): NameObject('/Tx'),  # 文本字段类型
        NameObject('/T'): TextStringObject(field_name),  # 字段名
        NameObject('/V'): TextStringObject(text),  # 默认值
        NameObject('/DV'): TextStringObject(text),  # 默认值
        NameObject('/F'): NumberObject(4),  # 可打印
        NameObject('/Ff'): NumberObject(0),  # 字段标志：0=可编辑
        NameObject('/Q'): NumberObject(1),  # 居中对齐
        NameObject('/DA'): TextStringObject('/Helvetica-Bold 13 Tf 0 0 0 rg'),  # 默认外观：黑色粗体13号（与问题标注一致）
        NameObject('/MK'): DictionaryObject({
            NameObject('/BC'): ArrayObject([NumberObject(0), NumberObject(0), NumberObject(0)])  # 黑色边框
        })
    })
    # 仅当给定背景色时设置 /BG
    if background_color is not None:
        text_field['/MK'][NameObject('/BG')] = ArrayObject([
            NumberObject(background_color[0]),
            NumberObject(background_color[1]),
            NumberObject(background_color[2])
        ])
    
    return text_field

def create_editable_text_field(rect_obj, text, rect_type, form_name, original_index, variable_index=0, background_color=None):
    """
    创建可编辑文字字段
    
    Args:
        rect_obj: 矩形对象
        text (str): 默认文字内容
        rect_type (str): 矩形类型
        form_name (str): 表单名称，用于生成唯一字段名
        original_index (int): 原始mapping的index值，用于生成唯一字段名
        
    Returns:
        DictionaryObject: 可编辑文字字段注解对象
    """
    # 获取矩形尺寸和位置
    x0, y0, x1, y1 = rect_obj
    width = x1 - x0
    height = y1 - y0
    
    # 创建文字字段的矩形（使用完整范围）
    text_rect = rect_obj
    
    # 创建可编辑文字字段（若background_color为None则无背景色）
    text_field = DictionaryObject({
        NameObject('/Type'): NameObject('/Annot'),
        NameObject('/Subtype'): NameObject('/Widget'),
        NameObject('/Rect'): text_rect,
        NameObject('/FT'): NameObject('/Tx'),  # 文本字段类型
        NameObject('/T'): TextStringObject(f"CRF_{form_name}_Index_{original_index}_Var_{variable_index}"),  # 字段名: 包含variable索引以区分多个框
        NameObject('/V'): TextStringObject(text),  # 默认值
        NameObject('/DV'): TextStringObject(text),  # 默认值
        NameObject('/F'): NumberObject(4),  # 可打印
        NameObject('/Ff'): NumberObject(0),  # 字段标志：0=可编辑
        NameObject('/Q'): NumberObject(1),  # 居中对齐
        NameObject('/DA'): TextStringObject('/Helvetica-Bold 13 Tf 0 0 0 rg'),  # 默认外观：黑色粗体18号
        NameObject('/MK'): DictionaryObject({
            NameObject('/BC'): ArrayObject([NumberObject(0), NumberObject(0), NumberObject(0)])  # 黑色边框
        })
    })
    # 仅当给定背景色时设置 /BG
    if background_color is not None:
        text_field['/MK'][NameObject('/BG')] = ArrayObject([
            NumberObject(background_color[0]),
            NumberObject(background_color[1]),
            NumberObject(background_color[2])
        ])
    
    return text_field


def create_combined_annotation(rect_obj, text, border_color, fill_color, rect_type):
    """
    创建组合注解：包含框和文字
    
    Args:
        rect_obj: 矩形对象
        text (str): 要显示的文本
        border_color (list): 边框颜色
        fill_color (list): 填充颜色
        rect_type (str): 矩形类型
        
    Returns:
        DictionaryObject: 组合注解对象
    """
    # 获取矩形尺寸
    x0, y0, x1, y1 = rect_obj
    width = x1 - x0
    height = y1 - y0
    
    # 创建外观流内容 - 包含框和文字
    stream_content = f"""q
{fill_color[0]} {fill_color[1]} {fill_color[2]} rg
0 0 {width} {height} re f
{border_color[0]} {border_color[1]} {border_color[2]} RG
3 w
0 0 {width} {height} re S
BT
/Helvetica-Bold 16 Tf
{border_color[0]} {border_color[1]} {border_color[2]} rg
{width/2 - 4} {height/2 - 6} Td
({text}) Tj
ET
Q""".strip()
    
    from pypdf.generic import StreamObject
    
    # 创建外观流对象
    appearance_stream = StreamObject()
    appearance_stream._data = stream_content.encode()
    appearance_stream.update({
        NameObject('/Type'): NameObject('/XObject'),
        NameObject('/Subtype'): NameObject('/Form'),
        NameObject('/BBox'): ArrayObject([NumberObject(0), NumberObject(0), 
                                         NumberObject(width), NumberObject(height)]),
        NameObject('/Length'): NumberObject(len(stream_content)),
        NameObject('/Resources'): DictionaryObject({
            NameObject('/Font'): DictionaryObject({
                NameObject('/Helvetica-Bold'): DictionaryObject({
                    NameObject('/Type'): NameObject('/Font'),
                    NameObject('/Subtype'): NameObject('/Type1'),
                    NameObject('/BaseFont'): NameObject('/Helvetica-Bold')
                })
            })
        })
    })
    
    # 创建注解对象
    annotation = DictionaryObject({
        NameObject('/Type'): NameObject('/Annot'),
        NameObject('/Subtype'): NameObject('/Square'),
        NameObject('/Rect'): rect_obj,
        NameObject('/F'): NumberObject(4),  # 可打印
        NameObject('/Contents'): TextStringObject(f"{rect_type} {text}"),
        NameObject('/T'): TextStringObject(f"CRF_{rect_type}_{text}"),
        NameObject('/AP'): DictionaryObject({
            NameObject('/N'): appearance_stream
        })
    })
    
    return annotation


def create_filled_appearance(width, height, border_color, fill_color):
    """
    创建带填充色的外观流
    
    Args:
        width (float): 矩形宽度
        height (float): 矩形高度
        border_color (list): 边框颜色 [r, g, b]
        fill_color (list): 填充颜色 [r, g, b]
        
    Returns:
        DictionaryObject: 外观流对象
    """
    # 创建外观流内容 (PDF绘图命令)
    stream_content = f"""
q
{fill_color[0]} {fill_color[1]} {fill_color[2]} rg
0 0 {width} {height} re f
{border_color[0]} {border_color[1]} {border_color[2]} RG
2 w
0 0 {width} {height} re S
Q
""".strip()
    
    from pypdf.generic import StreamObject
    
    appearance_stream = StreamObject()
    appearance_stream._data = stream_content.encode()
    appearance_stream.update({
        NameObject('/Type'): NameObject('/XObject'),
        NameObject('/Subtype'): NameObject('/Form'),
        NameObject('/BBox'): ArrayObject([NumberObject(0), NumberObject(0), 
                                         NumberObject(width), NumberObject(height)]),
        NameObject('/Length'): NumberObject(len(stream_content))
    })
    
    return appearance_stream


def create_text_annotation(x, y, text, rect_type):
    """
    创建文本注解 (在矩形中心显示索引数字)
    
    Args:
        x (float): 文本中心X坐标
        y (float): 文本中心Y坐标 
        text (str): 要显示的文本
        rect_type (str): 矩形类型
        
    Returns:
        DictionaryObject: 文本注解对象
    """
    # 文本框大小
    text_width = 20
    text_height = 20
    
    # 计算文本框矩形 (以x,y为中心)
    text_rect = RectangleObject([
        x - text_width/2, y - text_height/2,
        x + text_width/2, y + text_height/2
    ])
    
    # 文本颜色 (深色以便可读)
    text_color = [0, 0, 0]  # 黑色
    
    text_annotation = DictionaryObject({
        NameObject('/Type'): NameObject('/Annot'),
        NameObject('/Subtype'): NameObject('/FreeText'),
        NameObject('/Rect'): text_rect,
        NameObject('/Contents'): TextStringObject(text),
        NameObject('/DA'): TextStringObject('/Helvetica-Bold 14 Tf 0 0 0 rg'),  # 字体和颜色
        NameObject('/F'): NumberObject(4),  # 可打印
        NameObject('/BS'): DictionaryObject({
            NameObject('/W'): NumberObject(0),  # 无边框
        }),
        NameObject('/C'): ArrayObject([NumberObject(c) for c in text_color]),
        NameObject('/T'): TextStringObject(f"Index_{text}"),
    })
    
    return text_annotation


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
            # print(f"📄 解析JSON字符串矩形数据")
        
        # 执行注解
        result = annotate_pdf(source_path, rects_by_page, output_path)
        
        # 输出结果 - 注释掉重复的统计信息
        # print(f"\n🎉 注解成功完成!")
        # print(f"📊 统计信息:")
        # print(f"   - 总页数: {result['total_pages']}")
        # print(f"   - 处理页数: {result['processed_pages']}")
        # print(f"   - 总矩形数: {result['total_rects']}")
        # print(f"   - 文件大小: {result['file_size']:,} bytes")
        # print(f"📁 注解PDF输出路径: {output_path}")
        # print(f"🗂️  绝对路径: {result['output_path_absolute']}")
            
    except Exception as e:
        print(f"❌ 处理失败: {e}")
        sys.exit(1)


if __name__ == "__main__":
    main()
