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
    required super.message,
    required this.timeout,
    super.data,
  });

  @override
  String toString() {
    return 'TimeoutException: $message (Timeout: ${timeout.inMilliseconds}ms)';
  }
}

/// Exception thrown when network connection fails
class ConnectionException extends NetworkException {
  const ConnectionException({
    required super.message,
    super.data,
  });
}

/// Exception thrown when server returns an error response
class ServerException extends NetworkException {
  const ServerException({
    required super.message,
    required super.statusCode,
    super.data,
  });
}

/// Exception thrown when client-side error occurs (4xx status codes)
class ClientException extends NetworkException {
  const ClientException({
    required super.message,
    required super.statusCode,
    super.data,
  });
}

/// Exception thrown when authentication fails (401 status code)
class UnauthorizedException extends NetworkException {
  const UnauthorizedException({
    required super.message,
    super.data,
  }) : super(statusCode: 401);
}

/// Exception thrown when access is forbidden (403 status code)
class ForbiddenException extends NetworkException {
  const ForbiddenException({
    required super.message,
    super.data,
  }) : super(statusCode: 403);
}

/// Exception thrown when resource is not found (404 status code)
class NotFoundException extends NetworkException {
  const NotFoundException({
    required super.message,
    super.data,
  }) : super(statusCode: 404);
}

/// Exception thrown when request payload is invalid (400 status code)
class BadRequestException extends NetworkException {
  const BadRequestException({
    required super.message,
    super.data,
  }) : super(statusCode: 400);
}

/// Exception thrown when too many requests are made (429 status code)
class RateLimitException extends NetworkException {
  final Duration? retryAfter;

  const RateLimitException({
    required super.message,
    this.retryAfter,
    super.data,
  }) : super(statusCode: 429);

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
    required super.message,
    this.originalData,
    this.parseError,
  }) : super(data: originalData);

  @override
  String toString() {
    final buffer = StringBuffer('ParseException: $message');
    if (parseError != null) {
      buffer.write(' (Parse error: $parseError)');
    }
    return buffer.toString();
  }
}