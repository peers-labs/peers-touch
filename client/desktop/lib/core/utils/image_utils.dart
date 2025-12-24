import 'dart:io';
import 'package:flutter/material.dart';

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
