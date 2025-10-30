import 'package:flutter/material.dart';
import 'package:get/get.dart';
import 'package:peers_touch_mobile/store/sync_manager.dart';
import 'package:peers_touch_mobile/store/base_store.dart';

/// Sync status bar that appears at the top of the app
class SyncStatusBar extends StatelessWidget {
  final SyncManager _syncManager = Get.find<SyncManager>();
  
  SyncStatusBar({Key? key}) : super(key: key);
  
  @override
  Widget build(BuildContext context) {
    return Obx(() {
      final networkStatus = _syncManager.networkStatus;
      final isSyncing = _syncManager.isSyncing;
      final currentStore = _syncManager.currentSyncStore;
      
      // Don't show anything if network is connected and not syncing
      if (networkStatus == NetworkStatus.connected && !isSyncing) {
        return const SizedBox.shrink();
      }
      
      return AnimatedContainer(
        duration: const Duration(milliseconds: 300),
        height: _shouldShow(networkStatus, isSyncing) ? 48.0 : 0.0,
        child: Container(
          width: double.infinity,
          decoration: BoxDecoration(
            color: _getBackgroundColor(networkStatus, isSyncing),
            boxShadow: [
              BoxShadow(
                color: Colors.black.withValues(alpha: 0.1),
                offset: const Offset(0, 2),
                blurRadius: 4,
              ),
            ],
          ),
          child: SafeArea(
            bottom: false,
            child: Padding(
              padding: const EdgeInsets.symmetric(horizontal: 16.0, vertical: 8.0),
              child: Row(
                children: [
                  _buildIcon(networkStatus, isSyncing),
                  const SizedBox(width: 12),
                  Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      mainAxisAlignment: MainAxisAlignment.center,
                      children: [
                        Text(
                          _getTitle(networkStatus, isSyncing, currentStore),
                          style: const TextStyle(
                            color: Colors.white,
                            fontSize: 14,
                            fontWeight: FontWeight.w600,
                          ),
                        ),
                        if (_getSubtitle(networkStatus, isSyncing) != null)
                          Text(
                            _getSubtitle(networkStatus, isSyncing)!,
                            style: TextStyle(
                              color: Colors.white.withValues(alpha: 0.8),
                              fontSize: 12,
                            ),
                          ),
                      ],
                    ),
                  ),
                  if (isSyncing) _buildSyncProgress(),
                  if (!isSyncing && networkStatus == NetworkStatus.disconnected)
                    _buildRetryButton(),
                ],
              ),
            ),
          ),
        ),
      );
    });
  }
  
  bool _shouldShow(NetworkStatus networkStatus, bool isSyncing) {
    return isSyncing || networkStatus == NetworkStatus.disconnected;
  }
  
  Color _getBackgroundColor(NetworkStatus networkStatus, bool isSyncing) {
    if (isSyncing) {
      return const Color(0xFF2196F3); // Blue for syncing
    }
    
    switch (networkStatus) {
      case NetworkStatus.disconnected:
        return const Color(0xFFFF9800); // Orange for offline
      case NetworkStatus.connected:
        return const Color(0xFF4CAF50); // Green for connected
      case NetworkStatus.unknown:
        return const Color(0xFF9E9E9E); // Gray for unknown
    }
  }
  
  Widget _buildIcon(NetworkStatus networkStatus, bool isSyncing) {
    if (isSyncing) {
      return const SizedBox(
        width: 20,
        height: 20,
        child: CircularProgressIndicator(
          strokeWidth: 2,
          valueColor: AlwaysStoppedAnimation<Color>(Colors.white),
        ),
      );
    }
    
    IconData iconData;
    switch (networkStatus) {
      case NetworkStatus.disconnected:
        iconData = Icons.cloud_off;
        break;
      case NetworkStatus.connected:
        iconData = Icons.cloud_done;
        break;
      case NetworkStatus.unknown:
        iconData = Icons.cloud_queue;
        break;
    }
    
    return Icon(
      iconData,
      color: Colors.white,
      size: 20,
    );
  }
  
  String _getTitle(NetworkStatus networkStatus, bool isSyncing, String currentStore) {
    if (isSyncing) {
      if (currentStore.isNotEmpty) {
        return 'Syncing $currentStore...';
      }
      return 'Syncing data...';
    }
    
    switch (networkStatus) {
      case NetworkStatus.disconnected:
        return 'Working offline';
      case NetworkStatus.connected:
        return 'Connected';
      case NetworkStatus.unknown:
        return 'Checking connection...';
    }
  }
  
  String? _getSubtitle(NetworkStatus networkStatus, bool isSyncing) {
    if (isSyncing) {
      return 'Your data is being synchronized';
    }
    
    switch (networkStatus) {
      case NetworkStatus.disconnected:
        return 'Data will sync when connection is restored';
      case NetworkStatus.connected:
        return null;
      case NetworkStatus.unknown:
        return null;
    }
  }
  
  Widget _buildSyncProgress() {
    return Obx(() {
      final progress = _syncManager.syncProgress;
      final total = _syncManager.syncTotal;
      
      if (total > 0) {
        return Container(
          padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
          decoration: BoxDecoration(
            color: Colors.white.withValues(alpha: 0.2),
            borderRadius: BorderRadius.circular(12),
          ),
          child: Text(
            '$progress/$total',
            style: const TextStyle(
              color: Colors.white,
              fontSize: 12,
              fontWeight: FontWeight.w500,
            ),
          ),
        );
      }
      
      return const SizedBox.shrink();
    });
  }
  
  Widget _buildRetryButton() {
    return GestureDetector(
      onTap: () {
        _syncManager.syncAll();
      },
      child: Container(
        padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 6),
        decoration: BoxDecoration(
          color: Colors.white.withValues(alpha: 0.2),
          borderRadius: BorderRadius.circular(16),
          border: Border.all(
            color: Colors.white.withValues(alpha: 0.3),
            width: 1,
          ),
        ),
        child: const Row(
          mainAxisSize: MainAxisSize.min,
          children: [
            Icon(
              Icons.refresh,
              color: Colors.white,
              size: 16,
            ),
            SizedBox(width: 4),
            Text(
              'Retry',
              style: TextStyle(
                color: Colors.white,
                fontSize: 12,
                fontWeight: FontWeight.w500,
              ),
            ),
          ],
        ),
      ),
    );
  }
}

