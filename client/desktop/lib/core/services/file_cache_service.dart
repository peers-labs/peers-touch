import 'dart:io';
import 'dart:convert';
import 'package:path/path.dart' as p;
import 'package:peers_touch_base/storage/file_storage_manager.dart';
import 'package:peers_touch_desktop/core/services/network_initializer.dart';

class FileCacheService {
  Future<Directory> _userCategoryDir(String username, String category) async {
    // Migrate to use unified FileStorageManager
    // Path: Support/PeersTouchDesktop/{username}/media/{category}
    return await FileStorageManager().getDirectory(
      StorageLocation.support,
      StorageNamespace.peersTouchDesktop,
      subDir: p.join(username, 'media', category),
    );
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

  Future<File> saveLocalFileToUserDir({
    required String username,
    required String category,
    required String urlPath,
    required File sourceFile,
    String? suggestedName,
  }) async {
    final dir = await _userCategoryDir(username, category);
    final name = (suggestedName?.trim().isNotEmpty == true)
        ? suggestedName!.trim()
        : _deriveNameFromUrl(urlPath);
    final file = File(p.join(dir.path, name));

    if (!await dir.exists()) {
      await dir.create(recursive: true);
    }
    
    // Copy content
    await sourceFile.copy(file.path);
    return file;
  }

  String _deriveNameFromUrl(String urlPath) {
    try {
      final uri = Uri.parse(urlPath);
      final key = uri.queryParameters['key'] ?? '';
      if (key.isNotEmpty) {
        final seg = key.replaceAll('\\', '/').split('/').last;
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
