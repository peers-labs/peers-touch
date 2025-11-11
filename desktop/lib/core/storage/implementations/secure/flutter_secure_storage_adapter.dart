import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import '../../interfaces/secure/secure_storage_interface.dart';

class FlutterSecureStorageAdapter implements SecureStorageAdapter {
  final FlutterSecureStorage _storage;

  FlutterSecureStorageAdapter() : _storage = const FlutterSecureStorage();

  @override
  Future<void> write({required String key, required String value}) async {
    try {
      await _storage.write(key: key, value: value);
    } catch (e) {
      // TODO: Add proper error handling/logging
      print('Failed to write to secure storage: $e');
      rethrow;
    }
  }

  @override
  Future<String?> read({required String key}) async {
    try {
      return await _storage.read(key: key);
    } catch (e) {
      print('Failed to read from secure storage: $e');
      rethrow;
    }
  }

  @override
  Future<void> delete({required String key}) async {
    try {
      await _storage.delete(key: key);
    } catch (e) {
      print('Failed to delete from secure storage: $e');
      rethrow;
    }
  }

  @override
  Future<void> clear() async {
    try {
      await _storage.deleteAll();
    } catch (e) {
      print('Failed to clear secure storage: $e');
      rethrow;
    }
  }
}