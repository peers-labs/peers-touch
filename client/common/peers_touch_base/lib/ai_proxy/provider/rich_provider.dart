import 'dart:convert';

import 'package:peers_touch_base/ai_proxy/client/chat_client.dart';
import 'package:peers_touch_base/ai_proxy/client/openai/openai_chat_client.dart';
import 'package:peers_touch_base/ai_proxy/model/rich_model.dart';
import 'package:peers_touch_base/model/domain/ai_box/provider.pb.dart' as pb;
import 'package:peers_touch_base/model/exception/provider_exceptions.dart';

typedef ChatClientCreator = ChatClient Function(
    {required RichModel model, required String apiKey});

final Map<String, ChatClientCreator> _clientRegistry = {
  'openai': ({required model, required apiKey}) =>
      OpenAiChatClient(apiKey: apiKey),
};

List<RichModel> parseModelsFromJson(String json, String providerId) {
  if (json.isEmpty) return [];
  try {
    final config = jsonDecode(json);
    final modelsData = config['models'] as List<dynamic>? ?? [];

    return modelsData.map((modelData) {
      final capabilitiesData =
          (modelData['capabilities'] as List<dynamic>? ?? []).map((e) => e.toString()).toSet();
      return RichModel(
        id: modelData['id'] ?? '',
        providerId: providerId,
        name: modelData['name'] ?? '',
        description: modelData['description'] ?? '',
        capabilities: capabilitiesData,
      );
    }).toList();
  } catch (e) {
    // 使用异常而不是print，让调用者决定如何处理
    throw InvalidModelsException(
      '解析模型配置失败: $e',
      providerId: providerId,
    );
  }
}

String parseApiKey(String settingsJson) {
  if (settingsJson.isEmpty) return '';
  try {
    final settings = jsonDecode(settingsJson);
    return settings['apiKey'] ?? '';
  } catch (e) {
    // 返回空字符串而不是抛出异常，允许没有API密钥的情况
    return '';
  }
}

class RichProvider {

  RichProvider(this._rawProvider)
      : models = parseModelsFromJson(_rawProvider.configJson, _rawProvider.id),
        _apiKey = parseApiKey(_rawProvider.settingsJson) {
    _validateConfiguration();
  }
  final pb.Provider _rawProvider;
  final List<RichModel> models;
  final String _apiKey;

  /// 验证Provider配置
  void _validateConfiguration() {
    if (_rawProvider.id.isEmpty) {
      throw InvalidProviderConfigException('Provider ID不能为空', providerId: id);
    }

    if (_rawProvider.name.isEmpty) {
      throw InvalidProviderConfigException('Provider名称不能为空', providerId: id);
    }

    if (_rawProvider.sourceType.isEmpty) {
      throw InvalidProviderConfigException('Provider类型不能为空', providerId: id);
    }

    if (!_isValidJson(_rawProvider.configJson)) {
      throw InvalidProviderConfigException('配置JSON格式无效', providerId: id);
    }

    if (!_isValidJson(_rawProvider.settingsJson)) {
      throw InvalidProviderConfigException('设置JSON格式无效', providerId: id);
    }
  }

  /// 检查Provider是否有效
  bool _isValidProvider() {
    if (_rawProvider.id.isEmpty || _rawProvider.name.isEmpty) {
      return false;
    }

    if (_rawProvider.sourceType.isEmpty) {
      return false;
    }

    if (!_isValidJson(_rawProvider.configJson) || !_isValidJson(_rawProvider.settingsJson)) {
      return false;
    }

    return true;
  }

  /// 验证JSON格式
  bool _isValidJson(String jsonString) {
    if (jsonString.isEmpty) return true; // 空JSON认为是有效的
    
    try {
      jsonDecode(jsonString);
      return true;
    } catch (e) {
      return false;
    }
  }

  String get id => _rawProvider.id;

  String get name => _rawProvider.name;

  String get logoUrl => _rawProvider.logo;

  /// 是否有效 - 充血模型的核心属性
  bool get isValid => _isValidProvider();

  /// 是否有可用模型
  bool get hasAvailableModels => models.isNotEmpty;

  /// 是否支持指定模型
  bool supportsModel(String modelId) => models.any((m) => m.id == modelId);

  /// 获取默认模型
  RichModel? get defaultModel => models.isNotEmpty ? models.first : null;

  /// 获取支持特定功能的模型列表
  List<RichModel> getModelsByCapability(String capability) =>
      models.where((m) => m.supportsCapability(capability)).toList();

  /// 获取支持的模型ID列表
  List<String> getSupportedModels() {
    return models.map((m) => m.id).toList();
  }

  /// 测试连接（简单实现，实际应该调用具体的API测试）
  Future<bool> testConnection() async {
    // 简单的实现：检查是否有API密钥和有效模型
    if (_apiKey.isEmpty) {
      return false;
    }
    
    if (!isValid || !hasAvailableModels) {
      return false;
    }
    
    // 这里可以添加实际的API调用测试
    // 暂时返回true，表示配置看起来是有效的
    return true;
  }

  ChatClient createChatClient(String modelId) {
    if (!isValid) {
      throw InvalidProviderConfigException('Provider配置无效', providerId: id);
    }

    if (_apiKey.isEmpty) {
      throw InvalidApiKeyException('API密钥未配置或无效', providerId: id);
    }

    final model = models.firstWhere(
      (m) => m.id == modelId,
      orElse: () => throw InvalidModelsException('模型不存在: $modelId', providerId: id),
    );

    final creator = _clientRegistry[id];
    if (creator == null) {
      throw UnsupportedOperationException('Provider "$id" 不支持客户端聊天', providerId: id);
    }

    try {
      return creator(model: model, apiKey: _apiKey);
    } catch (e) {
      throw ClientCreationException(
        '创建聊天客户端失败',
        providerId: id,
        originalError: e,
      );
    }
  }

  static List<RichModel> _parseModelsFromJson(String json, String providerId) {
    if (json.isEmpty) return [];
    try {
      final config = jsonDecode(json);
      final modelsData = config['models'] as List<dynamic>? ?? [];

      return modelsData.map((modelData) {
        final capabilitiesData =
            (modelData['capabilities'] as List<dynamic>? ?? []).map((e) => e.toString()).toSet();
        return RichModel(
          id: modelData['id'] ?? '',
          providerId: providerId,
          name: modelData['name'] ?? '',
          description: modelData['description'] ?? '',
          capabilities: capabilitiesData,
        );
      }).toList();
    } catch (e) {
      // 使用异常而不是print，让调用者决定如何处理
      throw InvalidModelsException(
        '解析模型配置失败: $e',
        providerId: providerId,
      );
    }
  }

  static String _parseApiKey(String settingsJson) {
    if (settingsJson.isEmpty) return '';
    try {
      final settings = jsonDecode(settingsJson);
      return settings['apiKey'] ?? '';
    } catch (e) {
      // 返回空字符串而不是抛出异常，允许没有API密钥的情况
      return '';
    }
  }
}