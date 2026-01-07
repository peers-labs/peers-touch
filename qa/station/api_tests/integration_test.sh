#!/bin/bash

# 集成测试
# 运行所有 API 测试

BASE_URL="${BASE_URL:-http://localhost:18080}"
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
BASE_URL="${BASE_URL:-http://localhost:18080}"

echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo -e "${BLUE}        Peers-Touch API 集成测试${NC}"
echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo ""
echo "Base URL: $BASE_URL"
echo "开始时间: $(date '+%Y-%m-%d %H:%M:%S')"
echo ""

# 检查依赖
if ! command -v jq &> /dev/null; then
    echo -e "${RED}错误: 需要安装 jq${NC}"
    echo "macOS: brew install jq"
    echo "Ubuntu: apt-get install jq"
    exit 1
fi

# 检查服务是否运行
if ! curl -s --max-time 2 "$BASE_URL" > /dev/null 2>&1; then
    echo -e "${RED}错误: 无法连接到 $BASE_URL${NC}"
    echo "请先启动服务: cd station/app && go run main.go"
    exit 1
fi

TOTAL_TESTS=0
PASSED_TESTS=0
FAILED_TESTS=0

# 运行测试函数
run_test() {
    local test_name=$1
    local test_script=$2
    
    ((TOTAL_TESTS++))
    echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
    echo -e "${BLUE}测试 $TOTAL_TESTS: $test_name${NC}"
    echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
    echo ""
    
    if bash "$test_script"; then
        ((PASSED_TESTS++))
        echo -e "${GREEN}✅ $test_name 通过${NC}"
    else
        ((FAILED_TESTS++))
        echo -e "${RED}❌ $test_name 失败${NC}"
    fi
    echo ""
}

# 1. 健康检查
run_test "健康检查" "$SCRIPT_DIR/health_test.sh"

# 2. Provider API
run_test "Provider API" "$SCRIPT_DIR/provider_test.sh"

# 3. OSS API
run_test "OSS API" "$SCRIPT_DIR/oss_test.sh"

# 总结报告
echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo -e "${BLUE}           测试总结报告${NC}"
echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo ""
echo "总测试数: $TOTAL_TESTS"
echo -e "${GREEN}通过: $PASSED_TESTS${NC}"
echo -e "${RED}失败: $FAILED_TESTS${NC}"
echo ""
echo "结束时间: $(date '+%Y-%m-%d %H:%M:%S')"
echo ""

if [ $FAILED_TESTS -eq 0 ]; then
    echo -e "${GREEN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
    echo -e "${GREEN}    ✅ 所有测试通过！系统运行正常${NC}"
    echo -e "${GREEN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
    exit 0
else
    echo -e "${RED}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
    echo -e "${RED}    ❌ 有 $FAILED_TESTS 个测试失败${NC}"
    echo -e "${RED}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
    exit 1
fi
