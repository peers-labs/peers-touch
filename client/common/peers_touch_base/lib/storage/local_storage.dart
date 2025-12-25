import 'package:peers_touch_base/storage/kv/kv_database.dart';

/// A wrapper for key-value storage, implemented using Drift.
///
/// This class provides a simple interface for storing and retrieving
/// non-sensitive, unstructured data. It serializes objects to JSON for storage.
class LocalStorage {
  factory LocalStorage() => _instance;

  LocalStorage._internal();

  static final LocalStorage _instance = LocalStorage._internal();

  final KvDatabase _db = KvDatabase();

  /// Reads a value from local storage and deserializes it from JSON.
  ///
  /// - [key]: The key to read from.
  ///
  /// Returns the deserialized object, or `null` if the key is not found.
  Future<T?> get<T>(String key) {
    return _db.get<T>(key);
  }

  /// Writes a value to local storage by serializing it to JSON.
  ///
  /// - [key]: The key to write to.
  /// - [value]: The object to store. It must be JSON-encodable.
  Future<void> set<T>(String key, T value) {
    return _db.set<T>(key, value);
  }

  /// Removes a value from local storage.
  ///
  /// - [key]: The key to remove.
  Future<void> remove(String key) {
    return _db.remove(key);
  }

  /// Clears all data from the key-value storage.
  Future<void> clear() {
    return _db.clear();
  }
}