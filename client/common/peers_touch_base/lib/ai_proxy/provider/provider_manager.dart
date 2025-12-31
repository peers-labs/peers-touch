import 'dart:convert';
import 'dart:math';

import 'package:peers_touch_base/ai_proxy/provider/provider_manager_interface.dart';
// 使用新的本地存储服务
import 'package:peers_touch_base/ai_proxy/service/ai_box_local_storage_service.dart';
import 'package:peers_touch_base/model/domain/ai_box/provider.pb.dart';
import 'package:peers_touch_base/model/google/protobuf/timestamp.pb.dart';
import 'package:peers_touch_base/network/dio/peers_frame/service/ai_box_service.dart';


/// Provider同步异常
class ProviderSyncException implements Exception {
  
  ProviderSyncException(this.message, [this.cause]);
  final String message;
  final Object? cause;
  
  @override
  String toString() => 'ProviderSyncException: $message${cause != null ? ' (cause: $cause)' : ''}';
}

/// Provider管理器 - 支持双写策略和数据同步
class ProviderManager implements IProviderManager {

  ProviderManager({
    required AiBoxService aiBoxService,
    required AiBoxLocalStorageService localStorage,
  }) : _aiBoxService = aiBoxService, 
       _localStorage = localStorage;
  final AiBoxService _aiBoxService;
  final AiBoxLocalStorageService _localStorage;
  
  // 本地缓存
  final Map<String, Provider> _providers = {};
  String? _defaultProviderId;
  String? _currentProviderId;
  final Map<String, String> _sessionCurrentProviderIds = {};

  /// 创建新的Provider（仅本地，不保存到后台）
  /// 支持类型: openai, ollama, deepseek, custom
  @override
  Provider newProvider(ProviderType type, String url, String apiKey) {
    final id = _generateProviderId();
    final now = DateTime.now();
    
    // 基础配置
    final baseConfig = {
      'api_key': apiKey,
      'base_url': url,
      'model': _getDefaultModel(type),
    };

    return Provider(
      id: id,
      name: _getProviderName(type),
      peersUserId: '', // 将由后台填充
      sort: 0,
      enabled: true,
      checkModel: _getDefaultModel(type),
      logo: _getProviderLogo(type),
      description: _getProviderDescription(type),
      keyVaults: '', // 敏感信息，将在createProvider时处理
      sourceType: type.name,
      settingsJson: jsonEncode({
        'provider_type': type.name,
        'api_version': 'v1',
      }),
      configJson: jsonEncode(baseConfig),
      accessedAt: Timestamp.fromDateTime(now.toUtc()),
      createdAt: Timestamp.fromDateTime(now.toUtc()),
      updatedAt: Timestamp.fromDateTime(now.toUtc()),
    );
  }

  /// 创建Provider并保存到远程和本地
  @override
  Future<Provider> createProvider(Provider provider) async {
    try {
      // 1. 先保存到远程
      final createdProvider = await _aiBoxService.createProvider(provider);
      
      // 2. 再保存到本地
      await _localStorage.saveProvider(createdProvider);
      
      // 3. 更新本地缓存
      _providers[createdProvider.id] = createdProvider;
      
      // 4. 如果是第一个Provider，设为默认
      if (_providers.length == 1) {
        _defaultProviderId = createdProvider.id;
        await _localStorage.setDefaultProviderId(createdProvider.id);
      }
      
      return createdProvider;
    } catch (remoteError) {
      // 远程失败时，只保存到本地（离线模式）
      await _localStorage.saveProvider(provider);
      _providers[provider.id] = provider;
      
      if (_providers.length == 1) {
        _defaultProviderId = provider.id;
        await _localStorage.setDefaultProviderId(provider.id);
      }
      
      throw ProviderSyncException('远程保存失败，已保存到本地', remoteError);
    }
  }

