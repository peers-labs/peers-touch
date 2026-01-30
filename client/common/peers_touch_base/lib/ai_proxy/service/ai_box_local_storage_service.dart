import 'dart:convert';

import 'package:peers_touch_base/logger/logging_service.dart';
import 'package:peers_touch_base/model/domain/ai_box/provider.pb.dart';
import 'package:peers_touch_base/storage/local_storage.dart';

/// AI Box本地存储服务
/// 统管管理、消息、topic等业务存储逻辑
class AiBoxLocalStorageService {

  AiBoxLocalStorageService({
    LocalStorage? localStorage,
  }) : _localStorage = localStorage ?? LocalStorage();
  final LocalStorage _localStorage;

  /// Provider管理相关存储方法
  
  /// 获取所有Provider
  Future<List<Map<String, dynamic>>> getAllProviders() async {
    try {
      final List<dynamic>? providersList = await _localStorage.get<List<dynamic>>('ai_box_providers');
      if (providersList == null) return [];
      return providersList.cast<Map<String, dynamic>>();
    } catch (e) {
      throw StorageException('获取Provider列表失败: $e');
    }
  }

  /// 根据ID获取Provider
  Future<Map<String, dynamic>?> getProvider(String providerId) async {
    try {
      final providers = await getAllProviders();
      final provider = providers.firstWhere((p) => p['id'] == providerId, orElse: () => {});
      return provider.isEmpty ? null : provider;
    } catch (e) {
      throw StorageException('获取Provider失败: $e');
    }
  }

  /// 保存Provider
  Future<void> saveProvider(Provider provider) async {
    try {
      final List<Map<String, dynamic>> providers = await getAllProviders();
      final existingIndex = providers.indexWhere((p) => p['id'] == provider.id);
      
      final mapProvider =  _providerToMap(provider);
      if (existingIndex != -1) {
        providers[existingIndex] = _providerToMap(provider);
      } else {
        providers.add(mapProvider);
      }
      
      await _localStorage.set('ai_box_providers', providers);
    } catch (e) {
      throw StorageException('保存Provider失败: $e');
    }
  }

  /// 删除Provider
  Future<void> deleteProvider(String providerId) async {
    try {
      final List<Map<String, dynamic>> providers = await getAllProviders();
      providers.removeWhere((p) => p['id'] == providerId);
      await _localStorage.set('ai_box_providers', providers);
    } catch (e) {
      throw StorageException('删除Provider失败: $e');
    }
  }

  /// 获取默认Provider ID
  Future<String?> getDefaultProviderId() async {
    try {
      return await _localStorage.get<String>('ai_box_default_provider_id');
    } catch (e) {
      throw StorageException('获取默认Provider ID失败: $e');
    }
  }

  /// 设置默认Provider ID
  Future<void> setDefaultProviderId(String providerId) async {
    try {
      await _localStorage.set('ai_box_default_provider_id', providerId);
    } catch (e) {
      throw StorageException('设置默认Provider ID失败: $e');
    }
  }

  /// 获取当前Provider ID
  Future<String?> getCurrentProviderId() async {
    try {
      return await _localStorage.get<String>('ai_box_current_provider_id');
    } catch (e) {
      throw StorageException('获取当前Provider ID失败: $e');
    }
  }

  /// 设置当前Provider ID
  Future<void> setCurrentProviderId(String providerId) async {
    try {
      await _localStorage.set('ai_box_current_provider_id', providerId);
    } catch (e) {
      throw StorageException('设置当前Provider ID失败: $e');
    }
  }

  /// 获取会话级当前Provider ID
  Future<String?> getSessionCurrentProviderId(String sessionId) async {
    try {
      return await _localStorage.get<String>('ai_box_current_provider_id:$sessionId');
    } catch (e) {
      throw StorageException('获取会话当前Provider ID失败: $e');
    }
  }

  /// 设置会话级当前Provider ID
  Future<void> setSessionCurrentProviderId(String sessionId, String providerId) async {
    try {
      await _localStorage.set('ai_box_current_provider_id:$sessionId', providerId);
    } catch (e) {
      throw StorageException('设置会话当前Provider ID失败: $e');
    }
  }

  /// 消息管理相关存储方法
  
  /// 获取会话历史
  Future<List<Map<String, dynamic>>> getChatHistory(String sessionId) async {
    try {
      final sessionsJson = await _localStorage.get('ai_box_chat_sessions');
      if (sessionsJson == null) return [];
      
      final Map<String, dynamic> sessionsMap = json.decode(sessionsJson);
      final sessionData = sessionsMap[sessionId];
      if (sessionData == null) return [];
      
      final List<dynamic> sessionsList = json.decode(sessionData);
      return sessionsList.cast<Map<String, dynamic>>();
    } catch (e) {
      throw StorageException('获取会话历史失败: $e');
    }
  }

