import 'dart:io';
import 'package:device_info_plus/device_info_plus.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'package:uuid/uuid.dart';
import 'package:peers_touch_mobile/common/logger/logger.dart';

/// Service for managing device-specific identifiers (DID)
/// Generates a unique identifier per device installation that persists across app sessions
class DeviceIdService {
  static const String _deviceIdKey = 'device_id';
  static const String _installationIdKey = 'installation_id';
  
  static DeviceIdService? _instance;
  static DeviceIdService get instance => _instance ??= DeviceIdService._();
  
  DeviceIdService._();
  
  String? _cachedDeviceId;
  String? _cachedInstallationId;
  
  /// Get the device ID (DID) - unique per device installation
  /// This combines device hardware info with a unique installation UUID
  Future<String> getDeviceId() async {
    if (_cachedDeviceId != null) {
      return _cachedDeviceId!;
    }
    
    try {
      final prefs = await SharedPreferences.getInstance();
      
      // Check if we already have a stored device ID
      String? storedDeviceId = prefs.getString(_deviceIdKey);
      
      if (storedDeviceId != null && storedDeviceId.isNotEmpty) {
        _cachedDeviceId = storedDeviceId;
        appLogger.info('Retrieved existing device ID: ${storedDeviceId.substring(0, 8)}...');
        return storedDeviceId;
      }
      
      // Generate new device ID
      final deviceId = await _generateDeviceId();
      
      // Store it persistently
      await prefs.setString(_deviceIdKey, deviceId);
      _cachedDeviceId = deviceId;
      
      appLogger.info('Generated new device ID: ${deviceId.substring(0, 8)}...');
      return deviceId;
      
    } catch (e) {
      appLogger.error('Error getting device ID: $e');
      // Fallback to a simple UUID if device info fails
      final fallbackId = const Uuid().v4();
      _cachedDeviceId = fallbackId;
      return fallbackId;
    }
  }
  
  /// Get installation ID - unique per app installation
  /// This changes if the app is uninstalled and reinstalled
  Future<String> getInstallationId() async {
    if (_cachedInstallationId != null) {
      return _cachedInstallationId!;
    }
    
    try {
      final prefs = await SharedPreferences.getInstance();
      
      // Check if we already have a stored installation ID
      String? storedInstallationId = prefs.getString(_installationIdKey);
      
      if (storedInstallationId != null && storedInstallationId.isNotEmpty) {
        _cachedInstallationId = storedInstallationId;
        return storedInstallationId;
      }
      
      // Generate new installation ID
      final installationId = const Uuid().v4();
      
      // Store it persistently
      await prefs.setString(_installationIdKey, installationId);
      _cachedInstallationId = installationId;
      
      appLogger.info('Generated new installation ID: ${installationId.substring(0, 8)}...');
      return installationId;
      
    } catch (e) {
      appLogger.error('Error getting installation ID: $e');
      // Fallback to a simple UUID
      final fallbackId = const Uuid().v4();
      _cachedInstallationId = fallbackId;
      return fallbackId;
    }
  }
  
  /// Generate a device-specific identifier
  /// Combines device hardware information with installation UUID
  Future<String> _generateDeviceId() async {
    final deviceInfo = DeviceInfoPlugin();
    final installationId = await getInstallationId();
    
    String deviceIdentifier;
    
    if (Platform.isAndroid) {
      final androidInfo = await deviceInfo.androidInfo;
      // Combine multiple Android device identifiers
      deviceIdentifier = '${androidInfo.brand}_${androidInfo.model}_${androidInfo.device}_${androidInfo.hardware}';
    } else if (Platform.isIOS) {
      final iosInfo = await deviceInfo.iosInfo;
      // Combine iOS device identifiers
      deviceIdentifier = '${iosInfo.name}_${iosInfo.model}_${iosInfo.systemName}_${iosInfo.systemVersion}';
    } else {
      // Fallback for other platforms
      deviceIdentifier = 'unknown_device';
    }
    
    // Create a deterministic but unique ID by combining device info with installation UUID
    // Format: did:device:{platform}:{hash_of_device_info}:{installation_uuid}
    final platform = Platform.isAndroid ? 'android' : Platform.isIOS ? 'ios' : 'unknown';
    final deviceHash = deviceIdentifier.hashCode.abs().toString();
    
    return 'did:device:$platform:$deviceHash:$installationId';
  }
  
  /// Get device information for debugging
  Future<Map<String, dynamic>> getDeviceInfo() async {
    final deviceInfo = DeviceInfoPlugin();
    
    if (Platform.isAndroid) {
      final androidInfo = await deviceInfo.androidInfo;
      return {
        'platform': 'android',
        'brand': androidInfo.brand,
        'model': androidInfo.model,
        'device': androidInfo.device,
        'hardware': androidInfo.hardware,
        'androidId': androidInfo.id,
        'sdkInt': androidInfo.version.sdkInt,
      };
    } else if (Platform.isIOS) {
      final iosInfo = await deviceInfo.iosInfo;
      return {
        'platform': 'ios',
        'name': iosInfo.name,
        'model': iosInfo.model,
        'systemName': iosInfo.systemName,
        'systemVersion': iosInfo.systemVersion,
        'identifierForVendor': iosInfo.identifierForVendor,
      };
    }
    
    return {'platform': 'unknown'};
  }
  
  /// Reset device ID (for testing purposes)
  Future<void> resetDeviceId() async {
    final prefs = await SharedPreferences.getInstance();
    await prefs.remove(_deviceIdKey);
    await prefs.remove(_installationIdKey);
    _cachedDeviceId = null;
    _cachedInstallationId = null;
    appLogger.info('Device ID and Installation ID reset');
  }
  
  /// Check if this is the first app launch
  Future<bool> isFirstLaunch() async {
    final prefs = await SharedPreferences.getInstance();
    return !prefs.containsKey(_deviceIdKey);
  }
}