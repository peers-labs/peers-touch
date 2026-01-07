#!/bin/bash

# 健康检查测试
# 测试服务是否正常运行

BASE_URL="${BASE_URL:-http://localhost:18080}"
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

echo "🧪 健康检查测试"
echo "   Base URL: $BASE_URL"
echo ""

FAILED=0

# 1. 基础连接测试
echo "1️⃣  基础连接测试"
if curl -s --max-time 5 "$BASE_URL" > /dev/null 2>&1; then
    echo -e "   ${GREEN}✅ 服务可访问${NC}"
else
    echo -e "   ${RED}❌ 无法连接到服务${NC}"
    echo "   请确保服务正在运行: cd station/app && go run main.go"
    exit 1
fi
echo ""

# 2. 健康检查端点
echo "2️⃣  健康检查端点"
HEALTH_RESP=$(curl -s -w "\n%{http_code}" -X GET "$BASE_URL/health")
HTTP_CODE=$(echo "$HEALTH_RESP" | tail -n 1)
BODY=$(echo "$HEALTH_RESP" | head -n -1)

if [ "$HTTP_CODE" == "200" ]; then
    echo -e "   ${GREEN}✅ 健康检查通过${NC}"
    echo "   HTTP Status: $HTTP_CODE"
    if [ -n "$BODY" ]; then
        echo "   Response: $BODY"
    fi
else
    echo -e "   ${RED}❌ 健康检查失败${NC}"
    echo "   HTTP Status: $HTTP_CODE"
    echo "   Response: $BODY"
    ((FAILED++))
fi
echo ""

# 3. API 版本信息
echo "3️⃣  API 版本信息"
VERSION_RESP=$(curl -s -X GET "$BASE_URL/version" 2>/dev/null)

if [ -n "$VERSION_RESP" ]; then
    echo -e "   ${GREEN}✅ 版本信息获取成功${NC}"
    echo "   $VERSION_RESP"
else
    echo -e "   ${YELLOW}⚠️  版本信息端点不存在（可选）${NC}"
fi
echo ""

# 4. 响应时间测试
echo "4️⃣  响应时间测试"
START_TIME=$(date +%s%N)
curl -s "$BASE_URL/health" > /dev/null
END_TIME=$(date +%s%N)
RESPONSE_TIME=$(( ($END_TIME - $START_TIME) / 1000000 ))

if [ $RESPONSE_TIME -lt 1000 ]; then
    echo -e "   ${GREEN}✅ 响应时间正常${NC}"
    echo "   Response Time: ${RESPONSE_TIME}ms"
else
    echo -e "   ${YELLOW}⚠️  响应时间较慢${NC}"
    echo "   Response Time: ${RESPONSE_TIME}ms"
fi
echo ""

# 5. 并发请求测试
echo "5️⃣  并发请求测试"
CONCURRENT_REQUESTS=10
SUCCESS_COUNT=0

for i in $(seq 1 $CONCURRENT_REQUESTS); do
    curl -s "$BASE_URL/health" > /dev/null &
done
wait

# 验证所有请求都成功
for i in $(seq 1 $CONCURRENT_REQUESTS); do
    if curl -s --max-time 2 "$BASE_URL/health" > /dev/null 2>&1; then
        ((SUCCESS_COUNT++))
    fi
done

if [ $SUCCESS_COUNT -eq $CONCURRENT_REQUESTS ]; then
    echo -e "   ${GREEN}✅ 并发请求测试通过${NC}"
    echo "   成功处理 $SUCCESS_COUNT/$CONCURRENT_REQUESTS 个请求"
else
    echo -e "   ${YELLOW}⚠️  部分并发请求失败${NC}"
    echo "   成功: $SUCCESS_COUNT/$CONCURRENT_REQUESTS"
fi
echo ""

# 总结
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
if [ $FAILED -eq 0 ]; then
    echo -e "${GREEN}✅ 健康检查测试全部通过！${NC}"
    exit 0
else
    echo -e "${RED}❌ 健康检查测试失败: $FAILED 个用例${NC}"
    exit 1
fi