/// Sync status indicator for individual items
class SyncStatusIndicator extends StatelessWidget {
  final Map<String, SyncStatus> syncStatus;
  final double size;
  final bool showLabel;
  
  const SyncStatusIndicator({
    Key? key,
    required this.syncStatus,
    this.size = 16,
    this.showLabel = false,
  }) : super(key: key);
  
  @override
  Widget build(BuildContext context) {
    final overallStatus = _getOverallStatus();
    
    return Row(
      mainAxisSize: MainAxisSize.min,
      children: [
        Icon(
          _getIcon(overallStatus),
          color: _getColor(overallStatus),
          size: size,
        ),
        if (showLabel) ...[
          const SizedBox(width: 4),
          Text(
            _getLabelText(overallStatus),
            style: TextStyle(
              color: _getColor(overallStatus),
              fontSize: size * 0.75,
              fontWeight: FontWeight.w500,
            ),
          ),
        ],
      ],
    );
  }
  
  SyncStatus _getOverallStatus() {
    if (syncStatus.isEmpty) return SyncStatus.localOnly;
    
    final statuses = syncStatus.values.toList();
    
    // If any failed, show failed
    if (statuses.contains(SyncStatus.syncFailed)) {
      return SyncStatus.syncFailed;
    }
    
    // If any local only, show local only
    if (statuses.contains(SyncStatus.localOnly)) {
      return SyncStatus.localOnly;
    }
    
    // If any syncing, show syncing
    if (statuses.contains(SyncStatus.syncing)) {
      return SyncStatus.syncing;
    }
    
    // All synced
    return SyncStatus.synced;
  }
  
  IconData _getIcon(SyncStatus status) {
    switch (status) {
      case SyncStatus.localOnly:
        return Icons.schedule;
      case SyncStatus.syncing:
        return Icons.sync;
      case SyncStatus.synced:
        return Icons.cloud_done;
      case SyncStatus.syncFailed:
        return Icons.error_outline;
    }
  }
  
  Color _getColor(SyncStatus status) {
    switch (status) {
      case SyncStatus.localOnly:
        return Colors.orange;
      case SyncStatus.syncing:
        return Colors.blue;
      case SyncStatus.synced:
        return Colors.green;
      case SyncStatus.syncFailed:
        return Colors.red;
    }
  }
  
