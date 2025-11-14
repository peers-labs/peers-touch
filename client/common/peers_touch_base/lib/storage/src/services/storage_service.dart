import 'package:shared_preferences/shared_preferences.dart';

export 'secure_storage_service.dart';

enum StorageKey {
  apiKey,
  userId,
  themeMode,
}

class StorageService {
  final SharedPreferences _prefs;

  StorageService(this._prefs);

  Future<void> setString(StorageKey key, String value) async => await _prefs.setString(key.name, value);
  String? getString(StorageKey key) => _prefs.getString(key.name);
  Future<void> remove(StorageKey key) async => await _prefs.remove(key.name);
}
