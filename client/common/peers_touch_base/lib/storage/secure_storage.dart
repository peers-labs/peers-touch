/// 安全存储服务接口
abstract class SecureStorageService {
  Future<void> set(String key, String value);
  Future<String?> get(String key);
  Future<void> remove(String key);
  Future<void> clear();
}

/// 安全存储服务实现（基础版本）
class BasicSecureStorageService implements SecureStorageService {
  final Map<String, String> _storage = {};
  
  @override
  Future<void> set(String key, String value) async {
    _storage[key] = value;
  }
  
  @override
  Future<String?> get(String key) async {
    return _storage[key];
  }
  
  @override
  Future<void> remove(String key) async {
    _storage.remove(key);
  }
  
  @override
  Future<void> clear() async {
    _storage.clear();
  }
}