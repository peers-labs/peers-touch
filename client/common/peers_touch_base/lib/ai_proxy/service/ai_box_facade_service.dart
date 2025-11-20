import 'dart:async';
import 'dart:convert';
import 'package:dio/dio.dart';
import 'package:peers_touch_base/model/domain/ai_box/provider.pb.dart';
import 'package:peers_touch_base/model/domain/ai_box/chat.pb.dart';
import 'package:peers_touch_base/network/dio/peers_frame/service/ai_box_service.dart';
import 'package:peers_touch_base/network/dio/http_service_impl.dart';
import 'package:peers_touch_base/network/dio/http_service_locator.dart';
import 'ai_box_service_factory.dart';
import 'ai_box_local_storage_service.dart';
import '../provider/provider_manager.dart';

/// AI Box门面服务 - 为上层应用提供统一的AI服务接口
/// 封装了provider管理、模型管理、聊天功能等所有AI相关操作
class AiBoxFacadeService {
  final ProviderManager _providerManager;
  
  AiBoxFacadeService({ProviderManager? providerManager}) 
      : _providerManager = providerManager ?? ProviderManager(
          aiBoxService: AiBoxService(httpService: HttpServiceImpl(baseUrl: 'http://localhost:18080')),
          localStorage: AiBoxLocalStorageService(),
        );

  /// Provider管理相关接口
  
  /// 获取所有提供商
  Future<List<Provider>> getProviders() async {
    return await _providerManager.listProviders();
  }

  /// 获取单个提供商
  Future<Provider?> getProvider(String providerId) async {
    return await _providerManager.getProvider(providerId);
  }

  /// 创建提供商
  Future<void> createProvider(Provider provider) async {
    await _providerManager.createProvider(provider);
  }

  /// 更新提供商
  Future<void> updateProvider(Provider provider) async {
    await _providerManager.updateProvider(provider);
  }

  /// 删除提供商
  Future<void> deleteProvider(String providerId) async {
    await _providerManager.deleteProvider(providerId);
  }

  /// 获取默认提供商
  Future<Provider?> getDefaultProvider() async {
    return await _providerManager.getDefaultProvider();
  }

  /// 设置默认提供商
  Future<void> setDefaultProvider(String providerId) async {
    await _providerManager.setDefaultProvider(providerId);
  }

  /// 模型管理相关接口
  
  /// 获取提供商的模型列表
  Future<List<String>> getProviderModels(String providerId) async {
    final provider = await getProvider(providerId);
    if (provider == null) {
      throw Exception('Provider not found: $providerId');
    }
    
    // 使用AiBoxServiceFactory获取服务并拉取模型列表
    final aiService = AiBoxServiceFactory.getService();
    return await aiService.getModels(providerId);
  }

  /// 测试提供商连接
  Future<bool> testProviderConnection(String providerId) async {
    final provider = await getProvider(providerId);
    if (provider == null) {
      return false;
    }
    
    try {
      // 从provider配置中提取URL
      final configJson = provider.configJson;
      if (configJson.isEmpty) {
        return false;
      }
      
      final config = jsonDecode(configJson);
      final baseUrl = config['base_url'] ?? config['baseUrl'] ?? '';
      
      if (baseUrl.isEmpty) {
        return false;
      }
      
      // 使用HttpServiceLocator创建临时的HTTP服务
      final httpServiceLocator = HttpServiceLocator();
      
      // 为当前提供商初始化HTTP服务
      httpServiceLocator.initialize(baseUrl: baseUrl);
      
      // 使用Dio直接创建新实例，因为需要自定义认证头
      final dio = Dio(
        BaseOptions(
          baseUrl: baseUrl,
          connectTimeout: const Duration(seconds: 10),
          receiveTimeout: const Duration(seconds: 10),
        ),
      );
      
      // 构建获取模型列表的URL
      final modelsUrl = '/models';
      
      // 添加API密钥到请求头
      final headers = <String, dynamic>{};
      if (config.containsKey('api_key') && config['api_key'].isNotEmpty) {
        headers['Authorization'] = 'Bearer ${config['api_key']}';
      }
      
      final response = await dio.get(
        modelsUrl,
        options: Options(
          headers: headers,
        ),
      );
      
      // 检查响应内容
      if (response.statusCode == 200 && response.data != null) {
        // 尝试解析模型列表
        final data = response.data;
        if (data is Map && data.containsKey('data')) {
          final models = data['data'] as List;
          return models.isNotEmpty; // 如果有模型返回，认为连接成功
        } else if (data is List) {
          return data.isNotEmpty; // 如果直接返回模型列表，也认为成功
        }
        return true; // 只要有响应数据，就认为连接成功
      }
      
      return false;
    } catch (e) {
      // 任何异常都认为连接失败
      return false;
    }
  }

  /// 聊天功能相关接口
  
  /// 发送消息（流式响应）
  Stream<ChatCompletionResponse> sendMessageStream({
    required String providerId,
    required String message,
    String? model,
    double? temperature,
    List<Map<String, dynamic>>? openAIContent,
    List<String>? imagesBase64,
  }) {
    final aiService = AiBoxServiceFactory.getService();
    
    // 构建聊天请求
    final request = ChatCompletionRequest(
      model: model ?? '',
      messages: [
        ChatMessage(
          role: ChatRole.CHAT_ROLE_USER,
          content: message,
        ),
      ],
      temperature: temperature ?? 0.7,
      stream: true,
    );
    
    return aiService.chat(request);
  }

  /// 发送消息（非流式响应）
  Future<ChatCompletionResponse> sendMessage({
    required String providerId,
    required String message,
    String? model,
    double? temperature,
    List<Map<String, dynamic>>? openAIContent,
    List<String>? imagesBase64,
  }) async {
    final aiService = AiBoxServiceFactory.getService();
    
    // 构建聊天请求
    final request = ChatCompletionRequest(
      model: model ?? '',
      messages: [
        ChatMessage(
          role: ChatRole.CHAT_ROLE_USER,
          content: message,
        ),
      ],
      temperature: temperature ?? 0.7,
      stream: false,
    );
    
    return await aiService.chatSync(request);
  }

  /// 获取当前提供商（带缓存逻辑）
  Future<Provider?> getCurrentProvider() async {
    // 先尝试获取默认提供商
    final defaultProvider = await getDefaultProvider();
    if (defaultProvider != null) {
      return defaultProvider;
    }

    // 如果没有默认提供商，返回第一个启用的提供商
    final providers = await getProviders();
    return providers.firstWhere(
      (p) => p.enabled,
      orElse: () => providers.isNotEmpty ? providers.first : throw Exception('No provider found'),
    );
  }
}