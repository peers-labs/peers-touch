import '../models/storage_models.dart';

/// A minimal storage driver interface for the shared library.
abstract class StorageDriver {
  Future<Document> create(String resourceCode, Document doc);
  Future<Document?> read(String resourceCode, String id);
  Future<Page<Document>> query(String resourceCode, QueryOptions options);
  Future<Document> update(String resourceCode, String id, Document doc);
  Future<void> delete(String resourceCode, String id);
  Future<List<Document>> batchWrite(String resourceCode, List<Document> docs);
}

/// Simple in-memory storage driver to validate storage flows.
class InMemoryStorageDriver implements StorageDriver {
  final Map<String, Map<String, Document>> _store = {};

  /// Upserts a document. If `id` is missing, a random one is assigned.
  @override
  Future<Document> create(String resourceCode, Document doc) async {
    final id = (doc['id'] as String?) ?? _generateId();
    final withMeta = {
      ...doc,
      'id': id,
      'createdAt': (doc['createdAt'] as String?) ?? DateTime.now().toIso8601String(),
      'updatedAt': DateTime.now().toIso8601String(),
      'version': ((doc['version'] as int?) ?? 0) + 1,
    };
    final bucket = _store.putIfAbsent(resourceCode, () => {});
    bucket[id] = withMeta;
    return withMeta;
  }

  @override
  Future<Document?> read(String resourceCode, String id) async {
    final bucket = _store[resourceCode];
    return bucket?[id];
  }

  @override
  Future<Page<Document>> query(String resourceCode, QueryOptions options) async {
    final bucket = _store[resourceCode] ?? {};
    final all = bucket.values.toList();

    // Apply simple filter: equality, and membership for list fields
    final filtered = options.filter == null
        ? all
        : all.where((doc) => _matchesFilter(doc, options.filter!)).toList();

    final total = filtered.length;
    final start = ((options.page - 1) * options.pageSize).clamp(0, total);
    final end = (start + options.pageSize).clamp(0, total);
    final items = filtered.sublist(start, end);

    return Page<Document>(
      items: items,
      page: options.page,
      pageSize: options.pageSize,
      total: total,
    );
  }

  @override
  Future<Document> update(String resourceCode, String id, Document doc) async {
    final bucket = _store.putIfAbsent(resourceCode, () => {});
    final existing = bucket[id] ?? {'id': id};
    final updated = {
      ...existing,
      ...doc,
      'id': id,
      'updatedAt': DateTime.now().toIso8601String(),
      'version': ((existing['version'] as int?) ?? 0) + 1,
    };
    bucket[id] = updated;
    return updated;
  }

  @override
  Future<void> delete(String resourceCode, String id) async {
    final bucket = _store[resourceCode];
    bucket?.remove(id);
  }

  @override
  Future<List<Document>> batchWrite(String resourceCode, List<Document> docs) async {
    final results = <Document>[];
    for (final doc in docs) {
      results.add(await create(resourceCode, doc));
    }
    return results;
  }

  bool _matchesFilter(Document doc, Map<String, dynamic> filter) {
    for (final entry in filter.entries) {
      final key = entry.key;
      final expected = entry.value;
      final actual = doc[key];

      if (actual == null) return false;

      // If actual is a list, treat filter as membership
      if (actual is List) {
        if (expected is List) {
          if (!expected.every((e) => actual.contains(e))) return false;
        } else {
          if (!actual.contains(expected)) return false;
        }
      } else {
        // simple equality
        if (actual != expected) return false;
      }
    }
    return true;
  }

  String _generateId() {
    // Very simple ID generator for examples
    return DateTime.now().microsecondsSinceEpoch.toString();
  }
}