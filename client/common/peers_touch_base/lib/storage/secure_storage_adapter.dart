abstract class SecureStorageAdapter {
  Future<void> set(String key, String value);
  Future<String?> get(String key);
  Future<void> remove(String key);
}
