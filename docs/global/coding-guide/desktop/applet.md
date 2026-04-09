# Desktop Applet 系统指南

## 架构总览

Desktop 的 Applet 系统允许通过外部小程序扩展平台功能。Applet 以 Lynx 容器渲染，遵循 Manifest V2 协议，通过 Bridge V2 与宿主通信。

核心组成：

```
applet/
  types.ts           ← 类型定义：AppletManifestV2, AppletInfo, BridgeV2Message
  schema.ts          ← 校验逻辑：parseAppletIndexV2, parseAppletInfoV2
  AppletManager.ts   ← 管理器：扫描、加载、卸载、诊断
```

运行时资源位于 `/applets-dist/` 目录，入口清单为 `/applets-dist/index.json`。


## AppletManager 单例类

`AppletManager` 是 Applet 生命周期的中枢，采用单例模式。

```typescript
class AppletManager {
  private static instance: AppletManager;
  private applets: Map<string, AppletInfo> = new Map();
  private appletInstances: Map<string, any> = new Map();
  private rejectedDiagnostics: Map<string, string[]> = new Map();
  private indexDiagnostics: string[] = [];
  private appletDir: string = '/applets-dist';
  private platformVersion = '0.1.0';

  public static getInstance(): AppletManager;
}
```

获取实例：

```typescript
const manager = AppletManager.getInstance();
```


## scanApplets()：扫描与校验

`scanApplets()` 是 Applet 发现的入口，完成以下工作：

1. 请求 `/applets-dist/index.json`
2. 用 `parseAppletIndexV2` 校验 index 结构（`indexVersion` 必须为 2）
3. 遍历 `applets` 数组，逐个用 `parseAppletInfoV2` 校验
4. 去重（同 id 的后出现的被拒绝）
5. 收集所有拒绝原因到 `rejectedDiagnostics`

```typescript
const applets = await manager.scanApplets();
// 返回：通过校验的 AppletInfo[]
// 未通过校验的不在返回值中，但记录在诊断信息里
```

index.json 结构示例：

```json
{
  "indexVersion": 2,
  "generatedAt": "2026-04-01T00:00:00Z",
  "applets": [
    {
      "manifestVersion": 2,
      "id": "weather",
      "name": "Weather",
      "version": "1.0.0",
      "description": "Weather forecast applet",
      "author": "peers-touch",
      "icon": "cloud",
      "permissions": ["network"],
      "load": { "type": "lynx", "entry": "index.js" },
      "bridge": { "version": 2, "protocol": "peers-touch.applet.bridge.v2" }
    }
  ]
}
```

### 校验规则

`parseAppletInfoV2` 执行的校验项：

| 字段 | 规则 |
|------|------|
| `manifestVersion` | 必须等于 `2` |
| `id` | 非空字符串，匹配 `/^[a-z0-9][a-z0-9-]*$/` |
| `name` | 非空字符串 |
| `version` | 合法 semver（如 `1.2.3`、`1.0.0-beta.1`） |
| `description` | 非空字符串 |
| `author` | 非空字符串 |
| `icon` | 非空字符串 |
| `permissions` | 字符串数组 |
| `capabilities` | 可选，字符串数组 |
| `minPlatformVersion` | 可选，合法 semver |
| `targetPlatforms` | 可选，仅允许 `desktop`/`mobile`/`web` |
| `load.type` | 仅支持 `lynx` |
| `load.entry` | 非空字符串 |
| `bridge.version` | 必须等于 `2` |
| `bridge.protocol` | 必须等于 `peers-touch.applet.bridge.v2` |

任何字段不满足条件，该 Applet 整体被拒绝，其所有 issues 记入诊断。


## loadApplet(id)：加载 Applet

```typescript
const appletInfo = await manager.loadApplet('weather');
```

加载流程：

1. 从已扫描的 `applets` Map 中查找 id
2. 若找不到，检查是否在 `rejectedDiagnostics` 中（给出具体拒绝原因）
3. 对找到的 applet 再次执行 `parseAppletInfoV2` 运行时校验
4. 检查 `minPlatformVersion` 是否兼容当前平台版本
5. 若已加载（`appletInstances` 中已存在），直接返回
6. 记录到 `appletInstances`，标记 `status: 'loaded'`

错误场景：

