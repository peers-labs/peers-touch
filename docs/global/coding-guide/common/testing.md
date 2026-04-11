# 统一测试指南

> 最后更新: 2026-04-08
>
> 本文档定义 Peers-Touch 各端的测试策略、命名规范和执行方法。

---

## 1. 红线规则

源自 [`AGENTS.md` — Iron Laws: No Mocking](../../../../AGENTS.md#no-mocking):

> 1. 所有前后端协同的接口、功能, 如果我不说要使用 mock 先替代, 就不准 mock!
> 2. 当前端需要使用后端的接口时, 前端使用 mock, 将视为作弊!

**总结: 前端测试禁止 mock 后端 API。只有纯前端逻辑 (组件渲染、状态管理、工具函数) 才允许单元测试中使用 mock。**

---

## 2. Station (Go)

### 2.1 运行测试

```bash
cd apps/station

# 运行全部测试
go test ./...

# 运行单个包
go test ./frame/core/auth/...

# 运行指定测试函数
go test ./frame/core/auth/ -run TestSubjectContext

# 带详细输出
go test -v ./frame/core/auth/...

# 查看覆盖率
go test -cover ./...
```

### 2.2 命名规范

格式: `Test<Func>_<Scenario>`

```go
func TestSubjectContext(t *testing.T) { ... }
func TestHandleCreateProvider(t *testing.T) { ... }
func TestInviteAndRegister(t *testing.T) { ... }
func TestProtocolFrameRoundTrip(t *testing.T) { ... }
```

### 2.3 表格驱动测试 (Table-Driven)

项目标准模式, 参考 `station/app/subserver/ai_chat/handler/provider_handler_test.go`:

```go
func TestHandleCreateProvider(t *testing.T) {
    h := NewProviderHandlers()

    tests := []struct {
        name      string
        setupCtx  func() context.Context
        req       *model.CreateProviderRequest
        wantError bool
    }{
        {
            name: "missing name",
            setupCtx: func() context.Context {
                return context.Background()
            },
            req: &model.CreateProviderRequest{
                Name: "",
            },
            wantError: true,
        },
        {
            name: "valid provider",
            setupCtx: func() context.Context {
                ctx := context.Background()
                return coreauth.WithSubject(ctx, &coreauth.Subject{
                    ID: "admin",
                })
            },
            req: &model.CreateProviderRequest{
                Name:        "OpenAI",
                Description: "OpenAI GPT Provider",
                Logo:        "https://example.com/logo.png",
            },
            wantError: false,
        },
    }

    for _, tt := range tests {
        t.Run(tt.name, func(t *testing.T) {
            ctx := tt.setupCtx()
            resp, err := h.HandleCreateProvider(ctx, tt.req)

            if tt.wantError {
                if err == nil {
                    t.Error("Expected error but got none")
                }
                return
            }

            if err != nil && !tt.wantError {
                t.Logf("HandleCreateProvider() error = %v (may be expected)", err)
                return
            }

            if !tt.wantError && resp != nil && resp.Provider != nil {
                if resp.Provider.Name != tt.req.Name {
                    t.Errorf("Provider.Name = %v, want %v", resp.Provider.Name, tt.req.Name)
                }
            }
        })
    }
}
```

### 2.4 Context 测试模式

测试需要认证上下文时, 使用 `coreauth.WithSubject`:

```go
func TestProtectedHandler(t *testing.T) {
    tests := []struct {
        name      string
        ctx       context.Context
        wantError bool
    }{
        {
            name:      "no auth context",
            ctx:       context.Background(),
            wantError: true,
        },
        {
            name: "with valid subject",
            ctx: coreauth.WithSubject(context.Background(), &coreauth.Subject{
                ID:         "actor-1",
                Attributes: map[string]string{"role": "user"},
            }),
            wantError: false,
        },
    }

    for _, tt := range tests {
        t.Run(tt.name, func(t *testing.T) {
            // ...
        })
    }
}
```

### 2.5 断言

标准库 `testing` 的 `t.Errorf` / `t.Fatal`:

```go
if retrieved == nil {
    t.Fatal("GetSubject() returned nil")
}

if retrieved.ID != subject.ID {
    t.Errorf("ID = %v, want %v", retrieved.ID, subject.ID)
}
```

需要 `testify/assert` 时:

```go
import "github.com/stretchr/testify/assert"

func TestSomething(t *testing.T) {
    assert.NotNil(t, result)
    assert.Equal(t, expected, actual)
    assert.NoError(t, err)
}
```

### 2.6 测试文件位置

测试文件与源文件同目录, 文件名后缀 `_test.go`:

```
frame/core/auth/
  context.go
  context_test.go
  jwt.go
  config.go

app/subserver/ai_chat/handler/
  provider_handler.go
  provider_handler_test.go
```

集成测试可使用独立标签:

```
frame/core/plugin/native/subserver/relay/
  relay_integration_test.go
```

---

## 3. Desktop TypeScript

### 3.1 运行测试

```bash
cd apps/desktop

# 运行全部测试
npm run test
# 即: vitest run

# 运行指定测试文件
npm run test:applet
# 即: vitest run src/applet/AppletManager.test.ts

# watch 模式 (开发时)
npx vitest
```

### 3.2 测试框架

项目使用 **Vitest** + `vi.mock()` 进行测试。

### 3.3 Tauri 命令契约测试

源码参考: `apps/desktop/src/test/tauri-contract.test.ts`

```typescript
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { invoke } from '@tauri-apps/api/core';
import { AuthCommandException, api } from '../services/desktop_api';

vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn(),
}));

describe('TS <-> Rust command contract', () => {
  const invokeMock = vi.mocked(invoke);

  beforeEach(() => {
    invokeMock.mockReset();
  });

  it('auth_login 透传 input', async () => {
    invokeMock.mockResolvedValue({
      ok: false,
      error: { code: 'NOT_IMPLEMENTED', message: 'not implemented' },
    });

    let rejectedError: unknown;
    try {
      await api.authLogin({
        account: 'demo',
        password: 'pwd',
        base_url: 'http://localhost:8420',
      });
    } catch (error) {
      rejectedError = error;
    }

    expect(invokeMock).toHaveBeenCalledWith('auth_login', {
      input: {
        account: 'demo',
        password: 'pwd',
        base_url: 'http://localhost:8420',
      },
    });

    if (rejectedError) {
      expect(rejectedError).toBeInstanceOf(AuthCommandException);
    }
  });

  it('无 input 的命令不传入参数对象', async () => {
    invokeMock.mockResolvedValue({
      ok: true,
      data: { command: 'admin_health', status: 'stub' },
    });

    const result = await api.adminHealth();

    expect(invokeMock).toHaveBeenCalledWith('admin_health', undefined);
    expect(result.ok).toBe(true);
  });
});
```

**注意**: 这里 mock 的是 Tauri 的 `invoke` (IPC 底层), 不是后端 API。这属于前端内部层间隔离, 不违反红线规则。

### 3.4 测试文件位置

```
src/
  test/
    tauri-contract.test.ts    # Tauri IPC 契约测试
  services/
    api.test.ts               # API 服务层测试
  kernel/events/
    bus.test.ts               # 事件总线测试
  applet/
    AppletManager.test.ts     # Applet 管理器测试
  modules/
    registry.test.ts          # 模块注册测试
```

### 3.5 命名规范

- 文件: `<module>.test.ts`
- describe 块: 模块或类名
- it 块: 中文或英文描述行为

---

## 4. Desktop Rust

### 4.1 运行测试

```bash
cd apps/desktop/src-tauri

# 运行全部测试
cargo test

# 运行指定模块测试
cargo test --lib auth

# 查看输出
cargo test -- --nocapture
```

### 4.2 测试模块

Rust 测试写在源文件内部的 `#[cfg(test)]` 模块中:

```rust
#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_app_result_success() {
        let result = AppResult::success(StubPayload {
            command: "test".to_string(),
            status: "ok".to_string(),
        });
        assert!(result.ok);
        assert!(result.data.is_some());
        assert!(result.error.is_none());
    }

    #[test]
    fn test_app_result_fail() {
        let result: AppResult<StubPayload> = AppResult::fail(
            ErrorCode::InvalidArgument,
            "bad input",
            None,
        );
        assert!(!result.ok);
        assert!(result.data.is_none());
        assert!(result.error.is_some());
        assert_eq!(result.error.unwrap().message, "bad input");
    }
}
```

### 4.3 集成测试

放在 `tests/` 目录下:

```
src-tauri/
  src/
    error.rs           # 源码 + #[cfg(test)] mod tests
  tests/
    integration_test.rs  # 集成测试
```

---

## 5. Mobile Android

### 5.1 运行测试

```bash
cd apps/mobile/android

# 单元测试
./gradlew test

# 指定模块
./gradlew :app:testDebugUnitTest

# 仪器测试 (需要设备/模拟器)
./gradlew connectedAndroidTest
```

### 5.2 框架

- 单元测试: JUnit 5 + Mockito
- UI 测试: Compose Testing (`composeTestRule`)
- 断言: JUnit `assertEquals` / Truth

### 5.3 示例

```kotlin
class StationApiClientTest {
    @Test
    fun `pullEvents returns events list`() {
        val client = StationApiClient(baseUrl = "http://localhost:8420")
        val request = PullEventsRequest.newBuilder()
            .setLimit(10)
            .build()

        val response = runBlocking { client.pullEvents(request) }

        assertNotNull(response)
        assertTrue(response.eventsList.size <= 10)
    }
}
```

Compose UI 测试:

```kotlin
class ChatScreenTest {
    @get:Rule
    val composeTestRule = createComposeRule()

    @Test
    fun `message list displays messages`() {
        composeTestRule.setContent {
            ChatScreen(viewModel = fakeChatViewModel())
        }

        composeTestRule.onNodeWithText("Hello").assertIsDisplayed()
    }
}
```

---

## 6. Mobile iOS

### 6.1 运行测试

```bash
cd apps/mobile/ios

# 使用 xcodebuild
xcodebuild test \
  -workspace PeersTouch.xcworkspace \
  -scheme PeersTouch \
  -destination 'platform=iOS Simulator,name=iPhone 15'

# 或在 Xcode 中 Cmd+U
```

### 6.2 框架

- 单元测试: XCTest
- UI 测试: XCUITest
- SwiftUI 预览: `#Preview` 宏

### 6.3 示例

```swift
import XCTest
@testable import PeersTouch

class StationAPIClientTests: XCTestCase {

    func testPullEvents_returnsEvents() async throws {
        let client = StationAPIClient(baseURL: URL(string: "http://localhost:8420")!)
        var request = PeersTouch_Model_Events_V1_PullEventsRequest()
        request.limit = 10

        let response = try await client.pullEvents(request)

        XCTAssertTrue(response.events.count <= 10)
    }

    func testPullEvents_requiresAuth() async {
        let client = StationAPIClient(baseURL: URL(string: "http://localhost:8420")!)
        var request = PeersTouch_Model_Events_V1_PullEventsRequest()
        request.limit = 10

        do {
            _ = try await client.pullEvents(request, token: nil)
            XCTFail("Should throw unauthorized error")
        } catch {
            // Expected: 401 Unauthorized
        }
    }
}
```

---

## 7. 单元测试 vs 集成测试

### 7.1 划分原则

| 类型 | 范围 | 依赖 | 速度 |
|---|---|---|---|
| 单元测试 | 单个函数/方法 | 无外部依赖 | 毫秒级 |
| 集成测试 | API 端点 / 跨模块交互 | 需要数据库/服务 | 秒级 |

### 7.2 适用场景

**单元测试 (推荐场景)**:

- 纯逻辑函数 (序列化、校验、转换)
- Context 传递与提取
- 状态机转换
- 工具函数

```go
// 适合单元测试: 纯逻辑
func TestGetSerializerForType_Proto(t *testing.T) {
    typ := reflect.TypeOf((*eventsmodel.PullEventsRequest)(nil)).Elem()
    s := GetSerializerForType(typ)
    assert.Equal(t, "application/protobuf", s.ContentType())
}

func TestGetSerializerForType_JSON(t *testing.T) {
    typ := reflect.TypeOf(map[string]string{})
    s := GetSerializerForType(typ)
    assert.Equal(t, "application/json", s.ContentType())
}
```

**集成测试 (推荐场景)**:

- HTTP API 端点完整请求/响应
- 数据库读写链路
- SSE 连接建立与事件接收
- 认证完整链路 (签发 -> 验证 -> 拒绝过期)

```go
func TestInviteAndRegister(t *testing.T) {
    // 启动真实 relay subserver
    // 创建邀请码
    // 使用邀请码注册
    // 验证注册结果
}
```

### 7.3 禁止事项

- 禁止 mock Station API 来测试前端页面逻辑
- 禁止 mock 数据库来测试 Repository 层
- 禁止跳过认证中间件来测试受保护端点

---

## 8. CI 测试流程

```bash
# Station
cd apps/station && go test ./...

# Desktop TS
cd apps/desktop && npm run test

# Desktop Rust
cd apps/desktop/src-tauri && cargo test

# Mobile Android (需要 CI 环境配置 Android SDK)
cd apps/mobile/android && ./gradlew test

# Mobile iOS (需要 macOS CI)
cd apps/mobile/ios && xcodebuild test -workspace PeersTouch.xcworkspace -scheme PeersTouch -destination 'platform=iOS Simulator,name=iPhone 15'
```

---

## 9. 检查清单

新增功能前, 确认以下测试覆盖:

- [ ] 核心逻辑有表格驱动单元测试
- [ ] Proto 序列化/反序列化有往返测试
- [ ] API 端点有集成测试 (真实 HTTP 请求)
- [ ] 错误路径有测试 (无权限、参数错误、资源不存在)
- [ ] Tauri 命令有契约测试 (TS <-> Rust 参数传递)
- [ ] 不依赖 mock 后端 API
