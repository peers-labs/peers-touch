import 'package:flutter/material.dart';
import 'package:get/get.dart';
import 'package:peers_touch_mobile/l10n/app_localizations.dart';
import 'package:peers_touch_mobile/controller/controller.dart';

class AuthController extends GetxController {
  // Form fields
  final usernameController = TextEditingController();
  final passwordController = TextEditingController();
  final confirmPasswordController = TextEditingController();
  final serverAddressController = TextEditingController();

  // Form state
  final isLoginMode = true.obs;
  final isLoading = false.obs;
  final obscurePassword = true.obs;
  final obscureConfirmPassword = true.obs;

  // Validation errors
  final usernameError = ''.obs;
  final passwordError = ''.obs;
  final confirmPasswordError = ''.obs;
  final serverAddressError = ''.obs;

  @override
  void onInit() {
    super.onInit();
    // Initialize with empty values
    // Default to login mode
    isLoginMode.value = true;
    
    // Load saved server address if available
    final savedServerAddress = ControllerManager.authService.serverAddress.value;
    if (savedServerAddress.isNotEmpty) {
      serverAddressController.text = savedServerAddress;
    }
  }

  @override
  void onClose() {
    usernameController.dispose();
    passwordController.dispose();
    confirmPasswordController.dispose();
    serverAddressController.dispose();
    super.onClose();
  }

  void toggleMode() {
    isLoginMode.value = !isLoginMode.value;
    // Clear errors when switching modes
    clearErrors();
  }

  void clearErrors() {
    usernameError.value = '';
    passwordError.value = '';
    confirmPasswordError.value = '';
    serverAddressError.value = '';
  }

  bool validateForm() {
    clearErrors();
    bool isValid = true;

    // Validate username
    if (usernameController.text.trim().isEmpty) {
      usernameError.value = AppLocalizations.of(Get.context!)!.usernameRequired;
      isValid = false;
    }

    // Validate password
    if (passwordController.text.isEmpty) {
      passwordError.value = AppLocalizations.of(Get.context!)!.passwordRequired;
      isValid = false;
    } else if (passwordController.text.length < 6) {
      passwordError.value = AppLocalizations.of(Get.context!)!.passwordMinLength(6);
      isValid = false;
    }

    // Validate confirm password (only in register mode)
    if (!isLoginMode.value) {
      if (confirmPasswordController.text.isEmpty) {
        confirmPasswordError.value = AppLocalizations.of(Get.context!)!.passwordRequired;
        isValid = false;
      } else if (confirmPasswordController.text != passwordController.text) {
        confirmPasswordError.value = AppLocalizations.of(Get.context!)!.passwordMismatch;
        isValid = false;
      }
    }

    // Validate server address
    if (serverAddressController.text.trim().isEmpty) {
      serverAddressError.value = AppLocalizations.of(Get.context!)!.serverAddressRequired;
      isValid = false;
    } else if (!_isValidServerAddress(serverAddressController.text.trim())) {
      serverAddressError.value = AppLocalizations.of(Get.context!)!.invalidServerAddress;
      isValid = false;
    }

    return isValid;
  }

  bool _isValidServerAddress(String address) {
    // Basic URL validation
    final urlPattern = r'^https?://[\w\-._~:/?#\[\]@!$&()*+,;=]+$';
    final regex = RegExp(urlPattern, caseSensitive: false);
    return regex.hasMatch(address);
  }

  String _buildApiUrl(String endpoint) {
    String baseUrl = serverAddressController.text.trim();
    
    // Remove trailing slash if present
    if (baseUrl.endsWith('/')) {
      baseUrl = baseUrl.substring(0, baseUrl.length - 1);
    }
    
    // Add leading slash to endpoint if not present
    if (!endpoint.startsWith('/')) {
      endpoint = '/$endpoint';
    }
    
    return '$baseUrl$endpoint';
  }

  Future<void> submitForm() async {
    if (!validateForm()) {
      return;
    }

    isLoading.value = true;
    
    try {
      // Build the correct API endpoint
      final endpoint = isLoginMode.value ? '/user/login' : '/user/sign-up';
      final apiUrl = _buildApiUrl(endpoint);
      
      // Here you would implement actual API call
      // For now, we'll simulate success with the correct URL
      await Future.delayed(const Duration(seconds: 2));
      
      // Log the API URL for debugging (remove in production)
      debugPrint('API URL: $apiUrl');
      
      // Save authentication data
      await ControllerManager.authService.saveAuthData(
        loggedIn: true,
        token: 'dummy_token', // Use actual token from response in real implementation
        user: {'username': usernameController.text},
        serverAddr: serverAddressController.text,
      );
      
      if (isLoginMode.value) {
        _handleLoginSuccess();
      } else {
        _handleRegisterSuccess();
      }
    } catch (e) {
      _handleError(e.toString());
    } finally {
      isLoading.value = false;
    }
  }

  void _handleLoginSuccess() {
    // Save authentication data
    ControllerManager.authService.saveAuthData(
      loggedIn: true,
      token: 'dummy_token', // Use actual token from response in real implementation
      user: {'username': usernameController.text},
      serverAddr: serverAddressController.text,
    );
    
    final localizations = AppLocalizations.of(Get.context!)!;
    Get.snackbar(
      localizations.success,
      localizations.loginSuccess,
      snackPosition: SnackPosition.BOTTOM,
      backgroundColor: Colors.green,
      colorText: Colors.white,
    );
    
    // Navigate to home page or main app
    Get.offAllNamed('/home');
  }

  void _handleRegisterSuccess() {
    // Save authentication data
    ControllerManager.authService.saveAuthData(
      loggedIn: true,
      token: 'dummy_token', // Use actual token from response in real implementation
      user: {'username': usernameController.text},
      serverAddr: serverAddressController.text,
    );
    
    final localizations = AppLocalizations.of(Get.context!)!;
    Get.snackbar(
      localizations.success,
      localizations.registerSuccess,
      snackPosition: SnackPosition.BOTTOM,
      backgroundColor: Colors.green,
      colorText: Colors.white,
    );
    
    // Switch to login mode after successful registration
    isLoginMode.value = true;
    clearForm();
  }

  void _handleError(String error) {
    final localizations = AppLocalizations.of(Get.context!)!;
    Get.snackbar(
      localizations.error,
      isLoginMode.value ? localizations.loginFailed : localizations.registerFailed,
      snackPosition: SnackPosition.BOTTOM,
      backgroundColor: Colors.red,
      colorText: Colors.white,
    );
  }

  void clearForm() {
    usernameController.clear();
    passwordController.clear();
    confirmPasswordController.clear();
    serverAddressController.clear();
    clearErrors();
  }

  void togglePasswordVisibility() {
    obscurePassword.value = !obscurePassword.value;
  }

  void toggleConfirmPasswordVisibility() {
    obscureConfirmPassword.value = !obscureConfirmPassword.value;
  }
}