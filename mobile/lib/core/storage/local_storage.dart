import 'package:get_storage/get_storage.dart';

class LocalStorage {
  final GetStorage _box = GetStorage();

  T? get<T>(String key) => _box.read<T>(key);
  Future<void> set<T>(String key, T value) async => _box.write(key, value);
  Future<void> remove(String key) async => _box.remove(key);
}