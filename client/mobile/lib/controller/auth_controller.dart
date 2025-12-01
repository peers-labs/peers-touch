import 'package:flutter/material.dart';
import 'package:get/get.dart';
import 'package:peers_touch_mobile/l10n/app_localizations.dart';
import 'package:peers_touch_mobile/services/auth_service.dart';

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
    
    final authService = Get.find<AuthService>();
    
    // Load saved server address if available
    final savedServerAddress = authService.serverAddress.value;
    if (savedServerAddress.isNotEmpty) {
      serverAddressController.text = savedServerAddress;
    }
    
    // Load saved username if available
    final savedUsername = authService.lastUsername.value;
    if (savedUsername.isNotEmpty) {
      usernameController.text = savedUsername;
    }
    
    // Load saved password if available
    final savedPassword = authService.lastPassword.value;
    if (savedPassword.isNotEmpty) {
      passwordController.text = savedPassword;
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

  Future<void> submitForm() async {
    if (!validateForm()) {
      return;
    }

    // Login implementation
    try {
      isLoading.value = true;
      final authService = Get.find<AuthService>();
      
      // Save login info locally
      await authService.saveLoginInfo(
        username: usernameController.text.trim(),
        password: passwordController.text,
        serverAddr: serverAddressController.text.trim(),
      );

      if (isLoginMode.value) {
        await authService.login(
          usernameController.text.trim(),
          passwordController.text,
          serverAddressController.text.trim(),
        );
      } else {
        await authService.register(
          usernameController.text.trim(),
          passwordController.text,
          serverAddressController.text.trim(),
        );
      }
    } catch (e) {
      Get.snackbar(
        'Error',
        e.toString(),
        snackPosition: SnackPosition.BOTTOM,
      );
    } finally {
      isLoading.value = false;
    }
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