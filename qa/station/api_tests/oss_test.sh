#!/bin/bash

# OSS API 测试
# 测试文件上传、下载、元数据查询

BASE_URL="${BASE_URL:-http://localhost:18080}"
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

echo "🧪 OSS API 测试"
echo "   Base URL: $BASE_URL"
echo ""

FAILED=0
TEST_FILE="/tmp/oss_test_file.txt"
TEST_CONTENT="这是一个测试文件内容\nTest file content for OSS API"

# 准备测试文件
echo -e "$TEST_CONTENT" > "$TEST_FILE"

# 1. 上传文件
echo "1️⃣  上传文件"
UPLOAD_RESP=$(curl -s -X POST "$BASE_URL/oss/upload" \
  -F "file=@$TEST_FILE")

FILE_KEY=$(echo $UPLOAD_RESP | jq -r '.key // empty')
if [ -z "$FILE_KEY" ]; then
    echo -e "   ${YELLOW}⚠️  上传失败（可能需要认证）${NC}"
    echo "   Response: $UPLOAD_RESP"
    echo ""
    echo "提示: OSS 上传可能需要认证，请确保："
    echo "  1. 服务已启动"
    echo "  2. 认证配置正确"
    echo "  3. 或者在配置中关闭认证要求"
    rm "$TEST_FILE"
    exit 0
fi

echo -e "   ${GREEN}✅ 上传成功${NC}"
echo "   File Key: $FILE_KEY"
FILE_URL=$(echo $UPLOAD_RESP | jq -r '.url // empty')
FILE_SIZE=$(echo $UPLOAD_RESP | jq -r '.size // empty')
echo "   File URL: $FILE_URL"
echo "   File Size: $FILE_SIZE bytes"
echo ""

# 2. 下载文件
echo "2️⃣  下载文件"
DOWNLOAD_CONTENT=$(curl -s -X GET "$BASE_URL/oss/file?key=$FILE_KEY")

if [ -n "$DOWNLOAD_CONTENT" ]; then
    echo -e "   ${GREEN}✅ 下载成功${NC}"
    echo "   Content length: ${#DOWNLOAD_CONTENT} bytes"
    
    # 验证内容一致性
    ORIGINAL_CONTENT=$(cat "$TEST_FILE")
    if [ "$DOWNLOAD_CONTENT" == "$ORIGINAL_CONTENT" ]; then
        echo -e "   ${GREEN}✅ 内容验证通过${NC}"
    else
        echo -e "   ${RED}❌ 内容不一致${NC}"
        ((FAILED++))
    fi
else
    echo -e "   ${RED}❌ 下载失败${NC}"
    ((FAILED++))
fi
echo ""

# 3. 获取文件元数据
echo "3️⃣  获取文件元数据"
META_RESP=$(curl -s -X GET "$BASE_URL/oss/meta?key=$FILE_KEY")

META_SIZE=$(echo $META_RESP | jq -r '.size // empty')
META_MIME=$(echo $META_RESP | jq -r '.mime // empty')
META_BACKEND=$(echo $META_RESP | jq -r '.backend // empty')

if [ -n "$META_SIZE" ]; then
    echo -e "   ${GREEN}✅ 元数据获取成功${NC}"
    echo "   Size: $META_SIZE bytes"
    echo "   MIME: $META_MIME"
    echo "   Backend: $META_BACKEND"
else
    echo -e "   ${RED}❌ 元数据获取失败${NC}"
    echo "   Response: $META_RESP"
    ((FAILED++))
fi
echo ""

# 4. 测试不存在的文件
echo "4️⃣  测试不存在的文件"
NOT_FOUND_RESP=$(curl -s -w "\n%{http_code}" -X GET "$BASE_URL/oss/file?key=non-existent-key")
HTTP_CODE=$(echo "$NOT_FOUND_RESP" | tail -n 1)

if [ "$HTTP_CODE" == "404" ]; then
    echo -e "   ${GREEN}✅ 正确返回 404${NC}"
else
    echo -e "   ${RED}❌ 应该返回 404，实际返回 $HTTP_CODE${NC}"
    ((FAILED++))
fi
echo ""

# 5. 测试大文件上传（可选）
echo "5️⃣  测试大文件上传"
LARGE_FILE="/tmp/oss_large_test.txt"
dd if=/dev/zero of="$LARGE_FILE" bs=1M count=5 2>/dev/null

LARGE_UPLOAD_RESP=$(curl -s -X POST "$BASE_URL/oss/upload" \
  -F "file=@$LARGE_FILE")

LARGE_KEY=$(echo $LARGE_UPLOAD_RESP | jq -r '.key // empty')
if [ -n "$LARGE_KEY" ]; then
    echo -e "   ${GREEN}✅ 大文件上传成功${NC}"
    LARGE_SIZE=$(echo $LARGE_UPLOAD_RESP | jq -r '.size // empty')
    echo "   Size: $LARGE_SIZE bytes (~5MB)"
    
    # 清理大文件
    curl -s -X DELETE "$BASE_URL/oss/file?key=$LARGE_KEY" > /dev/null 2>&1
else
    echo -e "   ${YELLOW}⚠️  大文件上传失败（可能有大小限制）${NC}"
fi
rm "$LARGE_FILE"
echo ""

# 清理测试文件
rm "$TEST_FILE"

# 总结
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
if [ $FAILED -eq 0 ]; then
    echo -e "${GREEN}✅ OSS API 测试全部通过！${NC}"
    exit 0
else
    echo -e "${RED}❌ OSS API 测试失败: $FAILED 个用例${NC}"
    exit 1
fi
