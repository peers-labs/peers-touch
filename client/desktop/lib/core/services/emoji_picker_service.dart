import 'package:peers_touch_base/storage/local_storage.dart';

class EmojiPickerService {
  static const String _keyRecentEmojis = 'recent_emojis';
  static const String _keyFavoriteEmojis = 'favorite_emojis';
  static const int _maxRecentEmojis = 20;

  final LocalStorage _storage = LocalStorage();

  Future<void> initialize() async {
  }

  Future<List<String>> getRecentEmojis() async {
    final List<dynamic>? stored = await _storage.get<List<dynamic>>(_keyRecentEmojis);
    return stored?.map((e) => e as String).toList() ?? [];
  }

  Future<void> addRecentEmoji(String emoji) async {
    final List<String> current = await getRecentEmojis();
    current.removeWhere((e) => e == emoji);
    current.insert(0, emoji);
    if (current.length > _maxRecentEmojis) {
      current.removeLast();
    }
    await _storage.set<List<String>>(_keyRecentEmojis, current);
  }

  Future<List<String>> getFavoriteEmojis() async {
    final List<dynamic>? stored = await _storage.get<List<dynamic>>(_keyFavoriteEmojis);
    return stored?.map((e) => e as String).toList() ?? [];
  }

  Future<void> addFavoriteEmoji(String emoji) async {
    final List<String> current = await getFavoriteEmojis();
    if (!current.contains(emoji)) {
      current.add(emoji);
      await _storage.set<List<String>>(_keyFavoriteEmojis, current);
    }
  }

  Future<void> removeFavoriteEmoji(String emoji) async {
    final List<String> current = await getFavoriteEmojis();
    current.removeWhere((e) => e == emoji);
    await _storage.set<List<String>>(_keyFavoriteEmojis, current);
  }

  Future<bool> isFavoriteEmoji(String emoji) async {
    final List<String> current = await getFavoriteEmojis();
    return current.contains(emoji);
  }
}
