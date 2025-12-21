import 'package:flutter_secure_storage/flutter_secure_storage.dart';

/// 安全存储服务接口
abstract class SecureStorage {
  Future<void> set(String key, String value);
  Future<String?> get(String key);
  Future<void> remove(String key);
  Future<void> clear();
}

/// 安全存储服务实现（基于 FlutterSecureStorage）
class SecureStorageImpl implements SecureStorage {
  static const FlutterSecureStorage _fs = FlutterSecureStorage();

  @override
  Future<void> set(String key, String value) async {
    await _fs.write(key: key, value: value);
  }

  @override
  Future<String?> get(String key) async {
    return _fs.read(key: key);
  }

  @override
  Future<void> remove(String key) async {
    await _fs.delete(key: key);
  }

  @override
  Future<void> clear() async {
    await _fs.deleteAll();
  }
}