import 'dart:io';
import 'dart:typed_data';

/// 媒体文件类型
enum MediaType {
  image,
  video,
  audio,
  file,
}

/// 媒体文件模型
class MediaFile {
  const MediaFile({
    required this.localPath,
    required this.type,
    this.name,
    this.size,
    this.mimeType,
    this.width,
    this.height,
    this.duration,
    this.thumbnailPath,
    this.bytes,
  });

  /// 本地文件路径
  final String localPath;

  /// 媒体类型
  final MediaType type;

  /// 文件名
  final String? name;

  /// 文件大小 (bytes)
  final int? size;

  /// MIME 类型
  final String? mimeType;

  /// 图片/视频宽度
  final int? width;

  /// 图片/视频高度
  final int? height;

  /// 音视频时长 (milliseconds)
  final int? duration;

  /// 缩略图路径
  final String? thumbnailPath;

  /// 文件字节数据（可选，用于避免重复读取）
  final Uint8List? bytes;

  /// 获取 File 对象
  File get file => File(localPath);

  /// 从路径快速创建
  factory MediaFile.fromPath(String path) {
    final file = File(path);
    final name = path.split(Platform.pathSeparator).last;
    final ext = name.split('.').last.toLowerCase();

    MediaType type;
    if (['jpg', 'jpeg', 'png', 'gif', 'webp', 'heic', 'heif'].contains(ext)) {
      type = MediaType.image;
    } else if (['mp4', 'mov', 'avi', 'mkv', 'webm'].contains(ext)) {
      type = MediaType.video;
    } else if (['mp3', 'wav', 'aac', 'm4a', 'flac', 'ogg'].contains(ext)) {
      type = MediaType.audio;
    } else {
      type = MediaType.file;
    }

    return MediaFile(
      localPath: path,
      type: type,
      name: name,
      size: file.existsSync() ? file.lengthSync() : null,
    );
  }

  /// 从文件创建
  factory MediaFile.fromFile(File file, {MediaType? type}) {
    return MediaFile(
      localPath: file.path,
      type: type ?? MediaFile.fromPath(file.path).type,
      name: file.path.split(Platform.pathSeparator).last,
      size: file.existsSync() ? file.lengthSync() : null,
    );
  }

  /// 复制并修改
  MediaFile copyWith({
    String? localPath,
    MediaType? type,
    String? name,
    int? size,
    String? mimeType,
    int? width,
    int? height,
    int? duration,
    String? thumbnailPath,
    Uint8List? bytes,
  }) {
    return MediaFile(
      localPath: localPath ?? this.localPath,
      type: type ?? this.type,
      name: name ?? this.name,
      size: size ?? this.size,
      mimeType: mimeType ?? this.mimeType,
      width: width ?? this.width,
      height: height ?? this.height,
      duration: duration ?? this.duration,
      thumbnailPath: thumbnailPath ?? this.thumbnailPath,
      bytes: bytes ?? this.bytes,
    );
  }

  /// 判断是否为图片
  bool get isImage => type == MediaType.image;

  /// 判断是否为视频
  bool get isVideo => type == MediaType.video;

  /// 判断是否为音频
  bool get isAudio => type == MediaType.audio;

  /// 获取文件扩展名
  String get extension => name?.split('.').last.toLowerCase() ?? '';

  /// 获取格式化的文件大小
  String get formattedSize {
    if (size == null) return '';
    if (size! < 1024) return '$size B';
    if (size! < 1024 * 1024) return '${(size! / 1024).toStringAsFixed(1)} KB';
    if (size! < 1024 * 1024 * 1024) {
      return '${(size! / (1024 * 1024)).toStringAsFixed(1)} MB';
    }
    return '${(size! / (1024 * 1024 * 1024)).toStringAsFixed(1)} GB';
  }

  @override
  String toString() {
    return 'MediaFile(path: $localPath, type: $type, name: $name, size: $formattedSize)';
  }
}
