import 'package:get/get.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'dart:convert';
import 'package:dio/dio.dart';
import 'package:peers_touch_mobile/utils/logger.dart';

class AuthService extends GetxService {
  static const String _isLoggedInKey = 'is_logged_in';
  static const String _authTokenKey = 'auth_token';
  static const String _userInfoKey = 'user_info';
  static const String _serverAddressKey = 'server_address';
  static const String _lastUsernameKey = 'last_username';
  static const String _lastPasswordKey = 'last_password';

  final RxBool isLoggedIn = false.obs;
  final RxString authToken = ''.obs;
  final RxMap<String, dynamic> userInfo = <String, dynamic>{}.obs;
  final RxString serverAddress = ''.obs;
  final RxString lastUsername = ''.obs;
  final RxString lastPassword = ''.obs;

  Future<AuthService> init() async {
    await loadAuthData();
    return this;
  }

  String _normalizeUrl(String url) {
    if (url.isEmpty) return url;
    var normalized = url;
    if (!normalized.startsWith('http://') && !normalized.startsWith('https://')) {
      normalized = 'https://$normalized';
    }
    if (normalized.endsWith('/')) {
      normalized = normalized.substring(0, normalized.length - 1);
    }
    return normalized;
  }

  Future<void> login(String username, String password, String address) async {
    try {
      final baseUrl = _normalizeUrl(address);
      final fullUrl = '$baseUrl/actor/login';
      appLogger.i('Attempting login to: $fullUrl');
      
      // Create a new Dio instance for auth requests to avoid global config interference
      // or use Get.find<ApiClient>().dio if preferred
      final dio = Dio(BaseOptions(
        connectTimeout: const Duration(seconds: 10),
        receiveTimeout: const Duration(seconds: 10),
      ));

      final response = await dio.post(
        fullUrl,
        data: {
          'username': username,
          'password': password,
        },
      );

      if (response.statusCode == 200 || response.statusCode == 201) {
        final data = response.data;
        // Adapt to your actual API response structure
        final String token = data['token'] ?? '';
        final Map<String, dynamic> user = data['user'] is Map ? Map<String, dynamic>.from(data['user']) : {'username': username};
        
        await saveAuthData(
          loggedIn: true,
          token: token,
          user: user,
          serverAddr: baseUrl,
        );
      }
    } catch (e) {
      appLogger.e('Login error: $e');
      // If we want to allow offline testing or if API is not ready, 
      // we might want to mock success here if specific credentials are used,
      // but for now we rethrow to let the controller handle the error.
      rethrow;
    }
  }

  Future<void> register(String username, String password, String address) async {
    try {
      final baseUrl = _normalizeUrl(address);
      final fullUrl = '$baseUrl/api/auth/register';
      appLogger.i('Attempting register to: $fullUrl');

      final dio = Dio(BaseOptions(
        connectTimeout: const Duration(seconds: 10),
        receiveTimeout: const Duration(seconds: 10),
      ));

      final response = await dio.post(
        fullUrl,
        data: {
          'username': username,
          'password': password,
        },
      );

      if (response.statusCode == 200 || response.statusCode == 201) {
        final data = response.data;
        final String token = data['token'] ?? '';
        final Map<String, dynamic> user = data['user'] is Map ? Map<String, dynamic>.from(data['user']) : {'username': username};
        
        await saveAuthData(
          loggedIn: true,
          token: token,
          user: user,
          serverAddr: baseUrl,
        );
      }
    } catch (e) {
      appLogger.e('Registration error: $e');
      rethrow;
    }
  }

  Future<void> loadAuthData() async {
    final prefs = await SharedPreferences.getInstance();
    isLoggedIn.value = prefs.getBool(_isLoggedInKey) ?? false;
    authToken.value = prefs.getString(_authTokenKey) ?? '';
    serverAddress.value = prefs.getString(_serverAddressKey) ?? '';
    lastUsername.value = prefs.getString(_lastUsernameKey) ?? '';
    lastPassword.value = prefs.getString(_lastPasswordKey) ?? '';
    
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

  Future<void> saveLoginInfo({
    required String username,
    required String password,
    required String serverAddr,
  }) async {
    final prefs = await SharedPreferences.getInstance();
    await prefs.setString(_lastUsernameKey, username);
    await prefs.setString(_lastPasswordKey, password);
    await prefs.setString(_serverAddressKey, serverAddr);
    
    lastUsername.value = username;
    lastPassword.value = password;
    serverAddress.value = serverAddr;
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