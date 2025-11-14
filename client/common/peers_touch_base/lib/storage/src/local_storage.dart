import 'package:get_storage/get_storage.dart';

/// Simple wrapper around GetStorage for key-value persistence.
class StorageService {
  final GetStorage _box = GetStorage();

  Future<void> set(String key, dynamic value) async {
    await _box.write(key, value);
  }

  T? get<T>(String key) {
    final v = _box.read(key);
    if (v is T) return v;
    return null;
  }

  Future<void> remove(String key) async {
    await _box.remove(key);
  }
}