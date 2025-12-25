import 'dart:io';
import 'package:flutter/material.dart';

ImageProvider<Object>? imageProviderFor(String? src) {
  if (src == null) return null;
  final s = src.trim();
  if (s.isEmpty) return null;

  // 1. Try as local file first (handles Windows paths like E:\...)
  try {
    final f = File(s);
    if (f.existsSync()) return FileImage(f);
  } catch (_) {}

  // 2. Try as URI
  final uri = Uri.tryParse(s);
  if (uri == null) return null;
  
  if (uri.scheme == 'http' || uri.scheme == 'https') return NetworkImage(s);
  if (uri.scheme == 'file') return FileImage(File(uri.toFilePath()));
  
  return null;
}
