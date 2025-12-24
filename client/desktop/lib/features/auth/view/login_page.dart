import 'package:flutter/material.dart';
import 'package:get/get.dart';
import 'package:peers_touch_base/i18n/generated/app_localizations.dart';
import 'package:peers_touch_desktop/app/theme/ui_kit.dart';
import 'package:peers_touch_desktop/core/components/language_selector.dart';
import 'package:peers_touch_desktop/features/auth/controller/auth_controller.dart';
import 'package:peers_touch_ui/peers_touch_ui.dart';

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
                color: selected ? theme.colorScheme.primary : theme.colorScheme.onSurface.withAlpha(179),
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
                Obx(() => Row(
                      children: [
                        Expanded(
                          flex: 2,
                          child: SizedBox(
                            height: UIKit.controlHeightMd,
                            child: TextField(
                              key: const ValueKey('base_url_input'),
                              controller: controller.baseUrlController,
                              focusNode: controller.baseUrlFocus,
                              textInputAction: TextInputAction.next,
                              decoration: UIKit.inputDecoration(context).copyWith(
                                hintText: l.serverUrl,
                              ),
                            ),
                          ),
                        ),
                        const SizedBox(width: 8),
                        SizedBox(
                          height: UIKit.controlHeightMd,
                          child: Tooltip(
                            message: AppLocalizations.of(context)!.networkTypeTooltip,
                            child: Container(
                              padding: const EdgeInsets.symmetric(horizontal: 12),
                              decoration: BoxDecoration(
                                color: UIKit.inputFillLight(context),
                                borderRadius: BorderRadius.circular(UIKit.radiusSm(context)),
                                border: Border.all(
                                  color: controller.serverStatus.value == ServerStatus.reachable
                                      ? theme.colorScheme.primary.withAlpha(128)
                                      : (controller.serverStatus.value == ServerStatus.unknown
                                          ? theme.colorScheme.error
                                          : UIKit.dividerColor(context)),
                                  width: controller.serverStatus.value == ServerStatus.unknown ? 1.5 : UIKit.dividerThickness,
                                ),
                              ),
                              alignment: Alignment.center,
                              child: ConstrainedBox(
                                constraints: const BoxConstraints(minWidth: 80),
                                child: Row(
                                  mainAxisSize: MainAxisSize.min,
                                  children: [
                                    Icon(
                                      Icons.hub,
                                      size: 16,
                                      color: controller.serverStatus.value == ServerStatus.unknown
                                          ? theme.colorScheme.error
                                          : theme.colorScheme.primary.withAlpha(179),
                                    ),
                                    const SizedBox(width: 6),
                                    Text(
                                      controller.serverStatus.value == ServerStatus.unknown
                                          ? AppLocalizations.of(context)!.unknownNetwork
                                          : controller.protocol.value,
                                      style: theme.textTheme.bodyMedium?.copyWith(
                                        color: controller.serverStatus.value == ServerStatus.unknown
                                            ? theme.colorScheme.error
                                            : UIKit.textPrimary(context).withAlpha(217),
                                        fontWeight: FontWeight.w500,
                                      ),
                                    ),
                                  ],
                                ),
                              ),
                            ),
                          ),
                        ),
                      ],
                    )),
                const SizedBox(height: 12),
                Obx(() => controller.authTab.value == 1
                    ? TextBox(
                        key: const ValueKey('username_input'),
                        controller: controller.usernameController,
                        focusNode: controller.usernameFocus,
                        label: l.username,
                        value: '',
                        placeholder: l.username,
                        showLabel: false,
                        onChanged: (v) {},
                      )
                    : TextBox(
                        key: const ValueKey('email_input_login'),
                        controller: controller.emailController,
                        focusNode: controller.emailFocus,
                        label: l.email,
                        value: '',
                        placeholder: l.emailOrUsername,
                        showLabel: false,
                        onChanged: (v) {},
                      )),
                Obx(() => controller.authTab.value == 1
                    ? Padding(
                        padding: const EdgeInsets.only(top: 12.0),
                        child: TextBox(
                          key: const ValueKey('email_input_signup'),
                          controller: controller.emailController,
                          focusNode: controller.emailFocus,
                          label: l.email,
                          value: '',
                          placeholder: l.email,
                          showLabel: false,
                          onChanged: (v) {},
                        ),
                      )
                    : const SizedBox.shrink()),
                const SizedBox(height: 12),
                PasswordBox(
                  key: const ValueKey('password_input'),
                  controller: controller.passwordController,
                  focusNode: controller.passwordFocus,
                  label: l.password,
                  value: '',
                  placeholder: l.password,
                  showLabel: false,
                  onChanged: (v) {},
                ),
                Obx(() => controller.authTab.value == 1
                    ? Padding(
                        padding: const EdgeInsets.only(top: 12.0),
                        child: PasswordBox(
                          key: const ValueKey('confirm_password_input'),
                          controller: controller.confirmPasswordController,
                          focusNode: controller.confirmPasswordFocus,
                          label: l.confirmPassword,
                          value: '',
                          placeholder: l.confirmPassword,
                          showLabel: false,
                          onChanged: (v) {},
                        ),
                      )
                    : const SizedBox.shrink()),
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
