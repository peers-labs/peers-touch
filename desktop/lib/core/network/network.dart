/// Network core module for desktop application
/// Provides HTTP client, request/response models, interceptors, and exceptions
/// 
/// This module follows industry best practices:
/// - Clean separation of concerns
/// - Comprehensive error handling
/// - Flexible configuration
/// - Extensible interceptor system
/// - Type-safe request/response models
/// 
/// Usage:
/// ```dart
/// import 'package:desktop/core/network/network.dart';
/// 
/// // Create HTTP client
/// final client = HttpClient(
///   config: HttpClientConfig(
///     baseUrl: 'https://api.example.com',
///     enableLogging: true,
///     enableAuth: true,
///     authTokenProvider: MyTokenProvider(),
///   ),
/// );
/// 
/// // Make requests
/// final response = await client.get<User>('/users/1', fromJson: User.fromJson);
/// ```

export 'http_client.dart';
export 'request.dart';
export 'response.dart';
export 'exceptions/exceptions.dart';
export 'interceptors/auth_interceptor.dart';
export 'interceptors/log_interceptor.dart';
export 'network_provider.dart';