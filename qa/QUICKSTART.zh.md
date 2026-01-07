# QA 快速入门

> 5 分钟快速了解 Peers-Touch 的质量保证体系

## 🎯 核心目标

1. **单元测试** - 保证代码稳定
2. **API 测试** - 保证接口稳定
3. **Widget 测试** - 保证 UI 稳定

## 📂 目录结构

```
qa/
├── station/    # 后端测试（Docker + API）
└── client/     # 前端测试（Flutter）
```

## 🚀 快速开始

### Station 测试（推荐 Docker 环境）

```bash
# 一键运行所有后端测试
make test

# 查看详细日志
make test-docker-logs

# 清理测试环境
make clean-test
```

**测试内容**:
- ✅ 健康检查
- ✅ Provider CRUD
- ✅ OSS 文件操作
- ✅ 所有 API 端点

**环境隔离**:
- PostgreSQL (端口 5433)
- Redis (端口 6380)
- Station (端口 18080)

### Client 测试

```bash
# Desktop
cd client/desktop
flutter test

# Mobile
cd client/mobile
flutter test
```

## 📝 测试原则

### ✅ DO

1. **每次改动都运行测试**
2. **测试失败立即修复**
3. **新功能必须有测试**

### ❌ DON'T

1. **不要跳过失败的测试**
2. **不要修改测试让它通过**（应该修复代码）
3. **不要让测试相互依赖**

## 🔍 测试覆盖

| 模块 | 类型 | 位置 | 状态 |
|------|------|------|------|
| Station API | API 测试 | `qa/station/api_tests/` | ✅ 完成 |
| Station Service | 单元测试 | `station/app/subserver/*/service/*_test.go` | ⏳ 进行中 |
| Client Widget | Widget 测试 | `client/*/test/` | ⏳ 待完善 |

## 📖 深入学习

1. [完整方案](README.zh.md) - 详细的质量保证方案
2. [目录结构](STRUCTURE.zh.md) - 目录组织说明
3. [Station API 测试](station/api_tests/README.md) - API 测试详情
4. [Client 测试](client/README.md) - 客户端测试详情

## 💡 常见问题

### Q: 为什么推荐 Docker 环境？

A: 
- ✅ 完全隔离，不影响开发环境
- ✅ 预置测试数据，可重复执行
- ✅ 自动管理依赖（数据库、Redis）

### Q: 测试失败怎么办？

A:
1. 查看测试输出的错误信息
2. 检查是否是代码问题
3. **不要修改测试**，修复代码
4. 重新运行测试验证

### Q: 如何添加新的测试？

A:

**Station API 测试**:
1. 在 `qa/station/test_data/init.sql` 添加测试数据
2. 在 `qa/station/api_tests/` 创建测试脚本
3. 在 `integration_test.sh` 中注册

**Client 测试**:
1. 在 `client/*/test/` 创建测试文件
2. 运行 `flutter test` 验证

### Q: 测试覆盖率目标是多少？

A: 80%+

- Service 层: 80%+
- Handler 层: 70%+
- 核心业务: 90%+

## 🎓 下一步

- [ ] 运行一次完整测试 `make test`
- [ ] 阅读完整方案 [README.zh.md](README.zh.md)
- [ ] 为你的模块添加测试
- [ ] 设置 Git pre-commit hook

---

*开始测试之旅吧！🚀