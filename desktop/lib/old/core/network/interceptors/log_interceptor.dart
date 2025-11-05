import 'dart:convert';
import 'package:dio/dio.dart';
import 'package:logging/logging.dart';

/// Configuration for logging interceptor
class LoggingInterceptorConfig {
  /// Whether to log request headers
  final bool logRequestHeaders;

  /// Whether to log request body
  final bool logRequestBody;

  /// Whether to log response headers
  final bool logResponseHeaders;

  /// Whether to log response body
  final bool logResponseBody;

  /// Whether to log error responses
  final bool logErrorResponses;

  /// Maximum length of body content to log (to prevent huge logs)
  final int maxBodyLength;

  /// Whether to log request duration
  final bool logRequestDuration;

  /// URLs to exclude from logging (e.g., health checks)
  final List<String> excludeUrls;

  /// Log level for requests
  final Level requestLogLevel;

  /// Log level for responses
  final Level responseLogLevel;

  /// Log level for errors
  final Level errorLogLevel;

  const LoggingInterceptorConfig({
    this.logRequestHeaders = true,
    this.logRequestBody = true,
    this.logResponseHeaders = false,
    this.logResponseBody = true,
    this.logErrorResponses = true,
    this.maxBodyLength = 1000,
    this.logRequestDuration = true,
    this.excludeUrls = const [],
    this.requestLogLevel = Level.FINE,
    this.responseLogLevel = Level.FINE,
    this.errorLogLevel = Level.SEVERE,
  });
}

/// Dio interceptor that logs network requests and responses
class LoggingInterceptor extends Interceptor {
  final LoggingInterceptorConfig config;
  final Logger _logger = Logger('NetworkLogger');
  final Map<String, DateTime> _requestStartTimes = {};

  LoggingInterceptor({this.config = const LoggingInterceptorConfig()});

  @override
  void onRequest(RequestOptions options, RequestInterceptorHandler handler) {
    try {
      // Check if URL should be excluded from logging
      if (_shouldExcludeUrl(options.path)) {
        handler.next(options);
        return;
      }

      // Record request start time
      if (config.logRequestDuration) {
        _requestStartTimes[options.hashCode.toString()] = DateTime.now();
      }

      // Log request
      _logRequest(options);
    } catch (e) {
      _logger.warning('Error logging request: $e');
    }

    handler.next(options);
  }

  @override
  void onResponse(Response response, ResponseInterceptorHandler handler) {
    try {
      // Check if URL should be excluded from logging
      if (_shouldExcludeUrl(response.requestOptions.path)) {
        handler.next(response);
        return;
      }

      // Log response
      _logResponse(response);
    } catch (e) {
      _logger.warning('Error logging response: $e');
    }

    handler.next(response);
  }

  @override
  void onError(DioException err, ErrorInterceptorHandler handler) {
    try {
      // Check if URL should be excluded from logging
      if (_shouldExcludeUrl(err.requestOptions.path)) {
        handler.next(err);
        return;
      }

      // Log error
      _logError(err);
    } catch (e) {
      _logger.warning('Error logging error: $e');
    }

    handler.next(err);
  }

  void _logRequest(RequestOptions options) {
    final buffer = StringBuffer();
    buffer.writeln('🚀 REQUEST: ${options.method} ${options.uri}');

    if (config.logRequestHeaders) {
      buffer.writeln('Headers:');
      options.headers.forEach((key, value) {
        // Skip sensitive headers
        if (_isSensitiveHeader(key)) {
          buffer.writeln('  $key: ***');
        } else {
          buffer.writeln('  $key: $value');
        }
      });
    }

    if (config.logRequestBody && options.data != null) {
      buffer.writeln('Body:');
      final bodyString = _formatBody(options.data);
      buffer.writeln(bodyString);
    }

    _logger.log(config.requestLogLevel, buffer.toString());
  }

  void _logResponse(Response response) {
    final buffer = StringBuffer();
    buffer.writeln('✅ RESPONSE: ${response.statusCode} ${response.requestOptions.uri}');

    if (config.logRequestDuration) {
      final requestKey = response.requestOptions.hashCode.toString();
      final startTime = _requestStartTimes.remove(requestKey);
      if (startTime != null) {
        final duration = DateTime.now().difference(startTime);
        buffer.writeln('Duration: ${duration.inMilliseconds}ms');
      }
    }

    if (config.logResponseHeaders) {
      buffer.writeln('Headers:');
      response.headers.forEach((key, value) {
        buffer.writeln('  $key: $value');
      });
    }

    if (config.logResponseBody && response.data != null) {
      buffer.writeln('Body:');
      final bodyString = _formatBody(response.data);
      buffer.writeln(bodyString);
    }

    _logger.log(config.responseLogLevel, buffer.toString());
  }

  void _logError(DioException error) {
    final buffer = StringBuffer();
    buffer.writeln('❌ ERROR: ${error.type} ${error.requestOptions.uri}');

    if (config.logRequestDuration) {
      final requestKey = error.requestOptions.hashCode.toString();
      final startTime = _requestStartTimes.remove(requestKey);
      if (startTime != null) {
        final duration = DateTime.now().difference(startTime);
        buffer.writeln('Duration: ${duration.inMilliseconds}ms');
      }
    }

    buffer.writeln('Status Code: ${error.response?.statusCode ?? "N/A"}');
    buffer.writeln('Message: ${error.message ?? "N/A"}');

    if (config.logErrorResponses && error.response?.data != null) {
      buffer.writeln('Response Body:');
      final bodyString = _formatBody(error.response!.data);
      buffer.writeln(bodyString);
    }

    _logger.log(config.errorLogLevel, buffer.toString(), error);
  }

