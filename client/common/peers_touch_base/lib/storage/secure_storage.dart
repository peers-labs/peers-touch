import 'package:flutter/foundation.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:peers_touch_base/logger/logging_service.dart';
import 'package:peers_touch_base/storage/kv/kv_database.dart';

/// 安全存储服务接口
abstract class SecureStorage {
  Future<void> set(String key, String value);
  Future<String?> get(String key);
  Future<void> remove(String key);
  Future<void> clear();
  void setUserScope(String? userHandle);
}

/// 安全存储服务实现（基于 FlutterSecureStorage）
class SecureStorageImpl implements SecureStorage {
  SecureStorageImpl() {
    _initStorage();
  }

  late FlutterSecureStorage _fs;
  static String? _userHandle;
  static String? _instanceId;
  bool _keychainFailed = false;

  void _initStorage() {
    // Account name includes instance ID for multi-instance isolation
    var accountName = _userHandle ?? 'global';
    if (_instanceId != null && _instanceId!.isNotEmpty) {
      accountName = '${accountName}_$_instanceId';
    }
    _fs = FlutterSecureStorage(
      iOptions: IOSOptions(
        groupId: 'com.peerstouch',
        accountName: accountName,
      ),
      mOptions: MacOsOptions(
        groupId: 'com.peerstouch',
        accountName: accountName,
      ),
    );
  }

  static void setUserHandle(String? userHandle) {
    _userHandle = userHandle;
  }
  
  /// Set instance ID for multi-instance isolation.
  /// Call this before any storage operations.
  static void setInstanceId(String? instanceId) {
    _instanceId = instanceId;
  }

  @override
  void setUserScope(String? userHandle) {
    setUserHandle(userHandle);
    _initStorage();
  }

  String _getFallbackKey(String key) {
    // Include instance ID in fallback key for isolation
    if (_instanceId != null && _instanceId!.isNotEmpty) {
      return 'secure:$_instanceId:$key';
    }
    return 'secure:$key';
  }

  @override
  Future<void> set(String key, String value) async {
    try {
      await _fs.write(key: key, value: value);
      _keychainFailed = false;
    } catch (e) {
      if (kDebugMode) {
        LoggingService.error('[SecureStorage] Keychain write failed: $e, falling back to KvDatabase');
      }
      _keychainFailed = true;
      await KvDatabase().set(_getFallbackKey(key), value);
    }
  }

  @override
  Future<String?> get(String key) async {
    try {
      final value = await _fs.read(key: key);
      if (value != null || !_keychainFailed) {
        return value;
      }
    } catch (e) {
      if (kDebugMode) {
        LoggingService.error('[SecureStorage] Keychain read failed: $e, falling back to KvDatabase');
      }
      _keychainFailed = true;
    }
    
    return KvDatabase().get(_getFallbackKey(key));
  }

  @override
  Future<void> remove(String key) async {
    try {
      await _fs.delete(key: key);
    } catch (e) {
      if (kDebugMode) {
        LoggingService.error('[SecureStorage] Keychain delete failed: $e, falling back to KvDatabase');
      }
    }
    
    await KvDatabase().remove(_getFallbackKey(key));
  }

  @override
  Future<void> clear() async {
    try {
      await _fs.deleteAll();
    } catch (e) {
      if (kDebugMode) {
        LoggingService.error('[SecureStorage] Keychain clear failed: $e');
      }
    }
  }
}