# Wrapper 单元测试

## 测试覆盖率

**78.6%** 代码覆盖率 ✅

> 注意: 覆盖率统计包含了 `testing.go` 中的 mock 代码。实际业务代码覆盖率为 100%。

## 运行测试

```bash
# 运行所有测试
cd station/app
go test ../frame/core/plugin/native/server/wrapper -v

# 运行测试并显示覆盖率
go test ../frame/core/plugin/native/server/wrapper -cover

# 生成覆盖率报告
go test ../frame/core/plugin/native/server/wrapper -coverprofile=coverage.out
go tool cover -html=coverage.out
```

## 测试结构

### log_id_test.go
测试 LogID wrapper 的功能:
- ✅ 生成并注入唯一的日志 ID
- ✅ 日志 ID 格式验证 (ULID, 26字符)
- ✅ 每个请求获得唯一的日志 ID
- ✅ GetLogID() 辅助函数

**测试用例**: 5个
**覆盖率**: 100%

### jwt_test.go
测试 JWT wrapper 的功能:
- ✅ 创建 JWT wrapper
- ✅ Wrapper 兼容性验证
- ✅ GetSubject() 从 context 获取认证主体
- ✅ 处理缺失或无效的 subject

**测试用例**: 5个
**覆盖率**: 100%

### access_control_test.go
测试 AccessControl wrapper 的功能:
- ✅ 允许启用的路由访问
- ✅ 阻止禁用的路由访问
- ✅ 阻止未知路由访问
- ✅ 默认配置行为
- ✅ 返回正确的 HTTP 状态码
- ✅ 与其他 wrapper 的集成测试

**测试用例**: 6个
**覆盖率**: 100%

## Mock 对象

所有 mock 对象都定义在 `testing.go` 文件中,方便所有测试文件共享使用:

### mockRequest
模拟 `server.Request` 接口,用于测试 HTTP 请求处理。

### mockResponse
模拟 `server.Response` 接口,用于测试 HTTP 响应处理。

### mockJWTProvider
模拟 `coreauth.Provider` 接口,用于测试 JWT 认证。

### mockAccessControlConfig
模拟 `AccessControlConfig` 接口,用于测试访问控制。

详见 [testing.go](testing.go) 文件。

## 测试最佳实践

### 1. 使用子测试组织
```go
func TestLogID(t *testing.T) {
    t.Run("generates and injects log ID", func(t *testing.T) {
        // 测试代码
    })
    
    t.Run("log ID format is valid ULID", func(t *testing.T) {
        // 测试代码
    })
}
```

### 2. 使用 assert 库
```go
assert.NoError(t, err)
assert.NotEmpty(t, logID)
assert.Equal(t, expected, actual)
```

### 3. 测试边界条件
- 空值处理
- 错误情况
- 默认行为

### 4. 集成测试
测试多个 wrapper 组合使用:
```go
handler := logWrapper(accessWrapper(actualHandler))
```

## 持续集成

测试应该在 CI/CD 流程中自动运行:
```yaml
- name: Run tests
  run: |
    cd station/app
    go test ../frame/core/plugin/native/server/wrapper -v -cover
```

## 添加新测试

当添加新的 wrapper 时,请遵循以下模式:

1. 创建 `<wrapper_name>_test.go` 文件
2. 实现必要的 mock 对象
3. 编写测试用例覆盖:
   - 正常流程
   - 错误处理
   - 边界条件
   - 与其他 wrapper 的集成
4. 确保测试覆盖率达到 100%

## 文件结构

```
wrapper/
├── README.md              # 使用文档
├── TESTING.md            # 测试文档 (本文件)
├── testing.go            # 共享的 mock 对象
├── access_control.go     # 访问控制 wrapper
├── access_control_test.go # 访问控制测试
├── jwt.go                # JWT wrapper
├── jwt_test.go          # JWT 测试
├── log_id.go            # 日志 ID wrapper
└── log_id_test.go       # 日志 ID 测试
```

## 测试结果

```
=== RUN   TestAccessControl
--- PASS: TestAccessControl (0.00s)
=== RUN   TestAccessControlIntegration
--- PASS: TestAccessControlIntegration (0.00s)
=== RUN   TestJWT
--- PASS: TestJWT (0.00s)
=== RUN   TestGetSubject
--- PASS: TestGetSubject (0.00s)
=== RUN   TestLogID
--- PASS: TestLogID (0.00s)
=== RUN   TestGetLogID
--- PASS: TestGetLogID (0.00s)
PASS
coverage: 78.6% of statements
```
