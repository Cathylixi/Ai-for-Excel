# CDISC SDTM Terminology 导入脚本使用说明

## 📋 功能说明

该脚本用于将 CDISC SDTM Terminology Excel 文件（4万+行）解析并导入到 MongoDB 数据库。

### 核心功能
- ✅ 自动识别大类（蓝色标题行，`Codelist Extensible = "No"`）
- ✅ 解析子项（白色行）并关联到对应大类
- ✅ 批量导入MongoDB（每100条一批）
- ✅ 分块读取Excel避免内存溢出
- ✅ 自动创建索引优化查询性能

---

## 🚀 快速开始

### 1. 安装依赖

```bash
cd /Users/wgl/Desktop/LLX\ Solutions\ 0722/LLXExcel/backend/scripts

# 安装Python依赖
pip3 install -r requirements_sdtm.txt

# 或者单独安装
pip3 install pandas==2.0.3 pymongo==4.5.0 xlrd==2.0.1 openpyxl==3.1.2
```

### 2. 配置MongoDB连接

编辑 `import_sdtm_terminology.py` 中的配置：

```python
# MongoDB连接配置
MONGO_URI = 'mongodb://localhost:27017/'  # 根据实际情况修改
DB_NAME = 'References'
COLLECTION_NAME = 'sdtm_terminology'
```

### 3. 运行脚本

```bash
python3 import_sdtm_terminology.py
```

---

## 📊 MongoDB 文档结构

### 示例文档

```json
{
  "_id": ObjectId("..."),
  "File_Name": "CDISC SDTM Terminology_20250328.xls",
  "File_Function": "CDISC",
  "version": "2025-03-28",
  "codelist": {
    "code": "C141657",
    "name": "10-Meter Walk/Run Functional Test",
    "extensible": false,
    "definition": "10-Meter Walk/Run test code.",
    "nci_preferred_term": "CDISC Functional Test 10-Meter Walk/Run Test Code Terminology",
    "codelist_code": null
  },
  "items": [
    {
      "code": "C141706",
      "codelist_code": "C141657",
      "name": "10-Meter Walk/Run Functional Test Test Code",
      "submission_value": "TENMW1TC",
      "synonyms": ["10-Meter Walk/Run Functional Test Test Code"],
      "definition": "10-Meter Walk/Run test code.",
      "nci_preferred_term": "10-Meter Walk/Run - Was the 10-meter walk/run performed?"
    },
    {
      "code": "C147592",
      "codelist_code": "C141657",
      "name": "10-Meter Walk/Run Functional Test Name",
      "submission_value": "TENMW1N",
      "synonyms": ["10-Meter Walk/Run Functional Test Name"],
      "definition": "10-Meter Walk/Run - Test name.",
      "nci_preferred_term": "10-Meter Walk/Run - Test Name Terminology"
    }
  ],
  "last_updated": "2025-03-28"
}
```

---

## 🔍 查询示例

### 1. 按大类名称查询

```javascript
db.sdtm_terminology.find({ "codelist.name": "10-Meter Walk/Run Functional Test" })
```

### 2. 按子项Submission Value查询

```javascript
db.sdtm_terminology.find({ "items.submission_value": "TENMW1TC" })
```

### 3. 按Code查询大类

```javascript
db.sdtm_terminology.find({ "codelist.code": "C141657" })
```

### 4. 查询某个大类的所有子项

```javascript
db.sdtm_terminology.findOne(
  { "codelist.code": "C141657" },
  { items: 1, "codelist.name": 1 }
)
```

### 5. 统计总数

```javascript
// 统计大类总数
db.sdtm_terminology.countDocuments({})

// 统计子项总数
db.sdtm_terminology.aggregate([
  { $project: { itemCount: { $size: "$items" } } },
  { $group: { _id: null, total: { $sum: "$itemCount" } } }
])
```

### 6. 模糊搜索

