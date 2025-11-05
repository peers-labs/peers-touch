import 'package:peers_touch_desktop/core/network/network.dart';

/// Global HTTP client provider for the application
/// This ensures only one HTTP client instance is created and used throughout the app
class NetworkProvider {
  static HttpClient? _client;
  static HttpClientConfig? _config;

  /// Initialize the global HTTP client with configuration
  /// This should be called only once during app startup
  static void initialize({
    required String baseUrl,
    Duration connectTimeout = const Duration(seconds: 30),
    Duration receiveTimeout = const Duration(seconds: 30),
    Duration sendTimeout = const Duration(seconds: 30),
    Map<String, String> defaultHeaders = const {
      'Content-Type': 'application/json',
      'Accept': 'application/json',
    },
    bool enableLogging = true,
    LoggingInterceptorConfig loggingConfig = const LoggingInterceptorConfig(),
    bool enableAuth = false,
    AuthInterceptorConfig authConfig = const AuthInterceptorConfig(),
    AuthTokenProvider? authTokenProvider,
    bool validateCertificates = true,
    String? proxyUrl,
  }) {
    if (_client != null) {
      throw StateError('NetworkProvider has already been initialized');
    }

    _config = HttpClientConfig(
      baseUrl: baseUrl,
      connectTimeout: connectTimeout,
      receiveTimeout: receiveTimeout,
      sendTimeout: sendTimeout,
      defaultHeaders: defaultHeaders,
      enableLogging: enableLogging,
      loggingConfig: loggingConfig,
      enableAuth: enableAuth,
      authConfig: authConfig,
      authTokenProvider: authTokenProvider,
      validateCertificates: validateCertificates,
      proxyUrl: proxyUrl,
    );

    _client = HttpClient(config: _config!);
  }

  /// Get the global HTTP client instance
  /// Throws if not initialized
  static HttpClient get client {
    if (_client == null) {
      throw StateError(
          'NetworkProvider not initialized. Call NetworkProvider.initialize() first.');
    }
    return _client!;
  }

  /// Get the current configuration
  static HttpClientConfig? get config => _config;

  /// Check if the provider has been initialized
  static bool get isInitialized => _client != null;

  /// Update the base URL for the global client
  /// This allows changing the base URL without recreating the client
  static void updateBaseUrl(String newBaseUrl) {
    if (_client == null) {
      throw StateError('NetworkProvider not initialized');
    }
    _client!.addDefaultHeader('X-Base-Url-Override', newBaseUrl);
  }

  /// Add a default header to all requests
  static void addDefaultHeader(String key, String value) {
    if (_client == null) {
      throw StateError('NetworkProvider not initialized');
    }
    _client!.addDefaultHeader(key, value);
  }

  /// Remove a default header
  static void removeDefaultHeader(String key) {
    if (_client == null) {
      throw StateError('NetworkProvider not initialized');
    }
    _client!.removeDefaultHeader(key);
  }

  /// Dispose the global client and clean up resources
  /// This should be called when the app is shutting down
  static void dispose() {
    _client?.close();
    _client = null;
    _config = null;
  }

  /// Create a new client with different configuration
  /// This is useful for creating specialized clients (e.g., different base URLs)
  static HttpClient createClient({
    String? baseUrl,
    Duration? connectTimeout,
    Duration? receiveTimeout,
    Duration? sendTimeout,
    Map<String, String>? defaultHeaders,
    bool? enableLogging,
    LoggingInterceptorConfig? loggingConfig,
    bool? enableAuth,
    AuthInterceptorConfig? authConfig,
    AuthTokenProvider? authTokenProvider,
    bool? validateCertificates,
    String? proxyUrl,
  }) {
    return HttpClient(
      config: HttpClientConfig(
        baseUrl: baseUrl ?? _config?.baseUrl ?? 'http://localhost:8080',
        connectTimeout: connectTimeout ?? _config?.connectTimeout ?? const Duration(seconds: 30),
        receiveTimeout: receiveTimeout ?? _config?.receiveTimeout ?? const Duration(seconds: 30),
        sendTimeout: sendTimeout ?? _config?.sendTimeout ?? const Duration(seconds: 30),
        defaultHeaders: defaultHeaders ?? _config?.defaultHeaders ?? const {
          'Content-Type': 'application/json',
          'Accept': 'application/json',
        },
        enableLogging: enableLogging ?? _config?.enableLogging ?? true,
        loggingConfig: loggingConfig ?? _config?.loggingConfig ?? const LoggingInterceptorConfig(),
        enableAuth: enableAuth ?? _config?.enableAuth ?? false,
        authConfig: authConfig ?? _config?.authConfig ?? const AuthInterceptorConfig(),
        authTokenProvider: authTokenProvider ?? _config?.authTokenProvider,
        validateCertificates: validateCertificates ?? _config?.validateCertificates ?? true,
        proxyUrl: proxyUrl ?? _config?.proxyUrl,
      ),
    );
  }
}