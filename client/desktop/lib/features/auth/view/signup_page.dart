import 'package:flutter/material.dart';
import 'package:get/get.dart';
import 'package:peers_touch_ui/peers_touch_ui.dart';
import 'package:peers_touch_base/i18n/generated/app_localizations.dart';
import '../controller/auth_controller.dart';

class SignupPage extends GetView<AuthController> {
  const SignupPage({super.key});

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final l10n = AppLocalizations.of(context)!;
    // Darker fill color for inputs to match the reference style slightly, or just standard surface
    final inputFillColor = theme.colorScheme.surfaceVariant.withOpacity(0.3);

    return Scaffold(
      appBar: AppBar(
        leadingWidth: 150,
        leading: TextButton.icon(
          icon: Icon(Icons.arrow_back_ios, size: 18, color: theme.colorScheme.primary),
          label: Text(l10n.yourPrivacy, style: TextStyle(color: theme.colorScheme.primary, fontSize: 16)),
          onPressed: () => Get.back(),
          style: TextButton.styleFrom(padding: const EdgeInsets.only(left: 16)),
        ),
        actions: [
          Obx(() => TextButton(
            onPressed: controller.loading.value ? null : () => controller.signup(),
            child: Text(
              l10n.next, 
              style: TextStyle(
                fontWeight: FontWeight.bold, 
                fontSize: 16,
                color: controller.loading.value ? theme.disabledColor : theme.colorScheme.primary
              )
            ),
          )),
          const SizedBox(width: 16),
        ],
        backgroundColor: Colors.transparent,
        elevation: 0,
      ),
      body: Center(
        child: ConstrainedBox(
          constraints: const BoxConstraints(maxWidth: 420),
          child: ListView(
            padding: const EdgeInsets.symmetric(horizontal: 24, vertical: 10),
            children: [
              Text(
                l10n.createAccount,
                style: const TextStyle(fontSize: 32, fontWeight: FontWeight.bold),
              ),
              const SizedBox(height: 32),

              // Server URL
              Obx(() => _buildInput(
                context,
                label: l10n.serverUrl,
                value: controller.baseUrl.value,
                onChanged: controller.updateBaseUrl,
                placeholder: 'https://server.url',
                fillColor: inputFillColor,
              )),
              const SizedBox(height: 16),

              // Display Name
              Obx(() => _buildInput(
                context,
                label: l10n.displayName,
                value: controller.displayName.value,
                onChanged: (v) => controller.displayName.value = v,
                placeholder: l10n.displayName,
                fillColor: inputFillColor,
              )),
              const SizedBox(height: 16),

              // Username
              Obx(() => _buildInput(
                context,
                label: l10n.username,
                value: controller.username.value,
                onChanged: (v) => controller.username.value = v,
                placeholder: l10n.username,
                prefixText: '@ ',
                fillColor: inputFillColor,
              )),
              const SizedBox(height: 16),

              // Email
              Obx(() => _buildInput(
                context,
                label: l10n.email,
                value: controller.email.value,
                onChanged: (v) => controller.email.value = v,
                placeholder: l10n.email,
                fillColor: inputFillColor,
              )),
              const SizedBox(height: 16),

              // Password
              Obx(() => _buildInput(
                context,
                label: l10n.password,
                value: controller.password.value,
                onChanged: (v) => controller.password.value = v,
                placeholder: l10n.password,
                obscureText: true,
                fillColor: inputFillColor,
              )),
              const SizedBox(height: 16),

              // Confirm Password
              Obx(() => _buildInput(
                context,
                label: l10n.confirmPassword,
                value: controller.confirmPassword.value,
                onChanged: (v) => controller.confirmPassword.value = v,
                placeholder: l10n.confirmPassword,
                obscureText: true,
                fillColor: inputFillColor,
              )),
              const SizedBox(height: 8),
              
              Text(
                l10n.passwordMinLengthHint,
                style: TextStyle(
                  color: theme.colorScheme.onSurface.withOpacity(0.6),
                  fontSize: 13,
                ),
              ),

              const SizedBox(height: 24),
              
              Obx(() => controller.error.value == null 
                  ? const SizedBox.shrink() 
                  : ErrorBanner(message: controller.error.value!)),
                  
              // Debug info
              Obx(() {
                final status = controller.lastStatus.value;
                final body = controller.lastBody.value;
                if (status == null && (body == null || body.isEmpty)) return const SizedBox.shrink();
                return Padding(
                  padding: const EdgeInsets.only(top: 8.0),
                  child: SelectableText('HTTP ${status ?? '-'}\n${body ?? ''}', style: theme.textTheme.bodySmall),
                );
              }),
            ],
          ),
        ),
      ),
    );
  }

  Widget _buildInput(
    BuildContext context, {
    required String label,
    required String value,
    required ValueChanged<String> onChanged,
    String? placeholder,
    bool obscureText = false,
    String? prefixText,
    Color? fillColor,
  }) {
    final controller = TextEditingController(text: value)
      ..selection = TextSelection.collapsed(offset: value.length);
      
    return TextField(
      controller: controller,
      onChanged: onChanged,
      obscureText: obscureText,
      decoration: InputDecoration(
        hintText: placeholder,
        labelText: null, // No floating label to match design
        filled: true,
        fillColor: fillColor,
        prefixText: prefixText,
        border: OutlineInputBorder(
          borderRadius: BorderRadius.circular(12),
          borderSide: BorderSide.none,
        ),
        enabledBorder: OutlineInputBorder(
          borderRadius: BorderRadius.circular(12),
          borderSide: BorderSide(color: Theme.of(context).colorScheme.outline.withOpacity(0.1)),
        ),
        focusedBorder: OutlineInputBorder(
          borderRadius: BorderRadius.circular(12),
          borderSide: BorderSide(color: Theme.of(context).colorScheme.primary, width: 2),
        ),
        contentPadding: const EdgeInsets.symmetric(horizontal: 16, vertical: 16),
      ),
    );
  }
}
