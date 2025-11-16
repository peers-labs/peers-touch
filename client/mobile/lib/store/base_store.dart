import 'dart:async';

/// Enum representing the sync status of data
enum SyncStatus {
  /// Data is stored locally only
  localOnly,
  /// Data is being synchronized
  syncing,
  /// Data is synchronized with server
  synced,
  /// Sync failed, data remains local
  syncFailed,
}

/// Enum representing network connectivity status
enum NetworkStatus {
  /// Network is available
  connected,
  /// Network is unavailable
  disconnected,
  /// Network status is unknown
  unknown,
}

/// Configuration for a backend server
class ServerConfig {
  final String id;
  final String name;
  final String baseUrl;
  final String apiKey;
  final Map<String, String> headers;
  final Duration timeout;
  final bool isEnabled;
  final int priority;
  final int retryCount;

  const ServerConfig({
    required this.id,
    required this.name,
    required this.baseUrl,
    this.apiKey = '',
    this.headers = const {},
    this.timeout = const Duration(seconds: 30),
    this.isEnabled = true,
    this.priority = 1,
    this.retryCount = 3,
  });

  ServerConfig copyWith({
    String? id,
    String? name,
    String? baseUrl,
    String? apiKey,
    Map<String, String>? headers,
    Duration? timeout,
    bool? isEnabled,
    int? priority,
    int? retryCount,
  }) {
    return ServerConfig(
      id: id ?? this.id,
      name: name ?? this.name,
      baseUrl: baseUrl ?? this.baseUrl,
      apiKey: apiKey ?? this.apiKey,
      headers: headers ?? this.headers,
      timeout: timeout ?? this.timeout,
      isEnabled: isEnabled ?? this.isEnabled,
      priority: priority ?? this.priority,
      retryCount: retryCount ?? this.retryCount,
    );
  }

  /// Convert to JSON for storage
  Map<String, dynamic> toJson() {
    return {
      'id': id,
      'name': name,
      'baseUrl': baseUrl,
      'apiKey': apiKey,
      'headers': headers,
      'timeout': timeout.inMilliseconds,
      'isEnabled': isEnabled,
      'priority': priority,
      'retryCount': retryCount,
    };
  }

  /// Create from JSON
  factory ServerConfig.fromJson(Map<String, dynamic> json) {
    return ServerConfig(
      id: json['id'] ?? '',
      name: json['name'] ?? '',
      baseUrl: json['baseUrl'] ?? '',
      apiKey: json['apiKey'] ?? '',
      headers: Map<String, String>.from(json['headers'] ?? {}),
      timeout: Duration(milliseconds: json['timeout'] ?? 30000),
      isEnabled: json['isEnabled'] ?? true,
      priority: json['priority'] ?? 1,
      retryCount: json['retryCount'] ?? 3,
    );
  }
}

/// Base interface for all storable models
abstract class Storable {
  /// Unique identifier for the model
  String get id;
  
  /// Timestamp when the model was created locally
  DateTime get createdAt;
  
  /// Timestamp when the model was last modified locally
  DateTime get updatedAt;
  
  /// Current sync status
  SyncStatus get syncStatus;
  
  /// Server ID where this model should be synced (null for all servers)
  String? get targetServerId;
  
  /// Convert model to JSON for storage
  Map<String, dynamic> toJson();
  
  /// Create model from JSON
  static Storable fromJson(Map<String, dynamic> json) {
    throw UnimplementedError('fromJson must be implemented by subclasses');
  }
}

/// Result of a sync operation
class SyncResult {
  final bool success;
  final String? error;
  final int syncedCount;
  final int failedCount;
  final DateTime timestamp;

  const SyncResult({
    required this.success,
    this.error,
    required this.syncedCount,
    required this.failedCount,
    required this.timestamp,
  });
}

/// Base interface for all store implementations
abstract class BaseStore<T extends Storable> {
  /// Store name for identification
  String get storeName;
  
  /// Server configurations for this store
  List<ServerConfig> get serverConfigs;
  
  /// Current network status
  Stream<NetworkStatus> get networkStatusStream;
  
  /// Current sync status
  Stream<SyncStatus> get syncStatusStream;
  
  /// Initialize the store
  Future<void> initialize();
  
  /// Save item locally
  Future<void> saveLocal(T item);
  
  /// Save multiple items locally
  Future<void> saveLocalBatch(List<T> items);
  
  /// Get item by ID from local storage
  Future<T?> getLocal(String id);
  
  /// Get all items from local storage
  Future<List<T>> getAllLocal();
  
  /// Get items with specific sync status
  Future<List<T>> getLocalBySyncStatus(SyncStatus status);
  
  /// Delete item from local storage
  Future<void> deleteLocal(String id);
  
  /// Clear all local data
  Future<void> clearLocal();
  
  /// Sync pending items to servers
  Future<SyncResult> syncToServers();
  
  /// Sync specific item to servers
  Future<SyncResult> syncItem(String id);
  
  /// Fetch data from servers and update local storage
  Future<SyncResult> syncFromServers();
  
  /// Update server configurations
  Future<void> updateServerConfigs(List<ServerConfig> configs);
  
  /// Check connectivity to all configured servers
  Future<Map<String, bool>> checkServerConnectivity();
  
  /// Get sync statistics
  Future<Map<String, int>> getSyncStats();
}

/// Interface for sync event notifications
abstract class SyncEventListener {
  /// Called when sync starts
  void onSyncStarted(String storeName);
  
  /// Called when sync progresses
  void onSyncProgress(String storeName, int current, int total);
  
  /// Called when sync completes
  void onSyncCompleted(String storeName, SyncResult result);
  
  /// Called when network status changes
  void onNetworkStatusChanged(NetworkStatus status);
}