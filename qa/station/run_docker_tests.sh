#!/bin/bash

# Docker 环境测试运行脚本
# 用途：在隔离的 Docker 环境中运行所有测试

set -e

# 颜色定义
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"

echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo -e "${BLUE}🐳 Peers-Touch Docker 测试环境${NC}"
echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo ""

# 检查 Docker
if ! command -v docker &> /dev/null; then
    echo -e "${RED}❌ 错误: 未安装 Docker${NC}"
    exit 1
fi

if ! command -v docker-compose &> /dev/null; then
    echo -e "${RED}❌ 错误: 未安装 docker-compose${NC}"
    exit 1
fi

# 清理函数
cleanup() {
    echo ""
    echo -e "${YELLOW}🧹 清理测试环境...${NC}"
    cd "$SCRIPT_DIR"
    docker-compose -f docker-compose.test.yml down -v
    echo -e "${GREEN}✅ 清理完成${NC}"
}

# 注册清理函数
trap cleanup EXIT

# 进入 qa/station 目录
cd "$SCRIPT_DIR"

# 1. 停止并清理旧容器
echo -e "${YELLOW}📦 停止旧容器...${NC}"
docker-compose -f docker-compose.test.yml down -v 2>/dev/null || true

# 2. 构建镜像
echo ""
echo -e "${YELLOW}🔨 构建测试镜像...${NC}"
docker-compose -f docker-compose.test.yml build

# 3. 启动服务
echo ""
echo -e "${YELLOW}🚀 启动测试服务...${NC}"
docker-compose -f docker-compose.test.yml up -d

# 4. 等待服务就绪
echo ""
echo -e "${YELLOW}⏳ 等待服务就绪...${NC}"

# 等待 PostgreSQL
echo -n "   等待 PostgreSQL..."
for i in {1..30}; do
    if docker-compose -f docker-compose.test.yml exec -T postgres-test pg_isready -U test_user -d peers_touch_test &>/dev/null; then
        echo -e " ${GREEN}✅${NC}"
        break
    fi
    if [ $i -eq 30 ]; then
        echo -e " ${RED}❌ 超时${NC}"
        exit 1
    fi
    sleep 1
done

# 等待 Redis
echo -n "   等待 Redis..."
for i in {1..30}; do
    if docker-compose -f docker-compose.test.yml exec -T redis-test redis-cli ping &>/dev/null; then
        echo -e " ${GREEN}✅${NC}"
        break
    fi
    if [ $i -eq 30 ]; then
        echo -e " ${RED}❌ 超时${NC}"
        exit 1
    fi
    sleep 1
done

# 等待 Station
echo -n "   等待 Station..."
for i in {1..60}; do
    if curl -sf http://localhost:18080/health &>/dev/null; then
        echo -e " ${GREEN}✅${NC}"
        break
    fi
    if [ $i -eq 60 ]; then
        echo -e " ${RED}❌ 超时${NC}"
        echo ""
        echo -e "${YELLOW}查看 Station 日志:${NC}"
        docker-compose -f docker-compose.test.yml logs station-test
        exit 1
    fi
    sleep 1
done

# 5. 显示服务状态
echo ""
echo -e "${BLUE}📊 服务状态:${NC}"
docker-compose -f docker-compose.test.yml ps

# 6. 运行 API 测试
echo ""
echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo -e "${BLUE}🧪 运行 API 测试${NC}"
echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo ""

# 设置测试环境变量
export BASE_URL="http://localhost:18080"

# 运行集成测试
if bash "$SCRIPT_DIR/station_api/integration_test.sh"; then
    echo ""
    echo -e "${GREEN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
    echo -e "${GREEN}✅ 所有测试通过！${NC}"
    echo -e "${GREEN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
    EXIT_CODE=0
else
    echo ""
    echo -e "${RED}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
    echo -e "${RED}❌ 测试失败${NC}"
    echo -e "${RED}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
    
    echo ""
    echo -e "${YELLOW}📋 查看日志:${NC}"
    echo -e "   docker-compose -f qa/station/docker-compose.test.yml logs station-test"
    
    EXIT_CODE=1
fi

# 7. 可选：查看日志
if [ "$1" == "--logs" ] || [ "$EXIT_CODE" -ne 0 ]; then
    echo ""
    echo -e "${YELLOW}📋 Station 日志:${NC}"
    docker-compose -f docker-compose.test.yml logs --tail=50 station-test
fi

# 8. 可选：保持容器运行
if [ "$1" == "--keep" ]; then
    echo ""
    echo -e "${YELLOW}⚠️  容器保持运行状态${NC}"
    echo -e "${YELLOW}   手动清理: cd qa/station && docker-compose -f docker-compose.test.yml down -v${NC}"
    trap - EXIT
fi

exit $EXIT_CODE
