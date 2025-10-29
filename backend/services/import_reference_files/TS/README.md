# TS Reference Data 导入工具

## 📋 功能说明

将 `TS_example.xlsx` 文件作为**一条记录**存储到 MongoDB Atlas。

### 关键特性
- ✅ **单条记录存储**：整个Excel文件作为一个JSON对象存储
- ✅ **完整数据保留**：保留所有行和列的数据
- ✅ **结构化存储**：columns + data 格式，易于查询和使用

---

## 🚀 快速使用

### 执行导入

```bash
cd /Users/wgl/Desktop/LLX\ Solutions\ 0722/LLXExcel/backend/services/import_reference_files/TS

python3 import_ts_reference.py
```

---

## 📊 数据结构

### MongoDB 文档格式（一条记录）

```json
{
  "_id": ObjectId("..."),
  "file_name": "TS_example.xlsx",
  "file_type": "TS_Reference",
  "description": "TS (Trial Summary) Domain Reference Data - SDTM Standard",
  "columns": [
    "AI",
    "Protocol",
    "Codelist",
    "Multiple",
    "STUDYID",
    "DOMAIN",
    "TSSEQ",
    "TSPARMCD",
    "TSPARM",
    "TSVAL",
    "TSVAL1",
    "TSVALNF",
    "TSVALCD",
    "TSVCDREF",
    "TSVCDVER"
  ],
  "data": [
    {
      "AI": 0,
      "Protocol": null,
      "Codelist": null,
      "Multiple": 0,
      "STUDYID": "SNDX-5613-0700",
      "DOMAIN": "TS",
      "TSSEQ": 1,
      "TSPARMCD": "ACTSUB",
      "TSPARM": "Actual Number of Subjects",
      "TSVAL": null,
      "TSVAL1": null,
      "TSVALNF": null,
      "TSVALCD": null,
      "TSVCDREF": null,
      "TSVCDVER": null
    },
    {
      "AI": 1,
      "Protocol": "Study Design",
      "Codelist": "NY",
      "Multiple": 0,
      "STUDYID": "SNDX-5613-0700",
      "DOMAIN": "TS",
      "TSSEQ": 1,
      "TSPARMCD": "ADAPT",
      "TSPARM": "Adaptive Design",
      "TSVAL": "N",
      "TSVAL1": null,
      "TSVALNF": null,
      "TSVALCD": "C49487",
      "TSVCDREF": "CDISC",
      "TSVCDVER": "2022-12-16"
    }
    // ... 共46条数据记录
  ],
  "total_rows": 46,
  "total_columns": 15,
  "created_at": "2025-10-23 15:45:00",
  "last_updated": "2025-10-23 15:45:00",
  "metadata": {
    "source": "TS_example.xlsx",
    "format": "SDTM TS Domain",
    "version": "1.0"
  }
}
```

---

## 🔍 查询示例

### 1. 获取整个TS参考数据

```javascript
db.TS.findOne()
```

### 2. 仅获取列名

```javascript
db.TS.findOne({}, { columns: 1, _id: 0 })
```

### 3. 获取数据行数

```javascript
db.TS.findOne({}, { total_rows: 1, total_columns: 1 })
```

### 4. 获取所有数据行

```javascript
db.TS.findOne({}, { data: 1, _id: 0 })
```

### 5. 在应用中使用（Node.js示例）

```javascript
// 获取TS参考数据
const tsReference = await db.collection('TS').findOne();

// 获取列名
const columns = tsReference.columns;

// 获取所有数据
const data = tsReference.data;

// 过滤特定TSPARMCD的数据
const adaptData = tsReference.data.filter(row => row.TSPARMCD === 'ADAPT');

// 获取某一列的所有值
const allTSPARMCDs = tsReference.data.map(row => row.TSPARMCD);
```

---

## 📁 文件路径

- **Excel文件**：`backend/Resource/TS_example.xlsx`
- **导入脚本**：`backend/services/import_reference_files/TS/import_ts_reference.py`
- **数据库**：`References`
- **集合**：`TS`（只有一条记录）

---

## 🔧 配置说明

修改 `import_ts_reference.py` 中的配置：

```python
# Excel文件路径
EXCEL_PATH = '/path/to/TS_example.xlsx'

# MongoDB连接
MONGO_URI = 'mongodb+srv://...'
DB_NAME = 'References'
COLLECTION_NAME = 'TS'
```

---

## ⚠️ 注意事项

1. **单条记录**：集合中只有一条记录，每次导入会清空旧数据
2. **数据完整性**：保留所有原始数据，包括NaN值（存为null）
3. **数字类型**：整数保持为整数，浮点数保持为浮点数
4. **空值处理**：Excel中的空单元格存为null

---

## 📈 预期输出

```
============================================================
🚀 开始导入 TS Reference Data
============================================================
📄 Excel文件: TS_example.xlsx
🔌 连接MongoDB Atlas...
✅ MongoDB连接成功

📖 开始读取Excel文件...
✅ 读取成功
   📊 总行数: 46
   📊 总列数: 15
   📋 列名: ['AI', 'Protocol', 'Codelist', ...]

🔄 转换数据格式...
✅ 转换完成，共 46 条记录

💾 开始存储到MongoDB...
   📍 数据库: References
   📍 集合: TS
   🗑️  清空旧数据: 0 条
   ✅ 插入成功，文档ID: 67890...

🔍 验证导入结果...
   📊 集合中的文档数: 1
   ✅ 验证成功！
   📋 文件名: TS_example.xlsx
   📋 数据行数: 46
   📋 数据列数: 15
   📋 创建时间: 2025-10-23 15:45:00

============================================================
✅ TS Reference Data 导入完成
============================================================
```

---

## 🆚 与 SDTM Terminology 的区别

| 特性 | SDTM Terminology | TS Reference |
|------|-----------------|--------------|
| 存储方式 | 每个大类一条记录 | **整个文件一条记录** |
| 文档数量 | 889条 | **1条** |
| 数据结构 | codelist + items | **columns + data** |
| 用途 | 术语标准查询 | **参考模板数据** |