  /// 根据ID获取Provider
  @override
  Future<Provider?> getProvider(String id) async {
    // 1. 先检查本地缓存
    if (_providers.containsKey(id)) {
      return _providers[id];
    }
    
    try {
      // 2. 优先从远程获取最新数据
      final remoteProvider = await _aiBoxService.getProvider(id);
      
      // 3. 更新本地存储
      await _localStorage.saveProvider(remoteProvider);
      
      // 4. 更新本地缓存
      _providers[id] = remoteProvider;
      
      return remoteProvider;
    } catch (remoteError) {
      // 5. 远程失败时，从本地存储获取
      final localProviderMap = await _localStorage.getProvider(id);
      if (localProviderMap != null) {
        final provider = _mapToProvider(localProviderMap);
        _providers[id] = provider;
        return provider;
      }
      
      return null;
    }
  }

  /// 获取所有Provider
  @override
  Future<List<Provider>> listProviders() async {
    try {
      // 1. 优先从远程获取最新数据
      final remoteProviders = await _aiBoxService.listProviders();
      
      // 2. 更新本地存储
      for (final provider in remoteProviders) {
        await _localStorage.saveProvider(provider);
      }
      
      // 3. 更新本地缓存
      _providers.clear();
      for (final provider in remoteProviders) {
        _providers[provider.id] = provider;
      }
      
      return remoteProviders;
    } catch (remoteError) {
      // 4. 远程失败时，从本地存储获取
      final localProviderMaps = await _localStorage.getAllProviders();
      final localProviders = localProviderMaps.map(_mapToProvider).toList();
      
      // 5. 更新本地缓存
      _providers.clear();
      for (final provider in localProviders) {
        _providers[provider.id] = provider;
      }
      
      if (localProviders.isEmpty) {
        throw ProviderSyncException('无法获取Provider数据', remoteError);
      }
      
      return localProviders;
    }
  }

  /// 更新Provider
  @override
  Future<Provider> updateProvider(Provider provider) async {
    try {
      // 1. 先更新到远程
      final updatedProvider = await _aiBoxService.updateProvider(provider);
      
      // 2. 再更新到本地
      await _localStorage.saveProvider(updatedProvider);
      
      // 3. 更新本地缓存
      _providers[updatedProvider.id] = updatedProvider;
      
      return updatedProvider;
    } catch (remoteError) {
      // 4. 远程失败时，只更新到本地
      await _localStorage.saveProvider(provider);
      _providers[provider.id] = provider;
      
      throw ProviderSyncException('远程更新失败，已更新到本地', remoteError);
    }
  }

  /// 删除Provider
  @override
  Future<void> deleteProvider(String id) async {
    try {
      // 1. 先删除远程
      await _aiBoxService.deleteProvider(id);
      
      // 2. 再删除本地
      await _localStorage.deleteProvider(id);
      
      // 3. 从本地缓存删除
      _providers.remove(id);
      
      // 4. 如果删除的是默认Provider，清空默认设置
      if (_defaultProviderId == id) {
        _defaultProviderId = null;
        await _localStorage.setDefaultProviderId('');
      }
    } catch (remoteError) {
      // 远程失败时，只删除本地
      await _localStorage.deleteProvider(id);
      _providers.remove(id);
      
      if (_defaultProviderId == id) {
        _defaultProviderId = null;
        await _localStorage.setDefaultProviderId('');
      }
      
      throw ProviderSyncException('远程删除失败，已从本地删除', remoteError);
    }
  }

  /// 设置默认Provider
  @override
  Future<void> setDefaultProvider(String id) async {
    if (!_providers.containsKey(id) && id.isNotEmpty) {
      final provider = await getProvider(id);
      if (provider == null) {
        throw Exception('Provider not found: $id');
      }
    }
    
    _defaultProviderId = id;
    await _localStorage.setDefaultProviderId(id);
  }

