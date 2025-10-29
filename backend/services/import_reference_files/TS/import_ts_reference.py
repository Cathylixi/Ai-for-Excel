#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
TS Reference Data 导入MongoDB脚本

功能：
1. 读取 TS_example.xlsx 文件
2. 将整个Excel内容作为一条记录存储到 MongoDB
3. 存储路径：References.TS 集合（只有一条记录）

数据结构：
{
  "file_name": "TS_example.xlsx",
  "file_type": "TS_Reference",
  "description": "TS Domain Reference Data",
  "columns": [...],
  "data": [...],
  "total_rows": 46,
  "created_at": "2025-10-23",
  "last_updated": "2025-10-23"
}
"""

import os
import pandas as pd
from pymongo import MongoClient
from datetime import datetime
from bson import ObjectId
import numpy as np

# ===================== 配置参数 =====================

# Excel文件路径
EXCEL_PATH = '/Users/wgl/Desktop/LLX Solutions 0722/LLXExcel/backend/Resource/TS_example.xlsx'

# MongoDB连接配置（MongoDB Atlas）
MONGO_URI = 'mongodb+srv://xixili0818:QWERasdf1234@cluster0.cfd61nz.mongodb.net/?retryWrites=true&w=majority&appName=Cluster0'
DB_NAME = 'References'
COLLECTION_NAME = 'TS'

# ===================== 辅助函数 =====================

def clean_value(value):
    """清理单元格值，处理NaN和None"""
    if pd.isna(value) or value is None:
        return None
    if isinstance(value, (int, float)):
        # 如果是数字类型
        if pd.isna(value):
            return None
        # 检查是否为整数
        if isinstance(value, float) and value.is_integer():
            return int(value)
        return value
    if isinstance(value, str):
        return value.strip()
    return str(value)

def convert_df_to_records(df):
    """将DataFrame转换为记录列表，处理NaN值"""
    records = []
    for _, row in df.iterrows():
        record = {}
        for col in df.columns:
            record[col] = clean_value(row[col])
        records.append(record)
    return records

# ===================== 主函数 =====================

def import_ts_reference():
    """主导入函数"""
    print('=' * 60)
    print('🚀 开始导入 TS Reference Data')
    print('=' * 60)
    
    # 检查文件是否存在
    if not os.path.exists(EXCEL_PATH):
        print(f'❌ 文件不存在: {EXCEL_PATH}')
        return
    
    print(f'📄 Excel文件: {EXCEL_PATH}')
    
    # 连接MongoDB
    print(f'🔌 连接MongoDB Atlas...')
    try:
        client = MongoClient(MONGO_URI, serverSelectionTimeoutMS=10000)
        client.server_info()  # 测试连接
        print('✅ MongoDB连接成功')
    except Exception as e:
        print(f'❌ MongoDB连接失败: {e}')
        return
    
    db = client[DB_NAME]
    collection = db[COLLECTION_NAME]
    
    # 读取Excel
    print(f'\n📖 开始读取Excel文件...')
    try:
        df = pd.read_excel(EXCEL_PATH, sheet_name=0)
        print(f'✅ 读取成功')
        print(f'   📊 总行数: {len(df)}')
        print(f'   📊 总列数: {len(df.columns)}')
        print(f'   📋 列名: {list(df.columns)}')
        
    except Exception as e:
        print(f'❌ 读取Excel失败: {e}')
        return
    
    # 转换数据
    print(f'\n🔄 转换数据格式...')
    records = convert_df_to_records(df)
    print(f'✅ 转换完成，共 {len(records)} 条记录')
    
    # 构建MongoDB文档（整个Excel作为一条记录）
    current_time = datetime.now().strftime('%Y-%m-%d %H:%M:%S')
    
    document = {
        '_id': ObjectId(),
        'file_name': os.path.basename(EXCEL_PATH),
        'file_type': 'TS_Reference',
        'description': 'TS (Trial Summary) Domain Reference Data - SDTM Standard',
        'columns': list(df.columns),
        'data': records,
        'total_rows': len(records),
        'total_columns': len(df.columns),
        'created_at': current_time,
        'last_updated': current_time,
        'metadata': {
            'source': 'TS_example.xlsx',
            'format': 'SDTM TS Domain',
            'version': '1.0'
        }
    }
    
    # 清空集合并插入新记录（确保只有一条记录）
    print(f'\n💾 开始存储到MongoDB...')
    print(f'   📍 数据库: {DB_NAME}')
    print(f'   📍 集合: {COLLECTION_NAME}')
    
    try:
        # 清空集合（确保只有一条记录）
        delete_result = collection.delete_many({})
        print(f'   🗑️  清空旧数据: {delete_result.deleted_count} 条')
        
        # 插入新记录
        result = collection.insert_one(document)
        print(f'   ✅ 插入成功，文档ID: {result.inserted_id}')
        
    except Exception as e:
        print(f'   ❌ 存储失败: {e}')
        return
    
    # 验证
    print(f'\n🔍 验证导入结果...')
    try:
        count = collection.count_documents({})
        print(f'   📊 集合中的文档数: {count}')
        
        # 获取文档并显示部分信息
        doc = collection.find_one()
        if doc:
            print(f'   ✅ 验证成功！')
            print(f'   📋 文件名: {doc.get("file_name")}')
            print(f'   📋 数据行数: {doc.get("total_rows")}')
            print(f'   📋 数据列数: {doc.get("total_columns")}')
            print(f'   📋 列名: {doc.get("columns")[:5]}... (前5列)')
            print(f'   📋 创建时间: {doc.get("created_at")}')
        else:
            print(f'   ❌ 验证失败：未找到文档')
            
    except Exception as e:
        print(f'   ❌ 验证失败: {e}')
    
    # 关闭连接
    client.close()
    
    print('\n' + '=' * 60)
    print('✅ TS Reference Data 导入完成')
    print('=' * 60)
    
    # 输出查询示例
    print('\n📝 查询示例:')
    print('  // 获取整个TS参考数据')
    print('  db.TS.findOne()')
    print('')
    print('  // 获取数据行数')
    print('  db.TS.findOne({}, {total_rows: 1})')
    print('')
    print('  // 获取列名')
    print('  db.TS.findOne({}, {columns: 1})')
    print('')
    print('  // 获取所有数据')
    print('  db.TS.findOne({}, {data: 1})')

# ===================== 执行脚本 =====================

if __name__ == '__main__':
    try:
        import_ts_reference()
    except KeyboardInterrupt:
        print('\n\n⚠️ 用户中断')
    except Exception as e:
        print(f'\n❌ 发生错误: {e}')
        import traceback
        traceback.print_exc()

