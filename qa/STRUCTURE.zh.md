# QA 目录结构说明

## 📂 整体结构

```
qa/
├── README.zh.md           # 整体质量保证方案（主文档）
├── STRUCTURE.zh.md        # 本文档（目录结构说明）
├── station/               # Station（后端）测试
└── client/                # Client（前端）测试
```

## 🎯 设计原则

### 1. 前后端分离

- **qa/station/**: 所有后端相关的测试
  - API 测试
  - Docker 测试环境
  - 测试数据

- **qa/client/**: 所有前端相关的测试
  - Widget 测试
  - 集成测试
  - UI 测试

### 2. 职责清晰

每个目录都有明确的职责：

| 目录 | 职责 | 测试类型 |
|------|------|---------|
| `qa/` | 整体质量保证方案 | 文档 |
| `qa/station/` | 后端测试 | API、单元、集成 |
| `qa/client/` | 前端测试 | Widget、集成、UI |

### 3. 独立运行

- Station 测试可以独立运行（Docker 环境）
- Client 测试可以独立运行（Flutter 测试）
- 互不干扰，互不依赖

## 📁 详细结构

### Station 测试

```
qa/station/
├── docker-compose.test.yml   # Docker 测试环境
├── run_docker_tests.sh       # 测试运行脚本
├── api_tests/                # API 测试
│   ├── health_test.sh
│   ├── provider_test.sh
│   ├── oss_test.sh
│   ├── integration_test.sh
│   └── README.md
└── test_data/                # 测试数据
    ├── init.sql              # 数据库初始化
    ├── providers.json
    └── test_files/
```

**特点**:
- ✅ Docker 隔离环境
- ✅ 预置测试数据
- ✅ 自动化 API 测试
- ✅ 完整的 CRUD 覆盖

### Client 测试

```
qa/client/
├── README.md                 # 客户端测试说明
├── desktop/                  # Desktop 测试
│   └── widget_tests/
└── mobile/                   # Mobile 测试
    └── widget_tests/
```

**特点**:
- ✅ Widget 测试
- ✅ 集成测试
- ⏳ 待完善

## 🚀 使用方式

### Station 测试

```bash
# 运行完整测试
make test

# 或
bash qa/station/run_docker_tests.sh
```

### Client 测试

```bash
# Desktop
cd client/desktop
flutter test

# Mobile
cd client/mobile
flutter test
```

## 📝 添加新测试

### 添加 Station API 测试

1. 在 `qa/station/test_data/init.sql` 添加测试数据
2. 在 `qa/station/api_tests/` 创建测试脚本
3. 在 `qa/station/api_tests/integration_test.sh` 中注册

### 添加 Client 测试

1. 在对应的 `client/*/test/` 目录创建测试文件
2. 运行 `flutter test` 验证

## 🔄 迁移说明

### 旧结构 → 新结构

| 旧路径 | 新路径 | 说明 |
|--------|--------|------|
| `qa/station_api/` | `qa/station/api_tests/` | API 测试脚本 |
| `qa/docker-compose.test.yml` | `qa/station/docker-compose.test.yml` | Docker 配置 |
| `qa/test_data/` | `qa/station/test_data/` | 测试数据 |
| `qa/run_docker_tests.sh` | `qa/station/run_docker_tests.sh` | 测试脚本 |

### 已更新的文件

- ✅ `Makefile` - 更新所有测试命令路径
- ✅ `qa/README.zh.md` - 更新所有路径引用
- ✅ `qa/station/run_docker_tests.sh` - 更新内部路径
- ✅ `qa/station/api_tests/integration_test.sh` - 更新路径

## 💡 最佳实践

1. **Station 测试优先使用 Docker 环境**
   - 数据隔离
   - 环境一致
   - 可重复

2. **Client 测试使用 Flutter 测试框架**
   - Widget 测试
   - 集成测试
   - 覆盖率报告

3. **保持测试独立**
   - 每个测试独立运行
   - 不依赖执行顺序
   - 自己清理数据

4. **定期维护**
   - 更新测试数据
   - 添加新测试
   - 清理无用测试

## 🎓 学习路径

1. 阅读 [qa/README.zh.md](README.zh.md) - 整体方案
2. 阅读 [qa/station/api_tests/README.md](station/api_tests/README.md) - API 测试
3. 阅读 [qa/client/README.md](client/README.md) - 客户端测试
4. 运行测试，熟悉流程
5. 添加自己的测试

---

*有问题请参考主文档 [qa/README.zh.md](README.zh.md)*
