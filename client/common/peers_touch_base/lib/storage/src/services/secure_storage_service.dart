import 'package:flutter_secure_storage/flutter_secure_storage.dart';

enum SecureStorageKey {
  authToken,
  refreshToken,
}

class SecureStorageService {
  final FlutterSecureStorage _storage;

  SecureStorageService(this._storage);

  Future<void> write(SecureStorageKey key, String value) async => await _storage.write(key: key.name, value: value);
  Future<String?> read(SecureStorageKey key) async => await _storage.read(key: key.name);
  Future<void> delete(SecureStorageKey key) async => await _storage.delete(key: key.name);
}