  /// 获取默认Provider
  @override
  Future<Provider?> getDefaultProvider() async {
    // 如果缓存中没有默认Provider ID，尝试从本地存储获取
    _defaultProviderId ??= await _localStorage.getDefaultProviderId();
    
    // 如果还是没有，获取第一个Provider作为默认
    if (_defaultProviderId == null && _providers.isNotEmpty) {
      _defaultProviderId = _providers.values.first.id;
      await _localStorage.setDefaultProviderId(_defaultProviderId!);
    }
    
    if (_defaultProviderId != null) {
      // 确保Provider存在于缓存中
      if (!_providers.containsKey(_defaultProviderId)) {
        final provider = await getProvider(_defaultProviderId!);
        if (provider != null) {
          return provider;
        }
      } else {
        return _providers[_defaultProviderId];
      }
    }
    
    return null;
  }

  /// 设置当前Provider
  @override
  Future<void> setCurrentProvider(String id) async {
    if (!_providers.containsKey(id) && id.isNotEmpty) {
      final provider = await getProvider(id);
      if (provider == null) {
        throw Exception('Provider not found: $id');
      }
    }
    
    _currentProviderId = id;
  }

  /// 设置会话级当前Provider
  @override
  Future<void> setCurrentProviderForSession(String sessionId, String id) async {
    if (!_providers.containsKey(id) && id.isNotEmpty) {
      final provider = await getProvider(id);
      if (provider == null) {
        throw Exception('Provider not found: $id');
      }
    }
    _sessionCurrentProviderIds[sessionId] = id;
    await _localStorage.setSessionCurrentProviderId(sessionId, id);
  }

  /// 获取当前Provider
  @override
  Future<Provider?> getCurrentProvider() async {
    // 如果缓存中没有当前Provider ID，尝试从本地存储获取
    _currentProviderId ??= await _localStorage.getDefaultProviderId();
    
    // 如果当前Provider ID为空，返回默认Provider
    if (_currentProviderId == null || _currentProviderId!.isEmpty) {
      return await getDefaultProvider();
    }
    
    if (_currentProviderId != null && _currentProviderId!.isNotEmpty) {
      // 确保Provider存在于缓存中
      if (!_providers.containsKey(_currentProviderId)) {
        final provider = await getProvider(_currentProviderId!);
        if (provider != null) {
          return provider;
        }
      } else {
        return _providers[_currentProviderId];
      }
    }
    
    return null;
  }

  /// 获取会话级当前Provider
  @override
  Future<Provider?> getCurrentProviderForSession(String sessionId) async {
    // 优先使用缓存
    var id = _sessionCurrentProviderIds[sessionId];
    id ??= await _localStorage.getSessionCurrentProviderId(sessionId);
    if (id == null || id.isEmpty) {
      return await getDefaultProvider();
    }
    if (!_providers.containsKey(id)) {
      final provider = await getProvider(id);
      if (provider != null) {
        return provider;
      }
    } else {
      return _providers[id];
    }
    return null;
  }

  /// 从远程和本地初始化所有Provider
  Future<void> initProviders() async {
    try {
      // 1. 优先从远程获取最新数据
      final remoteProviders = await _aiBoxService.listProviders();
      
      // 2. 更新本地存储
      for (final provider in remoteProviders) {
        await _localStorage.saveProvider(provider);
      }
      
      // 3. 更新本地缓存
      _providers.clear();
      for (final provider in remoteProviders) {
        _providers[provider.id] = provider;
      }
      
      // 4. 设置默认Provider
      await getDefaultProvider();
    } catch (e) {
      // 5. 远程失败时，从本地存储初始化
      final localProviderMaps = await _localStorage.getAllProviders();
      final localProviders = localProviderMaps.map(_mapToProvider).toList();
      
      _providers.clear();
      for (final provider in localProviders) {
        _providers[provider.id] = provider;
      }
      
      // 设置默认Provider
      await getDefaultProvider();
      
      throw ProviderSyncException('远程初始化失败，已从本地初始化', e);
    }
  }

