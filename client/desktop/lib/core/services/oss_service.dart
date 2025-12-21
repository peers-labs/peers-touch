import 'dart:io';
import 'package:dio/dio.dart';
import 'package:get/get.dart' hide FormData, MultipartFile;
import 'package:peers_touch_base/network/dio/http_service_locator.dart';
import 'package:peers_touch_desktop/core/services/logging_service.dart';

class OssService {
  final _httpService = HttpServiceLocator().httpService;
  static const String _basePath = '/sub-oss';

  /// Uploads a file to the OSS subserver.
  /// 
  /// Endpoint: POST /sub-oss/upload
  /// Middleware: RequireJWT (handled by AuthInterceptor)
  /// Field: "file" (Multipart)
  Future<Map<String, dynamic>> uploadFile(File file) async {
    try {
      final fileName = file.uri.pathSegments.last;
      final formData = FormData.fromMap({
        'file': await MultipartFile.fromFile(
          file.path, 
          filename: fileName,
        ),
      });

      final data = await _httpService.post<Map<String, dynamic>>(
        '$_basePath/upload',
        data: formData,
      );

      return data;
    } catch (e) {
      if (e is DioException && e.response?.data is Map) {
        final errMap = e.response!.data as Map;
        if (errMap.containsKey('error')) {
          LoggingService.error('OssService', 'Upload failed: ${errMap['error']}');
          throw Exception(errMap['error']);
        }
      }
      rethrow;
    }
  }

  /// Gets file metadata
  /// 
  /// Endpoint: GET /sub-oss/meta?key=...
  Future<Map<String, dynamic>> getFileMeta(String key) async {
    try {
      final data = await _httpService.get<Map<String, dynamic>>(
        '$_basePath/meta',
        queryParameters: {'key': key},
      );
      return data;
    } catch (e) {
      rethrow;
    }
  }
}
