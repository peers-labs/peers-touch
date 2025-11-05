abstract class Cacheable {
  Future<void> saveToCache();
  Future<void> loadFromCache();
}