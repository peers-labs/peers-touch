import 'dart:convert';
import 'package:shared_preferences/shared_preferences.dart';
import 'package:get/get.dart';
import 'package:http/http.dart' as http;
import 'package:peers_touch_mobile/store/base_store.dart';
import 'package:peers_touch_mobile/common/logger/logger.dart';

/// Server configuration manager for handling multiple backend servers
class ServerConfigManager extends GetxController {
  static const String _configKey = 'server_configs';
  static const String _defaultConfigKey = 'default_server_configs';
  
  final RxMap<String, List<ServerConfig>> _storeConfigs = <String, List<ServerConfig>>{}.obs;
  final RxMap<String, String> _defaultServers = <String, String>{}.obs;
  
  SharedPreferences? _prefs;
  
  // Getters
  Map<String, List<ServerConfig>> get storeConfigs => _storeConfigs;
  Map<String, String> get defaultServers => _defaultServers;
  
  @override
  Future<void> onInit() async {
    super.onInit();
    await _initializePreferences();
    await _loadConfigurations();
  }
  
  /// Initialize shared preferences
  Future<void> _initializePreferences() async {
    _prefs = await SharedPreferences.getInstance();
  }
  
  /// Load server configurations from storage
  Future<void> _loadConfigurations() async {
    try {
      // Load store configs
      final configsJson = _prefs?.getString(_configKey);
      if (configsJson != null) {
        final configsMap = jsonDecode(configsJson) as Map<String, dynamic>;
        
        for (final entry in configsMap.entries) {
          final storeName = entry.key;
          final serverList = (entry.value as List)
              .map((json) => ServerConfig.fromJson(json))
              .toList();
          _storeConfigs[storeName] = serverList;
        }
      }
      
      // Load default server configs
      final defaultsJson = _prefs?.getString(_defaultConfigKey);
      if (defaultsJson != null) {
        final defaultsMap = jsonDecode(defaultsJson) as Map<String, dynamic>;
        _defaultServers.addAll(Map<String, String>.from(defaultsMap));
      }
      
      appLogger.info('Loaded server configurations for ${_storeConfigs.length} stores');
    } catch (e) {
      appLogger.error('Error loading server configurations: $e');
      _initializeDefaultConfigs();
    }
  }
  
  /// Initialize default server configurations
  void _initializeDefaultConfigs() {
    // Add default configurations for common stores
    final defaultPhotoServers = [
      ServerConfig(
        id: 'primary-server',
        name: 'Primary Server',
        baseUrl: 'https://api.example.com/v1',
        apiKey: '',
        isEnabled: true,
        priority: 1,
        timeout: const Duration(seconds: 30),
        retryCount: 3,
      ),
    ];
    
    _storeConfigs['PhotoStore'] = defaultPhotoServers;
    _defaultServers['PhotoStore'] = 'Primary Server';
    
    _saveConfigurations();
  }
  
  /// Save server configurations to storage
  Future<void> _saveConfigurations() async {
    try {
      // Save store configs
      final configsMap = _storeConfigs.map(
        (storeName, servers) => MapEntry(
          storeName,
          servers.map((server) => server.toJson()).toList(),
        ),
      );
      await _prefs?.setString(_configKey, jsonEncode(configsMap));
      
      // Save default server configs
      await _prefs?.setString(_defaultConfigKey, jsonEncode(_defaultServers));
      
      appLogger.info('Saved server configurations');
    } catch (e) {
      appLogger.error('Error saving server configurations: $e');
    }
  }
  
  /// Get server configurations for a specific store
  List<ServerConfig> getServerConfigs(String storeName) {
    return _storeConfigs[storeName] ?? [];
  }
  
  /// Get enabled server configurations for a specific store
  List<ServerConfig> getEnabledServerConfigs(String storeName) {
    return getServerConfigs(storeName)
        .where((config) => config.isEnabled)
        .toList()
      ..sort((a, b) => a.priority.compareTo(b.priority));
  }
  
  /// Get default server configuration for a specific store
  ServerConfig? getDefaultServerConfig(String storeName) {
    final defaultServerName = _defaultServers[storeName];
    if (defaultServerName == null) return null;
    
    return getServerConfigs(storeName)
        .where((config) => config.name == defaultServerName)
        .firstOrNull;
  }
  
