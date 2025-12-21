import 'dart:io';
import 'package:peers_touch_base/network/oss/oss_client.dart';

class OssService {
  final _client = OssClient();

  /// Uploads a file to the OSS subserver.
  /// 
  /// Endpoint: POST /sub-oss/upload
  /// Middleware: RequireJWT (handled by AuthInterceptor)
  /// Field: "file" (Multipart)
  Future<Map<String, dynamic>> uploadFile(File file) async {
    final ossFile = await _client.uploadFile(file);
    return ossFile.toJson();
  }

  /// Gets file metadata
  /// 
  /// Endpoint: GET /sub-oss/meta?key=...
  Future<Map<String, dynamic>> getFileMeta(String key) async {
    final ossFile = await _client.getFileMeta(key);
    return ossFile.toJson();
  }
}