  String _formatBody(dynamic data) {
    try {
      if (data is String) {
        // Try to parse as JSON for pretty printing
        try {
          final jsonData = jsonDecode(data);
          return _truncateString(const JsonEncoder.withIndent('  ').convert(jsonData));
        } catch (_) {
          return _truncateString(data);
        }
      } else if (data is Map || data is List) {
        return _truncateString(const JsonEncoder.withIndent('  ').convert(data));
      } else {
        return _truncateString(data.toString());
      }
    } catch (e) {
      return 'Unable to format body: $e';
    }
  }

  String _truncateString(String str) {
    if (str.length <= config.maxBodyLength) {
      return str;
    }
    return '${str.substring(0, config.maxBodyLength)}... (truncated)';
  }

  bool _isSensitiveHeader(String headerName) {
    final lowerHeader = headerName.toLowerCase();
    return lowerHeader.contains('authorization') ||
           lowerHeader.contains('cookie') ||
           lowerHeader.contains('x-api-key') ||
           lowerHeader.contains('x-auth');
  }

  bool _shouldExcludeUrl(String url) {
    for (final excludeUrl in config.excludeUrls) {
      if (url.contains(excludeUrl)) {
        return true;
      }
    }
    return false;
  }
}

/// Enhanced logging interceptor with request/response correlation
class CorrelatedLoggingInterceptor extends LoggingInterceptor {
  final Map<String, String> _requestResponseMap = {};
  int _requestIdCounter = 0;

  CorrelatedLoggingInterceptor({super.config});

  @override
  void onRequest(RequestOptions options, RequestInterceptorHandler handler) {
    // Generate unique request ID
    final requestId = 'REQ_${++_requestIdCounter}';
    _requestResponseMap[options.hashCode.toString()] = requestId;
    
    // Add request ID to options for correlation
    options.extra['requestId'] = requestId;
    
    super.onRequest(options, handler);
  }

  @override
  void _logRequest(RequestOptions options) {
    final requestId = options.extra['requestId'] as String? ?? 'UNKNOWN';
    final buffer = StringBuffer();
    buffer.writeln('🚀 REQUEST [$requestId]: ${options.method} ${options.uri}');

    if (config.logRequestHeaders) {
      buffer.writeln('Headers:');
      options.headers.forEach((key, value) {
        if (_isSensitiveHeader(key)) {
          buffer.writeln('  $key: ***');
        } else {
          buffer.writeln('  $key: $value');
        }
      });
    }

    if (config.logRequestBody && options.data != null) {
      buffer.writeln('Body:');
      final bodyString = _formatBody(options.data);
      buffer.writeln(bodyString);
    }

    _logger.log(config.requestLogLevel, buffer.toString());
  }

  @override
  void _logResponse(Response response) {
    final requestId = response.requestOptions.extra['requestId'] as String? ?? 'UNKNOWN';
    final buffer = StringBuffer();
    buffer.writeln('✅ RESPONSE [$requestId]: ${response.statusCode} ${response.requestOptions.uri}');

    if (config.logRequestDuration) {
      final requestKey = response.requestOptions.hashCode.toString();
      final startTime = _requestStartTimes.remove(requestKey);
      if (startTime != null) {
        final duration = DateTime.now().difference(startTime);
        buffer.writeln('Duration: ${duration.inMilliseconds}ms');
      }
    }

    if (config.logResponseHeaders) {
      buffer.writeln('Headers:');
      response.headers.forEach((key, value) {
        buffer.writeln('  $key: $value');
      });
    }

    if (config.logResponseBody && response.data != null) {
      buffer.writeln('Body:');
      final bodyString = _formatBody(response.data);
      buffer.writeln(bodyString);
    }

    _logger.log(config.responseLogLevel, buffer.toString());
  }

  @override
  void _logError(DioException error) {
    final requestId = error.requestOptions.extra['requestId'] as String? ?? 'UNKNOWN';
    final buffer = StringBuffer();
    buffer.writeln('❌ ERROR [$requestId]: ${error.type} ${error.requestOptions.uri}');

    if (config.logRequestDuration) {
      final requestKey = error.requestOptions.hashCode.toString();
      final startTime = _requestStartTimes.remove(requestKey);
      if (startTime != null) {
        final duration = DateTime.now().difference(startTime);
        buffer.writeln('Duration: ${duration.inMilliseconds}ms');
      }
    }

    buffer.writeln('Status Code: ${error.response?.statusCode ?? "N/A"}');
    buffer.writeln('Message: ${error.message ?? "N/A"}');

    if (config.logErrorResponses && error.response?.data != null) {
      buffer.writeln('Response Body:');
      final bodyString = _formatBody(error.response!.data);
      buffer.writeln(bodyString);
    }

    _logger.log(config.errorLogLevel, buffer.toString(), error);
  }
}