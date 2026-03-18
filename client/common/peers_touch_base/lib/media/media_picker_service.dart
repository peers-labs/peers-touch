import 'package:file_picker/file_picker.dart';
import 'package:peers_touch_base/media/media_file.dart';

/// 媒体选择服务
///
/// 提供跨平台的媒体选择功能。
/// Desktop 使用 file_picker。
/// Mobile 可扩展使用 image_picker。
class MediaPickerService {
  MediaPickerService._();

  static final MediaPickerService _instance = MediaPickerService._();

  /// 获取单例实例
  static MediaPickerService get instance => _instance;

  /// 选择图片
  ///
  /// [allowMultiple] 是否允许多选
  /// [maxCount] 最大选择数量
  Future<List<MediaFile>> pickImages({
    bool allowMultiple = true,
    int maxCount = 9,
  }) async {
    final result = await FilePicker.platform.pickFiles(
      type: FileType.image,
      allowMultiple: allowMultiple,
    );

    if (result == null) return [];

    final files = <MediaFile>[];
    for (final platformFile in result.files) {
      if (platformFile.path != null && files.length < maxCount) {
        files.add(MediaFile(
          localPath: platformFile.path!,
          type: MediaType.image,
          name: platformFile.name,
          size: platformFile.size,
        ));
      }
    }
    return files;
  }

  /// 选择视频
  Future<List<MediaFile>> pickVideos({
    bool allowMultiple = false,
    int maxCount = 1,
  }) async {
    final result = await FilePicker.platform.pickFiles(
      type: FileType.video,
      allowMultiple: allowMultiple,
    );

    if (result == null) return [];

    final files = <MediaFile>[];
    for (final platformFile in result.files) {
      if (platformFile.path != null && files.length < maxCount) {
        files.add(MediaFile(
          localPath: platformFile.path!,
          type: MediaType.video,
          name: platformFile.name,
          size: platformFile.size,
        ));
      }
    }
    return files;
  }

  /// 选择文件
  ///
  /// [allowedExtensions] 允许的扩展名列表，如 ['pdf', 'doc', 'docx']
  Future<List<MediaFile>> pickFiles({
    List<String>? allowedExtensions,
    bool allowMultiple = true,
    int maxCount = 9,
  }) async {
    final result = await FilePicker.platform.pickFiles(
      type: allowedExtensions != null ? FileType.custom : FileType.any,
      allowedExtensions: allowedExtensions,
      allowMultiple: allowMultiple,
    );

    if (result == null) return [];

    final files = <MediaFile>[];
    for (final platformFile in result.files) {
      if (platformFile.path != null && files.length < maxCount) {
        files.add(MediaFile(
          localPath: platformFile.path!,
          type: MediaType.file,
          name: platformFile.name,
          size: platformFile.size,
        ));
      }
    }
    return files;
  }

  /// 选择媒体（图片或视频）
  Future<List<MediaFile>> pickMedia({
    bool allowMultiple = true,
    int maxCount = 9,
  }) async {
    final result = await FilePicker.platform.pickFiles(
      type: FileType.media,
      allowMultiple: allowMultiple,
    );

    if (result == null) return [];

    final files = <MediaFile>[];
    for (final platformFile in result.files) {
      if (platformFile.path != null && files.length < maxCount) {
        final ext = platformFile.extension?.toLowerCase() ?? '';
        final isVideo = ['mp4', 'mov', 'avi', 'mkv', 'webm'].contains(ext);

        files.add(MediaFile(
          localPath: platformFile.path!,
          type: isVideo ? MediaType.video : MediaType.image,
          name: platformFile.name,
          size: platformFile.size,
        ));
      }
    }
    return files;
  }

  /// 选择音频
  Future<List<MediaFile>> pickAudio({
    bool allowMultiple = false,
    int maxCount = 1,
  }) async {
    final result = await FilePicker.platform.pickFiles(
      type: FileType.audio,
      allowMultiple: allowMultiple,
    );

    if (result == null) return [];

    final files = <MediaFile>[];
    for (final platformFile in result.files) {
      if (platformFile.path != null && files.length < maxCount) {
        files.add(MediaFile(
          localPath: platformFile.path!,
          type: MediaType.audio,
          name: platformFile.name,
          size: platformFile.size,
        ));
      }
    }
    return files;
  }

  /// 获取保存路径（用于保存文件）
  Future<String?> getSavePath({
    String? dialogTitle,
    String? fileName,
    List<String>? allowedExtensions,
  }) async {
    return FilePicker.platform.saveFile(
      dialogTitle: dialogTitle,
      fileName: fileName,
      allowedExtensions: allowedExtensions,
      type: allowedExtensions != null ? FileType.custom : FileType.any,
    );
  }

  /// 选择目录
  Future<String?> pickDirectory({String? dialogTitle}) async {
    return FilePicker.platform.getDirectoryPath(dialogTitle: dialogTitle);
  }

  /// 读取文件到内存
  Future<MediaFile?> pickSingleImage() async {
    final images = await pickImages(allowMultiple: false, maxCount: 1);
    return images.isNotEmpty ? images.first : null;
  }

  /// 检查文件大小是否超限
  bool isFileSizeValid(MediaFile file, {int maxSizeMB = 10}) {
    if (file.size == null) return true;
    return file.size! <= maxSizeMB * 1024 * 1024;
  }

  /// 检查是否支持的图片格式
  bool isSupportedImageFormat(MediaFile file) {
    final supportedFormats = ['jpg', 'jpeg', 'png', 'gif', 'webp', 'heic', 'heif'];
    return supportedFormats.contains(file.extension);
  }

  /// 检查是否支持的视频格式
  bool isSupportedVideoFormat(MediaFile file) {
    final supportedFormats = ['mp4', 'mov', 'avi', 'mkv', 'webm'];
    return supportedFormats.contains(file.extension);
  }
}
