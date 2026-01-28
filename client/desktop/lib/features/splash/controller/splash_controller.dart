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
      final isValid = await _verifyToken();
      
      if (isValid) {
        LoggingService.info('Splash: Token valid, verifying user profile');
        statusMessage.value = '加载用户信息...';
        
        // Refresh profile to verify user still exists
        final hasProfile = await _verifyUserProfile();
        if (hasProfile) {
          LoggingService.info('Splash: User profile valid, navigating to shell');
          statusMessage.value = '登录成功';
          await Future.delayed(const Duration(milliseconds: 300));
          Get.offAllNamed(AppRoutes.shell);
        } else {
          LoggingService.warning('Splash: User profile not found, triggering logout');
          // Use unified logout event
          if (Get.isRegistered<GlobalContext>()) {
            Get.find<GlobalContext>().requestLogout(LogoutReason.userNotFound);
          } else {
            // Fallback if GlobalContext not ready
            await tokenProvider.clear();
            Get.offAllNamed(AppRoutes.login);
          }
        }
      } else {
        LoggingService.warning('Splash: Token invalid, triggering logout');
        // Use unified logout event
        if (Get.isRegistered<GlobalContext>()) {
          Get.find<GlobalContext>().requestLogout(LogoutReason.tokenExpired);
        } else {
          // Fallback if GlobalContext not ready
          await tokenProvider.clear();
          Get.offAllNamed(AppRoutes.login);
        }
      }
    } catch (e) {
      LoggingService.error('Splash: Error checking auth: $e');
      statusMessage.value = '验证失败';
      await Future.delayed(const Duration(milliseconds: 300));
      Get.offAllNamed(AppRoutes.login);
    }
  }

  Future<bool> _verifyToken() async {
    try {
      final client = HttpServiceLocator().httpService;
      final response = await client.get<dynamic>('/api/v1/session/verify')
        .timeout(const Duration(seconds: 3));
      return response.statusCode == 200;
    } catch (e) {
      LoggingService.warning('Splash: Token verification failed: $e');
      return false;
    }
  }

  Future<bool> _verifyUserProfile() async {
    try {
      // Try to refresh profile from server
      if (Get.isRegistered<GlobalContext>()) {
        final globalContext = Get.find<GlobalContext>();
        await globalContext.refreshProfile();
        
        // Check if profile was loaded successfully
        final profile = globalContext.userProfile;
        if (profile != null && profile['id'] != null) {
          LoggingService.info('Splash: User profile verified: id=${profile['id']}');
          return true;
        }
      }
      
      LoggingService.warning('Splash: User profile is null or invalid');
      return false;
    } catch (e) {
      LoggingService.warning('Splash: User profile verification failed: $e');
      return false;
    }
  }
}
