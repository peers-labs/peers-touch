import 'package:flutter/material.dart';
import 'package:get/get.dart';
import 'package:peers_touch_mobile/controller/auth_controller.dart';
import 'package:peers_touch_mobile/l10n/app_localizations.dart';

class AuthPage extends StatelessWidget {
  const AuthPage({super.key});

  @override
  Widget build(BuildContext context) {
    final authController = Get.put(AuthController());
    final localizations = AppLocalizations.of(context)!;
    
    return Scaffold(
      body: SafeArea(
        child: SingleChildScrollView(
          padding: const EdgeInsets.all(24.0),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              const SizedBox(height: 40),
              
              // App Logo/Title
              Center(
                child: Column(
                  children: [
                    Image.asset(
                      'assets/images/logo.png',
                      height: 80,
                      errorBuilder: (context, error, stackTrace) {
                        return const Icon(
                          Icons.person,
                          size: 80,
                          color: Colors.blue,
                        );
                      },
                    ),
                    const SizedBox(height: 16),
                    Text(
                      localizations.appTitle,
                      style: const TextStyle(
                        fontSize: 28,
                        fontWeight: FontWeight.bold,
                      ),
                    ),
                  ],
                ),
              ),
              
              const SizedBox(height: 48),
              
              // Form Card
              Card(
                elevation: 4,
                shape: RoundedRectangleBorder(
                  borderRadius: BorderRadius.circular(16),
                ),
                child: Padding(
                  padding: const EdgeInsets.all(24.0),
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.stretch,
                    children: [
                      // Title
                      Text(
                        authController.isLoginMode.value
                            ? localizations.login
                            : localizations.register,
                        style: const TextStyle(
                          fontSize: 24,
                          fontWeight: FontWeight.bold,
                        ),
                        textAlign: TextAlign.center,
                      ),
                      
                      const SizedBox(height: 24),
                      
                      // Username Field
                      TextFormField(
                        controller: authController.usernameController,
                        decoration: InputDecoration(
                          labelText: localizations.username,
                          prefixIcon: const Icon(Icons.person),
                          border: OutlineInputBorder(
                            borderRadius: BorderRadius.circular(12),
                          ),
                          errorText: authController.usernameError.value.isEmpty
                              ? null
                              : authController.usernameError.value,
                        ),
                      ),
                      
                      const SizedBox(height: 16),
                      
                      // Password Field
                      Obx(() => TextFormField(
                        controller: authController.passwordController,
                        obscureText: authController.obscurePassword.value,
                        decoration: InputDecoration(
                          labelText: localizations.password,
                          prefixIcon: const Icon(Icons.lock),
                          suffixIcon: IconButton(
                            icon: Icon(
                              authController.obscurePassword.value
                                  ? Icons.visibility
                                  : Icons.visibility_off,
                            ),
                            onPressed: authController.togglePasswordVisibility,
                          ),
                          border: OutlineInputBorder(
                            borderRadius: BorderRadius.circular(12),
                          ),
                          errorText: authController.passwordError.value.isEmpty
                              ? null
                              : authController.passwordError.value,
                        ),
                      )),
                      
                      const SizedBox(height: 16),
                      
                      // Confirm Password Field (only in register mode)
                      Obx(() {
                        if (!authController.isLoginMode.value) {
                          return Column(
                            children: [
                              TextFormField(
                                controller: authController.confirmPasswordController,
                                obscureText: authController.obscureConfirmPassword.value,
                                decoration: InputDecoration(
                                  labelText: localizations.confirmPassword,
                                  prefixIcon: const Icon(Icons.lock_outline),
                                  suffixIcon: IconButton(
                                    icon: Icon(
                                      authController.obscureConfirmPassword.value
                                          ? Icons.visibility
                                          : Icons.visibility_off,
                                    ),
                                    onPressed: authController.toggleConfirmPasswordVisibility,
                                  ),
                                  border: OutlineInputBorder(
                                    borderRadius: BorderRadius.circular(12),
                                  ),
                                  errorText: authController.confirmPasswordError.value.isEmpty
                                      ? null
                                      : authController.confirmPasswordError.value,
                                ),
                              ),
                              const SizedBox(height: 16),
                            ],
                          );
                        }
                        return const SizedBox.shrink();
                      }),
                      
                      // Server Address Field
                      TextFormField(
                        controller: authController.serverAddressController,
                        decoration: InputDecoration(
                          labelText: localizations.serverAddress,
                          hintText: localizations.serverAddressHint,
                          prefixIcon: const Icon(Icons.dns),
                          border: OutlineInputBorder(
                            borderRadius: BorderRadius.circular(12),
                          ),
                          errorText: authController.serverAddressError.value.isEmpty
                              ? null
                              : authController.serverAddressError.value,
                        ),
                        keyboardType: TextInputType.url,
                      ),
                      
                      const SizedBox(height: 24),
                      
                      // Submit Button
                      Obx(() => ElevatedButton(
                        onPressed: authController.isLoading.value
                            ? null
                            : authController.submitForm,
                        style: ElevatedButton.styleFrom(
                          padding: const EdgeInsets.symmetric(vertical: 16),
                          shape: RoundedRectangleBorder(
                            borderRadius: BorderRadius.circular(12),
                          ),
                        ),
                        child: authController.isLoading.value
                            ? const SizedBox(
                                height: 20,
                                width: 20,
                                child: CircularProgressIndicator(strokeWidth: 2),
                              )
                            : Text(
                                authController.isLoginMode.value
                                    ? localizations.login
                                    : localizations.register,
                                style: const TextStyle(fontSize: 16),
                              ),
                      )),
                      
                      const SizedBox(height: 16),
                      
                      // Switch Mode Button
                      TextButton(
                        onPressed: authController.toggleMode,
                        child: Obx(() => Text(
                          authController.isLoginMode.value
                              ? localizations.switchToRegister
                              : localizations.switchToLogin,
                        )),
                      ),
                      
                      // Default to login mode
                      const SizedBox(height: 8),
                      Obx(() {
                        if (!authController.isLoginMode.value) {
                          return TextButton(
                            onPressed: () => authController.isLoginMode.value = true,
                            child: Text(
                              'Already have an account? Login',
                              style: TextStyle(
                                color: Colors.blue[600],
                                fontSize: 14,
                              ),
                            ),
                          );
                        }
                        return const SizedBox.shrink();
                      }),
                    ],
                  ),
                ),
              ),
              
              const SizedBox(height: 24),
              
              // Additional Info
              Text(
                'Peers Touch - Connect with your friends securely',
                style: TextStyle(
                  color: Colors.grey[600],
                  fontSize: 12,
                ),
                textAlign: TextAlign.center,
              ),
            ],
          ),
        ),
      ),
    );
  }
}