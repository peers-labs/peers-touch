import 'dart:io';
import 'package:dio/dio.dart';
import 'package:get/get.dart' hide FormData, MultipartFile;
import 'package:peers_touch_desktop/core/network/api_client.dart';
import 'package:peers_touch_desktop/core/services/logging_service.dart';

class OssService {
  final ApiClient _apiClient = Get.find<ApiClient>();
  static const String _basePath = '/sub-oss';

  /// Uploads a file to the OSS subserver.
  /// 
  /// Endpoint: POST /sub-oss/upload
  /// Middleware: RequireJWT (handled by ApiClient AuthInterceptor)
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

      final response = await _apiClient.post<Map<String, dynamic>>(
        '$_basePath/upload',
        data: formData,
      );

      return response.data ?? {};
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
      final response = await _apiClient.get<Map<String, dynamic>>(
        '$_basePath/meta',
        query: {'key': key},
      );
      return response.data ?? {};
    } catch (e) {
      rethrow;
    }
  }
}
