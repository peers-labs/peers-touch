/// Network module for HTTP client and related functionality
/// 
/// This library provides a comprehensive HTTP client implementation
/// with features like authentication, logging, error handling, and
/// request/response models. It includes:
/// 
/// - [HttpClient]: Main HTTP client with configurable options
/// - [Request]: Base request model for API calls
/// - [Response]: Base response model with standardized structure
/// - Network exceptions: Custom exception types for different error scenarios
/// - Interceptors: Authentication and logging interceptors
/// - NetworkProvider: Provider for easy access to HTTP client instance
/// 
/// Example usage:
/// ```dart
/// final client = NetworkProvider.client;
/// final response = await client.get('/api/users');
/// ```

export 'http_client.dart';
export 'request.dart';
export 'response.dart';
export 'exceptions/exceptions.dart';
export 'interceptors/auth_interceptor.dart';
export 'interceptors/log_interceptor.dart';
export 'network_provider.dart';