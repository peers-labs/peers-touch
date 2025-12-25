
import 'dart:convert';
import 'dart:io';
import 'package:peers_touch_base/logger/logging_service.dart';
import 'package:peers_touch_base/storage/file_storage_manager.dart';
import 'capability_base.dart';

class StorageCapability extends AppletCapability {
  @override
  String get moduleName => 'storage';

  @override
  Future<dynamic> handle(String action, Map<String, dynamic> params, String appId) async {
    switch (action) {
      case 'set':
        return _handleSet(params, appId);
      case 'get':
        return _handleGet(params, appId);
      case 'remove':
        return _handleRemove(params, appId);
      case 'clear':
        return _handleClear(appId);
      default:
        throw Exception("Unknown action: $action");
    }
  }

  /// Helper to get the storage file for a specific applet
  Future<File> _getStorageFile(String appId) async {
    return FileStorageManager().getFile(
      StorageLocation.support,
      StorageNamespace.applets,
      'storage.json',
      subDir: appId, // Isolate storage by AppID
    );
  }

  /// Helper to read storage map
  Future<Map<String, dynamic>> _readStorage(String appId) async {
    try {
      final file = await _getStorageFile(appId);
      if (await file.exists()) {
        final content = await file.readAsString();
        if (content.isNotEmpty) {
          return jsonDecode(content) as Map<String, dynamic>;
        }
      }
    } catch (e) {
      LoggingService.error('StorageCap: Failed to read storage for $appId', e);
    }
    return {};
  }

  /// Helper to write storage map
  Future<void> _writeStorage(String appId, Map<String, dynamic> data) async {
    try {
      final file = await _getStorageFile(appId);
      await file.writeAsString(jsonEncode(data));
    } catch (e) {
      LoggingService.error('StorageCap: Failed to write storage for $appId', e);
    }
  }

  Future<void> _handleSet(Map<String, dynamic> params, String appId) async {
    final key = params['key'];
    final value = params['value'];
    
    if (key == null) return;

    final data = await _readStorage(appId);
    data[key.toString()] = value;
    await _writeStorage(appId, data);
    
    LoggingService.info("Applet $appId set storage: $key = $value");
  }

  Future<dynamic> _handleGet(Map<String, dynamic> params, String appId) async {
    final key = params['key'];
    if (key == null) return null;

    final data = await _readStorage(appId);
    return data[key.toString()];
  }

  Future<void> _handleRemove(Map<String, dynamic> params, String appId) async {
    final key = params['key'];
    if (key == null) return;

    final data = await _readStorage(appId);
    if (data.containsKey(key.toString())) {
      data.remove(key.toString());
      await _writeStorage(appId, data);
      LoggingService.info("Applet $appId removed storage key: $key");
    }
  }

  Future<void> _handleClear(String appId) async {
    try {
      final file = await _getStorageFile(appId);
      if (await file.exists()) {
        await file.delete();
        LoggingService.info("Applet $appId cleared all storage");
      }
    } catch (e) {
      LoggingService.error('StorageCap: Failed to clear storage for $appId', e);
    }
  }
}