```typescript
try {
  await manager.loadApplet('nonexistent');
} catch (err) {
  // Error: Applet nonexistent not found
}

try {
  await manager.loadApplet('invalid-applet');
} catch (err) {
  // Error: Applet invalid-applet is invalid:
  //   - index.applets[2].version 必须是合法 semver（例如 1.2.3）
}

try {
  await manager.loadApplet('future-applet');
} catch (err) {
  // Error: Applet future-applet requires higher platform version: 2.0.0
}
```


## unloadApplet(id)：卸载 Applet

```typescript
manager.unloadApplet('weather');
```

从 `appletInstances` 中移除对应记录。不影响 `applets` Map 中的注册信息，后续可重新加载。


## getDiagnostics()：获取诊断信息

```typescript
const diagnostics = manager.getDiagnostics();
// 返回：AppletDiagnostic[]
```

```typescript
interface AppletDiagnostic {
  source: string;     // 'index.json' 或 applet id
  issues: string[];   // 具体问题列表
}
```

诊断信息来自两个来源：
- `indexDiagnostics`：index.json 自身的结构问题
- `rejectedDiagnostics`：各个被拒绝 applet 的校验问题

示例输出：

```typescript
[
  {
    source: 'index.json',
    issues: ['index.json 不是合法 JSON 对象']
  },
  {
    source: 'broken-applet',
    issues: [
      'index.applets[1].version 必须是合法 semver（例如 1.2.3）',
      'index.applets[1].load.entry 必须是非空字符串'
    ]
  }
]
```


## 其他 API

```typescript
// 获取单个 Applet 信息（无需加载）
const info = manager.getAppletInfo('weather');

// 获取所有已扫描的可用 Applet
const all = manager.getAvailableApplets();

// 获取所有已加载的 Applet id 列表
const loaded = manager.getLoadedApplets();

// 清空所有已加载实例
manager.clear();
```


## semver 比较

`AppletManager` 内置 `compareSemver` 用于平台版本兼容性检查：

```typescript
private compareSemver(left: string, right: string): number
```

- 忽略 pre-release 标签（`-beta.1` 部分被截断）
- 仅比较 major.minor.patch 三段
- 返回值：负数 = left < right，0 = 相等，正数 = left > right
- 用途：当 `minPlatformVersion` > `platformVersion` 时拒绝加载


## AppletInfo 类型

`AppletInfo` 继承自 `AppletManifestV2`，额外携带运行时路径信息：

```typescript
interface AppletManifestV2 {
  manifestVersion: 2;
  id: string;
  name: string;
  version: string;
  description: string;
  author: string;
  icon: string;
  permissions: string[];
  capabilities?: string[];
  minPlatformVersion?: string;
  targetPlatforms?: Array<'desktop' | 'mobile' | 'web'>;
  load: { type: 'lynx'; entry: string };
  bridge: { version: 2; protocol: 'peers-touch.applet.bridge.v2' };
}

interface AppletInfo extends AppletManifestV2 {
  main: string;   // 等于 load.entry
  path: string;   // /applets-dist/{id}
}
```


## Bridge V2 通信协议

Applet 与宿主通过 Bridge V2 协议通信，消息类型：

```typescript
interface BridgeV2InitMessage {
  protocol: 'peers-touch.applet.bridge.v2';
  appletId: string;
  kind: 'init';
  manifest: AppletManifestV2;
}

interface BridgeV2EventMessage {
  protocol: 'peers-touch.applet.bridge.v2';
  appletId: string;
  kind: 'event';
  event: string;
  payload?: unknown;
}
```

所有消息必须携带 `protocol` 和 `appletId` 字段。`kind` 区分消息类型：`init` 用于 Applet 初始化握手，`event` 用于后续事件通信。


## 与 Lynx 容器的集成

Applet 的 `load.type` 当前仅支持 `lynx`。加载时，宿主根据 `AppletInfo.path` 和 `AppletInfo.main` 构造 Lynx 容器的入口 URL，例如：

```
/applets-dist/weather/index.js
```

Lynx 容器负责渲染 Applet UI，Bridge V2 协议负责双向通信。


## 典型生命周期

```
                       scanApplets()
                            |
                    读取 index.json
                            |
                   parseAppletIndexV2
                            |
              遍历 parseAppletInfoV2 (逐个校验)
                            |
                 通过 → applets Map
                 拒绝 → rejectedDiagnostics
                            |
                      loadApplet(id)
                            |
                    运行时二次校验
                            |
                  版本兼容性检查 (semver)
                            |
                 记入 appletInstances
                            |
                     Lynx 容器渲染
                            |
                   Bridge V2 通信
                            |
                    unloadApplet(id)
```
