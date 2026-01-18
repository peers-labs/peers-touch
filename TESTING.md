# Testing Guide - Social Follow API

本文档说明如何运行和维护 Social Follow API 的测试套件。

## 📋 目录

- [测试概述](#测试概述)
- [后端测试](#后端测试)
- [前端测试](#前端测试)
- [测试覆盖](#测试覆盖)
- [持续集成](#持续集成)
- [最佳实践](#最佳实践)

## 测试概述

### 测试金字塔

```
        ┌─────────────┐
        │   E2E Tests │  (手动/自动化 UI 测试)
        └─────────────┘
       ┌───────────────┐
       │ Integration   │  (API 集成测试)
       │    Tests      │
       └───────────────┘
      ┌─────────────────┐
      │   Unit Tests    │  (单元测试)
      └─────────────────┘
```

### 测试文件位置

**后端测试：**
- 集成测试：`station/frame/touch/social/social_follow_integration_test.go`
- 单元测试：各模块的 `*_test.go` 文件

**前端测试：**
- Service 测试：`client/desktop/test/features/social/service/social_api_service_test.dart`
- Repository 测试：`client/desktop/test/features/discovery/repository/discovery_repository_test.dart`

## 后端测试

### 运行所有测试

```bash
cd station/frame/touch
go test ./... -v
```

### 运行 Social Follow 集成测试

```bash
cd station/frame/touch/social
go test -v -run TestFollow
```

### 运行特定测试用例

```bash
# 测试 Follow/Unfollow 工作流
go test -v -run TestFollowUnfollowEndToEnd

# 测试互相关注
go test -v -run TestMutualFollowRelationship

# 测试批量查询
go test -v -run TestBatchGetRelationships

# 测试分页
go test -v -run TestPaginationWithCursor
```

### 跳过集成测试（快速测试）

```bash
go test -short ./...
```

### 运行性能测试

```bash
cd station/frame/touch/social
go test -bench=. -benchmem
```

### 测试覆盖率

```bash
# 生成覆盖率报告
go test -coverprofile=coverage.out ./...

# 查看覆盖率
go tool cover -func=coverage.out

# 生成 HTML 报告
go tool cover -html=coverage.out -o coverage.html
```

### 后端测试用例清单

| 测试用例 | 描述 | 优先级 |
|---------|------|--------|
| `TestFollowUnfollowEndToEnd` | 完整的关注/取消关注流程 | P0 |
| `TestMutualFollowRelationship` | 互相关注场景 | P0 |
| `TestBatchGetRelationships` | 批量查询关系 | P0 |
| `TestFollowersAndFollowingLists` | 粉丝和关注列表 | P0 |
| `TestFollowCounters` | 计数器准确性 | P1 |
| `TestDuplicateFollowPrevention` | 防止重复关注 | P1 |
| `TestUnfollowNonexistentRelationship` | 幂等性测试 | P1 |
| `TestFollowAPIHandler` | HTTP Handler 测试 | P1 |
| `TestPaginationWithCursor` | 分页功能 | P1 |
| `TestErrorHandling` | 错误处理 | P2 |
| `BenchmarkFollowOperation` | 性能基准测试 | P2 |

## 前端测试

### 生成 Mock 文件

```bash
cd client/desktop

# 生成所有 mock 文件
flutter pub run build_runner build

# 或者监听模式（开发时使用）
flutter pub run build_runner watch
```

### 运行所有测试

```bash
cd client/desktop
flutter test
```

### 运行特定测试文件

```bash
# 测试 Social API Service
flutter test test/features/social/service/social_api_service_test.dart

# 测试 Discovery Repository
flutter test test/features/discovery/repository/discovery_repository_test.dart
```

### 运行特定测试用例

```bash
flutter test --name "follow() should send correct protobuf request"
```

### 测试覆盖率

```bash
# 生成覆盖率报告
flutter test --coverage

# 查看 HTML 报告（需要安装 lcov）
genhtml coverage/lcov.info -o coverage/html
open coverage/html/index.html
```

### 前端测试用例清单

| 测试组 | 测试用例数 | 描述 |
|-------|-----------|------|
| Follow Operations | 4 | follow, unfollow, getRelationship, getRelationships |
| Followers and Following | 3 | getFollowers, getFollowing, pagination |
| Error Handling | 3 | 网络错误、无效响应、空列表 |
| Integration Scenarios | 3 | 完整工作流、互相关注、批量查询 |
| **总计** | **13** | 全面覆盖 Social API Service |

## 测试覆盖

### 当前覆盖率目标

- **后端代码覆盖率**: ≥ 80%
- **前端代码覆盖率**: ≥ 75%
- **核心功能覆盖率**: 100%

### 核心功能定义

核心功能（P0）必须有完整的测试覆盖：

1. ✅ Follow/Unfollow 操作
2. ✅ 关系状态查询（单个和批量）
3. ✅ 粉丝列表获取
4. ✅ 关注列表获取
5. ✅ 分页功能
6. ✅ 数据库一致性

## 持续集成

### GitHub Actions 配置示例

```yaml
name: Tests

on: [push, pull_request]

jobs:
  backend-tests:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v2
      - uses: actions/setup-go@v2
        with:
          go-version: '1.21'
      - name: Run tests
        run: |
          cd station
          go test ./... -v -coverprofile=coverage.out
      - name: Upload coverage
        uses: codecov/codecov-action@v2
        with:
          files: ./coverage.out

  frontend-tests:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v2
      - uses: subosito/flutter-action@v2
        with:
          flutter-version: '3.x'
      - name: Install dependencies
        run: |
          cd client/desktop
          flutter pub get
      - name: Generate mocks
        run: |
          cd client/desktop
          flutter pub run build_runner build
      - name: Run tests
        run: |
          cd client/desktop
          flutter test --coverage
      - name: Upload coverage
        uses: codecov/codecov-action@v2
        with:
          files: ./client/desktop/coverage/lcov.info
```

### 本地 CI 模拟

```bash
# 运行完整的 CI 测试流程
./scripts/run_all_tests.sh
```

创建 `scripts/run_all_tests.sh`:

```bash
#!/bin/bash
set -e

echo "========================================="
echo "  Running Backend Tests"
echo "========================================="
cd station/frame/touch
go test ./... -v -coverprofile=coverage.out
go tool cover -func=coverage.out

echo ""
echo "========================================="
echo "  Running Frontend Tests"
echo "========================================="
cd ../../../client/desktop
flutter pub get
flutter pub run build_runner build --delete-conflicting-outputs
flutter test --coverage
echo "Coverage report: client/desktop/coverage/lcov.info"

echo ""
echo "========================================="
echo "  All Tests Passed! ✅"
echo "========================================="
```

## 最佳实践

### 1. 测试命名规范

**后端（Go）：**
```go
func TestFeatureName_Scenario_ExpectedBehavior(t *testing.T) {
    // 例如：
    // TestFollow_WithValidUser_ShouldCreateRelationship
    // TestUnfollow_NonexistentRelationship_ShouldBeIdempotent
}
```

**前端（Dart）：**
```dart
test('methodName() should expectedBehavior when scenario', () async {
    // 例如：
    // test('follow() should send correct protobuf request when called', () async {
});
```

### 2. 测试结构：AAA 模式

```go
func TestExample(t *testing.T) {
    // Arrange - 准备测试数据
    user1 := createTestUser()
    user2 := createTestUser()
    
    // Act - 执行操作
    err := service.Follow(ctx, user1.ID, user2.ID)
    
    // Assert - 验证结果
    require.NoError(t, err)
    assert.True(t, isFollowing(user1.ID, user2.ID))
}
```

### 3. 使用 Table-Driven Tests

```go
func TestValidation(t *testing.T) {
    tests := []struct {
        name        string
        input       string
        expectError bool
    }{
        {"valid ID", "123", false},
        {"invalid ID", "abc", true},
        {"empty ID", "", true},
    }
    
    for _, tt := range tests {
        t.Run(tt.name, func(t *testing.T) {
            err := validate(tt.input)
            if tt.expectError {
                assert.Error(t, err)
            } else {
                assert.NoError(t, err)
            }
        })
    }
}
```

### 4. 测试数据清理

```go
func TestWithCleanup(t *testing.T) {
    tc := setupTestContext(t)
    defer tc.cleanup(t)  // 确保清理
    
    // 测试代码...
}
```

### 5. Mock 使用原则

- ✅ Mock 外部依赖（HTTP、数据库、第三方服务）
- ✅ Mock 复杂的内部服务
- ❌ 不要 Mock 简单的数据结构
- ❌ 不要过度 Mock（保持测试真实性）

### 6. 测试隔离

- 每个测试应该独立运行
- 不依赖其他测试的状态
- 使用唯一的测试数据（如时间戳）
- 测试后清理数据

### 7. 性能测试

```go
func BenchmarkFollow(b *testing.B) {
    setup()
    defer cleanup()
    
    b.ResetTimer()
    for i := 0; i < b.N; i++ {
        service.Follow(ctx, user1ID, user2ID)
    }
}
```

### 8. 测试文档

每个测试文件应包含：
- 测试目的说明
- 依赖的环境要求
- 特殊配置说明
- 已知问题和限制

## 常见问题

### Q: 测试数据库连接失败？

A: 确保数据库服务正在运行，或使用 `-short` 跳过集成测试：
```bash
go test -short ./...
```

### Q: Mock 文件生成失败？

A: 清理并重新生成：
```bash
flutter pub run build_runner clean
flutter pub run build_runner build --delete-conflicting-outputs
```

### Q: 测试运行很慢？

A: 使用并行测试和缓存：
```bash
# Go 并行测试
go test -parallel 4 ./...

# Flutter 并发测试
flutter test --concurrency=4
```

### Q: 如何调试失败的测试？

A: 使用详细输出和日志：
```bash
# Go
go test -v -run TestSpecificTest

# Flutter
flutter test --verbose test/specific_test.dart
```

## 测试维护

### 定期任务

- [ ] 每周检查测试覆盖率
- [ ] 每月更新测试数据
- [ ] 每季度审查测试用例
- [ ] 删除过时的测试

### 添加新测试

当添加新功能时：

1. ✅ 先写测试（TDD）
2. ✅ 确保测试失败
3. ✅ 实现功能
4. ✅ 确保测试通过
5. ✅ 重构代码
6. ✅ 更新文档

### 测试审查清单

在 PR 中：
- [ ] 所有测试通过
- [ ] 新功能有测试覆盖
- [ ] 测试命名清晰
- [ ] 没有被注释掉的测试
- [ ] 测试数据会被清理
- [ ] 更新了测试文档

## 资源链接

- [Go Testing Package](https://pkg.go.dev/testing)
- [Testify Documentation](https://github.com/stretchr/testify)
- [Flutter Testing Guide](https://docs.flutter.dev/testing)
- [Mockito for Dart](https://pub.dev/packages/mockito)

---

**最后更新**: 2026-01-18  
**维护者**: Development Team  
**版本**: 1.0.0