  /// 生成Provider ID
  String _generateProviderId() {
    final random = Random();
    final timestamp = DateTime.now().millisecondsSinceEpoch;
    final randomPart = random.nextInt(10000);
    return 'provider_$timestamp$randomPart';
  }

  /// 获取默认模型
  String _getDefaultModel(ProviderType type) {
    switch (type) {
      case ProviderType.openai:
        return 'gpt-3.5-turbo';
      case ProviderType.ollama:
        return 'llama2';
      case ProviderType.deepseek:
        return 'deepseek-chat';
      case ProviderType.custom:
        return 'custom-model';
      default:
        return 'default-model';
    }
  }

  /// 获取Provider名称
  String _getProviderName(ProviderType type) {
    switch (type) {
      case ProviderType.openai:
        return 'OpenAI';
      case ProviderType.ollama:
        return 'Ollama';
      case ProviderType.deepseek:
        return 'DeepSeek';
      case ProviderType.custom:
        return 'Custom';
      default:
        return 'Unknown Provider';
    }
  }

  /// 获取Provider Logo
  String _getProviderLogo(ProviderType type) {
    // 这里可以返回默认的logo图片路径
    return '';
  }

  /// 获取Provider描述
  String _getProviderDescription(ProviderType type) {
    switch (type) {
      case ProviderType.openai:
        return 'OpenAI official provider';
      case ProviderType.ollama:
        return 'Ollama local provider';
      case ProviderType.deepseek:
        return 'DeepSeek provider';
      case ProviderType.custom:
        return 'Custom OpenAI compatible provider';
      default:
        return 'Unknown provider type';
    }
  }

  /// 获取同步状态
  Future<Map<String, dynamic>> getSyncStatus() async {
    try {
      final localProviderMaps = await _localStorage.getAllProviders();
      final localProviders = localProviderMaps.map(_mapToProvider).toList();
      final remoteProviders = await _aiBoxService.listProviders();
      
      final localIds = localProviders.map((p) => p.id).toSet();
      final remoteIds = remoteProviders.map((p) => p.id).toSet();
      
      final onlyLocal = localIds.difference(remoteIds);
      final onlyRemote = remoteIds.difference(localIds);
      final common = localIds.intersection(remoteIds);
      
      return {
        'localCount': localProviders.length,
        'remoteCount': remoteProviders.length,
        'onlyLocalCount': onlyLocal.length,
        'onlyRemoteCount': onlyRemote.length,
        'commonCount': common.length,
        'isSynced': onlyLocal.isEmpty && onlyRemote.isEmpty,
        'lastSyncTime': DateTime.now().toIso8601String(),
      };
    } catch (e) {
      return {
        'success': false,
        'message': '获取同步状态失败: $e',
        'error': e,
      };
    }
  }

  /// 将Map转换为Protobuf Provider
  Provider _mapToProvider(Map<String, dynamic> map) {
    return Provider(
      id: map['id'] ?? '',
      name: map['name'] ?? '',
      peersUserId: map['peersUserId'] ?? '',
      sort: map['sort'] ?? 0,
      enabled: map['enabled'] ?? true,
      checkModel: map['checkModel'] ?? '',
      logo: map['logo'] ?? '',
      description: map['description'] ?? '',
      keyVaults: map['keyVaults'] ?? '',
      sourceType: map['sourceType'] ?? '',
      settingsJson: map['settingsJson'] ?? '',
      configJson: map['configJson'] ?? '',
      accessedAt: Timestamp.fromDateTime(
        DateTime.fromMillisecondsSinceEpoch(map['accessedAt'] ?? 0)
      ),
      createdAt: Timestamp.fromDateTime(
        DateTime.fromMillisecondsSinceEpoch(map['createdAt'] ?? 0)
      ),
      updatedAt: Timestamp.fromDateTime(
        DateTime.fromMillisecondsSinceEpoch(map['updatedAt'] ?? 0)
      ),
    );
  }
}
