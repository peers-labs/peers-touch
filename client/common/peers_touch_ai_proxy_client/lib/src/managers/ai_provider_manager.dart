import 'dart:async';

import '../interfaces/ai_provider_interface.dart';
import '../models/chat_models.dart';
import '../models/provider_config.dart';
import '../providers/openai_client.dart';
import '../providers/ollama_client.dart';

/// AI 提供商管理器
class AIProviderManager {
  final Map<String, AIProvider> _providers = {};
  String? _defaultProviderId;

  /// 注册提供商
  void registerProvider(String id, AIProvider provider) {
    _providers[id] = provider;
    
    // 如果没有默认提供商，设置第一个注册的为默认
    if (_defaultProviderId == null) {
      _defaultProviderId = id;
    }
  }

  /// 创建并注册 OpenAI 提供商
  void registerOpenAIProvider({
    required String id,
    required String name,
    required String baseUrl,
    String? apiKey,
    Map<String, dynamic>? headers,
    Map<String, dynamic>? parameters,
    bool enabled = true,
    int timeout = 30000,
    int maxRetries = 3,
  }) {
    final config = ProviderConfig(
      id: id,
      type: AIProviderType.openai,
      name: name,
      baseUrl: baseUrl,
      apiKey: apiKey,
      headers: headers,
      parameters: parameters,
      enabled: enabled,
      timeout: timeout,
      maxRetries: maxRetries,
    );

    final provider = OpenAIClient(config);
    registerProvider(id, provider);
  }

  /// 创建并注册 Ollama 提供商
  void registerOllamaProvider({
    required String id,
    required String name,
    required String baseUrl,
    Map<String, dynamic>? headers,
    Map<String, dynamic>? parameters,
    bool enabled = true,
    int timeout = 30000,
    int maxRetries = 3,
  }) {
    final config = ProviderConfig(
      id: id,
      type: AIProviderType.ollama,
      name: name,
      baseUrl: baseUrl,
      headers: headers,
      parameters: parameters,
      enabled: enabled,
      timeout: timeout,
      maxRetries: maxRetries,
    );

    final provider = OllamaClient(config);
    registerProvider(id, provider);
  }

  /// 获取提供商
  AIProvider? getProvider(String id) {
    return _providers[id];
  }

  /// 获取所有提供商
  Map<String, AIProvider> get providers => Map.unmodifiable(_providers);

  /// 获取启用的提供商
  Map<String, AIProvider> get enabledProviders {
    return Map.unmodifiable(
      _providers..removeWhere((id, provider) => !provider.config.enabled),
    );
  }

  /// 设置默认提供商
  void setDefaultProvider(String id) {
    if (_providers.containsKey(id)) {
      _defaultProviderId = id;
    } else {
      throw ArgumentError('Provider with id $id not found');
    }
  }

  /// 获取默认提供商
  AIProvider? get defaultProvider {
    if (_defaultProviderId != null) {
      return _providers[_defaultProviderId];
    }
    return null;
  }

  /// 检查提供商连接状态
  Future<Map<String, bool>> checkAllConnections() async {
    final results = <String, bool>{};
    
    for (final entry in _providers.entries) {
      try {
        final isConnected = await entry.value.checkConnection();
        results[entry.key] = isConnected;
      } catch (e) {
        results[entry.key] = false;
      }
    }
    
    return results;
  }

  /// 获取所有可用模型
  Future<Map<String, List<ModelInfo>>> getAllModels() async {
    final results = <String, List<ModelInfo>>{};
    
    for (final entry in _providers.entries) {
      try {
        final models = await entry.value.listModels();
        results[entry.key] = models;
      } catch (e) {
        results[entry.key] = [];
      }
    }
    
    return results;
  }

  /// 使用指定提供商进行聊天补全
  Future<ChatCompletionResponse> chatCompletionWithProvider(
    String providerId,
    ChatCompletionRequest request,
  ) async {
    final provider = _providers[providerId];
    if (provider == null) {
      throw ArgumentError('Provider with id $providerId not found');
    }
    
    if (!provider.config.enabled) {
      throw AIProviderException(
        type: AIProviderErrorType.invalidRequest,
        message: 'Provider $providerId is disabled',
      );
    }
    
    return await provider.chatCompletion(request);
  }

  /// 使用默认提供商进行聊天补全
  Future<ChatCompletionResponse> chatCompletion(ChatCompletionRequest request) async {
    final provider = defaultProvider;
    if (provider == null) {
      throw StateError('No default provider set');
    }
    
    return await chatCompletionWithProvider(_defaultProviderId!, request);
  }

  /// 流式聊天补全
  Stream<ChatCompletionResponse> chatCompletionStreamWithProvider(
    String providerId,
    ChatCompletionRequest request,
  ) {
    final provider = _providers[providerId];
    if (provider == null) {
      throw ArgumentError('Provider with id $providerId not found');
    }
    
    if (!provider.config.enabled) {
      throw AIProviderException(
        type: AIProviderErrorType.invalidRequest,
        message: 'Provider $providerId is disabled',
      );
    }
    
    return provider.chatCompletionStream(request);
  }

  /// 使用默认提供商进行流式聊天补全
  Stream<ChatCompletionResponse> chatCompletionStream(ChatCompletionRequest request) {
    final provider = defaultProvider;
    if (provider == null) {
      throw StateError('No default provider set');
    }
    
    return chatCompletionStreamWithProvider(_defaultProviderId!, request);
  }

  /// 智能选择提供商（基于模型可用性、延迟等）
  Future<String?> selectOptimalProvider({
    required String model,
    int? maxTokens,
    bool? requireStream,
  }) async {
    // 简单的实现：按优先级选择第一个可用的提供商
    for (final entry in _providers.entries) {
      if (entry.value.config.enabled) {
        try {
          final isConnected = await entry.value.checkConnection();
          if (isConnected) {
            return entry.key;
          }
        } catch (e) {
          // 忽略连接检查错误
        }
      }
    }
    
    return null;
  }

  /// 更新提供商配置
  void updateProviderConfig(String providerId, ProviderConfig newConfig) {
    final provider = _providers[providerId];
    if (provider == null) {
      throw ArgumentError('Provider with id $providerId not found');
    }
    
    provider.updateConfig(newConfig);
  }

  /// 启用/禁用提供商
  void setProviderEnabled(String providerId, bool enabled) {
    final provider = _providers[providerId];
    if (provider == null) {
      throw ArgumentError('Provider with id $providerId not found');
    }
    
    final newConfig = ProviderConfig(
      id: provider.config.id,
      type: provider.config.type,
      name: provider.config.name,
      baseUrl: provider.config.baseUrl,
      apiKey: provider.config.apiKey,
      headers: provider.config.headers,
      parameters: provider.config.parameters,
      enabled: enabled,
      timeout: provider.config.timeout,
      maxRetries: provider.config.maxRetries,
    );
    
    provider.updateConfig(newConfig);
  }

  /// 关闭所有提供商连接
  Future<void> closeAll() async {
    for (final provider in _providers.values) {
      try {
        await provider.close();
      } catch (e) {
        // 忽略关闭错误
      }
    }
    _providers.clear();
    _defaultProviderId = null;
  }
}