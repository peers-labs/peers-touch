import 'dart:convert';
import 'dart:io';

import 'package:dio/dio.dart';
import 'package:peers_touch_base/network/dio/http_service_locator.dart';
import 'package:peers_touch_base/network/oss/model/oss_file.dart';

class OssClient {
  final _httpService = HttpServiceLocator().httpService;
  static const String _basePath = '/sub-oss';

  /// Uploads a file to the OSS subserver.
  /// 
  /// Endpoint: POST /sub-oss/upload
  /// Middleware: RequireJWT (handled by AuthInterceptor)
  /// Field: "file" (Multipart)
  Future<OssFile> uploadFile(File file) async {
    try {
      final fileName = file.uri.pathSegments.last;
      final formData = FormData.fromMap({
        'file': await MultipartFile.fromFile(
          file.path, 
          filename: fileName,
        ),
      });

      final response = await _httpService.postResponse(
        '$_basePath/upload',
        data: formData,
      );
      
      final data = response.data;
      if (data == null) {
        throw Exception('Upload failed: empty response');
      }
      
      Map<String, dynamic> jsonMap;
      if (data is Map) {
        jsonMap = Map<String, dynamic>.from(data);
      } else if (data is String) {
         try {
           jsonMap = jsonDecode(data);
         } catch (_) {
           throw Exception('Upload failed: unexpected response type String: $data');
         }
      } else {
        throw Exception('Upload failed: unexpected response type ${data.runtimeType}');
      }

      return OssFile.fromJson(jsonMap);
    } catch (e) {
      if (e is DioException) {
        if (e.response?.statusCode == 401) {
          throw Exception('认证失败，请重新登录');
        }
        if (e.response?.data is Map) {
          final errMap = e.response!.data as Map;
          if (errMap.containsKey('error')) {
            throw Exception(errMap['error']);
          }
        }
      }
      rethrow;
    }
  }

  /// Gets file metadata
  /// 
  /// Endpoint: GET /sub-oss/meta?key=...
  Future<OssFile> getFileMeta(String key) async {
    try {
      final data = await _httpService.get<Map<String, dynamic>>(
        '$_basePath/meta',
        queryParameters: {'key': key},
      );
      return OssFile.fromJson(data);
    } catch (e) {
      rethrow;
    }
  }
}
