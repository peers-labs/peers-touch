# 测试数据说明

## 目录结构

```
test_data/
├── README.md           # 本文档
├── init.sql            # 数据库初始化脚本
├── providers.json      # Provider 测试数据
├── test_files/         # 测试文件目录
│   ├── sample.txt
│   ├── sample.json
│   └── sample.png
└── fixtures/           # 固定测试数据
    └── ...
```

## 预置测试数据

### Providers

数据库中预置了 3 个测试 Provider：

| ID | Name | Source Type | Active |
|----|------|-------------|--------|
| `11111111-1111-1111-1111-111111111111` | Test Provider 1 | openai | ✅ |
| `22222222-2222-2222-2222-222222222222` | Test Provider 2 | anthropic | ✅ |
| `33333333-3333-3333-3333-333333333333` | Inactive Provider | custom | ❌ |

### OSS Files

预置了 2 个测试文件记录：

| ID | File Key | File Name | Content Type |
|----|----------|-----------|--------------|
| `aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa` | test/file1.txt | file1.txt | text/plain |
| `bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb` | test/image.png | image.png | image/png |

## 使用方法

### 1. 在测试中使用预置数据

```bash
# 使用预置的 Provider ID
PROVIDER_ID="11111111-1111-1111-1111-111111111111"

# 测试获取 Provider
curl -s "http://localhost:18080/aibox/provider?id=$PROVIDER_ID"
```

### 2. 添加新的测试数据

编辑 `init.sql`，添加 INSERT 语句：

```sql
INSERT INTO your_table (id, name, ...) VALUES
    ('your-uuid', 'Your Name', ...);
```

### 3. 使用测试文件

```bash
# 上传测试文件
curl -X POST http://localhost:18080/oss/upload \
  -F "file=@test_data/test_files/sample.txt"
```

## 数据隔离原则

1. **每个测试独立创建数据**
   - 不依赖预置数据（除非是只读查询）
   - 测试结束后清理自己创建的数据

2. **使用事务**
   - 测试开始时开启事务
   - 测试结束时回滚事务

3. **使用唯一标识**
   - 测试数据使用特殊前缀（如 `test_`）
   - 便于识别和清理

## 数据库重置

如果需要重置测试数据库：

```bash
# 停止并删除容器和数据卷
cd qa
docker-compose -f docker-compose.test.yml down -v

# 重新启动（会重新初始化数据库）
docker-compose -f docker-compose.test.yml up -d
```

## 注意事项

1. **不要在测试中使用生产数据**
2. **不要提交敏感信息**（API keys, passwords 等）
3. **保持测试数据最小化**
4. **定期清理无用的测试数据**
