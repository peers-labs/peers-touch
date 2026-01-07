# Station API 测试

每个 API 使用独立的测试文件管理。

## 📁 测试文件

| 文件 | 说明 | 测试内容 |
|------|------|---------|
| `health_test.sh` | 健康检查 | 服务可用性、响应时间、并发处理 |
| `provider_test.sh` | Provider API | 创建、查询、更新、删除、列表 |
| `oss_test.sh` | OSS API | 文件上传、下载、元数据查询 |
| `integration_test.sh` | 集成测试 | 运行所有测试 |

## 🚀 运行测试

### 运行单个 API 测试

```bash
# 健康检查
bash qa/station_api/health_test.sh

# Provider API
bash qa/station_api/provider_test.sh

# OSS API
bash qa/station_api/oss_test.sh
```

### 运行所有测试

```bash
# 集成测试（推荐）
bash qa/station_api/integration_test.sh

# 或使用 Makefile
make test-api
```

### 自定义 Base URL

```bash
# 指定不同的服务地址
BASE_URL=http://localhost:8080 bash qa/station_api/provider_test.sh
```

## 📊 测试输出

每个测试都会显示：
- ✅ 成功的测试用例（绿色）
- ❌ 失败的测试用例（红色）
- ⚠️  警告信息（黄色）

示例输出：
```
🧪 Provider API 测试
   Base URL: http://localhost:18080

1️⃣  创建 Provider
   ✅ 创建成功
   Provider ID: abc123

2️⃣  获取 Provider
   ✅ 获取成功
   Name: Test Provider

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
✅ Provider API 测试全部通过！
```

## 🔧 添加新的 API 测试

1. 创建新的测试文件：
```bash
cp qa/station_api/provider_test.sh qa/station_api/new_api_test.sh
```

2. 修改测试内容：
```bash
#!/bin/bash

BASE_URL="${BASE_URL:-http://localhost:18080}"
# ... 测试逻辑
```

3. 添加到集成测试：
```bash
# 编辑 integration_test.sh
run_test "New API" "$SCRIPT_DIR/new_api_test.sh"
```

4. 添加执行权限：
```bash
chmod +x qa/station_api/new_api_test.sh
```

## 📝 测试编写规范

### 1. 文件命名

- 使用 `<api_name>_test.sh` 格式
- 小写字母，下划线分隔
- 例如: `provider_test.sh`, `oss_test.sh`

### 2. 测试结构

```bash
#!/bin/bash

# API 说明
# 测试内容描述

BASE_URL="${BASE_URL:-http://localhost:18080}"
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

echo "🧪 [API名称] 测试"
echo ""

FAILED=0

# 测试用例 1
echo "1️⃣  [测试名称]"
# 测试逻辑
if [ 成功条件 ]; then
    echo -e "   ${GREEN}✅ 成功${NC}"
else
    echo -e "   ${RED}❌ 失败${NC}"
    ((FAILED++))
fi
echo ""

# 总结
if [ $FAILED -eq 0 ]; then
    echo -e "${GREEN}✅ 测试全部通过！${NC}"
    exit 0
else
    echo -e "${RED}❌ 测试失败: $FAILED 个用例${NC}"
    exit 1
fi
```

### 3. 最佳实践

- ✅ 每个测试独立运行
- ✅ 测试后清理数据
- ✅ 使用有意义的测试数据
- ✅ 验证响应格式和内容
- ✅ 处理错误情况
- ❌ 不要依赖其他测试的结果
- ❌ 不要使用真实的生产数据

## 🐛 故障排查

### 测试失败

1. **检查服务是否运行**
```bash
curl http://localhost:18080/health
```

2. **查看详细错误**
```bash
bash -x qa/station_api/provider_test.sh
```

3. **检查 Base URL**
```bash
echo $BASE_URL
```

### 常见问题

**Q: 提示 "jq: command not found"**
```bash
# macOS
brew install jq

# Ubuntu
sudo apt-get install jq
```

**Q: 无法连接到服务**
```bash
# 确保服务正在运行
cd station/app
go run main.go
```

**Q: OSS 测试失败**
- 检查是否需要认证
- 查看服务配置
- 确认存储路径可写

## 📈 CI/CD 集成

在 CI 中运行测试：

```yaml
# .github/workflows/api-test.yml
- name: Run API Tests
  run: |
    cd station/app
    go run main.go &
    sleep 5
    bash qa/station_api/integration_test.sh
```

## 🔗 相关文档

- [质量保证方案](../README.zh.md)
- [完整测试方案](../../TESTING.zh.md)
