import 'dart:io';

import 'package:extended_image/extended_image.dart';
import 'package:flutter/material.dart';

ImageProvider<Object>? imageProviderFor(String? src) {
  if (src == null) return null;
  final s = src.trim();
  if (s.isEmpty) return null;

  try {
    final f = File(s);
    if (f.existsSync()) return FileImage(f);
  } catch (_) {}

  final uri = Uri.tryParse(s);
  if (uri == null) return null;
  
  if (uri.scheme == 'http' || uri.scheme == 'https') {
    return ExtendedNetworkImageProvider(
      s,
      cache: true,
      cacheMaxAge: const Duration(days: 30),
    );
  }
  
  if (uri.scheme == 'file') return FileImage(File(uri.toFilePath()));
  
  return null;
}
