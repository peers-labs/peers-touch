import 'dart:async';
import 'dart:io';
import 'package:flutter_image_compress/flutter_image_compress.dart';
import 'package:image/image.dart' as img;
import 'package:mime/mime.dart';
import 'package:path/path.dart' as path;
import 'package:path_provider/path_provider.dart';
import 'package:peers_touch_desktop/features/friend_chat/models/message_attachment.dart';
import 'package:peers_touch_desktop/features/friend_chat/models/upload_progress.dart';
import 'package:peers_touch_desktop/core/services/oss_service.dart';
import 'package:peers_touch_desktop/core/services/logging_service.dart';

class AttachmentUploadException implements Exception {
  final String message;
  AttachmentUploadException(this.message);

  @override
  String toString() => 'AttachmentUploadException: $message';
}

class AttachmentUploadService {
  final _ossService = OssService();
  
  static const int maxFileSizeBytes = 100 * 1024 * 1024;
  static const int maxImageDimension = 2000;
  static const int imageQuality = 85;
  static const int thumbnailSize = 300;

  Future<MessageAttachment> uploadImage(
    File imageFile, {
    Function(UploadProgress)? onProgress,
  }) async {
    try {
      LoggingService.info('AttachmentUploadService: Starting image upload: ${imageFile.path}');

      final fileSize = await imageFile.length();
      if (fileSize > maxFileSizeBytes) {
        throw AttachmentUploadException('图片大小超过${maxFileSizeBytes ~/ (1024 * 1024)}MB限制');
      }

      onProgress?.call(UploadProgress(
        percentage: 0.1,
        uploaded: 0,
        total: fileSize,
        status: UploadStatus.UPLOADING,
      ));

      final compressedFile = await _compressImage(imageFile);
      LoggingService.info('AttachmentUploadService: Image compressed: ${await compressedFile.length()} bytes');

      onProgress?.call(UploadProgress(
        percentage: 0.3,
        uploaded: fileSize ~/ 3,
        total: fileSize,
        status: UploadStatus.UPLOADING,
      ));

      final thumbnail = await _generateThumbnail(compressedFile);
      LoggingService.info('AttachmentUploadService: Thumbnail generated: ${await thumbnail.length()} bytes');

      onProgress?.call(UploadProgress(
        percentage: 0.5,
        uploaded: fileSize ~/ 2,
        total: fileSize,
        status: UploadStatus.UPLOADING,
      ));

      final ossFile = await _ossService.uploadFile(compressedFile);
      LoggingService.info('AttachmentUploadService: Image uploaded to OSS: ${ossFile['url']}');

      onProgress?.call(UploadProgress(
        percentage: 0.8,
        uploaded: fileSize * 4 ~/ 5,
        total: fileSize,
        status: UploadStatus.UPLOADING,
      ));

      final thumbnailOss = await _ossService.uploadFile(thumbnail);
      LoggingService.info('AttachmentUploadService: Thumbnail uploaded: ${thumbnailOss['url']}');

      final dimensions = await _getImageDimensions(compressedFile);

      onProgress?.call(UploadProgress.completed(fileSize));

      await _cleanupTempFiles([compressedFile, thumbnail]);

      return MessageAttachment(
        type: AttachmentType.IMAGE,
        url: ossFile['key'] as String,
        thumbnailUrl: thumbnailOss['key'] as String,
        fileSize: await compressedFile.length(),
        fileName: path.basename(imageFile.path),
        metadata: {
          'width': dimensions['width'],
          'height': dimensions['height'],
          'oss_key': ossFile['key'],
          'thumbnail_oss_key': thumbnailOss['key'],
        },
      );
    } catch (e) {
      LoggingService.error('AttachmentUploadService: Image upload failed: $e');
      onProgress?.call(UploadProgress.failed());
      throw AttachmentUploadException('图片上传失败: $e');
    }
  }

  Future<MessageAttachment> uploadFile(
    File file, {
    Function(UploadProgress)? onProgress,
  }) async {
    try {
      LoggingService.info('AttachmentUploadService: Starting file upload: ${file.path}');

      final fileSize = await file.length();
      if (fileSize > maxFileSizeBytes) {
        throw AttachmentUploadException('文件大小超过${maxFileSizeBytes ~/ (1024 * 1024)}MB限制');
      }

      onProgress?.call(UploadProgress(
        percentage: 0.1,
        uploaded: 0,
        total: fileSize,
        status: UploadStatus.UPLOADING,
      ));

      final ossFile = await _ossService.uploadFile(file);
      LoggingService.info('AttachmentUploadService: File uploaded to OSS: ${ossFile['url']}');

      onProgress?.call(UploadProgress.completed(fileSize));

      final mimeType = lookupMimeType(file.path);
      final attachmentType = _getAttachmentTypeFromMime(mimeType);

      return MessageAttachment(
        type: attachmentType,
        url: ossFile['key'] as String,
        fileSize: fileSize,
        fileName: path.basename(file.path),
        metadata: {
          'oss_key': ossFile['key'],
          'mime_type': mimeType,
        },
      );
    } catch (e) {
      LoggingService.error('AttachmentUploadService: File upload failed: $e');
      onProgress?.call(UploadProgress.failed());
      throw AttachmentUploadException('文件上传失败: $e');
    }
  }

