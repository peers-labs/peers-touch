import 'dart:convert';
import 'dart:async';

import '../interfaces/ai_provider_interface.dart';
import 'package:peers_touch_base/model/domain/ai_box/chat.pb.dart';
import 'package:peers_touch_base/model/domain/ai_box/ai_models.pb.dart';
import 'package:peers_touch_base/model/domain/ai_box/provider.pb.dart';
import '../models/provider_config.dart';
import '../providers/openai_client.dart';
import '../providers/ollama_client.dart';
import '../providers/deepseek_client.dart';
import 'package:peers_touch_base/storage/secure_storage.dart';
import 'package:crypto/crypto.dart';
import 'package:convert/convert.dart';

/// AI 提供商管理器
class AIProviderManager {
  final Map<String, AIProvider> _providers = {};
  String? _defaultProviderId;
  final SecureStorageService _secureStorage;

  AIProviderManager() : _secureStorage = SecureStorageService();

  /// 简单的加密工具
  String _encryptString(String plainText) {
    // 使用简单的异或加密，生产环境应该使用更安全的加密方式
    final key = 'peers_touch_ai_provider_key_2024';
    final bytes = utf8.encode(plainText);
    final keyBytes = utf8.encode(key);
    final encrypted = bytes.map((byte) => byte ^ keyBytes[byte % keyBytes.length]).toList();
    return base64.encode(encrypted);
  }

  /// 简单的解密工具
  String _decryptString(String encryptedText) {
    final key = 'peers_touch_ai_provider_key_2024';
    final encrypted = base64.decode(encryptedText);
    final keyBytes = utf8.encode(key);
    final decrypted = encrypted.map((byte) => byte ^ keyBytes[byte % keyBytes.length]).toList();
    return utf8.decode(decrypted);
  }

  /// 保存加密的 keyVaults 数据
  Future<void> _saveKeyVaults(String providerId, Map<String, String> keyVaults) async {
    final encryptedData = _encryptString(jsonEncode(keyVaults));
    await _secureStorage.set('ai_provider_keyvaults_$providerId', encryptedData);
  }

  /// 获取解密的 keyVaults 数据
  Future<Map<String, String>?> _getKeyVaults(String providerId) async {
    final encryptedData = await _secureStorage.get('ai_provider_keyvaults_$providerId');
    if (encryptedData == null) return null;
    
    try {
      final decryptedData = _decryptString(encryptedData);
      final Map<String, dynamic> decoded = jsonDecode(decryptedData);
      return decoded.map((key, value) => MapEntry(key, value.toString()));
    } catch (e) {
      return null;
    }
  }

  /// 注册提供商
  void registerProvider(String id, AIProvider provider) {
    _providers[id] = provider;
    
    // 如果没有默认提供商，设置第一个注册的为默认
    _defaultProviderId ??= id;
  }

  /// 创建并注册 OpenAI 提供商
  Future<void> registerOpenAIProvider({
    required String id,
    required String name,
    required String baseUrl,
    String? apiKey,
    Map<String, dynamic>? headers,
    Map<String, dynamic>? config,
    Map<String, String>? keyVaults, // 存储加密的敏感数据
    Map<String, dynamic>? settings, // 提供商元数据，如 {"sdkType": "openai"}
    bool enabled = true,
    int timeout = 30000,
    int maxRetries = 3,
  }) async {
    // 保存加密的 keyVaults
    if (keyVaults != null) {
      await _saveKeyVaults(id, keyVaults);
    }

    // 构建 settings，确保包含 sdkType
    final providerSettings = settings ?? {};
    providerSettings['sdkType'] = 'openai';

    final providerConfig = ProviderConfig(
      id: id,
      type: AIProviderType.openai,
      name: name,
      baseUrl: baseUrl,
      apiKey: apiKey,
      headers: headers,
      parameters: config,
      enabled: enabled,
      timeout: timeout,
      maxRetries: maxRetries,
    );

    // 设置 settings 和 config
    providerConfig.settings = jsonEncode(providerSettings);
    providerConfig.config = jsonEncode(config ?? {});

    final provider = OpenAIClient(providerConfig);
    registerProvider(id, provider);
  }

