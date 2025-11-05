class SecureStorage {
  final Map<String, String> _secure = {};

  Future<void> set(String key, String value) async {
    _secure[key] = value;
  }

  String? get(String key) => _secure[key];

  Future<void> remove(String key) async {
    _secure.remove(key);
  }
}