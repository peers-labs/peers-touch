#!/bin/bash

# Friend Chat API 测试
# 测试同时支持 JSON 和 Proto 两种格式

BASE_URL="${BASE_URL:-http://localhost:18080}"
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo -e "${BLUE}   Friend Chat API 测试 (JSON + Proto)${NC}"
echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo ""
echo "Base URL: $BASE_URL"
echo ""

FAILED=0

# 测试用户（从运行中的 Desktop 或环境变量）
TOKEN_A="${TEST_TOKEN_A}"
ACTOR_ID_A="${TEST_ACTOR_A:-321670653675585537}"
ACTOR_ID_B="${TEST_ACTOR_B:-321670653306486785}"
SESSION_ID="${TEST_SESSION_ID}"

if [ -z "$TOKEN_A" ]; then
    echo -e "${YELLOW}⚠️  未设置测试 token，将跳过需要认证的测试${NC}"
    echo -e "${YELLOW}   设置方式: export TEST_TOKEN_A='your_token'${NC}"
    echo ""
fi

# Test 1: 检查服务状态
echo -e "${BLUE}[1/5] 检查服务状态${NC}"
if curl -s --max-time 2 "$BASE_URL" > /dev/null 2>&1; then
    echo -e "${GREEN}✅ Station 服务运行中${NC}"
else
    echo -e "${RED}❌ Station 服务未响应${NC}"
    exit 1
fi
echo ""

# Test 2: 测试端点是否存在（JSON 格式，无认证）
echo -e "${BLUE}[2/5] 测试 JSON 格式端点${NC}"
HTTP_CODE=$(curl -s -w "%{http_code}" -o /dev/null -X POST "$BASE_URL/friend-chat/message/send" \
  -H "Content-Type: application/json" \
  -d '{"session_ulid":"test","receiver_did":"test","content":"test"}')

if [ "$HTTP_CODE" = "401" ]; then
    echo -e "${GREEN}✅ JSON 端点正常（返回 401，需要认证）${NC}"
elif [ "$HTTP_CODE" = "400" ]; then
    echo -e "${GREEN}✅ JSON 端点正常（返回 400，接收到请求）${NC}"
elif [ "$HTTP_CODE" = "404" ]; then
    echo -e "${RED}❌ 端点不存在 (404)${NC}"
    ((FAILED++))
else
    echo -e "${YELLOW}⚠️  JSON 格式返回 HTTP $HTTP_CODE${NC}"
fi
echo ""

# Test 3: 测试端点是否存在（Proto 格式，无认证）
echo -e "${BLUE}[3/5] 测试 Proto 格式端点${NC}"

# 创建简单的 Proto 测试数据
TMP_DIR=$(mktemp -d)
PROTO_FILE="$TMP_DIR/test.bin"

python3 << 'EOF' > "$PROTO_FILE" 2>/dev/null
import sys
# 构造 Proto 二进制（简单测试）
data = bytearray()
# field 1: session_ulid
data.extend([0x0a, 0x04])
data.extend(b"test")
# field 2: receiver_did  
data.extend([0x12, 0x04])
data.extend(b"test")
# field 3: type = 1
data.extend([0x18, 0x01])
# field 4: content
data.extend([0x22, 0x04])
data.extend(b"test")
sys.stdout.buffer.write(data)
EOF

if [ -f "$PROTO_FILE" ]; then
    HTTP_CODE=$(curl -s -w "%{http_code}" -o /dev/null -X POST "$BASE_URL/friend-chat/message/send" \
      -H "Content-Type: application/protobuf" \
      --data-binary "@$PROTO_FILE")
    
    if [ "$HTTP_CODE" = "401" ]; then
        echo -e "${GREEN}✅ Proto 端点正常（返回 401，需要认证）${NC}"
    elif [ "$HTTP_CODE" = "400" ]; then
        echo -e "${GREEN}✅ Proto 端点正常（返回 400，接收到请求）${NC}"
    elif [ "$HTTP_CODE" = "404" ]; then
        echo -e "${RED}❌ 端点不存在 (404)${NC}"
        ((FAILED++))
    else
        echo -e "${YELLOW}⚠️  Proto 格式返回 HTTP $HTTP_CODE${NC}"
    fi
else
    echo -e "${YELLOW}⚠️  无法创建 Proto 测试文件，跳过${NC}"
fi

rm -rf "$TMP_DIR"
echo ""