  /// 创建并注册 Ollama 提供商
  Future<void> registerOllamaProvider({
    required String id,
    required String name,
    required String baseUrl,
    Map<String, dynamic>? headers,
    Map<String, dynamic>? config,
    Map<String, String>? keyVaults, // 存储加密的敏感数据
    Map<String, dynamic>? settings, // 提供商元数据，如 {"sdkType": "ollama"}
    bool enabled = true,
    int timeout = 30000,
    int maxRetries = 3,
  }) async {
    // 保存加密的 keyVaults
    if (keyVaults != null) {
      await _saveKeyVaults(id, keyVaults);
    }

    // 构建 settings，确保包含 sdkType
    final providerSettings = settings ?? {};
    providerSettings['sdkType'] = 'ollama';

    final providerConfig = ProviderConfig(
      id: id,
      type: AIProviderType.ollama,
      name: name,
      baseUrl: baseUrl,
      headers: headers,
      parameters: config,
      enabled: enabled,
      timeout: timeout,
      maxRetries: maxRetries,
      settings: jsonEncode(providerSettings),
      config: jsonEncode(config ?? {}),
    );

    final provider = OllamaClient(providerConfig);
    registerProvider(id, provider);
  }

  /// 创建并注册 DeepSeek 提供商
  Future<void> registerDeepSeekProvider({
    required String id,
    required String name,
    required String baseUrl,
    String? apiKey,
    Map<String, dynamic>? headers,
    Map<String, dynamic>? config,
    Map<String, String>? keyVaults, // 存储加密的敏感数据
    Map<String, dynamic>? settings, // 提供商元数据，如 {"sdkType": "deepseek"}
    bool enabled = true,
    int timeout = 30000,
    int maxRetries = 3,
  }) async {
    // 保存加密的 keyVaults
    if (keyVaults != null) {
      await _saveKeyVaults(id, keyVaults);
    }

    // 构建 settings，确保包含 sdkType
    final providerSettings = settings ?? {};
    providerSettings['sdkType'] = 'deepseek';

    final providerConfig = ProviderConfig(
      id: id,
      type: AIProviderType.deepseek,
      name: name,
      baseUrl: baseUrl,
      apiKey: apiKey,
      headers: headers,
      parameters: config,
      enabled: enabled,
      timeout: timeout,
      maxRetries: maxRetries,
    );

    // 设置 settings 和 config
    providerConfig.settings = jsonEncode(providerSettings);
    providerConfig.config = jsonEncode(config ?? {});

    final provider = DeepSeekClient(providerConfig);
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
      _providers..removeWhere((id, provider) => !provider.provider.enabled),
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
  Future<Map<String, List<AiModelInfo>>> getAllModels() async {
    final results = <String, List<AiModelInfo>>{};
    
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
    
    if (!provider.provider.enabled) {
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
    
    if (!provider.provider.enabled) {
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
      if (entry.value.provider.enabled) {
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

  /// 获取提供商的 keyVaults 数据（解密后）
  Future<Map<String, String>?> getProviderKeyVaults(String providerId) async {
    return await _getKeyVaults(providerId);
  }

  /// 获取提供商的 settings 数据（解析 JSON）
  Map<String, dynamic>? getProviderSettings(String providerId) {
    final provider = _providers[providerId];
    if (provider == null) return null;
    
    try {
      return jsonDecode(provider.provider.settingsJson);
    } catch (e) {
      return null;
    }
  }

  /// 获取提供商的 config 数据（解析 JSON）
  Map<String, dynamic>? getProviderConfig(String providerId) {
    final provider = _providers[providerId];
    if (provider == null) return null;
    
    try {
      return jsonDecode(provider.provider.configJson);
    } catch (e) {
      return null;
    }
  }

  /// 更新提供商的 settings
  Future<void> updateProviderSettings(String providerId, Map<String, dynamic> newSettings) async {
    final provider = _providers[providerId];
    if (provider == null) {
      throw ArgumentError('Provider with id $providerId not found');
    }
    
    final newConfig = Provider(
      id: provider.provider.id,
      name: provider.provider.name,
      sourceType: provider.provider.sourceType,
      enabled: provider.provider.enabled,
    );
    
    newConfig.settingsJson = jsonEncode(newSettings);
    newConfig.configJson = provider.provider.configJson;
    
    provider.updateConfig(newConfig);
  }

  /// 更新提供商的 config（运行时配置）
  Future<void> updateProviderConfig(String providerId, Map<String, dynamic> newConfig) async {
    final provider = _providers[providerId];
    if (provider == null) {
      throw ArgumentError('Provider with id $providerId not found');
    }
    
    final newProviderConfig = Provider(
      id: provider.provider.id,
      name: provider.provider.name,
      sourceType: provider.provider.sourceType,
      enabled: provider.provider.enabled,
    );
    
    newProviderConfig.settingsJson = provider.provider.settingsJson;
    newProviderConfig.configJson = jsonEncode(newConfig);
    
    provider.updateConfig(newProviderConfig);
  }

  /// 更新提供商的 keyVaults（加密的敏感数据）
  Future<void> updateProviderKeyVaults(String providerId, Map<String, String> newKeyVaults) async {
    await _saveKeyVaults(providerId, newKeyVaults);
  }

  /// 启用/禁用提供商
  Future<void> setProviderEnabled(String providerId, bool enabled) async {
    final provider = _providers[providerId];
    if (provider == null) {
      throw ArgumentError('Provider with id $providerId not found');
    }
    
    // 保持现有的 settings 和 config
    final newConfig = Provider(
      id: provider.provider.id,
      name: provider.provider.name,
      sourceType: provider.provider.sourceType,
      enabled: enabled,
    );
    
    // 保留原有的 settings 和 config
    newConfig.settingsJson = provider.provider.settingsJson;
    newConfig.configJson = provider.provider.configJson;
    
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

  /// 从 protobuf Provider 创建 AIProvider
  Future<AIProvider?> createProviderFromProtobuf(Provider protobufProvider) async {
    // 获取解密的 keyVaults
    final keyVaults = await getProviderKeyVaults(protobufProvider.id);
    
    // 解析 settings
    Map<String, dynamic> settings = {};
    try {
      if (protobufProvider.settings.isNotEmpty) {
        settings = jsonDecode(protobufProvider.settings);
      }
    } catch (e) {
      settings = {};
    }
    
    // 解析 config
    Map<String, dynamic> config = {};
    try {
      if (protobufProvider.config.isNotEmpty) {
        config = jsonDecode(protobufProvider.config);
      }
    } catch (e) {
      config = {};
    }
    
    // 根据 settings 中的 sdkType 创建对应的提供商
    final sdkType = settings['sdkType'] as String?;
    
    switch (sdkType) {
      case 'openai':
        await registerOpenAIProvider(
          id: protobufProvider.id,
          name: protobufProvider.name,
          baseUrl: protobufProvider.baseUrl,
          apiKey: protobufProvider.apiKey,
          headers: protobufProvider.headers.isNotEmpty 
              ? jsonDecode(protobufProvider.headers) as Map<String, dynamic>
              : null,
          config: config,
          keyVaults: keyVaults,
          settings: settings,
          enabled: protobufProvider.enabled,
          timeout: protobufProvider.timeout.toInt(),
          maxRetries: protobufProvider.maxRetries.toInt(),
        );
        return _providers[protobufProvider.id];
        
      case 'ollama':
        await registerOllamaProvider(
          id: protobufProvider.id,
          name: protobufProvider.name,
          baseUrl: protobufProvider.baseUrl,
          headers: protobufProvider.headers.isNotEmpty 
              ? jsonDecode(protobufProvider.headers) as Map<String, dynamic>
              : null,
          config: config,
          keyVaults: keyVaults,
          settings: settings,
          enabled: protobufProvider.enabled,
          timeout: protobufProvider.timeout.toInt(),
          maxRetries: protobufProvider.maxRetries.toInt(),
        );
        return _providers[protobufProvider.id];
        
      case 'deepseek':
        await registerDeepSeekProvider(
          id: protobufProvider.id,
          name: protobufProvider.name,
          baseUrl: protobufProvider.baseUrl,
          apiKey: protobufProvider.apiKey,
          headers: protobufProvider.headers.isNotEmpty 
              ? jsonDecode(protobufProvider.headers) as Map<String, dynamic>
              : null,
          config: config,
          keyVaults: keyVaults,
          settings: settings,
          enabled: protobufProvider.enabled,
          timeout: protobufProvider.timeout.toInt(),
          maxRetries: protobufProvider.maxRetries.toInt(),
        );
        return _providers[protobufProvider.id];
        
      default:
        return null;
    }
  }

  /// 将 AIProvider 转换为 protobuf Provider
  Provider createProtobufFromProvider(AIProvider aiProvider) {
    final settings = getProviderSettings(aiProvider.config.id) ?? {};
    final config = getProviderConfig(aiProvider.config.id) ?? {};
    
    final protobufProvider = Provider(
      id: aiProvider.config.id,
      name: aiProvider.config.name,
      type: aiProvider.config.type,
      baseUrl: aiProvider.config.baseUrl,
      apiKey: aiProvider.config.apiKey,
      enabled: aiProvider.config.enabled,
      timeout: aiProvider.config.timeout,
      maxRetries: aiProvider.config.maxRetries,
    );
    
    // 设置 JSON 字符串
    protobufProvider.settings = jsonEncode(settings);
    protobufProvider.config = jsonEncode(config);
    
    // 设置 headers（如果存在）
    if (aiProvider.config.headers != null) {
      protobufProvider.headers = jsonEncode(aiProvider.config.headers);
    }
    
    return protobufProvider;
  }
}