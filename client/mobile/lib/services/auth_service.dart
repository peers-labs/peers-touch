import 'package:get/get.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'dart:convert';
import 'package:peers_touch_mobile/utils/logger.dart';

class AuthService extends GetxService {
  static const String _isLoggedInKey = 'is_logged_in';
  static const String _authTokenKey = 'auth_token';
  static const String _userInfoKey = 'user_info';
  static const String _serverAddressKey = 'server_address';

  final RxBool isLoggedIn = false.obs;
  final RxString authToken = ''.obs;
  final RxMap<String, dynamic> userInfo = <String, dynamic>{}.obs;
  final RxString serverAddress = ''.obs;

  Future<AuthService> init() async {
    await loadAuthData();
    return this;
  }

  Future<void> loadAuthData() async {
    final prefs = await SharedPreferences.getInstance();
    isLoggedIn.value = prefs.getBool(_isLoggedInKey) ?? false;
    authToken.value = prefs.getString(_authTokenKey) ?? '';
    serverAddress.value = prefs.getString(_serverAddressKey) ?? '';
    
    final userInfoString = prefs.getString(_userInfoKey);
    if (userInfoString != null && userInfoString.isNotEmpty) {
      try {
        userInfo.value = Map<String, dynamic>.from(json.decode(userInfoString));
      } catch (e) {
        appLogger.e('Error loading user info: $e');
        userInfo.clear();
      }
    }
  }

  Future<void> saveAuthData({
    required bool loggedIn,
    String? token,
    Map<String, dynamic>? user,
    String? serverAddr,
  }) async {
    final prefs = await SharedPreferences.getInstance();
    
    await prefs.setBool(_isLoggedInKey, loggedIn);
    isLoggedIn.value = loggedIn;
    
    if (token != null) {
      await prefs.setString(_authTokenKey, token);
      authToken.value = token;
    }
    
    if (user != null) {
      final userInfoString = json.encode(user);
      await prefs.setString(_userInfoKey, userInfoString);
      userInfo.value = user;
    }
    
    if (serverAddr != null) {
      await prefs.setString(_serverAddressKey, serverAddr);
      serverAddress.value = serverAddr;
    }
  }

  Future<void> saveServerAddress(String address) async {
    final prefs = await SharedPreferences.getInstance();
    await prefs.setString(_serverAddressKey, address);
    serverAddress.value = address;
  }

  Future<void> clearAuthData() async {
    final prefs = await SharedPreferences.getInstance();
    await prefs.remove(_isLoggedInKey);
    await prefs.remove(_authTokenKey);
    await prefs.remove(_userInfoKey);
    // 保留服务器地址，不清除
    
    isLoggedIn.value = false;
    authToken.value = '';
    userInfo.clear();
  }

  Future<void> logout() async {
    await clearAuthData();
  }

  bool get hasValidAuth => isLoggedIn.value && authToken.value.isNotEmpty;
}