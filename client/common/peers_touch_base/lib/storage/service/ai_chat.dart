import 'package:dio/dio.dart';
import '../kv/kv_database.dart';

// 1. 定义 AI 存储服务的抽象接口
abstract class AIStorageService {
  Future<void> saveMessage(String messageId, Map<String, dynamic> messageData);
  Future<Map<String, dynamic>?> getMessage(String messageId);
  // 预留的远端存储方法
  Future<void> saveMessageToRemote(Map<String, dynamic> messageData);

  Future<void> set<T>(String key, T value);
  Future<T?> get<T>(String key);
  Future<void> remove(String key);
}

// 2. 实现 AI 存储服务
class AIStorageServiceImpl implements AIStorageService {
  final KvDatabase _local;
  final Dio _remote;

  AIStorageServiceImpl({required KvDatabase local, required Dio remote})
      : _local = local,
        _remote = remote;

  @override
  Future<void> saveMessage(String messageId, Map<String, dynamic> messageData) {
    // 使用我们之前基于 Drift 的 KvDatabase 进行本地存储
    return _local.set('ai_message_$messageId', messageData);
  }

  @override
  Future<Map<String, dynamic>?> getMessage(String messageId) {
    return _local.get<Map<String, dynamic>>('ai_message_$messageId');
  }

  @override
  Future<void> saveMessageToRemote(Map<String, dynamic> messageData) async {
    // TODO: 实现将消息保存到远端服务器的逻辑
    // try {
    //   await _remote.post('/chat/messages', data: messageData);
    // } catch (e) {
    //   // 处理网络错误
    //   // print('Failed to save message to remote: $e');
    // }
    print('Pretending to save to remote: $messageData');
    return Future.value();
  }

  @override
  Future<void> set<T>(String key, T value) {
    return _local.set(key, value);
  }

  @override
  Future<T?> get<T>(String key) {
    return _local.get<T>(key);
  }

  @override
  Future<void> remove(String key) {
    return _local.remove(key);
  }
}