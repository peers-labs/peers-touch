#!/bin/bash

# Provider API 测试
# 测试 AI Box Provider 的 CRUD 操作

BASE_URL="${BASE_URL:-http://localhost:18080}"
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

echo "🧪 Provider API 测试"
echo "   Base URL: $BASE_URL"
echo ""

FAILED=0

# 1. 创建 Provider
echo "1️⃣  创建 Provider"
CREATE_RESP=$(curl -s -X POST "$BASE_URL/aibox/provider" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Test Provider",
    "description": "自动化测试创建的 Provider",
    "logo": "https://example.com/logo.png",
    "source_type": "openai"
  }')

PROVIDER_ID=$(echo $CREATE_RESP | jq -r '.id // empty')
if [ -z "$PROVIDER_ID" ]; then
    echo -e "   ${RED}❌ 创建失败${NC}"
    echo "   Response: $CREATE_RESP"
    ((FAILED++))
else
    echo -e "   ${GREEN}✅ 创建成功${NC}"
    echo "   Provider ID: $PROVIDER_ID"
fi
echo ""

# 2. 获取 Provider
echo "2️⃣  获取 Provider"
GET_RESP=$(curl -s -X GET "$BASE_URL/aibox/provider?id=$PROVIDER_ID")

NAME=$(echo $GET_RESP | jq -r '.name // empty')
if [ "$NAME" == "Test Provider" ]; then
    echo -e "   ${GREEN}✅ 获取成功${NC}"
    echo "   Name: $NAME"
else
    echo -e "   ${RED}❌ 获取失败${NC}"
    echo "   Expected: Test Provider"
    echo "   Got: $NAME"
    ((FAILED++))
fi
echo ""

# 3. 更新 Provider
echo "3️⃣  更新 Provider"
UPDATE_RESP=$(curl -s -X PUT "$BASE_URL/aibox/provider" \
  -H "Content-Type: application/json" \
  -d "{
    \"id\": \"$PROVIDER_ID\",
    \"name\": \"Updated Provider\",
    \"description\": \"更新后的描述\"
  }")

UPDATED_NAME=$(echo $UPDATE_RESP | jq -r '.name // empty')
if [ "$UPDATED_NAME" == "Updated Provider" ]; then
    echo -e "   ${GREEN}✅ 更新成功${NC}"
    echo "   New Name: $UPDATED_NAME"
else
    echo -e "   ${RED}❌ 更新失败${NC}"
    echo "   Expected: Updated Provider"
    echo "   Got: $UPDATED_NAME"
    ((FAILED++))
fi
echo ""

# 4. 列表查询
echo "4️⃣  列表查询"
LIST_RESP=$(curl -s -X GET "$BASE_URL/aibox/providers?page_number=1&page_size=10")

if echo $LIST_RESP | jq -e '.items | length' > /dev/null 2>&1; then
    COUNT=$(echo $LIST_RESP | jq '.items | length')
    echo -e "   ${GREEN}✅ 列表查询成功${NC}"
    echo "   找到 $COUNT 个 Providers"
else
    echo -e "   ${RED}❌ 列表查询失败${NC}"
    echo "   Response: $LIST_RESP"
    ((FAILED++))
fi
echo ""

# 5. 测试 Provider 连接（可选）
echo "5️⃣  测试 Provider 连接"
TEST_RESP=$(curl -s -X POST "$BASE_URL/aibox/provider/test" \
  -H "Content-Type: application/json" \
  -d "{\"id\": \"$PROVIDER_ID\"}")

TEST_OK=$(echo $TEST_RESP | jq -r '.ok // false')
if [ "$TEST_OK" == "true" ] || [ "$TEST_OK" == "false" ]; then
    echo -e "   ${GREEN}✅ 测试接口正常${NC}"
    echo "   Result: $TEST_OK"
else
    echo -e "   ${YELLOW}⚠️  测试接口响应异常${NC}"
    echo "   Response: $TEST_RESP"
fi
echo ""

# 6. 删除 Provider
echo "6️⃣  删除 Provider"
DELETE_RESP=$(curl -s -X DELETE "$BASE_URL/aibox/provider" \
  -H "Content-Type: application/json" \
  -d "{\"id\": \"$PROVIDER_ID\"}")

DELETED=$(echo $DELETE_RESP | jq -r '.deleted // false')
if [ "$DELETED" == "true" ]; then
    echo -e "   ${GREEN}✅ 删除成功${NC}"
else
    echo -e "   ${RED}❌ 删除失败${NC}"
    echo "   Response: $DELETE_RESP"
    ((FAILED++))
fi
echo ""

# 7. 验证已删除
echo "7️⃣  验证已删除"
VERIFY_RESP=$(curl -s -X GET "$BASE_URL/aibox/provider?id=$PROVIDER_ID")

if echo $VERIFY_RESP | grep -q "not found\|error"; then
    echo -e "   ${GREEN}✅ 验证成功（Provider 已删除）${NC}"
else
    echo -e "   ${RED}❌ 验证失败（Provider 仍然存在）${NC}"
    ((FAILED++))
fi
echo ""

# 总结
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
if [ $FAILED -eq 0 ]; then
    echo -e "${GREEN}✅ Provider API 测试全部通过！${NC}"
    exit 0
else
    echo -e "${RED}❌ Provider API 测试失败: $FAILED 个用例${NC}"
    exit 1
fi
