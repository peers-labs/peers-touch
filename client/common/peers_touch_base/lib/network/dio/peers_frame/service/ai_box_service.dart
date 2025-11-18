import 'dart:convert';
import 'package:peers_touch_base/model/domain/ai_box/provider.pb.dart';
import 'package:peers_touch_base/model/google/protobuf/timestamp.pb.dart';
import 'package:peers_touch_base/network/dio/http_service.dart';

/// AI Box Service - RPC风格客户端
/// 提供简单的RPC风格接口，底层基于dio客户端
class AiBoxService {
  final IHttpService _httpService;
  
  AiBoxService({required IHttpService httpService}) : _httpService = httpService;

  /// 创建Provider
  /// 使用ProviderInfo作为参数，简化调用
  Future<Provider> createProvider(Provider providerInfo) async {
    try {
      final response = await _httpService.post(
        '/api/v1/providers',
        data: {
          'name': providerInfo.name,
          'description': providerInfo.description,
          'logo': providerInfo.logo,
          'source_type': providerInfo.sourceType,
          'enabled': providerInfo.enabled,
          'check_model': providerInfo.checkModel,
          'config': jsonDecode(providerInfo.configJson),
          'settings': jsonDecode(providerInfo.settingsJson),
        },
      );
      
      return _parseProviderFromResponse(response);
    } catch (e) {
      throw Exception('Failed to create provider: $e');
    }
  }

  /// 获取Provider
  Future<Provider> getProvider(String id) async {
    try {
      final response = await _httpService.get('/api/v1/providers/$id');
      return _parseProviderFromResponse(response);
    } catch (e) {
      throw Exception('Failed to get provider: $e');
    }
  }

  /// 更新Provider
  /// 使用ProviderInfo作为参数
  Future<Provider> updateProvider(Provider providerInfo) async {
    try {
      final response = await _httpService.put(
        '/api/v1/providers/${providerInfo.id}',
        data: {
          'display_name': providerInfo.name,
          'description': providerInfo.description,
          'logo': providerInfo.logo,
          'enabled': providerInfo.enabled,
          'config': jsonDecode(providerInfo.configJson),
        },
      );
      
      return _parseProviderFromResponse(response);
    } catch (e) {
      throw Exception('Failed to update provider: $e');
    }
  }

  /// 删除Provider
  Future<void> deleteProvider(String id) async {
    try {
      await _httpService.delete('/api/v1/providers/$id');
    } catch (e) {
      throw Exception('Failed to delete provider: $e');
    }
  }

  /// 列出所有Provider
  Future<List<Provider>> listProviders() async {
    try {
      final response = await _httpService.get('/api/v1/providers');
      
      if (response.data is List) {
        return (response.data as List)
            .map((item) => _parseProviderFromMap(item))
            .toList();
      } else if (response.data is Map && response.data['items'] is List) {
        return (response.data['items'] as List)
            .map((item) => _parseProviderFromMap(item))
            .toList();
      } else {
        throw Exception('Invalid response format');
      }
    } catch (e) {
      throw Exception('Failed to list providers: $e');
    }
  }

  /// 解析Provider响应
  Provider _parseProviderFromResponse(dynamic response) {
    if (response.data is Map) {
      return _parseProviderFromMap(response.data);
    } else {
      throw Exception('Invalid response format');
    }
  }

  /// 从Map解析Provider
  Provider _parseProviderFromMap(Map<String, dynamic> data) {
    return Provider(
      id: data['id'] ?? '',
      name: data['name'] ?? data['display_name'] ?? '',
      peersUserId: data['peers_user_id'] ?? '',
      sort: data['sort'] ?? 0,
      enabled: data['enabled'] ?? true,
      checkModel: data['check_model'] ?? '',
      logo: data['logo'] ?? '',
      description: data['description'] ?? '',
      keyVaults: data['key_vaults'] ?? '',
      sourceType: data['source_type'] ?? '',
      settingsJson: jsonEncode(data['settings'] ?? {}),
      configJson: jsonEncode(data['config'] ?? {}),
      accessedAt: data['accessed_at'] != null
          ? Timestamp.fromDateTime(DateTime.parse(data['accessed_at']).toUtc())
          : Timestamp.fromDateTime(DateTime.now().toUtc()),
      createdAt: data['created_at'] != null
          ? Timestamp.fromDateTime(DateTime.parse(data['created_at']).toUtc())
          : Timestamp.fromDateTime(DateTime.now().toUtc()),
      updatedAt: data['updated_at'] != null
          ? Timestamp.fromDateTime(DateTime.parse(data['updated_at']).toUtc())
          : Timestamp.fromDateTime(DateTime.now().toUtc()),
    );
  }
}