import 'dart:async';
import 'package:dio/dio.dart';
import 'package:logging/logging.dart';

/// Interface for authentication token providers
abstract class AuthTokenProvider {
  /// Get the current authentication token
  Future<String?> getToken();

  /// Refresh the authentication token
  Future<String?> refreshToken();

  /// Check if the token is expired
  Future<bool> isTokenExpired();

  /// Clear the authentication token
  Future<void> clearToken();
}

/// Configuration for authentication interceptor
class AuthInterceptorConfig {
  /// Header name for the authentication token
  final String headerName;

  /// Token prefix (e.g., 'Bearer ')
  final String tokenPrefix;

  /// Whether to refresh token on 401 responses
  final bool enableTokenRefresh;

  /// Maximum number of retry attempts for token refresh
  final int maxRetryAttempts;

  /// URLs to exclude from authentication
  final List<String> excludeUrls;

  /// Whether to throw exception on auth failure
  final bool throwOnAuthFailure;

  const AuthInterceptorConfig({
    this.headerName = 'Authorization',
    this.tokenPrefix = 'Bearer ',
    this.enableTokenRefresh = true,
    this.maxRetryAttempts = 1,
    this.excludeUrls = const [],
    this.throwOnAuthFailure = true,
  });
}

/// Dio interceptor that handles authentication
class AuthInterceptor extends Interceptor {
  final AuthTokenProvider tokenProvider;
  final AuthInterceptorConfig config;
  final Logger _logger = Logger('AuthInterceptor');

  /// Track requests that are currently refreshing tokens to prevent multiple refresh calls
  final Map<String, Completer<String?>> _refreshingTokens = {};

  AuthInterceptor({
    required this.tokenProvider,
    this.config = const AuthInterceptorConfig(),
  });

  @override
  Future<void> onRequest(
    RequestOptions options,
    RequestInterceptorHandler handler,
  ) async {
    try {
      // Check if URL should be excluded from authentication
      if (_shouldExcludeUrl(options.path)) {
        _logger.fine('Skipping authentication for excluded URL: ${options.path}');
        return handler.next(options);
      }

      // Get authentication token
      final token = await tokenProvider.getToken();
      
      if (token != null && token.isNotEmpty) {
        // Add authentication header
        options.headers[config.headerName] = '${config.tokenPrefix}$token';
        _logger.fine('Added authentication header to request: ${options.path}');
      } else {
        _logger.warning('No authentication token available for request: ${options.path}');
        
        if (config.throwOnAuthFailure) {
          return handler.reject(
            DioException(
              requestOptions: options,
              error: 'No authentication token available',
              type: DioExceptionType.badResponse,
            ),
          );
        }
      }

      handler.next(options);
    } catch (error) {
      _logger.severe('Error adding authentication header: $error');
      handler.reject(
        DioException(
          requestOptions: options,
          error: 'Failed to add authentication: $error',
          type: DioExceptionType.unknown,
        ),
      );
    }
  }

  @override
  Future<void> onError(
    DioException err,
    ErrorInterceptorHandler handler,
  ) async {
    // Handle 401 Unauthorized responses
    if (err.response?.statusCode == 401 && config.enableTokenRefresh) {
      _logger.info('Received 401 response, attempting token refresh');
      
      try {
        // Attempt to refresh token
        final newToken = await _refreshTokenWithRetry();
        
        if (newToken != null && newToken.isNotEmpty) {
          _logger.info('Token refreshed successfully, retrying request');
          
          // Retry the original request with new token
          final options = err.requestOptions;
          options.headers[config.headerName] = '${config.tokenPrefix}$newToken';
          
          try {
            final response = await Dio().fetch(options);
            return handler.resolve(response);
          } catch (retryError) {
            _logger.severe('Request retry failed after token refresh: $retryError');
            return handler.reject(retryError as DioException);
          }
        } else {
          _logger.warning('Token refresh failed, clearing token and rejecting request');
          await tokenProvider.clearToken();
          
          if (config.throwOnAuthFailure) {
            return handler.reject(err);
          }
        }
      } catch (refreshError) {
        _logger.severe('Token refresh failed: $refreshError');
        await tokenProvider.clearToken();
        
        if (config.throwOnAuthFailure) {
          return handler.reject(err);
        }
      }
    }

    // Handle other authentication-related errors
    if (_isAuthError(err)) {
      _logger.warning('Authentication error: ${err.response?.statusCode}');
      
      if (config.throwOnAuthFailure) {
        return handler.reject(err);
      }
    }

    handler.next(err);
  }

  /// Check if URL should be excluded from authentication
  bool _shouldExcludeUrl(String url) {
    for (final excludeUrl in config.excludeUrls) {
      if (url.contains(excludeUrl)) {
        return true;
      }
    }
    return false;
  }

  /// Check if error is authentication-related
  bool _isAuthError(DioException error) {
    final statusCode = error.response?.statusCode;
    return statusCode == 401 || statusCode == 403;
  }

  /// Refresh token with retry logic
  Future<String?> _refreshTokenWithRetry() async {
    final refreshKey = 'global';
    
    // Check if token refresh is already in progress
    if (_refreshingTokens.containsKey(refreshKey)) {
      _logger.fine('Token refresh already in progress, waiting for result');
      return await _refreshingTokens[refreshKey]!.future;
    }

    // Create a new completer for this refresh operation
    final completer = Completer<String?>();
    _refreshingTokens[refreshKey] = completer;

    try {
      // Attempt token refresh
      final newToken = await tokenProvider.refreshToken();
      completer.complete(newToken);
      return newToken;
    } catch (error) {
      _logger.severe('Token refresh failed: $error');
      completer.completeError(error);
      rethrow;
    } finally {
      // Remove the completer from tracking
      _refreshingTokens.remove(refreshKey);
    }
  }
}

/// Simple implementation of AuthTokenProvider for demonstration
class SimpleAuthTokenProvider implements AuthTokenProvider {
  String? _token;
  final Future<String?> Function()? refreshTokenCallback;

  SimpleAuthTokenProvider({String? initialToken, this.refreshTokenCallback})
      : _token = initialToken;

  @override
  Future<String?> getToken() async => _token;

  @override
  Future<String?> refreshToken() async {
    if (refreshTokenCallback != null) {
      _token = await refreshTokenCallback!();
      return _token;
    }
    return null;
  }

  @override
  Future<bool> isTokenExpired() async {
    // Simple implementation - in real apps, decode JWT token and check expiry
    return _token == null || _token!.isEmpty;
  }

  @override
  Future<void> clearToken() async {
    _token = null;
  }

  void setToken(String? token) {
    _token = token;
  }
}