```javascript
// 搜索包含特定关键词的大类
db.sdtm_terminology.find({ 
  "codelist.name": { $regex: "Walk", $options: "i" } 
})

// 搜索子项定义
db.sdtm_terminology.find({ 
  "items.definition": { $regex: "performed", $options: "i" } 
})
```

---

## 🛠️ 性能优化特性

### 1. 分块读取Excel
- 使用 pandas 一次性读取（4万行可接受）
- 避免多次I/O操作

### 2. 批量写入MongoDB
- 每100条文档批量写入
- 减少网络往返次数

### 3. 索引优化
脚本自动创建以下索引：
```javascript
db.sdtm_terminology.createIndex({ "codelist.code": 1 })
db.sdtm_terminology.createIndex({ "codelist.name": 1 })
db.sdtm_terminology.createIndex({ "items.code": 1 })
db.sdtm_terminology.createIndex({ "items.submission_value": 1 })
```

### 4. 内存优化
- 仅读取A-H列（8列）
- 使用字符串类型避免类型转换
- 批量写入后清空缓存

---

## ⚠️ 注意事项

### 1. Excel格式
- 支持 `.xls` 格式（使用 xlrd）
- 如果是 `.xlsx` 格式，脚本会自动切换到 openpyxl

### 2. MongoDB连接
- 确保MongoDB服务正在运行
- 检查连接字符串是否正确
- 如果使用MongoDB Atlas，需要修改 `MONGO_URI`

### 3. 数据清空
- 脚本会**清空**现有 `sdtm_terminology` 集合
- 如需保留旧数据，请注释掉 `collection.delete_many({})`

### 4. 文件路径
- 确保Excel文件路径正确
- 相对路径改为绝对路径避免问题

---

## 🐛 故障排查

### 问题1：xlrd.biffh.XLRDError: Excel xlsx file; not supported
**解决方案**：文件格式为 `.xlsx`，修改代码中的 `engine='xlrd'` 为 `engine='openpyxl'`

### 问题2：pymongo.errors.ServerSelectionTimeoutError
**解决方案**：
- 检查MongoDB是否运行：`mongod --version`
- 检查连接字符串
- 检查防火墙设置

### 问题3：ImportError: Missing optional dependency 'xlrd'
**解决方案**：
```bash
pip3 install xlrd==2.0.1
```

### 问题4：内存不足
**解决方案**：
- 减小 `BATCH_SIZE`（如改为50）
- 使用 `chunksize` 参数分块读取

---

## 📈 预期输出

```
============================================================
🚀 开始导入 CDISC SDTM Terminology
============================================================
📄 Excel文件: /Users/.../CDISC SDTM Terminology_20250328.xls
📅 版本日期: 2025-03-28
🔌 连接MongoDB: mongodb://localhost:27017/
✅ MongoDB连接成功
🗑️  清空集合: References.sdtm_terminology

📖 开始读取Excel文件...
✅ 读取成功，总行数: 42567

🔍 开始解析文档结构...
  💾 批量写入 100 条文档（总计: 100 个大类，2345 个子项）
  💾 批量写入 100 条文档（总计: 200 个大类，4821 个子项）
  ...
  💾 批量写入 52 条文档（总计: 852 个大类，41234 个子项）

🔧 创建索引...
✅ 索引创建完成

🔍 验证导入结果...
✅ 导入完成！
   📊 总计大类: 852
   📊 总计子项: 41234

============================================================
✅ SDTM Terminology 导入完成
============================================================

📝 示例查询:
  db.sdtm_terminology.find({ "codelist.name": "10-Meter Walk/Run Functional Test" })
  db.sdtm_terminology.find({ "items.submission_value": "TENMW1TC" })
  db.sdtm_terminology.countDocuments({})
```

---

## 📞 联系支持

如有问题，请检查：
1. Python版本（建议3.8+）
2. 依赖包版本
3. MongoDB版本（建议4.4+）
4. Excel文件完整性