  /// Add server configuration for a store
  Future<void> addServerConfig(String storeName, ServerConfig config) async {
    final configs = _storeConfigs[storeName] ?? [];
    
    // Check for duplicate names
    if (configs.any((c) => c.name == config.name)) {
      throw Exception('Server with name "${config.name}" already exists');
    }
    
    configs.add(config);
    _storeConfigs[storeName] = configs;
    
    // Set as default if it's the first server
    if (configs.length == 1) {
      _defaultServers[storeName] = config.name;
    }
    
    await _saveConfigurations();
    appLogger.info('Added server config "${config.name}" for $storeName');
  }
  
  /// Update server configuration
  Future<void> updateServerConfig(
    String storeName,
    String serverName,
    ServerConfig updatedConfig,
  ) async {
    final configs = _storeConfigs[storeName] ?? [];
    final index = configs.indexWhere((c) => c.name == serverName);
    
    if (index == -1) {
      throw Exception('Server "$serverName" not found in $storeName');
    }
    
    // If name changed, check for duplicates
    if (updatedConfig.name != serverName) {
      if (configs.any((c) => c.name == updatedConfig.name)) {
        throw Exception('Server with name "${updatedConfig.name}" already exists');
      }
      
      // Update default server name if this was the default
      if (_defaultServers[storeName] == serverName) {
        _defaultServers[storeName] = updatedConfig.name;
      }
    }
    
    configs[index] = updatedConfig;
    _storeConfigs[storeName] = configs;
    
    await _saveConfigurations();
    appLogger.info('Updated server config "${updatedConfig.name}" for $storeName');
  }
  
  /// Remove server configuration
  Future<void> removeServerConfig(String storeName, String serverName) async {
    final configs = _storeConfigs[storeName] ?? [];
    configs.removeWhere((c) => c.name == serverName);
    
    // Update default if this was the default server
    if (_defaultServers[storeName] == serverName) {
      if (configs.isNotEmpty) {
        _defaultServers[storeName] = configs.first.name;
      } else {
        _defaultServers.remove(storeName);
      }
    }
    
    _storeConfigs[storeName] = configs;
    await _saveConfigurations();
    appLogger.info('Removed server config "$serverName" from $storeName');
  }
  
  /// Set default server for a store
  Future<void> setDefaultServer(String storeName, String serverName) async {
    final configs = getServerConfigs(storeName);
    if (!configs.any((c) => c.name == serverName)) {
      throw Exception('Server "$serverName" not found in $storeName');
    }
    
    _defaultServers[storeName] = serverName;
    await _saveConfigurations();
    appLogger.info('Set "$serverName" as default server for $storeName');
  }
  
  /// Enable/disable server configuration
  Future<void> setServerEnabled(
    String storeName,
    String serverName,
    bool enabled,
  ) async {
    final configs = _storeConfigs[storeName] ?? [];
    final index = configs.indexWhere((c) => c.name == serverName);
    
    if (index == -1) {
      throw Exception('Server "$serverName" not found in $storeName');
    }
    
    final updatedConfig = configs[index].copyWith(isEnabled: enabled);
    configs[index] = updatedConfig;
    _storeConfigs[storeName] = configs;
    
    await _saveConfigurations();
    appLogger.info('${enabled ? "Enabled" : "Disabled"} server "$serverName" for $storeName');
  }
  
  /// Update server priority
  Future<void> updateServerPriority(
    String storeName,
    String serverName,
    int priority,
  ) async {
    final configs = _storeConfigs[storeName] ?? [];
    final index = configs.indexWhere((c) => c.name == serverName);
    
    if (index == -1) {
      throw Exception('Server "$serverName" not found in $storeName');
    }
    
    final updatedConfig = configs[index].copyWith(priority: priority);
    configs[index] = updatedConfig;
    _storeConfigs[storeName] = configs;
    
    await _saveConfigurations();
    appLogger.info('Updated priority for server "$serverName" in $storeName to $priority');
  }
  
  /// Test server connectivity
  Future<bool> testServerConnectivity(ServerConfig config) async {
    try {
      final response = await http.get(
        Uri.parse('${config.baseUrl}/health'),
        headers: {
          'Authorization': 'Bearer ${config.apiKey}',
          'Content-Type': 'application/json',
        },
      ).timeout(config.timeout);
      
      return response.statusCode == 200;
    } catch (e) {
      appLogger.error('Server connectivity test failed for ${config.name}: $e');
      return false;
    }
  }
  
  /// Test connectivity for all servers in a store
  Future<Map<String, bool>> testStoreConnectivity(String storeName) async {
    final configs = getServerConfigs(storeName);
    final results = <String, bool>{};
    
    for (final config in configs) {
      results[config.name] = await testServerConnectivity(config);
    }
    
    return results;
  }
  
