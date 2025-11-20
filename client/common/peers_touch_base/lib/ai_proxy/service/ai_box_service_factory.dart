import 'package:peers_touch_base/ai_proxy/adapter/ai_proxy_adapter.dart';
import 'package:peers_touch_base/ai_proxy/service/ai_box_client_mode_service.dart';
import 'package:peers_touch_base/ai_proxy/service/ai_box_server_mode_service.dart';
import 'package:peers_touch_base/ai_proxy/service/ai_box_service.dart';
import 'package:peers_touch_base/ai_proxy/service/ai_box_facade_service.dart';
import 'package:peers_touch_base/network/dio/http_service_impl.dart';
import 'package:peers_touch_base/network/dio/peers_frame/service/ai_box_service.dart' as frame;

/// AI Box 服务模式
enum AiBoxMode {
  client, // 客户端直连模式
  server, // 服务端代理模式
}

/// AI Box 服务工厂
/// 
/// 负责创建和管理整个AI服务依赖链，对外隐藏所有实现细节
class AiBoxServiceFactory {
  /// 根据模式获取AI Box服务实例
  /// 
  /// [mode]: 服务模式
  /// [baseUrl]: 服务器地址（可选，默认 http://localhost:18080）
  /// [httpService]: HTTP服务（可选，用于自定义HTTP客户端）
  /// 
  /// 内部自动创建和管理整个依赖链：
  /// client模式: IAiBoxService -> AiBoxClientModeService -> AiProxyAdapter -> AiBoxService -> IHttpService
  /// server模式: IAiBoxService -> AiBoxServerModeService
  static IAiBoxService getService({
    AiBoxMode mode = AiBoxMode.client,
    String? baseUrl,
    HttpServiceImpl? httpService,
  }) {
    switch (mode) {
      case AiBoxMode.client:
        // 构建完整的依赖链，对外完全隐藏实现细节
        final http = httpService ?? HttpServiceImpl(
          baseUrl: baseUrl ?? 'http://localhost:18080',
        );
        final frameService = frame.AiBoxService(httpService: http);
        final adapter = AiProxyAdapter(frameService);
        return AiBoxClientModeService(adapter);
      case AiBoxMode.server:
        // Server mode 可能需要不同的依赖，例如一个 http client
        // throw UnimplementedError('Server mode is not implemented yet.');
        return AiBoxServerModeService();
    }
  }

  /// 创建AI Box门面服务（包含provider管理、模型管理、聊天功能）
  static AiBoxFacadeService createFacadeService() {
    return AiBoxFacadeService();
  }
}