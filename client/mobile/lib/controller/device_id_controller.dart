import 'package:get/get.dart';
import 'package:peers_touch_mobile/service/device_id_service.dart';
import 'package:peers_touch_mobile/common/logger/logger.dart';

/// Controller for managing device identification
class DeviceIdController extends GetxController {
  final DeviceIdService _deviceIdService = DeviceIdService.instance;
  
  // Observable device ID
  final RxString deviceId = ''.obs;
  final RxString installationId = ''.obs;
  final RxBool isLoading = false.obs;
  final RxBool isFirstLaunch = false.obs;
  
  // Device information
  final RxMap<String, dynamic> deviceInfo = <String, dynamic>{}.obs;
  
  @override
  void onInit() {
    super.onInit();
    _initializeDeviceId();
  }
  
  /// Initialize device ID on app startup
  Future<void> _initializeDeviceId() async {
    try {
      isLoading.value = true;
      
      // Check if this is first launch
      isFirstLaunch.value = await _deviceIdService.isFirstLaunch();
      
      // Get device ID and installation ID
      final did = await _deviceIdService.getDeviceId();
      final iid = await _deviceIdService.getInstallationId();
      
      deviceId.value = did;
      installationId.value = iid;
      
      // Get device information
      deviceInfo.value = await _deviceIdService.getDeviceInfo();
      
      appLogger.info('Device ID initialized: ${did.substring(0, 20)}...');
      
      if (isFirstLaunch.value) {
        appLogger.info('First app launch detected');
        _onFirstLaunch();
      }
      
    } catch (e) {
      appLogger.error('Error initializing device ID: $e');
    } finally {
      isLoading.value = false;
    }
  }
  
  /// Handle first launch logic
  void _onFirstLaunch() {
    // You can add any first-launch specific logic here
    // For example: analytics, onboarding, etc.
    appLogger.info('Performing first launch setup');
  }
  
  /// Get the current device ID
  String getCurrentDeviceId() {
    return deviceId.value;
  }
  
  /// Get the current installation ID
  String getCurrentInstallationId() {
    return installationId.value;
  }
  
  /// Get device information as a formatted string
  String getDeviceInfoString() {
    if (deviceInfo.isEmpty) return 'Device info not available';
    
    final info = deviceInfo;
    final platform = info['platform'] ?? 'unknown';
    
    if (platform == 'android') {
      return '${info['brand']} ${info['model']} (Android ${info['sdkInt']})';
    } else if (platform == 'ios') {
      return '${info['name']} ${info['model']} (${info['systemName']} ${info['systemVersion']})';
    }
    
    return 'Unknown device';
  }
  
  /// Reset device ID (for testing/debugging)
  Future<void> resetDeviceId() async {
    try {
      isLoading.value = true;
      await _deviceIdService.resetDeviceId();
      
      // Re-initialize
      await _initializeDeviceId();
      
      appLogger.info('Device ID reset and re-initialized');
    } catch (e) {
      appLogger.error('Error resetting device ID: $e');
    } finally {
      isLoading.value = false;
    }
  }
  
  /// Generate a new device ID for avatar generation
  /// This uses the device ID as input for identicon generation
  String getIdenticonInput() {
    // Use device ID as input for generating consistent avatars
    return deviceId.value.isNotEmpty ? deviceId.value : 'fallback-id';
  }
}