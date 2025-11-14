# Peers-Touch Dio 封装

基于 Dio 的跨端网络请求库，为 Peers-Touch 客户端提供统一的 HTTP 请求解决方案，简化网络通信逻辑，增强可维护性和扩展性。

## 📚 目录
- [核心特性](#-核心特性)
- [快速开始](#-快速开始)
- [高级配置](#-高级配置)
- [API 参考](#-api-参考)
- [注意事项](#-注意事项)
- [版本日志](#-版本更新日志)
- [贡献指南](#-贡献指南)

## ✨ 核心特性

### 统一请求处理
- 标准化请求参数格式
- 自动添加公共请求头（如认证信息、设备信息）
- 支持请求参数加密与签名

### 智能响应处理
- 统一响应数据格式解析
- 错误码标准化与映射
- 自动 token 刷新与重试机制
- 业务异常与网络异常分离处理

### 增强日志系统
- 分级日志（DEBUG/INFO/WARN/ERROR）
- 敏感信息脱敏
- 请求/响应日志格式化输出
- 支持日志导出与上传

### 安全合规
- 请求参数校验
- 响应数据校验
- 证书固定（SSL Pinning）
- 隐私数据加密传输

### 灵活扩展
- 拦截器链机制
- 自定义适配器支持
- 多环境配置管理
- 动态超时控制

## 🚀 快速开始

### 安装
```yaml
# pubspec.yaml
dependencies:
  peers_touch_network_client:
    path: ../../../../peers_touch_network_client
```

### 初始化
```dart
import 'package:peers_touch_network_client/src/dio/peers_dio.dart';

void main() {
  // 基础初始化
  final dio = PeersDio(
    baseUrl: 'https://api.peers-touch.com',
    config: DioConfig(
      connectTimeout: Duration(seconds: 30),
      receiveTimeout: Duration(seconds: 30),
      enableLog: true,
    ),
  );

  // 添加全局拦截器
  dio.addInterceptor(AuthInterceptor());
  dio.addInterceptor(LogInterceptor());
}
```

### 发送请求
```dart
// GET 请求
final response = await dio.get('/api/v1/users',
  queryParameters: {'page': 1, 'limit': 20},
  options: PeersOptions(
    needAuth: true,
    showLoading: true,
  ),
);

// POST 请求
final response = await dio.post('/api/v1/users',
  data: {'name': 'Peers', 'email': 'contact@peers-touch.com'},
  options: PeersOptions(
    needAuth: true,
    timeout: Duration(seconds: 45),
  ),
);
```

## ⚙️ 高级配置

### 多环境支持
```dart
final config = DioConfig(
  environments: {
    'dev': EnvironmentConfig(baseUrl: 'https://dev-api.peers-touch.com'),
    'test': EnvironmentConfig(baseUrl: 'https://test-api.peers-touch.com'),
    'prod': EnvironmentConfig(baseUrl: 'https://api.peers-touch.com'),
  },
  currentEnvironment: 'dev',
);
```

### 配置参数说明
| 参数名 | 类型 | 默认值 | 描述 |
|--------|------|--------|------|
| baseUrl | String | '' | 基础请求地址 |
| connectTimeout | Duration | 30s | 连接超时时间 |
| receiveTimeout | Duration | 30s | 接收超时时间 |
| enableLog | bool | false | 是否启用日志 |
| enableSecurity | bool | true | 是否启用安全增强 |
| interceptors | List<Interceptor> | [] | 自定义拦截器 |
| httpAdapter | HttpClientAdapter | Default | HTTP适配器 |

### 自定义拦截器
```dart
class AuthInterceptor extends PeersInterceptor {
  @override
  Future<void> onRequest(RequestOptions options) async {
    // 添加认证令牌
    final token = await AuthManager.getToken();
    if (token != null) {
      options.headers['Authorization'] = 'Bearer \$token';
    }
    return super.onRequest(options);
  }
}
```

## 📝 API 参考

### PeersDio 类
| 方法 | 描述 | 参数 | 返回值 |
|------|------|------|--------|
| `get` | 发送 GET 请求 | `path, queryParameters, options` | `Future<T>` |
| `post` | 发送 POST 请求 | `path, data, options` | `Future<T>` |
| `put` | 发送 PUT 请求 | `path, data, options` | `Future<T>` |
| `delete` | 发送 DELETE 请求 | `path, options` | `Future<T>` |
| `addInterceptor` | 添加拦截器 | `interceptor` | `void` |
| `setAuthToken` | 设置认证令牌 | `token` | `void` |
| `clearAuthToken` | 清除认证令牌 | - | `void` |
| `cancelRequests` | 取消请求 | `tag` | `void` |

### PeersOptions 类
| 属性 | 类型 | 默认值 | 描述 |
|------|------|--------|------|
| `needAuth` | bool | false | 是否需要认证 |
| `showLoading` | bool | false | 是否显示加载动画 |
| `timeout` | Duration | 30s | 请求超时时间 |
| `responseType` | ResponseType | json | 响应数据类型 |
| `requestType` | RequestType | json | 请求数据类型 |
| `tag` | String | '' | 请求标记 |
| `extra` | Map<String, dynamic> | {} | 额外参数 |

## 📌 注意事项

### 跨平台适配
- **桌面端**：支持 Windows/macOS/Linux，需在初始化时提供设备唯一标识
- **移动端**：支持 Android/iOS，自动获取设备信息
- **Web**：需注意跨域配置，建议配合后端 CORS 设置

### 错误处理
```dart
try {
  final response = await dio.get('/api/v1/users');
  // 处理成功响应
} on PeersNetworkException catch (e) {
  // 处理网络异常
  switch (e.type) {
    case NetworkErrorType.unauthorized:
      // 处理未授权
      break;
    case NetworkErrorType.timeout:
      // 处理超时
      break;
    default:
      // 其他错误
      break;
  }
}
```

### 性能优化
- 避免在 UI 线程执行大型请求
- 合理设置缓存策略减少重复请求
- 批量取消不再需要的请求（如页面销毁时）

## 🔄 版本规划

### 计划版本

#### v0.1.0 - 基础版本
- 完成Dio核心封装
- 实现统一请求/响应处理
- 支持基础拦截器机制
- 实现日志系统

#### v0.2.0 - 增强版本
- 增加多环境配置管理
- 优化错误处理体系
- 添加证书固定支持
- 增强日志脱敏规则

#### v1.0.0 - 稳定版本
- 完成所有核心功能开发
- 进行全面测试与优化
- 发布正式稳定版本

### 当前状态
项目正处于初始化阶段，正在进行基础版本的开发工作。

## 🤝 贡献指南

### 开发流程
1. Fork 仓库
2. 创建特性分支 (`git checkout -b feature/amazing-feature`)
3. 提交更改 (`git commit -m 'Add some amazing feature'`)
4. 推送到分支 (`git push origin feature/amazing-feature`)
5. 创建 Pull Request

### 代码规范
- 遵循 [Effective Dart](https://dart.dev/guides/language/effective-dart)
- 所有提交需通过 lint 检查
- 新增功能需添加单元测试

## 📄 许可证

本项目基于 MIT 许可证开源 - 详情请见项目根目录下的 LICENSE 文件。

---

**维护者**：Peers-Touch 开发团队
**联系我们**：dev@peers-touch.com
**项目地址**：https://github.com/peers-touch/peers_touch_network_client