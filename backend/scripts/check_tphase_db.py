import os
from pymongo import MongoClient
from dotenv import load_dotenv

# 加载环境变量
load_dotenv('../.env')

MONGO_URI = os.getenv('MONGO_URI')

client = MongoClient(MONGO_URI)
db = client['References']
collection = db['sdtm_terminology']

print("\n========== 1. 查找TPHASE相关的codelist ==========")
tphase_doc = collection.find_one({
    'File_Function': 'CDISC',
    'codelist.name': {'$regex': 'phase', '$options': 'i'}
})

if tphase_doc:
    print("✅ 找到Phase相关codelist:")
    print(f"  - codelist.code: {tphase_doc['codelist'].get('code')}")
    print(f"  - codelist.name: {tphase_doc['codelist'].get('name')}")
    print(f"  - codelist.codelist_code: {tphase_doc['codelist'].get('codelist_code')}")
    print(f"  - Items数量: {len(tphase_doc.get('items', []))}")
    
    if tphase_doc.get('items'):
        print("\n前5个items:")
        for item in tphase_doc['items'][:5]:
            print(f"    - {item.get('submission_value')} (code: {item.get('code')})")
else:
    print("❌ 未找到Phase相关codelist")

print("\n========== 2. 精确查找 'Trial Phase Classification' ==========")
exact_doc = collection.find_one({
    'File_Function': 'CDISC',
    'codelist.name': 'Trial Phase Classification'
})

if exact_doc:
    print("✅ 找到 'Trial Phase Classification'")
    print(f"  - codelist.code: {exact_doc['codelist'].get('code')}")
else:
    print("❌ 未找到 'Trial Phase Classification'")

print("\n========== 3. 查找所有包含Phase的codelist名称 ==========")
all_phase = list(collection.find({
    'File_Function': 'CDISC',
    'codelist.name': {'$regex': 'phase', '$options': 'i'}
}, {'codelist.name': 1, 'codelist.code': 1}))

print(f"找到 {len(all_phase)} 个包含'Phase'的codelist:")
for doc in all_phase:
    print(f"  - {doc['codelist']['name']} ({doc['codelist'].get('code')})")

print("\n========== 4. 查找codelist_code包含TPHASE的 ==========")
by_code = collection.find_one({
    'File_Function': 'CDISC',
    'codelist.codelist_code': {'$regex': 'TPHASE', '$options': 'i'}
})

if by_code:
    print("✅ 通过codelist_code找到:")
    print(f"  - codelist.name: {by_code['codelist'].get('name')}")
    print(f"  - codelist.code: {by_code['codelist'].get('code')}")
    print(f"  - codelist.codelist_code: {by_code['codelist'].get('codelist_code')}")
else:
    print("❌ 未找到codelist_code包含TPHASE的")

print("\n========== 5. 在Phase codelist中查找'Phase 3' ==========")
if tphase_doc:
    phase3_item = next((item for item in tphase_doc.get('items', []) 
                        if 'phase 3' in str(item.get('submission_value', '')).lower()), None)
    if phase3_item:
        print("✅ 找到Phase 3:")
        print(f"  - submission_value: {phase3_item.get('submission_value')}")
        print(f"  - code: {phase3_item.get('code')}")
        print(f"  - name: {phase3_item.get('name')}")
    else:
        print("❌ 未找到'Phase 3'相关的submission_value")
        print("所有submission_value:")
        for item in tphase_doc.get('items', [])[:10]:
            print(f"  - {item.get('submission_value')}")

client.close()
