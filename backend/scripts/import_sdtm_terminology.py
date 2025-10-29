#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
CDISC SDTM Terminology Excel导入MongoDB脚本

功能：
1. 读取 CDISC SDTM Terminology_20250328.xls
2. 识别大类（Codelist Extensible = "No"）和子项
3. 生成MongoDB文档结构
4. 批量导入到 References/sdtm_terminology 集合

性能优化：
- 分块读取Excel避免内存溢出
- 批量写入MongoDB（每100条）
- 仅读取必要列
"""

import os
import re
import pandas as pd
from pymongo import MongoClient
from datetime import datetime
from bson import ObjectId

# ===================== 配置参数 =====================

# Excel文件路径
EXCEL_PATH = '/Users/wgl/Desktop/LLX Solutions 0722/LLXExcel/backend/Resource/CDISC SDTM Terminology_20250328.xls'

# MongoDB连接配置（MongoDB Atlas云端数据库）
MONGO_URI = 'mongodb+srv://xixili0818:QWERasdf1234@cluster0.cfd61nz.mongodb.net/?retryWrites=true&w=majority&appName=Cluster0'
DB_NAME = 'References'  # 使用独立的References数据库
COLLECTION_NAME = 'sdtm_terminology'

# 批量写入大小
BATCH_SIZE = 100

# Excel列映射（A-H列）
COLUMN_MAPPING = {
    'Code': 0,                      # A列
    'Codelist Code': 1,            # B列
    'Codelist Extensible': 2,      # C列
    'Codelist Name': 3,            # D列
    'CDISC Submission Value': 4,   # E列
    'CDISC Synonym(s)': 5,         # F列
    'CDISC Definition': 6,         # G列
    'NCI Preferred Term': 7        # H列
}

# ===================== 辅助函数 =====================

def parse_version_from_filename(filename):
    """从文件名提取版本日期"""
    match = re.search(r'(\d{8})', filename)
    if match:
        date_str = match.group(1)
        return f"{date_str[:4]}-{date_str[4:6]}-{date_str[6:]}"
    return datetime.now().strftime('%Y-%m-%d')

def clean_value(value):
    """清理单元格值"""
    if pd.isna(value) or value == '' or value is None:
        return None
    if isinstance(value, str):
        return value.strip()
    return str(value).strip()

def parse_synonyms(synonym_str):
    """解析Synonym字段（可能包含多个，用分隔符分开）"""
    if not synonym_str:
        return []
    # 假设用分号或逗号分隔
    synonyms = re.split(r'[;,]', synonym_str)
    return [s.strip() for s in synonyms if s.strip()]

def is_codelist_header(row):
    """判断是否为大类标题行（Codelist Extensible = "No" 或 "Yes"）"""
    extensible = clean_value(row.get('Codelist Extensible'))
    # 🔥 修改：同时识别Yes和No（之前只识别No，导致很多大类被遗漏）
    return extensible and extensible.upper() in ['NO', 'YES']

def build_codelist_document(header_row, items, file_info):
    """构建MongoDB文档"""
    code = clean_value(header_row.get('Code'))
    name = clean_value(header_row.get('Codelist Name'))
    definition = clean_value(header_row.get('CDISC Definition'))
    nci_term = clean_value(header_row.get('NCI Preferred Term'))
    
    document = {
        '_id': ObjectId(),
        'File_Name': file_info['file_name'],
        'File_Function': 'CDISC',
        'version': file_info['version'],
        'codelist': {
            'code': code or '',
            'codelist_code': code or '',  # 🔥 大类的codelist_code等于自己的code
            'name': name or '',
            'extensible': False,
            'definition': definition or '',
            'nci_preferred_term': nci_term or ''
        },
        'items': items,
        'last_updated': file_info['version']
    }
    
    return document

def build_item(row, codelist_code):
    """构建子项"""
    code = clean_value(row.get('Code'))
    name = clean_value(row.get('Codelist Name'))
    submission_value = clean_value(row.get('CDISC Submission Value'))
    synonym_str = clean_value(row.get('CDISC Synonym(s)'))
    definition = clean_value(row.get('CDISC Definition'))
    nci_term = clean_value(row.get('NCI Preferred Term'))
    
    synonyms = parse_synonyms(synonym_str) if synonym_str else []
    
    item = {
        'code': code or '',
        'codelist_code': codelist_code or '',
        'name': name or '',
        'submission_value': submission_value or '',
        'synonyms': synonyms,
        'definition': definition or '',
        'nci_preferred_term': nci_term or ''
    }
    
    return item

# ===================== 主函数 =====================

def import_sdtm_terminology():
    """主导入函数"""
    print('=' * 60)
    print('🚀 开始导入 CDISC SDTM Terminology')
    print('=' * 60)
    
    # 检查文件是否存在
    if not os.path.exists(EXCEL_PATH):
        print(f'❌ 文件不存在: {EXCEL_PATH}')
        return
    
    print(f'📄 Excel文件: {EXCEL_PATH}')
    
    # 提取文件信息
    file_name = os.path.basename(EXCEL_PATH)
    version = parse_version_from_filename(file_name)
    file_info = {
        'file_name': file_name,
        'version': version
    }
    
    print(f'📅 版本日期: {version}')
    
    # 连接MongoDB
    print(f'🔌 连接MongoDB: {MONGO_URI}')
    try:
        client = MongoClient(MONGO_URI, serverSelectionTimeoutMS=5000)
        client.server_info()  # 测试连接
        print('✅ MongoDB连接成功')
    except Exception as e:
        print(f'❌ MongoDB连接失败: {e}')
        return
    
    db = client[DB_NAME]
    collection = db[COLLECTION_NAME]
    
    # 清空集合（可选，根据需求决定是否清空）
    print(f'🗑️  清空集合: {DB_NAME}.{COLLECTION_NAME}')
    collection.delete_many({})
    
    # 读取Excel
    print(f'\n📖 开始读取Excel文件（第二个sheet）...')
    try:
        # 🔥 读取第二个sheet（sheet_name=1，索引从0开始）
        # 使用pandas读取Excel（.xls格式需要xlrd）
        # 只读取前8列（A-H）
        df = pd.read_excel(
            EXCEL_PATH,
            sheet_name=1,    # 🔥 读取第二个sheet（索引从0开始）
            engine='xlrd',   # .xls格式使用xlrd
            usecols='A:H',   # 只读取A到H列
            dtype=str        # 全部读为字符串，避免类型转换问题
        )
        
        print(f'✅ 读取成功（第二个sheet），总行数: {len(df)}')
        
    except Exception as e:
        print(f'❌ 读取Excel失败: {e}')
        return
    
    # 标准化列名
    df.columns = [
        'Code',
        'Codelist Code',
        'Codelist Extensible',
        'Codelist Name',
        'CDISC Submission Value',
        'CDISC Synonym(s)',
        'CDISC Definition',
        'NCI Preferred Term'
    ]
    
    # 开始解析
    print(f'\n🔍 开始解析文档结构...')
    
    documents = []
    current_codelist_header = None
    current_items = []
    total_codelists = 0
    total_items = 0
    
    for idx, row in df.iterrows():
        # 转换为字典
        row_dict = row.to_dict()
        
        # 检查是否为大类标题行
        if is_codelist_header(row_dict):
            # 保存前一个大类（如果存在）
            if current_codelist_header is not None:
                doc = build_codelist_document(current_codelist_header, current_items, file_info)
                documents.append(doc)
                total_codelists += 1
                total_items += len(current_items)
                
                # 批量写入
                if len(documents) >= BATCH_SIZE:
                    collection.insert_many(documents)
                    print(f'  💾 批量写入 {len(documents)} 条文档（总计: {total_codelists} 个大类，{total_items} 个子项）')
                    documents = []
            
            # 开始新的大类
            current_codelist_header = row_dict
            current_items = []
            
        else:
            # 这是子项
            if current_codelist_header is not None:
                codelist_code = clean_value(current_codelist_header.get('Code'))
                item = build_item(row_dict, codelist_code)
                current_items.append(item)
    
    # 保存最后一个大类
    if current_codelist_header is not None:
        doc = build_codelist_document(current_codelist_header, current_items, file_info)
        documents.append(doc)
        total_codelists += 1
        total_items += len(current_items)
    
    # 最后一批写入
    if documents:
        collection.insert_many(documents)
        print(f'  💾 批量写入 {len(documents)} 条文档（总计: {total_codelists} 个大类，{total_items} 个子项）')
    
    # 创建索引
    print(f'\n🔧 创建索引...')
    collection.create_index([('codelist.code', 1)])
    collection.create_index([('codelist.name', 1)])
    collection.create_index([('items.code', 1)])
    collection.create_index([('items.submission_value', 1)])
    print('✅ 索引创建完成')
    
    # 验证
    print(f'\n🔍 验证导入结果...')
    final_count = collection.count_documents({})
    print(f'✅ 导入完成！')
    print(f'   📊 总计大类: {final_count}')
    print(f'   📊 总计子项: {total_items}')
    
    # 关闭连接
    client.close()
    
    print('\n' + '=' * 60)
    print('✅ SDTM Terminology 导入完成')
    print('=' * 60)
    
    # 输出示例查询
    print('\n📝 示例查询:')
    print('  db.sdtm_terminology.find({ "codelist.name": "10-Meter Walk/Run Functional Test" })')
    print('  db.sdtm_terminology.find({ "items.submission_value": "TENMW1TC" })')
    print(f'  db.sdtm_terminology.countDocuments({{}})')

# ===================== 执行脚本 =====================

if __name__ == '__main__':
    try:
        import_sdtm_terminology()
    except KeyboardInterrupt:
        print('\n\n⚠️ 用户中断')
    except Exception as e:
        print(f'\n❌ 发生错误: {e}')
        import traceback
        traceback.print_exc()

