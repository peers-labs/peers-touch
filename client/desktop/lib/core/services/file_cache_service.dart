import 'dart:io';
import 'dart:convert';
import 'package:path/path.dart' as p;
import 'package:path_provider/path_provider.dart';
import 'package:peers_touch_desktop/core/services/network_initializer.dart';

class FileCacheService {
  Future<Directory> _userCategoryDir(String username, String category) async {
    final support = await getApplicationSupportDirectory();
    final base = Directory(p.join(support.path, 'PeersTouchDesktop', username, 'media', category));
    if (!await base.exists()) {
      await base.create(recursive: true);
    }
    return base;
  }

  Future<File> downloadToUserDir({
    required String username,
    required String category,
    required String urlPath,
    String? suggestedName,
  }) async {
    final dir = await _userCategoryDir(username, category);
    final name = (suggestedName?.trim().isNotEmpty == true)
        ? suggestedName!.trim()
        : _deriveNameFromUrl(urlPath);
    final file = File(p.join(dir.path, name));

    final base = NetworkInitializer.currentBaseUrl;
    final full = Uri.parse(base.trim().endsWith('/')
        ? '${base.trim()}${urlPath.startsWith('/') ? urlPath.substring(1) : urlPath}'
        : '${base.trim()}${urlPath}');

    final client = HttpClient();
    final req = await client.getUrl(full);
    final resp = await req.close();
    final sink = file.openWrite();
    await resp.forEach((chunk) => sink.add(chunk));
    await sink.close();
    return file;
  }

  String _deriveNameFromUrl(String urlPath) {
    try {
      final uri = Uri.parse(urlPath);
      final key = uri.queryParameters['key'] ?? '';
      if (key.isNotEmpty) {
        final seg = key.split('/').last;
        return seg.isNotEmpty ? seg : _hash(urlPath);
      }
    } catch (_) {}
    return _hash(urlPath);
  }

  String _hash(String s) {
    final bytes = utf8.encode(s);
    final sum = bytes.fold<int>(0, (acc, b) => (acc * 131 + b) & 0x7fffffff);
    return 'f_$sum.bin';
  }
}
