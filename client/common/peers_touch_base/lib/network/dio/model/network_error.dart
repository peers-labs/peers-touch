import 'package:dio/dio.dart';

class NetworkError extends DioException {
  NetworkError({
    required super.requestOptions,
    super.response,
    super.type,
    super.error,
  });

  // You can add custom properties or methods here
  String get customMessage {
    switch (type) {
      case DioExceptionType.connectionTimeout:
        return 'Connection timed out. Please check your internet connection.';
      case DioExceptionType.sendTimeout:
        return 'Request sent timed out. Please try again.';
      case DioExceptionType.receiveTimeout:
        return 'Receiving timed out. Please try again.';
      case DioExceptionType.badResponse:
        // You can customize the message based on the status code
        if (response?.statusCode == 401) {
          return 'Unauthorized. Please log in again.';
        } else if (response?.statusCode == 404) {
          return 'The requested resource was not found.';
        } else {
          return 'Server error. Please try again later.';
        }
      case DioExceptionType.cancel:
        return 'Request was cancelled.';
      case DioExceptionType.unknown:
        return 'An unexpected error occurred. Please check your internet connection.';
      default:
        return 'An unexpected error occurred.';
    }
  }
}