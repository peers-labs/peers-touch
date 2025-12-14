import 'dart:io';
import 'package:dio/dio.dart';
import 'package:peers_touch_base/network/dio/http_service_locator.dart';

class DiscoveryRepository {
  final _http = HttpServiceLocator().httpService;

  /// Fetch user's outbox
  Future<Map<String, dynamic>> fetchOutbox(String username, {bool page = true}) async {
    final response = await _http.get<Map<String, dynamic>>(
      '/activitypub/$username/outbox',
      queryParameters: {'page': page},
    );
    return response;
  }

  /// Upload media file
  Future<Map<String, dynamic>> uploadMedia(String username, File file, {String? alt}) async {
    final form = FormData.fromMap({
      'file': await MultipartFile.fromFile(file.path, filename: file.uri.pathSegments.last),
      if (alt != null) 'alt': alt,
    });
    
    final response = await _http.post<Map<String, dynamic>>(
      '/activitypub/$username/media',
      data: form,
    );
    return response;
  }

  /// Submit a post (activity) to outbox
  Future<Map<String, dynamic>> submitPost(String username, Map<String, dynamic> activity) async {
    final response = await _http.post<Map<String, dynamic>>(
      '/activitypub/$username/outbox',
      data: activity,
    );
    return response;
  }
}
