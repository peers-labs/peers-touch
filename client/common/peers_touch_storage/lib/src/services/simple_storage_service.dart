import '../drivers/in_memory_driver.dart';
import '../models/storage_models.dart';

/// A minimal storage service wrapping a StorageDriver.
/// Provides a thin layer to mimic app-level calls.
class SimpleStorageService {
  final StorageDriver driver;

  SimpleStorageService({required this.driver});

  Future<Document> create(String resourceCode, Document doc) =>
      driver.create(resourceCode, doc);

  Future<Document?> read(String resourceCode, String id) =>
      driver.read(resourceCode, id);

  Future<Page<Document>> query(String resourceCode, QueryOptions options) =>
      driver.query(resourceCode, options);

  Future<Document> update(String resourceCode, String id, Document doc) =>
      driver.update(resourceCode, id, doc);

  Future<void> delete(String resourceCode, String id) =>
      driver.delete(resourceCode, id);

  Future<List<Document>> batchWrite(String resourceCode, List<Document> docs) =>
      driver.batchWrite(resourceCode, docs);
}