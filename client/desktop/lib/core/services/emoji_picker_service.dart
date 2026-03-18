
import 'package:peers_touch_base/storage/local_storage.dart';

class EmojiPickerService {
  static const String _keyRecentEmojis = 'recent_emojis';
  static const String _keyFavoriteEmojis = 'favorite_emojis';
  static const int _maxRecentEmojis = 20;

  final LocalStorage _storage = LocalStorage();

  Future&lt;List&lt;String&gt;&gt; getRecentEmojis() async {
    final List&lt;dynamic&gt;? stored = await _storage.get&lt;List&lt;dynamic&gt;&gt;(_keyRecentEmojis);
    return stored?.map((e) =&gt; e as String).toList() ?? [];
  }

  Future&lt;void&gt; addRecentEmoji(String emoji) async {
    final List&lt;String&gt; current = await getRecentEmojis();
    current.removeWhere((e) =&gt; e == emoji);
    current.insert(0, emoji);
    if (current.length &gt; _maxRecentEmojis) {
      current.removeLast();
    }
    await _storage.set&lt;List&lt;String&gt;&gt;(_keyRecentEmojis, current);
  }

  Future&lt;List&lt;String&gt;&gt; getFavoriteEmojis() async {
    final List&lt;dynamic&gt;? stored = await _storage.get&lt;List&lt;dynamic&gt;&gt;(_keyFavoriteEmojis);
    return stored?.map((e) =&gt; e as String).toList() ?? [];
  }

  Future&lt;void&gt; addFavoriteEmoji(String emoji) async {
    final List&lt;String&gt; current = await getFavoriteEmojis();
    if (!current.contains(emoji)) {
      current.add(emoji);
      await _storage.set&lt;List&lt;String&gt;&gt;(_keyFavoriteEmojis, current);
    }
  }

  Future&lt;void&gt; removeFavoriteEmoji(String emoji) async {
    final List&lt;String&gt; current = await getFavoriteEmojis();
    current.removeWhere((e) =&gt; e == emoji);
    await _storage.set&lt;List&lt;String&gt;&gt;(_keyFavoriteEmojis, current);
  }

  Future&lt;bool&gt; isFavoriteEmoji(String emoji) async {
    final List&lt;String&gt; current = await getFavoriteEmojis();
    return current.contains(emoji);
  }
}
