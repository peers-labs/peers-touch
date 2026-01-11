#!/bin/bash

# 测试 Proto 协议的脚本
# 使用 protoc 来编码/解码 Proto 消息

# 颜色定义
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

echo "================================"
echo "Proto 协议测试报告"
echo "================================"
echo ""

# Token (需要替换为实际的 token)
TOKEN="eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJleHAiOjE3Mzk2MzM5MTgsImlhdCI6MTczNjk1NTUxOCwiaWQiOiIxIiwibmFtZSI6ImFkbWluIiwic3ViIjoiMSJ9.Qc8Oi-LKxJqJGCXDKvJQJcZCNECPwZAP6YVPPMNdxr4"
BASE_URL="http://localhost:8080"

# 测试函数
test_api() {
    local name=$1
    local method=$2
    local path=$3
    local accept=$4
    local data=$5
    
    echo "-----------------------------------"
    echo "测试: $name"
    echo "方法: $method $path"
    echo "Accept: $accept"
    
    if [ "$method" = "GET" ]; then
        response=$(curl -s -w "\nHTTP_CODE:%{http_code}" \
            -X GET "$BASE_URL$path" \
            -H "Authorization: Bearer $TOKEN" \
            -H "Accept: $accept")
    else
        response=$(curl -s -w "\nHTTP_CODE:%{http_code}" \
            -X $method "$BASE_URL$path" \
            -H "Authorization: Bearer $TOKEN" \
            -H "Accept: $accept" \
            -H "Content-Type: application/json" \
            -d "$data")
    fi
    
    http_code=$(echo "$response" | grep "HTTP_CODE:" | cut -d: -f2)
    body=$(echo "$response" | sed '/HTTP_CODE:/d')
    content_type=$(curl -s -I -X $method "$BASE_URL$path" \
        -H "Authorization: Bearer $TOKEN" \
        -H "Accept: $accept" | grep -i "content-type:" | cut -d: -f2- | tr -d '\r')
    
    echo "HTTP Status: $http_code"
    echo "Content-Type:$content_type"
    
    if [ "$http_code" = "200" ] || [ "$http_code" = "201" ]; then
        echo -e "${GREEN}✓ 成功${NC}"
        if [[ "$content_type" == *"application/protobuf"* ]]; then
            echo -e "${GREEN}✓ 返回 Proto 二进制${NC}"
            echo "响应长度: $(echo -n "$body" | wc -c) bytes"
        elif [[ "$content_type" == *"application/json"* ]]; then
            echo -e "${YELLOW}✓ 返回 JSON${NC}"
            echo "响应预览: $(echo "$body" | head -c 200)..."
        fi
    else
        echo -e "${RED}✗ 失败${NC}"
        echo "响应: $body"
    fi
    echo ""
}

# 测试所有 Social API 接口
echo "## Social API 接口测试"
echo ""

# 1. Create Post (JSON)
test_api "1. Create Post (JSON)" \
    "POST" \
    "/api/v1/social/posts" \
    "application/json" \
    '{"type":"TEXT","visibility":"PUBLIC","text":{"text":"Test post from Proto API"}}'

# 2. Get Timeline (JSON)
test_api "2. Get Timeline (JSON)" \
    "GET" \
    "/api/v1/social/timeline?limit=5" \
    "application/json"

# 3. Get Timeline (Proto)
test_api "3. Get Timeline (Proto)" \
    "GET" \
    "/api/v1/social/timeline?limit=5" \
    "application/protobuf"

# 4. Get Post (JSON)
test_api "4. Get Post by ID (JSON)" \
    "GET" \
    "/api/v1/social/posts/1" \
    "application/json"

# 5. Get Post (Proto)
test_api "5. Get Post by ID (Proto)" \
    "GET" \
    "/api/v1/social/posts/1" \
    "application/protobuf"

# 6. Like Post (JSON)
test_api "6. Like Post (JSON)" \
    "POST" \
    "/api/v1/social/posts/1/like" \
    "application/json"

# 7. Unlike Post (JSON)
test_api "7. Unlike Post (JSON)" \
    "POST" \
    "/api/v1/social/posts/1/unlike" \
    "application/json"

# 8. Get User Posts (JSON)
test_api "8. Get User Posts (JSON)" \
    "GET" \
    "/api/v1/social/users/1/posts?limit=5" \
    "application/json"

# 9. Get User Posts (Proto)
test_api "9. Get User Posts (Proto)" \
    "GET" \
    "/api/v1/social/users/1/posts?limit=5" \
    "application/protobuf"

echo "================================"
echo "测试完成"
echo "================================"