  /// Get server configuration statistics
  Map<String, Map<String, int>> getConfigurationStats() {
    final stats = <String, Map<String, int>>{};
    
    for (final entry in _storeConfigs.entries) {
      final storeName = entry.key;
      final configs = entry.value;
      
      stats[storeName] = {
        'total': configs.length,
        'enabled': configs.where((c) => c.isEnabled).length,
        'disabled': configs.where((c) => !c.isEnabled).length,
      };
    }
    
    return stats;
  }
  
  /// Import server configurations from JSON
  Future<void> importConfigurations(Map<String, dynamic> configData) async {
    try {
      for (final entry in configData.entries) {
        final storeName = entry.key;
        final serverList = (entry.value as List)
            .map((json) => ServerConfig.fromJson(json))
            .toList();
        
        _storeConfigs[storeName] = serverList;
        
        // Set first server as default if no default exists
        if (serverList.isNotEmpty && !_defaultServers.containsKey(storeName)) {
          _defaultServers[storeName] = serverList.first.name;
        }
      }
      
      await _saveConfigurations();
      appLogger.info('Imported server configurations');
    } catch (e) {
      appLogger.error('Error importing server configurations: $e');
      rethrow;
    }
  }
  
  /// Export server configurations to JSON
  Map<String, dynamic> exportConfigurations() {
    return _storeConfigs.map(
      (storeName, servers) => MapEntry(
        storeName,
        servers.map((server) => server.toJson()).toList(),
      ),
    );
  }
  
  /// Reset all configurations to defaults
  Future<void> resetToDefaults() async {
    _storeConfigs.clear();
    _defaultServers.clear();
    _initializeDefaultConfigs();
    appLogger.info('Reset server configurations to defaults');
  }
  
  /// Validate server configuration
  List<String> validateServerConfig(ServerConfig config) {
    final errors = <String>[];
    
    if (config.name.trim().isEmpty) {
      errors.add('Server name cannot be empty');
    }
    
    if (config.baseUrl.trim().isEmpty) {
      errors.add('Base URL cannot be empty');
    } else {
      try {
        Uri.parse(config.baseUrl);
      } catch (e) {
        errors.add('Invalid base URL format');
      }
    }
    
    if (config.priority < 1) {
      errors.add('Priority must be greater than 0');
    }
    
    if (config.retryCount < 0) {
      errors.add('Retry count cannot be negative');
    }
    
    if (config.timeout.inSeconds < 1) {
      errors.add('Timeout must be at least 1 second');
    }
    
    return errors;
  }
}

/// Extension for ServerConfig to add convenience methods
extension ServerConfigExtension on ServerConfig {
  /// Create a copy with updated fields
  ServerConfig copyWith({
    String? id,
    String? name,
    String? baseUrl,
    String? apiKey,
    bool? isEnabled,
    int? priority,
    Duration? timeout,
    int? retryCount,
    Map<String, String>? headers,
  }) {
    return ServerConfig(
      id: id ?? this.id,
      name: name ?? this.name,
      baseUrl: baseUrl ?? this.baseUrl,
      apiKey: apiKey ?? this.apiKey,
      isEnabled: isEnabled ?? this.isEnabled,
      priority: priority ?? this.priority,
      timeout: timeout ?? this.timeout,
      retryCount: retryCount ?? this.retryCount,
      headers: headers ?? this.headers,
    );
  }
  
  /// Convert to JSON
  Map<String, dynamic> toJson() {
    return {
      'id': id,
      'name': name,
      'baseUrl': baseUrl,
      'apiKey': apiKey,
      'isEnabled': isEnabled,
      'priority': priority,
      'timeout': timeout.inMilliseconds,
      'retryCount': retryCount,
      'headers': headers,
    };
  }
  
  /// Create from JSON
  static ServerConfig fromJson(Map<String, dynamic> json) {
    return ServerConfig(
      id: json['id'] ?? '',
      name: json['name'],
      baseUrl: json['baseUrl'],
      apiKey: json['apiKey'] ?? '',
      isEnabled: json['isEnabled'] ?? true,
      priority: json['priority'] ?? 1,
      timeout: Duration(milliseconds: json['timeout'] ?? 30000),
      retryCount: json['retryCount'] ?? 3,
      headers: Map<String, String>.from(json['headers'] ?? {}),
    );
  }
}