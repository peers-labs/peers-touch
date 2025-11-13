import 'dart:convert';
import 'dart:io';
import 'package:yaml/yaml.dart';

import '../models/provider_config.dart';

/// 配置加载器
class ConfigLoader {
  /// 从YAML文件加载配置
  static Map<String, dynamic> loadFromYaml(String filePath) {
    try {
      final file = File(filePath);
      if (!file.existsSync()) {
        throw Exception('配置文件不存在: $filePath');
      }
      
      final content = file.readAsStringSync();
      final yamlMap = loadYaml(content);
      
      // 将YAML转换为Map
      return _yamlToMap(yamlMap);
    } catch (e) {
      throw Exception('加载配置文件失败: $e');
    }
  }

  /// 将YAML对象转换为Map
  static dynamic _yamlToMap(dynamic yaml) {
    if (yaml is YamlMap) {
      final map = <String, dynamic>{};
      yaml.nodes.forEach((key, value) {
        map[key.toString()] = _yamlToMap(value);
      });
      return map;
    } else if (yaml is YamlList) {
      return yaml.map((item) => _yamlToMap(item)).toList();
    } else {
      return yaml;
    }
  }

  /// 从配置Map创建ProviderConfig列表
  static List<ProviderConfig> parseProviderConfigs(Map<String, dynamic> configMap) {
    final providers = <ProviderConfig>[];
    
    // 遍历配置中的每个服务
    configMap.forEach((serviceName, serviceConfig) {
      if (serviceConfig is Map<String, dynamic>) {
        serviceConfig.forEach((modelKey, modelConfig) {
          if (modelConfig is Map<String, dynamic>) {
            modelConfig.forEach((modelName, modelDetails) {
              if (modelDetails is Map<String, dynamic>) {
                try {
                  final provider = _createProviderConfig(
                    serviceName: serviceName,
                    modelKey: modelKey,
                    modelName: modelName,
                    config: modelDetails,
                  );
                  providers.add(provider);
                } catch (e) {
                  print('解析配置失败: $serviceName.$modelKey.$modelName - $e');
                }
              }
            });
          }
        });
      }
    });
    
    return providers;
  }

  /// 创建单个ProviderConfig
  static ProviderConfig _createProviderConfig({
    required String serviceName,
    required String modelKey,
    required String modelName,
    required Map<String, dynamic> config,
  }) {
    final protocol = config['protocol']?.toString() ?? 'openai';
    final baseUrl = config['proxy_url']?.toString() ?? '';
    final apiKey = config['api_key']?.toString();
    final displayName = config['display']?.toString() ?? modelName;
    
    // 确定提供商类型
    final providerType = _getProviderType(protocol);
    
    // 生成唯一ID
    final id = '${serviceName}_${modelKey}_${modelName}';
    
    return ProviderConfig(
      id: id,
      type: providerType,
      name: displayName,
      baseUrl: baseUrl,
      apiKey: apiKey,
      headers: _createHeaders(protocol, apiKey),
      enabled: true,
      timeout: 30000,
      maxRetries: 3,
    );
  }

  /// 根据协议确定提供商类型
  static AIProviderType _getProviderType(String protocol) {
    switch (protocol.toLowerCase()) {
      case 'openai':
        return AIProviderType.openai;
      case 'ollama':
        return AIProviderType.ollama;
      default:
        return AIProviderType.openai; // 默认为OpenAI
    }
  }

  /// 创建请求头
  static Map<String, dynamic>? _createHeaders(String protocol, String? apiKey) {
    final headers = <String, dynamic>{
      'Content-Type': 'application/json',
    };
    
    if (apiKey != null && apiKey.isNotEmpty) {
      if (protocol.toLowerCase() == 'openai') {
        headers['Authorization'] = 'Bearer $apiKey';
      } else {
        headers['Authorization'] = 'Bearer $apiKey';
      }
    }
    
    return headers;
  }
}