  Future<File> _compressImage(File imageFile) async {
    try {
      final imageBytes = await imageFile.readAsBytes();
      final image = img.decodeImage(imageBytes);

      if (image == null) {
        throw AttachmentUploadException('无效的图片文件');
      }

      int targetWidth = image.width;
      int targetHeight = image.height;

      if (image.width > maxImageDimension || image.height > maxImageDimension) {
        if (image.width > image.height) {
          targetWidth = maxImageDimension;
          targetHeight = (image.height * maxImageDimension / image.width).round();
        } else {
          targetHeight = maxImageDimension;
          targetWidth = (image.width * maxImageDimension / image.height).round();
        }
      }

      final resized = img.copyResize(image, width: targetWidth, height: targetHeight);

      final tempDir = await getTemporaryDirectory();
      final compressedPath = path.join(
        tempDir.path,
        'compressed_${DateTime.now().millisecondsSinceEpoch}_${path.basename(imageFile.path)}',
      );

      final result = await FlutterImageCompress.compressWithList(
        img.encodeJpg(resized, quality: imageQuality),
        quality: imageQuality,
      );

      final compressedFile = File(compressedPath);
      await compressedFile.writeAsBytes(result);

      return compressedFile;
    } catch (e) {
      throw AttachmentUploadException('图片压缩失败: $e');
    }
  }

  Future<File> _generateThumbnail(File imageFile) async {
    try {
      final imageBytes = await imageFile.readAsBytes();
      final image = img.decodeImage(imageBytes);

      if (image == null) {
        throw AttachmentUploadException('无法生成缩略图');
      }

      final thumbnail = img.copyResize(
        image,
        width: thumbnailSize,
        height: thumbnailSize,
        maintainAspect: true,
      );

      final tempDir = await getTemporaryDirectory();
      final thumbnailPath = path.join(
        tempDir.path,
        'thumb_${DateTime.now().millisecondsSinceEpoch}_${path.basename(imageFile.path)}',
      );

      final result = await FlutterImageCompress.compressWithList(
        img.encodeJpg(thumbnail, quality: 70),
        quality: 70,
      );

      final thumbnailFile = File(thumbnailPath);
      await thumbnailFile.writeAsBytes(result);

      return thumbnailFile;
    } catch (e) {
      throw AttachmentUploadException('缩略图生成失败: $e');
    }
  }

  Future<Map<String, int>> _getImageDimensions(File imageFile) async {
    try {
      final imageBytes = await imageFile.readAsBytes();
      final image = img.decodeImage(imageBytes);

      if (image == null) {
        return {'width': 0, 'height': 0};
      }

      return {
        'width': image.width,
        'height': image.height,
      };
    } catch (e) {
      LoggingService.warning('AttachmentUploadService: Failed to get image dimensions: $e');
      return {'width': 0, 'height': 0};
    }
  }

  AttachmentType _getAttachmentTypeFromMime(String? mimeType) {
    if (mimeType == null) return AttachmentType.FILE;

    if (mimeType.startsWith('image/')) {
      return AttachmentType.IMAGE;
    } else if (mimeType.startsWith('video/')) {
      return AttachmentType.VIDEO;
    } else if (mimeType.startsWith('audio/')) {
      return AttachmentType.AUDIO;
    } else {
      return AttachmentType.FILE;
    }
  }

  Future<void> _cleanupTempFiles(List<File> files) async {
    for (final file in files) {
      try {
        if (await file.exists()) {
          await file.delete();
        }
      } catch (e) {
        LoggingService.warning('AttachmentUploadService: Failed to cleanup temp file: ${file.path}');
      }
    }
  }

  bool isImageFile(String filePath) {
    final mimeType = lookupMimeType(filePath);
    return mimeType != null && mimeType.startsWith('image/');
  }

  bool isVideoFile(String filePath) {
    final mimeType = lookupMimeType(filePath);
    return mimeType != null && mimeType.startsWith('video/');
  }

  bool isAudioFile(String filePath) {
    final mimeType = lookupMimeType(filePath);
    return mimeType != null && mimeType.startsWith('audio/');
  }

  String formatFileSize(int bytes) {
    if (bytes < 1024) {
      return '$bytes B';
    } else if (bytes < 1024 * 1024) {
      return '${(bytes / 1024).toStringAsFixed(1)} KB';
    } else if (bytes < 1024 * 1024 * 1024) {
      return '${(bytes / (1024 * 1024)).toStringAsFixed(1)} MB';
    } else {
      return '${(bytes / (1024 * 1024 * 1024)).toStringAsFixed(1)} GB';
    }
  }
}
