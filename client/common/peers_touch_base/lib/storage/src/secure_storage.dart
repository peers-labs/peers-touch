import 'package:flutter_secure_storage/flutter_secure_storage.dart';

class SecureStorageService {
  static const FlutterSecureStorageService _fs = FlutterSecureStorageService();

  Future<void> set(String key, String value) async {
    await _fs.write(key: key, value: value);
  }

  Future<String?> get(String key) async {
    return _fs.read(key: key);
  }

  Future<void> remove(String key) async {
    await _fs.delete(key: key);
  }
}