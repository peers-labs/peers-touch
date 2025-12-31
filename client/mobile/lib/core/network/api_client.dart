import 'package:dio/dio.dart';

class ApiClient {

  ApiClient() {
    _dio = Dio(
      BaseOptions(
        connectTimeout: const Duration(seconds: 10),
        receiveTimeout: const Duration(seconds: 20),
      ),
    );
    // TODO: add interceptors, baseUrl, headers
  }
  late final Dio _dio;

  Dio get dio => _dio;
}