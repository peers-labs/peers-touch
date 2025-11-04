/// Base class for all network-related exceptions
abstract class NetworkException implements Exception {
  final String message;
  final int? statusCode;
  final dynamic data;

  const NetworkException({
    required this.message,
    this.statusCode,
    this.data,
  });

  @override
  String toString() {
    final buffer = StringBuffer('NetworkException: $message');
    if (statusCode != null) {
      buffer.write(' (Status: $statusCode)');
    }
    if (data != null) {
      buffer.write(' - Data: $data');
    }
    return buffer.toString();
  }
}

/// Exception thrown when a network request times out
class TimeoutException extends NetworkException {
  final Duration timeout;

  const TimeoutException({
    required String message,
    required this.timeout,
    dynamic data,
  }) : super(
          message: message,
          data: data,
        );

  @override
  String toString() {
    return 'TimeoutException: $message (Timeout: ${timeout.inMilliseconds}ms)';
  }
}

/// Exception thrown when network connection fails
class ConnectionException extends NetworkException {
  const ConnectionException({
    required String message,
    dynamic data,
  }) : super(
          message: message,
          data: data,
        );
}

/// Exception thrown when server returns an error response
class ServerException extends NetworkException {
  const ServerException({
    required String message,
    required int statusCode,
    dynamic data,
  }) : super(
          message: message,
          statusCode: statusCode,
          data: data,
        );
}

/// Exception thrown when client-side error occurs (4xx status codes)
class ClientException extends NetworkException {
  const ClientException({
    required String message,
    required int statusCode,
    dynamic data,
  }) : super(
          message: message,
          statusCode: statusCode,
          data: data,
        );
}

/// Exception thrown when authentication fails (401 status code)
class UnauthorizedException extends NetworkException {
  const UnauthorizedException({
    required String message,
    dynamic data,
  }) : super(
          message: message,
          statusCode: 401,
          data: data,
        );
}

/// Exception thrown when access is forbidden (403 status code)
class ForbiddenException extends NetworkException {
  const ForbiddenException({
    required String message,
    dynamic data,
  }) : super(
          message: message,
          statusCode: 403,
          data: data,
        );
}

/// Exception thrown when resource is not found (404 status code)
class NotFoundException extends NetworkException {
  const NotFoundException({
    required String message,
    dynamic data,
  }) : super(
          message: message,
          statusCode: 404,
          data: data,
        );
}

/// Exception thrown when request payload is invalid (400 status code)
class BadRequestException extends NetworkException {
  const BadRequestException({
    required String message,
    dynamic data,
  }) : super(
          message: message,
          statusCode: 400,
          data: data,
        );
}

/// Exception thrown when too many requests are made (429 status code)
class RateLimitException extends NetworkException {
  final Duration? retryAfter;

  const RateLimitException({
    required String message,
    this.retryAfter,
    dynamic data,
  }) : super(
          message: message,
          statusCode: 429,
          data: data,
        );

  @override
  String toString() {
    final buffer = StringBuffer('RateLimitException: $message');
    if (retryAfter != null) {
      buffer.write(' (Retry after: ${retryAfter!.inSeconds}s)');
    }
    return buffer.toString();
  }
}

/// Exception thrown when parsing response data fails
class ParseException extends NetworkException {
  final dynamic originalData;
  final dynamic parseError;

  const ParseException({
    required String message,
    this.originalData,
    this.parseError,
  }) : super(
          message: message,
          data: originalData,
        );

  @override
  String toString() {
    final buffer = StringBuffer('ParseException: $message');
    if (parseError != null) {
      buffer.write(' (Parse error: $parseError)');
    }
    return buffer.toString();
  }
}