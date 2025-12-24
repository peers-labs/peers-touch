import 'dart:io';
import 'package:flutter/material.dart';
import 'package:flutter/painting.dart';

ImageProvider<Object>? imageProviderFor(String? src) {
  if (src == null) return null;
  final s = src.trim();
  if (s.isEmpty) return null;
  final uri = Uri.tryParse(s);
  if (uri == null) return null;
  if (uri.scheme == 'http' || uri.scheme == 'https') return NetworkImage(s);
  if (uri.scheme == 'file') return FileImage(File(uri.toFilePath()));
  if (!uri.hasScheme) {
    final f = File(s);
    if (f.existsSync()) return FileImage(f);
  }
  return null;
}

/// 强制移除指定图片的内存缓存，以便下次渲染拉取最新内容
void evictImageCacheFor(String? src) {
  if (src == null) return;
  final s = src.trim();
  if (s.isEmpty) return;
  final uri = Uri.tryParse(s);
  if (uri == null) return;
  if (uri.scheme == 'http' || uri.scheme == 'https') {
    try {
      NetworkImage(s).evict(cache: PaintingBinding.instance.imageCache);
    } catch (_) {}
  } else if (uri.scheme == 'file' || !uri.hasScheme) {
    try {
      FileImage(File(uri.hasScheme ? uri.toFilePath() : s)).evict(cache: PaintingBinding.instance.imageCache);
    } catch (_) {}
  }
}
