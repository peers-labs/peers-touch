import 'dart:convert';

import 'package:get/get.dart';
import 'package:peers_touch_base/ai_proxy/provider/template/template_factory.dart';
import 'package:peers_touch_base/ai_proxy/service/ai_box_facade_service.dart';
import 'package:peers_touch_base/model/domain/ai_box/provider.pb.dart';
import 'package:peers_touch_base/model/google/protobuf/timestamp.pb.dart';

/// AI服务提供商管理服务
class ProviderService extends GetxService {

  ProviderService({AiBoxFacadeService? aiBoxFacadeService})
      : _aiBoxFacadeService = aiBoxFacadeService ?? Get.find();
  late final AiBoxFacadeService _aiBoxFacadeService;

  /// 获取所有提供商
  Future<List<Provider>> getProviders() async {
    try {
      return await _aiBoxFacadeService.getProviders();
    } catch (e) {
      return [];
    }
  }

  /// 创建提供商
  Future<void> createProvider(Provider provider) async {
    try {
      await _aiBoxFacadeService.createProvider(provider);
    } catch (e) {
      throw Exception('Failed to create provider: $e');
    }
  }

  /// 更新提供商
  Future<void> updateProvider(Provider provider) async {
    try {
      await _aiBoxFacadeService.updateProvider(provider);
    } catch (e) {
      throw Exception('Failed to update provider: $e');
    }
  }

  /// 获取当前提供商
  Future<Provider?> getCurrentProvider() async {
    try {
      return await _aiBoxFacadeService.getCurrentProvider();
    } catch (e) {
      return null;
    }
  }

  /// 删除提供商
  Future<void> deleteProvider(String providerId) async {
    try {
      await _aiBoxFacadeService.deleteProvider(providerId);
    } catch (e) {
      throw Exception('Failed to delete provider: $e');
    }
  }

  /// 设置当前提供商
  Future<void> setCurrentProvider(String providerId) async {
    try {
      await _aiBoxFacadeService.setCurrentProvider(providerId);
    } catch (e) {
      throw Exception('Failed to set current provider: $e');
    }
  }

  /// 获取会话级当前提供商
  Future<Provider?> getCurrentProviderForSession(String sessionId) async {
    try {
      return await _aiBoxFacadeService.getCurrentProviderForSession(sessionId);
    } catch (e) {
      return null;
    }
  }

  /// 设置会话级当前提供商
  Future<void> setCurrentProviderForSession(String sessionId, String providerId) async {
    try {
      await _aiBoxFacadeService.setCurrentProviderForSession(sessionId, providerId);
    } catch (e) {
      throw Exception('Failed to set session current provider: $e');
    }
  }

  /// 测试提供商连接
  Future<bool> testProviderConnection(Provider provider) async {
    try {
      // 使用模板，确保默认值已应用
      final template = AIProviderTemplateFactory.fromProvider(provider);
      final withDefaults = template.applyDefaults(provider);
      // 先更新远端配置，确保 settingsJson 中的 apiKey/proxyUrl 生效
      await _aiBoxFacadeService.updateProvider(withDefaults);
      return await _aiBoxFacadeService.testProviderConnection(withDefaults.id);
    } catch (e) {
      return false;
    }
  }

  /// 获取提供商的模型列表
  Future<List<String>> fetchProviderModels(Provider provider) async {
    try {
      final template = AIProviderTemplateFactory.fromProvider(provider);
      final withDefaults = template.applyDefaults(provider);
      // 确保配置已更新到服务端
      await _aiBoxFacadeService.updateProvider(withDefaults);
      return await _aiBoxFacadeService.getProviderModels(withDefaults.id);
    } catch (e) {
      return [];
    }
  }

  /// 创建默认提供商
  Provider createDefaultProvider({
    required String id,
    required String name,
    required String sourceType,
    required String peersUserId,
  }) {
    final now = DateTime.now().toUtc();

    return Provider(
      id: id,
      name: name,
      peersUserId: peersUserId,
      sort: 0,
      enabled: true,
      sourceType: sourceType,
      checkModel: _getDefaultModels(sourceType).first,
      settingsJson: jsonEncode({
        'baseUrl': _getDefaultBaseUrl(sourceType),
        'proxyUrl': _getDefaultBaseUrl(sourceType),
        'defaultProxyUrl': _getDefaultBaseUrl(sourceType),
        'models': _getDefaultModels(sourceType),
        'apiKey': '',
        'requestFormat': sourceType.toLowerCase(),
      }),
      configJson: jsonEncode({
        'temperature': 0.7,
        'maxTokens': 2048,
        'topP': 1.0,
        'frequencyPenalty': 0.0,
        'presencePenalty': 0.0,
      }),
      accessedAt: Timestamp.fromDateTime(now),
      createdAt: Timestamp.fromDateTime(now),
      updatedAt: Timestamp.fromDateTime(now),
    );
  }

  /// 获取默认基础URL
  String _getDefaultBaseUrl(String sourceType) {
    switch (sourceType.toLowerCase()) {
      case 'openai':
        return 'https://api.openai.com/v1';
      case 'ollama':
        return 'http://localhost:11434';
      case 'anthropic':
        return 'https://api.anthropic.com';
      case 'google':
        return 'https://generativelanguage.googleapis.com';
      default:
        return 'https://api.openai.com/v1';
    }
  }

  /// 获取默认模型列表
  List<String> _getDefaultModels(String sourceType) {
    switch (sourceType.toLowerCase()) {
      case 'openai':
        return ['gpt-3.5-turbo', 'gpt-4', 'gpt-4-turbo'];
      case 'ollama':
        return ['llama2', 'mistral', 'codellama'];
      case 'anthropic':
        return ['claude-3-sonnet', 'claude-3-opus'];
      case 'google':
        return ['gemini-pro', 'gemini-pro-vision'];
      default:
        return ['gpt-3.5-turbo'];
    }
  }
}
