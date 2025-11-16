import 'dart:async';
import 'package:connectivity_plus/connectivity_plus.dart';
import 'package:get/get.dart';
import 'package:peers_touch_mobile/store/base_store.dart';
import 'package:peers_touch_mobile/common/logger/logger.dart';

/// Global sync manager that coordinates synchronization across all stores
class SyncManager extends GetxController {
  static final SyncManager _instance = SyncManager._internal();
  factory SyncManager() => _instance;
  SyncManager._internal();

  // Registered stores
  final Map<String, BaseStore> _stores = {};
  
  // Sync event listeners
  final List<SyncEventListener> _listeners = [];
  
  // Network connectivity
  final Connectivity _connectivity = Connectivity();
  final Rx<NetworkStatus> _networkStatus = NetworkStatus.unknown.obs;
  StreamSubscription<List<ConnectivityResult>>? _connectivitySubscription;
  
  // Sync state
  final RxBool _isSyncing = false.obs;
  final RxString _currentSyncStore = ''.obs;
  final RxInt _syncProgress = 0.obs;
  final RxInt _syncTotal = 0.obs;
  
  // Auto-sync settings
  final RxBool _autoSyncEnabled = true.obs;
  Timer? _autoSyncTimer;
  final Duration _autoSyncInterval = const Duration(minutes: 5);
  
  // Getters
  NetworkStatus get networkStatus => _networkStatus.value;
  bool get isSyncing => _isSyncing.value;
  String get currentSyncStore => _currentSyncStore.value;
  int get syncProgress => _syncProgress.value;
  int get syncTotal => _syncTotal.value;
  bool get autoSyncEnabled => _autoSyncEnabled.value;
  
  // Streams
  Stream<NetworkStatus> get networkStatusStream => _networkStatus.stream;
  Stream<bool> get syncingStream => _isSyncing.stream;
  
  @override
  void onInit() {
    super.onInit();
    _initializeNetworkMonitoring();
    _startAutoSync();
  }
  
  @override
  void onClose() {
    _connectivitySubscription?.cancel();
    _autoSyncTimer?.cancel();
    super.onClose();
  }
  
  /// Initialize network connectivity monitoring
  void _initializeNetworkMonitoring() {
    _connectivitySubscription = _connectivity.onConnectivityChanged.listen(
      (List<ConnectivityResult> results) {
        _updateNetworkStatus(results.first);
      },
    );
    
    // Check initial connectivity
    _checkInitialConnectivity();
  }
  
  /// Check initial network connectivity
  Future<void> _checkInitialConnectivity() async {
    try {
      final results = await _connectivity.checkConnectivity();
      _updateNetworkStatus(results.first);
    } catch (e) {
      appLogger.error('Error checking initial connectivity: $e');
      _networkStatus.value = NetworkStatus.unknown;
    }
  }
  
  /// Update network status based on connectivity results
  void _updateNetworkStatus(ConnectivityResult result) {
    final wasConnected = _networkStatus.value == NetworkStatus.connected;
    
    if (result == ConnectivityResult.none) {
      _networkStatus.value = NetworkStatus.disconnected;
    } else if (result == ConnectivityResult.wifi || 
               result == ConnectivityResult.mobile ||
               result == ConnectivityResult.ethernet) {
      _networkStatus.value = NetworkStatus.connected;
    } else {
      _networkStatus.value = NetworkStatus.unknown;
    }
    
    // Notify listeners
    for (final listener in _listeners) {
      listener.onNetworkStatusChanged(_networkStatus.value);
    }
    
    // Auto-sync when network becomes available
    if (!wasConnected && _networkStatus.value == NetworkStatus.connected) {
      if (_autoSyncEnabled.value) {
        _scheduleSyncAll();
      }
    }
    
    appLogger.info('Network status changed to: ${_networkStatus.value}');
  }
  
  /// Register a store with the sync manager
  void registerStore(BaseStore store) {
    _stores[store.storeName] = store;
    appLogger.info('Registered store: ${store.storeName}');
  }
  
  /// Unregister a store from the sync manager
  void unregisterStore(String storeName) {
    _stores.remove(storeName);
    appLogger.info('Unregistered store: $storeName');
  }
  
  /// Add sync event listener
  void addSyncListener(SyncEventListener listener) {
    _listeners.add(listener);
  }
  
  /// Remove sync event listener
  void removeSyncListener(SyncEventListener listener) {
    _listeners.remove(listener);
  }
  
  /// Start auto-sync timer
  void _startAutoSync() {
    if (!_autoSyncEnabled.value) return;
    
    _autoSyncTimer?.cancel();
    _autoSyncTimer = Timer.periodic(_autoSyncInterval, (timer) {
      if (_networkStatus.value == NetworkStatus.connected && !_isSyncing.value) {
        _scheduleSyncAll();
      }
    });
  }
  
  /// Schedule sync for all stores
  void _scheduleSyncAll() {
    Future.delayed(const Duration(seconds: 1), () {
      syncAll();
    });
  }
  
  /// Enable or disable auto-sync
  void setAutoSyncEnabled(bool enabled) {
    _autoSyncEnabled.value = enabled;
    if (enabled) {
      _startAutoSync();
    } else {
      _autoSyncTimer?.cancel();
    }
  }
  
