import 'dart:io';

import 'package:get/get.dart';
import 'package:peers_touch_base/context/global_context.dart';
import 'package:peers_touch_base/logger/logging_service.dart';
import 'package:peers_touch_base/network/dio/http_service_locator.dart';
import 'package:peers_touch_base/network/token_provider.dart';
import 'package:peers_touch_base/storage/local_storage_adapter.dart';
import 'package:peers_touch_desktop/app/routes/app_routes.dart';

class SplashController extends GetxController {
  final userAvatar = Rx<String?>(null);
  final userHandle = Rx<String?>(null);
  // MYQ：说了，不要有语言的硬编码
  final statusMessage = '正在初始化...'.obs;
  final showButtons = false.obs;
  final isLoading = false.obs;

  @override
  void onInit() {
    super.onInit();
    _loadUserInfo();
  }

  Future<void> _loadUserInfo() async {
    try {
      await Future.delayed(const Duration(milliseconds: 100));
      
      final localStorage = Get.find<LocalStorageAdapter>();
      final session = await localStorage.get<Map<String, dynamic>>('global:current_session');
      
      if (session != null) {
        userAvatar.value = session['avatarUrl']?.toString();
        userHandle.value = session['handle']?.toString() ?? session['actorId']?.toString();
        statusMessage.value = '欢迎回来';
        LoggingService.info('Splash: Found user session - handle: ${userHandle.value}, avatar: ${userAvatar.value}');
      } else {
        statusMessage.value = '请选择登录方式';
        LoggingService.info('Splash: No user session found');
      }
      
      await Future.delayed(const Duration(milliseconds: 300));
      showButtons.value = true;
    } catch (e) {
      LoggingService.error('Splash: Error loading user info: $e');
      statusMessage.value = '初始化失败';
      await Future.delayed(const Duration(milliseconds: 500));
      Get.offAllNamed(AppRoutes.login);
    }
  }

  void directLogin() async {
    if (isLoading.value) return;
    
    isLoading.value = true;
    showButtons.value = false;
    await _checkAuthAndNavigate();
    isLoading.value = false;
  }

  void gotoLogin() {
    Get.offAllNamed(AppRoutes.login);
  }

  Future<void> _checkAuthAndNavigate() async {
    try {
      statusMessage.value = '验证身份...';
      
      final tokenProvider = Get.find<TokenProvider>();
      final token = await tokenProvider.readAccessToken();
      
      if (token == null || token.isEmpty) {
        LoggingService.info('Splash: No token found, navigating to login');
        statusMessage.value = '请登录';
        await Future.delayed(const Duration(milliseconds: 300));
        Get.offAllNamed(AppRoutes.login);
        return;
      }
      
      LoggingService.info('Splash: Token found, verifying with backend');
      final verifyResult = await _verifyToken();
      
      if (verifyResult == _VerifyResult.valid) {
        LoggingService.info('Splash: Token valid, verifying user profile');
        statusMessage.value = '加载用户信息...';
        
        final profileResult = await _verifyUserProfile();
        if (profileResult == _VerifyResult.valid) {
          LoggingService.info('Splash: User profile valid, navigating to shell');
          statusMessage.value = '登录成功';
          await Future.delayed(const Duration(milliseconds: 300));
          Get.offAllNamed(AppRoutes.shell);
        } else if (profileResult == _VerifyResult.networkError) {
          // Network error — don't invalidate the session, let user in
          LoggingService.warning('Splash: Profile check skipped (network error), entering app');
          statusMessage.value = '登录成功';
          await Future.delayed(const Duration(milliseconds: 300));
          Get.offAllNamed(AppRoutes.shell);
        } else {
          LoggingService.warning('Splash: User profile not found, triggering logout');
          if (Get.isRegistered<GlobalContext>()) {
            Get.find<GlobalContext>().requestLogout(LogoutReason.userNotFound);
          } else {
            await tokenProvider.clear();
            Get.offAllNamed(AppRoutes.login);
          }
        }
      } else if (verifyResult == _VerifyResult.networkError) {
        // Network error — token may still be valid, let user in
        LoggingService.warning('Splash: Token verify skipped (network error), entering app');
        statusMessage.value = '登录成功';
        await Future.delayed(const Duration(milliseconds: 300));
        Get.offAllNamed(AppRoutes.shell);
      } else {
        LoggingService.warning('Splash: Token invalid, triggering logout');
        if (Get.isRegistered<GlobalContext>()) {
          Get.find<GlobalContext>().requestLogout(LogoutReason.tokenExpired);
        } else {
          await tokenProvider.clear();
          Get.offAllNamed(AppRoutes.login);
        }
      }
    } catch (e) {
      // Distinguish network errors from other failures
      if (_isNetworkError(e)) {
        LoggingService.warning('Splash: Network error during auth check, entering app: $e');
        statusMessage.value = '登录成功';
        await Future.delayed(const Duration(milliseconds: 300));
        Get.offAllNamed(AppRoutes.shell);
      } else {
        LoggingService.error('Splash: Error checking auth: $e');
        statusMessage.value = '验证失败';
        await Future.delayed(const Duration(milliseconds: 300));
        Get.offAllNamed(AppRoutes.login);
      }
    }
  }

  Future<_VerifyResult> _verifyToken() async {
    try {
      final client = HttpServiceLocator().httpService;
      final response = await client.getResponse<dynamic>('/api/v1/session/verify');
      if (response.statusCode == 200) return _VerifyResult.valid;
      if (response.statusCode == 401) return _VerifyResult.invalid;
      return _VerifyResult.invalid;
    } catch (e) {
      LoggingService.warning('Splash: Token verification failed: $e');
      return _isNetworkError(e) ? _VerifyResult.networkError : _VerifyResult.invalid;
    }
  }

  Future<_VerifyResult> _verifyUserProfile() async {
    try {
      if (Get.isRegistered<GlobalContext>()) {
        final globalContext = Get.find<GlobalContext>();
        await globalContext.refreshProfile();
        
        final profile = globalContext.userProfile;
        if (profile != null && profile['id'] != null) {
          LoggingService.info('Splash: User profile verified: id=${profile['id']}');
          return _VerifyResult.valid;
        }
      }
      
      LoggingService.warning('Splash: User profile is null or invalid');
      return _VerifyResult.invalid;
    } catch (e) {
      LoggingService.warning('Splash: User profile verification failed: $e');
      return _isNetworkError(e) ? _VerifyResult.networkError : _VerifyResult.invalid;
    }
  }

  bool _isNetworkError(Object e) {
    if (e is SocketException) return true;
    final msg = e.toString().toLowerCase();
    return msg.contains('socketexception') ||
        msg.contains('connection refused') ||
        msg.contains('connection reset') ||
        msg.contains('timed out') ||
        msg.contains('timeout') ||
        msg.contains('network is unreachable');
  }
}

enum _VerifyResult { valid, invalid, networkError }
