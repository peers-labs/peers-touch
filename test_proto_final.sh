#!/bin/bash

BASE_URL="http://localhost:18080"

echo "========================================"
echo "   Proto 协议完整测试报告"
echo "========================================"
echo ""

# 使用已有用户登录 (假设数据库中有用户)
echo "=== 1. 尝试登录 ==="

# 尝试多个可能的用户
for email in "admin@peers.com" "test@test.com" "user@example.com"; do
  for pwd in "Admin@123" "Test@123" "Password@123"; do
    LOGIN=$(curl -s -X POST "$BASE_URL/activitypub/login" \
      -H 'Content-Type: application/json' \
      -d "{\"email\":\"$email\",\"password\":\"$pwd\"}")
    
    TOKEN=$(echo "$LOGIN" | grep -o '"token":"[^"]*"' | cut -d'"' -f4)
    
    if [ -n "$TOKEN" ]; then
      echo "✓ 登录成功: $email"
      break 2
    fi
  done
done

# 如果没有找到用户,创建一个新用户
if [ -z "$TOKEN" ]; then
  echo "未找到已有用户,创建新用户..."
  
  SIGNUP=$(curl -s -X POST "$BASE_URL/activitypub/sign-up" \
    -H 'Content-Type: application/json' \
    -d '{"username":"testapi","name":"Test API","password":"Test@12345","email":"testapi@example.com"}')
  
  echo "注册响应: $SIGNUP"
  
  LOGIN=$(curl -s -X POST "$BASE_URL/activitypub/login" \
    -H 'Content-Type: application/json' \
    -d '{"email":"testapi@example.com","password":"Test@12345"}')
  
  TOKEN=$(echo "$LOGIN" | grep -o '"token":"[^"]*"' | cut -d'"' -f4)
fi

if [ -z "$TOKEN" ]; then
  echo "✗ 无法获取Token,退出测试"
  exit 1
fi

echo "✓ Token: ${TOKEN:0:50}..."
echo ""

# 创建测试帖子
echo "=== 2. 创建测试帖子 ==="
CREATE_RESP=$(curl -s -w "\nHTTP_CODE:%{http_code}" -X POST "$BASE_URL/api/v1/social/posts" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -H "Accept: application/json" \
  -d '{"type":"TEXT","visibility":"PUBLIC","text":{"text":"这是Proto协议测试帖子"}}')

HTTP_CODE=$(echo "$CREATE_RESP" | grep "HTTP_CODE:" | cut -d: -f2)
BODY=$(echo "$CREATE_RESP" | sed '/HTTP_CODE:/d')

echo "HTTP: $HTTP_CODE"
if [ "$HTTP_CODE" = "200" ]; then
  POST_ID=$(echo "$BODY" | grep -o '"id":"[^"]*"' | head -1 | cut -d'"' -f4)
  echo "✓ 帖子创建成功, ID: $POST_ID"
  echo "Response: $(echo "$BODY" | head -c 150)..."
else
  echo "✗ 创建失败: $BODY"
  POST_ID=""
fi
echo ""

# 测试函数
test_endpoint() {
  local name=$1
  local method=$2
  local path=$3
  local data=$4
  
  echo "-----------------------------------"
  echo "测试: $name"
  echo "-----------------------------------"
  
  # JSON 请求
  if [ "$method" = "GET" ]; then
    JSON_RESP=$(curl -s -w "\nHTTP:%{http_code}\nCT:%{content_type}" \
      -X GET "$BASE_URL$path" \
      -H "Authorization: Bearer $TOKEN" \
      -H "Accept: application/json")
  else
    JSON_RESP=$(curl -s -w "\nHTTP:%{http_code}\nCT:%{content_type}" \
      -X $method "$BASE_URL$path" \
      -H "Authorization: Bearer $TOKEN" \
      -H "Content-Type: application/json" \
      -H "Accept: application/json" \
      -d "$data")
  fi
  
  JSON_HTTP=$(echo "$JSON_RESP" | grep "HTTP:" | cut -d: -f2)
  JSON_CT=$(echo "$JSON_RESP" | grep "CT:" | cut -d: -f2-)
  JSON_BODY=$(echo "$JSON_RESP" | sed '/HTTP:/d' | sed '/CT:/d')
  JSON_LEN=$(echo -n "$JSON_BODY" | wc -c | tr -d ' ')
  
  echo "[JSON]"
  echo "  HTTP: $JSON_HTTP"
  echo "  Content-Type: $JSON_CT"
  echo "  Body Length: $JSON_LEN bytes"
  echo "  Preview: $(echo "$JSON_BODY" | head -c 100)..."
  
  # Proto 请求
  if [ "$method" = "GET" ]; then
    PROTO_RESP=$(curl -s -w "\nHTTP:%{http_code}\nCT:%{content_type}" \
      -X GET "$BASE_URL$path" \
      -H "Authorization: Bearer $TOKEN" \
      -H "Accept: application/protobuf")
  else
    PROTO_RESP=$(curl -s -w "\nHTTP:%{http_code}\nCT:%{content_type}" \
      -X $method "$BASE_URL$path" \
      -H "Authorization: Bearer $TOKEN" \
      -H "Content-Type: application/json" \
      -H "Accept: application/protobuf" \
      -d "$data")
  fi
  
  PROTO_HTTP=$(echo "$PROTO_RESP" | grep "HTTP:" | cut -d: -f2)
  PROTO_CT=$(echo "$PROTO_RESP" | grep "CT:" | cut -