  /// Sync all registered stores
  Future<Map<String, SyncResult>> syncAll() async {
    if (_isSyncing.value) {
      appLogger.warning('Sync already in progress, skipping');
      return {};
    }
    
    if (_networkStatus.value != NetworkStatus.connected) {
      appLogger.warning('Network not available, skipping sync');
      return {};
    }
    
    _isSyncing.value = true;
    final results = <String, SyncResult>{};
    
    try {
      for (final entry in _stores.entries) {
        final storeName = entry.key;
        final store = entry.value;
        
        _currentSyncStore.value = storeName;
        
        // Notify listeners
        for (final listener in _listeners) {
          listener.onSyncStarted(storeName);
        }
        
        try {
          // Sync to servers first
          final toServerResult = await store.syncToServers();
          
          // Then sync from servers
          final fromServerResult = await store.syncFromServers();
          
          // Combine results
          final combinedResult = SyncResult(
            success: toServerResult.success && fromServerResult.success,
            error: toServerResult.error ?? fromServerResult.error,
            syncedCount: toServerResult.syncedCount + fromServerResult.syncedCount,
            failedCount: toServerResult.failedCount + fromServerResult.failedCount,
            timestamp: DateTime.now(),
          );
          
          results[storeName] = combinedResult;
          
          // Notify listeners
          for (final listener in _listeners) {
            listener.onSyncCompleted(storeName, combinedResult);
          }
          
          appLogger.info('Sync completed for $storeName: ${combinedResult.success}');
        } catch (e) {
          final errorResult = SyncResult(
            success: false,
            error: e.toString(),
            syncedCount: 0,
            failedCount: 1,
            timestamp: DateTime.now(),
          );
          
          results[storeName] = errorResult;
          
          // Notify listeners
          for (final listener in _listeners) {
            listener.onSyncCompleted(storeName, errorResult);
          }
          
          appLogger.error('Sync failed for $storeName: $e');
        }
      }
    } finally {
      _isSyncing.value = false;
      _currentSyncStore.value = '';
      _syncProgress.value = 0;
      _syncTotal.value = 0;
    }
    
    return results;
  }
  
  /// Sync specific store
  Future<SyncResult?> syncStore(String storeName) async {
    final store = _stores[storeName];
    if (store == null) {
      appLogger.error('Store not found: $storeName');
      return null;
    }
    
    if (_networkStatus.value != NetworkStatus.connected) {
      appLogger.warning('Network not available, skipping sync for $storeName');
      return null;
    }
    
    _currentSyncStore.value = storeName;
    
    // Notify listeners
    for (final listener in _listeners) {
      listener.onSyncStarted(storeName);
    }
    
    try {
      // Sync to servers first
      final toServerResult = await store.syncToServers();
      
      // Then sync from servers
      final fromServerResult = await store.syncFromServers();
      
      // Combine results
      final combinedResult = SyncResult(
        success: toServerResult.success && fromServerResult.success,
        error: toServerResult.error ?? fromServerResult.error,
        syncedCount: toServerResult.syncedCount + fromServerResult.syncedCount,
        failedCount: toServerResult.failedCount + fromServerResult.failedCount,
        timestamp: DateTime.now(),
      );
      
      // Notify listeners
      for (final listener in _listeners) {
        listener.onSyncCompleted(storeName, combinedResult);
      }
      
      return combinedResult;
    } catch (e) {
      final errorResult = SyncResult(
        success: false,
        error: e.toString(),
        syncedCount: 0,
        failedCount: 1,
        timestamp: DateTime.now(),
      );
      
      // Notify listeners
      for (final listener in _listeners) {
        listener.onSyncCompleted(storeName, errorResult);
      }
      
      appLogger.error('Sync failed for $storeName: $e');
      return errorResult;
    } finally {
      _currentSyncStore.value = '';
    }
  }
  
  /// Force sync all stores regardless of network status
  Future<Map<String, SyncResult>> forceSyncAll() async {
    final originalStatus = _networkStatus.value;
    _networkStatus.value = NetworkStatus.connected;
    
    try {
      return await syncAll();
    } finally {
      _networkStatus.value = originalStatus;
    }
  }
  
  /// Get sync statistics for all stores
  Future<Map<String, Map<String, int>>> getAllSyncStats() async {
    final stats = <String, Map<String, int>>{};
    
    for (final entry in _stores.entries) {
      try {
        stats[entry.key] = await entry.value.getSyncStats();
      } catch (e) {
        appLogger.error('Error getting sync stats for ${entry.key}: $e');
        stats[entry.key] = {'error': 1};
      }
    }
    
    return stats;
  }
  
  /// Check connectivity to all servers across all stores
  Future<Map<String, Map<String, bool>>> checkAllServerConnectivity() async {
    final connectivity = <String, Map<String, bool>>{};
    
    for (final entry in _stores.entries) {
      try {
        connectivity[entry.key] = await entry.value.checkServerConnectivity();
      } catch (e) {
        appLogger.error('Error checking connectivity for ${entry.key}: $e');
        connectivity[entry.key] = {'error': false};
      }
    }
    
    return connectivity;
  }
}