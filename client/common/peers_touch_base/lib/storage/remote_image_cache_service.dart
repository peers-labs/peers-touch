import 'dart:convert';
import 'dart:io';

import 'package:crypto/crypto.dart';
import 'package:get/get.dart';
import 'package:peers_touch_base/context/global_context.dart';
import 'package:peers_touch_base/network/dio/http_service_locator.dart';
import 'package:peers_touch_base/storage/file_storage_manager.dart';
import 'package:peers_touch_base/storage/local_storage.dart';
import 'package:synchronized/synchronized.dart';

class RemoteImageCacheService {
  factory RemoteImageCacheService() => _instance;
  RemoteImageCacheService._internal();
  static final RemoteImageCacheService _instance = RemoteImageCacheService._internal();

  static const _subDir = 'remote_images';
  static const _metaPrefix = 'remote_image_meta_';

  final _locks = <String, Lock>{};
  final _inflight = <String, Future<File?>>{};

  Future<File?> getOrFetch(
    String? src, {
    Duration maxAge = const Duration(days: 30),
  }) async {
    final url = _normalizeToHttpUrl(src);
    if (url == null) return null;

    final key = sha256.convert(utf8.encode(url)).toString();
    final cached = await _tryGetCachedFile(key: key, maxAge: maxAge);
    if (cached != null) return cached;

    return _fetchOnce(key: key, url: url, maxAge: maxAge);
  }

  String? _normalizeToHttpUrl(String? src) {
    if (src == null) return null;
    final s = src.trim();
    if (s.isEmpty) return null;

    if (s.startsWith('/')) {
      try {
        final baseUrl = HttpServiceLocator().baseUrl;
        final prefix = baseUrl.endsWith('/') ? baseUrl.substring(0, baseUrl.length - 1) : baseUrl;
        return '$prefix$s';
      } catch (_) {
        return null;
      }
    }

    final uri = Uri.tryParse(s);
    if (uri == null) return null;
    if (uri.scheme == 'http' || uri.scheme == 'https') return s;
    return null;
  }

  Future<File?> _tryGetCachedFile({
    required String key,
    required Duration maxAge,
  }) async {
    final meta = await LocalStorage().get<Map<String, dynamic>>('$_metaPrefix$key');
    final path = meta?['path']?.toString();
    if (path == null || path.isEmpty) return null;

    final f = File(path);
    if (!await f.exists()) return null;

    final stat = await f.stat();
    final age = DateTime.now().difference(stat.modified);
    if (age > maxAge) return null;

    if (!await _isImageFile(f)) return null;
    return f;
  }

  Future<File?> _fetchOnce({
    required String key,
    required String url,
    required Duration maxAge,
  }) async {
    final lock = _locks.putIfAbsent(key, () => Lock());
    return lock.synchronized(() async {
      final cached = await _tryGetCachedFile(key: key, maxAge: maxAge);
      if (cached != null) return cached;

      final existing = _inflight[key];
      if (existing != null) return existing;

      final f = _downloadAndStore(key: key, url: url);
      _inflight[key] = f;
      try {
        return await f;
      } finally {
        _inflight.remove(key);
      }
    });
  }

  Future<File?> _downloadAndStore({
    required String key,
    required String url,
  }) async {
    final client = HttpClient();
    try {
      final uri = Uri.parse(url);
      final req = await client.getUrl(uri);
      req.headers.set('Accept', 'image/*');

      // Get token through GlobalContext (single source of truth)
      String? token;
      if (Get.isRegistered<GlobalContext>()) {
        token = Get.find<GlobalContext>().currentSession?['accessToken']?.toString();
      }
      if (token != null && token.trim().isNotEmpty) {
        req.headers.set('Authorization', 'Bearer ${token.trim()}');
      }

      final resp = await req.close();
      if (resp.statusCode != 200) return null;

      final contentType = resp.headers.contentType?.mimeType ?? '';
      if (!contentType.startsWith('image/')) return null;

      final bytes = await resp.fold<List<int>>(<int>[], (acc, chunk) {
        acc.addAll(chunk);
        return acc;
      });

      final target = await FileStorageManager().getFile(
        StorageLocation.cache,
        StorageNamespace.cache,
        '$key.bin',
        subDir: _subDir,
      );
      final tmp = File('${target.path}.tmp');
      await tmp.writeAsBytes(bytes, flush: true);
      if (await target.exists()) {
        await target.delete();
      }
      await tmp.rename(target.path);

      await LocalStorage().set<Map<String, dynamic>>(
        '$_metaPrefix$key',
        <String, dynamic>{
          'url': url,
          'path': target.path,
          'contentType': contentType,
          'savedAt': DateTime.now().millisecondsSinceEpoch,
        },
      );

      return target;
    } catch (_) {
      return null;
    } finally {
      client.close(force: true);
    }
  }

  Future<bool> _isImageFile(File file) async {
    try {
      final raf = await file.open();
      try {
        final header = await raf.read(12);
        if (header.length >= 8 &&
            header[0] == 0x89 &&
            header[1] == 0x50 &&
            header[2] == 0x4E &&
            header[3] == 0x47) {
          return true;
        }
        if (header.length >= 3 && header[0] == 0xFF && header[1] == 0xD8 && header[2] == 0xFF) {
          return true;
        }
        if (header.length >= 6) {
          final s = ascii.decode(header.take(6).toList(), allowInvalid: true);
          if (s == 'GIF87a' || s == 'GIF89a') return true;
        }
        if (header.length >= 12) {
          final riff = ascii.decode(header.take(4).toList(), allowInvalid: true);
          final webp = ascii.decode(header.skip(8).take(4).toList(), allowInvalid: true);
          if (riff == 'RIFF' && webp == 'WEBP') return true;
        }
      } finally {
        await raf.close();
      }
    } catch (_) {}
    return false;
  }
}