  String _getLabelText(SyncStatus status) {
    switch (status) {
      case SyncStatus.localOnly:
        return 'Local Only';
      case SyncStatus.syncing:
        return 'Syncing';
      case SyncStatus.synced:
        return 'Synced';
      case SyncStatus.syncFailed:
        return 'Failed';
    }
  }
}

/// Sync settings dialog
class SyncSettingsDialog extends StatelessWidget {
  final SyncManager _syncManager = Get.find<SyncManager>();
  
  SyncSettingsDialog({Key? key}) : super(key: key);
  
  @override
  Widget build(BuildContext context) {
    return AlertDialog(
      title: const Text('Sync Settings'),
      content: Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          Obx(() => SwitchListTile(
            title: const Text('Auto Sync'),
            subtitle: const Text('Automatically sync when network is available'),
            value: _syncManager.autoSyncEnabled,
            onChanged: (value) {
              _syncManager.setAutoSyncEnabled(value);
            },
          )),
          const Divider(),
          ListTile(
            leading: const Icon(Icons.sync),
            title: const Text('Sync Now'),
            subtitle: const Text('Manually sync all data'),
            onTap: () {
              Navigator.of(context).pop();
              _syncManager.syncAll();
            },
          ),
          ListTile(
            leading: const Icon(Icons.info_outline),
            title: const Text('Sync Status'),
            subtitle: const Text('View detailed sync information'),
            onTap: () {
              Navigator.of(context).pop();
              _showSyncStatusDialog(context);
            },
          ),
        ],
      ),
      actions: [
        TextButton(
          onPressed: () => Navigator.of(context).pop(),
          child: const Text('Close'),
        ),
      ],
    );
  }
  
  void _showSyncStatusDialog(BuildContext context) {
    showDialog(
      context: context,
      builder: (context) => SyncStatusDialog(),
    );
  }
}

/// Detailed sync status dialog
class SyncStatusDialog extends StatelessWidget {
  final SyncManager _syncManager = Get.find<SyncManager>();
  
  SyncStatusDialog({Key? key}) : super(key: key);
  
  @override
  Widget build(BuildContext context) {
    return AlertDialog(
      title: const Text('Sync Status'),
      content: SizedBox(
        width: double.maxFinite,
        child: FutureBuilder<Map<String, Map<String, int>>>(
          future: _syncManager.getAllSyncStats(),
          builder: (context, snapshot) {
            if (snapshot.connectionState == ConnectionState.waiting) {
              return const Center(child: CircularProgressIndicator());
            }
            
            if (snapshot.hasError) {
              return Text('Error: ${snapshot.error}');
            }
            
            final stats = snapshot.data ?? {};
            
            return Column(
              mainAxisSize: MainAxisSize.min,
              children: [
                Obx(() => _buildNetworkStatus()),
                const Divider(),
                ...stats.entries.map((entry) => _buildStoreStats(entry.key, entry.value)),
              ],
            );
          },
        ),
      ),
      actions: [
        TextButton(
          onPressed: () => Navigator.of(context).pop(),
          child: const Text('Close'),
        ),
      ],
    );
  }
  
  Widget _buildNetworkStatus() {
    final status = _syncManager.networkStatus;
    final isSyncing = _syncManager.isSyncing;
    
    return ListTile(
      leading: Icon(
        status == NetworkStatus.connected ? Icons.wifi : Icons.wifi_off,
        color: status == NetworkStatus.connected ? Colors.green : Colors.red,
      ),
      title: Text('Network: ${status.toString().split('.').last}'),
      subtitle: Text(isSyncing ? 'Syncing...' : 'Ready'),
      trailing: isSyncing ? const SizedBox(
        width: 20,
        height: 20,
        child: CircularProgressIndicator(strokeWidth: 2),
      ) : null,
    );
  }
  
  Widget _buildStoreStats(String storeName, Map<String, int> stats) {
    return ExpansionTile(
      leading: const Icon(Icons.storage),
      title: Text(storeName),
      children: stats.entries.map((entry) => ListTile(
        title: Text(entry.key),
        trailing: Text(entry.value.toString()),
      )).toList(),
    );
  }
}