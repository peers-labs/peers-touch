import 'dart:convert';

/// Main configuration class for Peers-touch client
class PeersTouchConfig {
  /// Unique identifier for this node
  final String nodeId;

  /// URL of the registry service for peer discovery
  final String registryUrl;

  /// Connection configuration
  final ConnectionConfig connection;

  /// Security configuration
  final SecurityConfig security;

  /// Enable debug logging
  final bool debug;

  /// Create a new configuration
  PeersTouchConfig({
    required this.nodeId,
    required this.registryUrl,
    this.connection = const ConnectionConfig(),
    this.security = const SecurityConfig(),
    this.debug = false,
  });

  /// Create configuration from JSON
  factory PeersTouchConfig.fromJson(Map<String, dynamic> json) {
    return PeersTouchConfig(
      nodeId: json['nodeId'] as String,
      registryUrl: json['registryUrl'] as String,
      connection: json['connection'] != null
          ? ConnectionConfig.fromJson(
              Map<String, dynamic>.from(json['connection']),
            )
          : const ConnectionConfig(),
      security: json['security'] != null
          ? SecurityConfig.fromJson(
              Map<String, dynamic>.from(json['security']),
            )
          : const SecurityConfig(),
      debug: json['debug'] as bool? ?? false,
    );
  }

  /// Convert to JSON
  Map<String, dynamic> toJson() {
    return {
      'nodeId': nodeId,
      'registryUrl': registryUrl,
      'connection': connection.toJson(),
      'security': security.toJson(),
      'debug': debug,
    };
  }

  /// Convert to JSON string
  String toJsonString() => jsonEncode(toJson());

  @override
  String toString() {
    return 'PeersTouchConfig(nodeId: $nodeId, registryUrl: $registryUrl, debug: $debug)';
  }

  @override
  bool operator ==(Object other) {
    if (identical(this, other)) return true;
    return other is PeersTouchConfig &&
        other.nodeId == nodeId &&
        other.registryUrl == registryUrl;
  }

  @override
  int get hashCode => nodeId.hashCode ^ registryUrl.hashCode;
}

/// Connection configuration
class ConnectionConfig {
  /// Connection timeout in seconds
  final int timeout;

  /// Maximum retry attempts for failed connections
  final int maxRetries;

  /// Retry delay in milliseconds
  final int retryDelay;

  /// Heartbeat interval in seconds
  final int heartbeatInterval;

  /// Maximum number of concurrent connections
  final int maxConnections;

  const ConnectionConfig({
    this.timeout = 30,
    this.maxRetries = 3,
    this.retryDelay = 1000,
    this.heartbeatInterval = 60,
    this.maxConnections = 10,
  });

  /// Create from JSON
  factory ConnectionConfig.fromJson(Map<String, dynamic> json) {
    return ConnectionConfig(
      timeout: json['timeout'] as int? ?? 30,
      maxRetries: json['maxRetries'] as int? ?? 3,
      retryDelay: json['retryDelay'] as int? ?? 1000,
      heartbeatInterval: json['heartbeatInterval'] as int? ?? 60,
      maxConnections: json['maxConnections'] as int? ?? 10,
    );
  }

  /// Convert to JSON
  Map<String, dynamic> toJson() {
    return {
      'timeout': timeout,
      'maxRetries': maxRetries,
      'retryDelay': retryDelay,
      'heartbeatInterval': heartbeatInterval,
      'maxConnections': maxConnections,
    };
  }

  @override
  String toString() {
    return 'ConnectionConfig(timeout: ${timeout}s, maxRetries: $maxRetries)';
  }
}

/// Security configuration
class SecurityConfig {
  /// Enable TLS/SSL encryption
  final bool enableTls;

  /// Certificate authority bundle path
  final String? caBundlePath;

  /// Client certificate path
  final String? clientCertPath;

  /// Client private key path
  final String? clientKeyPath;

  /// Enable end-to-end encryption for messages
  final bool enableE2ee;

  const SecurityConfig({
    this.enableTls = true,
    this.caBundlePath,
    this.clientCertPath,
    this.clientKeyPath,
    this.enableE2ee = true,
  });

  /// Create from JSON
  factory SecurityConfig.fromJson(Map<String, dynamic> json) {
    return SecurityConfig(
      enableTls: json['enableTls'] as bool? ?? true,
      caBundlePath: json['caBundlePath'] as String?,
      clientCertPath: json['clientCertPath'] as String?,
      clientKeyPath: json['clientKeyPath'] as String?,
      enableE2ee: json['enableE2ee'] as bool? ?? true,
    );
  }

  /// Convert to JSON
  Map<String, dynamic> toJson() {
    return {
      'enableTls': enableTls,
      if (caBundlePath != null) 'caBundlePath': caBundlePath,
      if (clientCertPath != null) 'clientCertPath': clientCertPath,
      if (clientKeyPath != null) 'clientKeyPath': clientKeyPath,
      'enableE2ee': enableE2ee,
    };
  }

  @override
  String toString() {
    return 'SecurityConfig(enableTls: $enableTls, enableE2ee: $enableE2ee)';
  }
}