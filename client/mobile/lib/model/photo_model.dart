import 'dart:io';

/// Simple photo model for basic photo operations
class PhotoModel {
  final int id;
  final String path;

  PhotoModel({
    required this.id,
    required this.path,
  });

  /// Check if the photo file exists
  bool fileExistsSync() {
    try {
      return File(path).existsSync();
    } catch (e) {
      return false;
    }
  }

  /// Get file name from path
  String get fileName {
    return path.split('/').last;
  }

  @override
  String toString() {
    return 'PhotoModel(id: $id, path: $path)';
  }

  @override
  bool operator ==(Object other) {
    if (identical(this, other)) return true;
    return other is PhotoModel && other.id == id && other.path == path;
  }

  @override
  int get hashCode => id.hashCode ^ path.hashCode;
}