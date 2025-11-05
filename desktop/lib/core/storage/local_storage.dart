class LocalStorage {
  final Map<String, dynamic> _store = {};

  Future<void> set(String key, dynamic value) async {
    _store[key] = value;
  }

  T? get<T>(String key) {
    final v = _store[key];
    if (v is T) return v;
    return null;
  }

  Future<void> remove(String key) async {
    _store.remove(key);
  }
}