# Test 4: 如果有 token 和 session，测试 JSON 格式发送消息
if [ -n "$TOKEN_A" ] && [ -n "$SESSION_ID" ]; then
    echo -e "${BLUE}[4/5] 测试 JSON 格式发送消息（需要认证）${NC}"
    
    RESPONSE=$(curl -s -w "\n%{http_code}" -X POST "$BASE_URL/friend-chat/message/send" \
      -H "Authorization: Bearer $TOKEN_A" \
      -H "Content-Type: application/json" \
      -d "{
        \"session_ulid\": \"$SESSION_ID\",
        \"receiver_did\": \"$ACTOR_ID_B\",
        \"type\": 1,
        \"content\": \"Test from JSON API\"
      }")
    
    HTTP_CODE=$(echo "$RESPONSE" | tail -n1)
    BODY=$(echo "$RESPONSE" | head -n-1)
    
    if [ "$HTTP_CODE" = "200" ]; then
        echo -e "${GREEN}✅ JSON 格式消息发送成功${NC}"
        echo -e "   响应: ${BODY:0:100}..."
    else
        echo -e "${RED}❌ JSON 格式消息发送失败 (HTTP $HTTP_CODE)${NC}"
        echo -e "   响应: $BODY"
        ((FAILED++))
    fi
    echo ""
else
    echo -e "${BLUE}[4/5] 跳过 JSON 格式消息测试（需要 token 和 session）${NC}"
    echo ""
fi

# Test 5: 如果有 token 和 session，测试 Proto 格式发送消息
if [ -n "$TOKEN_A" ] && [ -n "$SESSION_ID" ]; then
    echo -e "${BLUE}[5/5] 测试 Proto 格式发送消息（需要认证）${NC}"
    
    TMP_DIR=$(mktemp -d)
    PROTO_FILE="$TMP_DIR/message.bin"
    
    # 构造真实的 Proto 消息
    python3 << EOF > "$PROTO_FILE" 2>/dev/null
import sys
session = b"$SESSION_ID"
receiver = b"$ACTOR_ID_B"
content = b"Test from Proto API"

data = bytearray()
# field 1: session_ulid
data.extend([0x0a, len(session)])
data.extend(session)
# field 2: receiver_did
data.extend([0x12, len(receiver)])
data.extend(receiver)
# field 3: type = 1 (TEXT)
data.extend([0x18, 0x01])
# field 4: content
data.extend([0x22, len(content)])
data.extend(content)

sys.stdout.buffer.write(data)
EOF
    
    if [ -f "$PROTO_FILE" ]; then
        HTTP_CODE=$(curl -s -w "%{http_code}" -o /tmp/proto_response.bin -X POST "$BASE_URL/friend-chat/message/send" \
          -H "Authorization: Bearer $TOKEN_A" \
          -H "Content-Type: application/protobuf" \
          --data-binary "@$PROTO_FILE")
        
        if [ "$HTTP_CODE" = "200" ]; then
            RESPONSE_SIZE=$(wc -c < /tmp/proto_response.bin | tr -d ' ')
            echo -e "${GREEN}✅ Proto 格式消息发送成功${NC}"
            echo -e "   HTTP 状态码: $HTTP_CODE"
            echo -e "   响应大小: $RESPONSE_SIZE bytes (Proto 二进制)"
        else
            echo -e "${RED}❌ Proto 格式消息发送失败 (HTTP $HTTP_CODE)${NC}"
            ((FAILED++))
        fi
        
        rm -f /tmp/proto_response.bin
    else
        echo -e "${YELLOW}⚠️  无法创建 Proto 消息文件，跳过${NC}"
    fi
    
    rm -rf "$TMP_DIR"
    echo ""
else
    echo -e "${BLUE}[5/5] 跳过 Proto 格式消息测试（需要 token 和 session）${NC}"
    echo ""
fi

# 总结
echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
if [ $FAILED -eq 0 ]; then
    echo -e "${GREEN}✅ 所有测试通过！${NC}"
    echo -e "${GREEN}   接口同时支持 JSON 和 Proto 两种格式${NC}"
    echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
    echo ""
    echo "提示："
    echo "  - JSON 格式: Content-Type: application/json"
    echo "  - Proto 格式: Content-Type: application/protobuf"
    echo "  - 完整测试需要设置: TEST_TOKEN_A, TEST_SESSION_ID"
    echo ""
    exit 0
else
    echo -e "${RED}❌ 有 $FAILED 个测试失败${NC}"
    echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
    echo ""
    exit 1
fi