  /// 保存消息
  Future<void> saveMessage(String sessionId, Map<String, dynamic> message) async {
    try {
      final sessionsJson = await _localStorage.get('ai_box_chat_sessions') ?? '{}';
      final Map<String, dynamic> sessionsMap = json.decode(sessionsJson);
      
      List<Map<String, dynamic>> sessions = [];
      if (sessionsMap.containsKey(sessionId)) {
        sessions = (json.decode(sessionsMap[sessionId]) as List)
            .cast<Map<String, dynamic>>()
            .toList();
      }
      
      // 创建新的会话记录
      final newSession = {
        'id': sessionId,
        'messages': [...sessions.expand((s) => s['messages'] ?? []), message],
        'createdAt': DateTime.now().millisecondsSinceEpoch,
        'updatedAt': DateTime.now().millisecondsSinceEpoch,
      };
      
      sessions.add(newSession);
      sessionsMap[sessionId] = json.encode(sessions);
      await _localStorage.set('ai_box_chat_sessions', json.encode(sessionsMap));
    } catch (e) {
      throw StorageException('保存消息失败: $e');
    }
  }

  /// 删除会话
  Future<void> deleteSession(String sessionId) async {
    try {
      final sessionsJson = await _localStorage.get('ai_box_chat_sessions') ?? '{}';
      final Map<String, dynamic> sessionsMap = json.decode(sessionsJson);
      sessionsMap.remove(sessionId);
      await _localStorage.set('ai_box_chat_sessions', json.encode(sessionsMap));
    } catch (e) {
      throw StorageException('删除会话失败: $e');
    }
  }

  /// Topic管理相关存储方法
  
  /// 获取所有Topic
  Future<List<Map<String, dynamic>>> getAllTopics() async {
    try {
      final topicsJson = await _localStorage.get('ai_box_topics');
      if (topicsJson == null) return [];
      
      final List<dynamic> topicsList = json.decode(topicsJson);
      return topicsList.cast<Map<String, dynamic>>();
    } catch (e) {
      throw StorageException('获取Topic列表失败: $e');
    }
  }

  /// 保存Topic
  Future<void> saveTopic(Map<String, dynamic> topic) async {
    try {
      final List<Map<String, dynamic>> topics = await getAllTopics();
      final existingIndex = topics.indexWhere((t) => t['id'] == topic['id']);
      
      if (existingIndex != -1) {
        topics[existingIndex] = topic;
      } else {
        topics.add(topic);
      }
      
      await _localStorage.set('ai_box_topics', json.encode(topics));
    } catch (e) {
      throw StorageException('保存Topic失败: $e');
    }
  }

  /// 删除Topic
  Future<void> deleteTopic(String topicId) async {
    try {
      final List<Map<String, dynamic>> topics = await getAllTopics();
      topics.removeWhere((t) => t['id'] == topicId);
      await _localStorage.set('ai_box_topics', json.encode(topics));
    } catch (e) {
      throw StorageException('删除Topic失败: $e');
    }
  }

  /// 数据同步相关方法
  
  /// 同步所有数据
  Future<void> syncAllData() async {
    try {
      // 简单的本地数据同步逻辑
      // 在实际项目中，这里会与远程服务器进行数据同步
      final providers = await getAllProviders();
      final topics = await getAllTopics();
      
      // 记录同步时间
      await _localStorage.set('last_sync_time', DateTime.now().millisecondsSinceEpoch.toString());
      
      LoggingService.info('数据同步完成: ${providers.length}个Provider, ${topics.length}个Topic');
    } catch (e) {
      throw StorageException('数据同步失败: $e');
    }
  }

  /// 检查数据一致性
  Future<bool> checkDataConsistency() async {
    try {
      // 简单的数据一致性检查
      // 在实际项目中，这里会与远程数据进行对比
      final providers = await getAllProviders();
      final topics = await getAllTopics();
      
      // 检查数据完整性
      for (var provider in providers) {
        if (provider['id'] == null || provider['name'] == null) {
          return false;
        }
      }
      
      for (var topic in topics) {
        if (topic['id'] == null || topic['title'] == null) {
          return false;
        }
      }
      
      return true;
    } catch (e) {
      throw StorageException('数据一致性检查失败: $e');
    }
  }

  /// 强制同步到远程
  Future<void> forceSyncToRemote() async {
    try {
      // 在实际项目中，这里会强制将本地数据推送到远程服务器
      await syncAllData();
      LoggingService.info('强制同步到远程完成');
    } catch (e) {
      throw StorageException('强制同步失败: $e');
    }
  }

  /// 获取同步状态
  Future<Map<String, dynamic>> getSyncStatus() async {
    try {
      final lastSyncTime = await _localStorage.get('last_sync_time');
      final providers = await getAllProviders();
      final topics = await getAllTopics();
      
      return {
        'success': true,
        'message': '同步状态获取成功',
        'lastSyncTime': lastSyncTime != null 
            ? DateTime.fromMillisecondsSinceEpoch(int.parse(lastSyncTime)).toIso8601String()
            : '从未同步',
        'localDataCount': {
          'providers': providers.length,
          'topics': topics.length,
        },
      };
    } catch (e) {
      throw StorageException('获取同步状态失败: $e');
    }
  }

    /// 将Protobuf Provider转换为Map
  Map<String, dynamic> _providerToMap(Provider provider) {
    return provider.toProto3Json() as Map<String, dynamic>;
  }
}

/// 存储异常类
class StorageException implements Exception {
  StorageException(this.message);
  final String message;

  @override
  String toString() => 'StorageException: $message';
}
