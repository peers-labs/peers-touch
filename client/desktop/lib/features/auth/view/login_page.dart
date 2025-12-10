import 'package:flutter/material.dart';
import 'package:get/get.dart';
import 'package:peers_touch_ui/peers_touch_ui.dart';
import '../controller/auth_controller.dart';

import 'package:peers_touch_desktop/core/components/language_selector.dart';
import 'package:peers_touch_base/i18n/generated/app_localizations.dart';

class LoginPage extends GetView<AuthController> {
  const LoginPage({super.key});

  Widget _buildSimpleTab(BuildContext context, String label, int index) {
    final selected = controller.authTab.value == index;
    final theme = Theme.of(context);
    return InkWell(
      onTap: () => controller.switchTab(index),
      borderRadius: BorderRadius.circular(4),
      child: Padding(
        padding: const EdgeInsets.symmetric(horizontal: 4, vertical: 4),
        child: Column(
          children: [
            Text(
              label,
              style: TextStyle(
                fontSize: 16,
                fontWeight: selected ? FontWeight.w600 : FontWeight.normal,
                color: selected ? theme.colorScheme.primary : theme.colorScheme.onSurface.withOpacity(0.7),
              ),
            ),
            if (selected)
              Container(
                margin: const EdgeInsets.only(top: 4),
                width: 20,
                height: 2,
                color: theme.colorScheme.primary,
              )
          ],
        ),
      ),
    );
  }



  @override
  Widget build(BuildContext context) {
    final l = AppLocalizations.of(context)!;
    final theme = Theme.of(context);
    return Scaffold(
      body: Stack(
        children: [
          Align(
            alignment: Alignment.topCenter,
            child: ConstrainedBox(
              constraints: const BoxConstraints(maxWidth: 420),
              child: Padding(
                padding: const EdgeInsets.symmetric(horizontal: 24.0),
                child: SingleChildScrollView(child: Column(
                  mainAxisSize: MainAxisSize.min,
                  crossAxisAlignment: CrossAxisAlignment.center,
                  children: [
                    SizedBox(height: MediaQuery.of(context).size.height * 0.15), // Fixed top spacer (15% height)
                    Obx(() => Row(
                  mainAxisAlignment: MainAxisAlignment.center,
                  children: [
                    _buildSimpleTab(context, l.loginTab, 0),
                    const SizedBox(width: 32),
                    _buildSimpleTab(context, l.registerTab, 1),
                  ],
                )),
                const SizedBox(height: 32),
                Obx(() => IntrinsicHeight(
                  child: Row(
                    crossAxisAlignment: CrossAxisAlignment.stretch,
                    children: [
                      Expanded(
                        flex: 2,
                        child: TextBox(
                          label: l.serverUrl,
                          value: controller.baseUrl.value,
                          placeholder: l.serverUrl,
                          showLabel: false,
                          onChanged: (v) => controller.updateBaseUrl(v),
                        ),
                      ),
                      const SizedBox(width: 8),
                      Container(
                        padding: const EdgeInsets.symmetric(horizontal: 16),
                        decoration: BoxDecoration(
                          color: theme.colorScheme.surface,
                          borderRadius: BorderRadius.circular(8),
                          border: Border.all(color: theme.colorScheme.outline.withOpacity(0.3)),
                        ),
                        alignment: Alignment.center,
                        child: ConstrainedBox(
                          constraints: const BoxConstraints(minWidth: 80),
                          child: Row(
                            mainAxisSize: MainAxisSize.min,
                            children: [
                              Icon(Icons.hub, size: 14, color: theme.colorScheme.primary.withOpacity(0.7)),
                              const SizedBox(width: 6),
                              Text(
                                controller.protocol.value ?? 'peers-touch',
                                style: theme.textTheme.bodyMedium?.copyWith(
                                  color: theme.colorScheme.onSurface.withOpacity(0.8),
                                  fontWeight: FontWeight.w500,
                                ),
                              ),
                            ],
                          ),
                        ),
                      ),
                    ],
                  ),
                )),
                const SizedBox(height: 12),
                Obx(() => controller.authTab.value == 1
                    ? TextBox(
                        label: l.username,
                        value: controller.username.value,
                        placeholder: l.username,
                        showLabel: false,
                        onChanged: (v) => controller.username.value = v,
                      )
                    : TextBox(
                        label: l.email,
                        value: controller.email.value,
                        placeholder: l.emailOrUsername,
                        showLabel: false,
                        onChanged: (v) => controller.email.value = v,
                      )),
                Obx(() => controller.authTab.value == 1
                    ? Padding(
                        padding: const EdgeInsets.only(top: 12.0),
                        child: TextBox(
                          label: l.email,
                          value: controller.email.value,
                          placeholder: l.email,
                          showLabel: false,
                          onChanged: (v) => controller.email.value = v,
                        ),
                      )
                    : const SizedBox.shrink()),
                const SizedBox(height: 12),
                Obx(() => PasswordBox(
                      label: l.password,
                      value: controller.password.value,
                      placeholder: l.password,
                      showLabel: false,
                      onChanged: (v) => controller.password.value = v,
                    )),
                const SizedBox(height: 24),
                Obx(() => PrimaryButton(
                      text: controller.authTab.value == 0 ? l.signIn : l.signUp,
                      loading: controller.loading.value,
                      onPressed: () => controller.authTab.value == 0 ? controller.login() : controller.signup(),
                      fullWidth: true,
                    )),
                Obx(() => controller.authTab.value == 0
                    ? Padding(
                        padding: const EdgeInsets.only(top: 16.0),
                        child: TextButton(onPressed: null, child: Text(l.forgotPassword, style: TextStyle(color: Theme.of(context).colorScheme.secondary))),
                      )
                    : const SizedBox(height: 8)),
                const SizedBox(height: 12),
                Obx(() => controller.error.value == null ? const SizedBox.shrink() : ErrorBanner(message: controller.error.value!)),
                Obx(() {
                  final status = controller.lastStatus.value;
                  final body = controller.lastBody.value;
                  if (status == null && (body == null || body.isEmpty)) return const SizedBox.shrink();
                  return Padding(
                    padding: const EdgeInsets.only(top: 8.0),
                    child: SelectableText('HTTP ${status ?? '-'}\n${body ?? ''}', style: Theme.of(context).textTheme.bodySmall),
                  );
                }),
                const SizedBox(height: 12),
                
              ],
            )),
          ),
        ),
      ),
          const Positioned(
            top: 24,
            right: 24,
            child: LanguageSelector(),
          ),
        ],
      ),
    );
  }
}
