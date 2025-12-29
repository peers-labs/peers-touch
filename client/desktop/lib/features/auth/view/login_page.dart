import 'package:flutter/material.dart';
import 'package:get/get.dart';
import 'package:peers_touch_base/i18n/generated/app_localizations.dart';
import 'package:peers_touch_desktop/app/theme/ui_kit.dart';
import 'package:peers_touch_desktop/core/components/language_selector.dart';
import 'package:peers_touch_desktop/features/auth/controller/auth_controller.dart';
import 'package:peers_touch_desktop/core/utils/image_utils.dart';
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
                    // 顶部头像预览（仅登录模式显示）
                    Obx(() {
                      if (controller.authTab.value != 0) return const SizedBox(height: 16);
                      final src = controller.loginPreviewAvatar.value;
                      final p = imageProviderFor(src);
                      return Padding(
                        padding: const EdgeInsets.only(bottom: 16.0),
                        child: ClipRRect(
                          borderRadius: BorderRadius.circular(16),
                          child: Container(
                            width: 72,
                            height: 72,
                            color: theme.colorScheme.surfaceContainerHighest,
                            child: p != null
                                ? Image(image: p, fit: BoxFit.cover)
                                : Icon(Icons.person, size: 40, color: UIKit.textSecondary(context)),
                          ),
                        ),
                      );
                    }),
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
                            message: () {
                              final s = controller.serverStatus.value;
                              final l = AppLocalizations.of(context)!;
                              if (s == ServerStatus.reachable) {
                                return l.networkTypeTooltip;
                              }
                              if (s == ServerStatus.checking) {
                                return l.networkCheckingTooltip;
                              }
                              if (s == ServerStatus.unreachable) {
                                return l.networkUnreachableTooltip;
                              }
                              if (s == ServerStatus.notFound) {
                                return l.networkNotFoundTooltip;
                              }
                              return l.networkUnknownTooltip;
                            }(),
                            child: Container(
                              padding: const EdgeInsets.symmetric(horizontal: 12),
                              decoration: BoxDecoration(
                                color: UIKit.inputFillLight(context),
                                borderRadius: BorderRadius.circular(UIKit.radiusSm(context)),
                                border: Border.all(
                                  color: controller.serverStatus.value == ServerStatus.reachable
                                      ? theme.colorScheme.primary.withAlpha(128)
                                      : (controller.serverStatus.value == ServerStatus.unknown ||
                                          controller.serverStatus.value == ServerStatus.unreachable ||
                                          controller.serverStatus.value == ServerStatus.notFound
                                          ? theme.colorScheme.error
                                          : UIKit.dividerColor(context)),
                                  width: (controller.serverStatus.value == ServerStatus.unknown ||
                                          controller.serverStatus.value == ServerStatus.unreachable ||
                                          controller.serverStatus.value == ServerStatus.notFound)
                                      ? 1.5
                                      : UIKit.dividerThickness,
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
                                      color: (controller.serverStatus.value == ServerStatus.unknown ||
                                              controller.serverStatus.value == ServerStatus.unreachable ||
                                              controller.serverStatus.value == ServerStatus.notFound)
                                          ? theme.colorScheme.error
                                          : theme.colorScheme.primary.withAlpha(179),
                                    ),
                                    const SizedBox(width: 6),
                                    Text(
                                      () {
                                        final s = controller.serverStatus.value;
                                        final l = AppLocalizations.of(context)!;
                                        if (s == ServerStatus.reachable) return controller.protocol.value;
                                        if (s == ServerStatus.checking) return l.networkCheckingLabel;
                                        if (s == ServerStatus.unreachable) return l.networkUnreachableLabel;
                                        if (s == ServerStatus.notFound) return l.networkNotFoundLabel;
                                        return l.unknownNetwork;
                                      }(),
                                      style: theme.textTheme.bodyMedium?.copyWith(
                                        color: (controller.serverStatus.value == ServerStatus.unknown ||
                                                controller.serverStatus.value == ServerStatus.unreachable ||
                                                controller.serverStatus.value == ServerStatus.notFound)
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
                // 下拉建议（无箭头，丝滑）
                Obx(() {
                  final isLogin = controller.authTab.value == 0;
                  final focused = isLogin ? controller.emailFocused.value : controller.usernameFocused.value;
                  final text = isLogin ? controller.email.value : controller.username.value;
                  final list = <String>{}
                    ..addAll(controller.recentUsers)
                    ..addAll(controller.presetUsers.map((e) => (e['username'] ?? e['handle'] ?? e['name'] ?? '').toString()).where((e) => e.isNotEmpty));
                  final items = list.where((e) => text.isEmpty || e.toLowerCase().contains(text.toLowerCase())).take(6).toList();
                  if (!focused || items.isEmpty) return const SizedBox.shrink();
                  return Container(
                    margin: const EdgeInsets.only(top: 8),
                    decoration: BoxDecoration(
                      color: theme.colorScheme.surface,
                      borderRadius: BorderRadius.circular(12),
                      boxShadow: UIKit.panelShadow(context),
                      border: Border.all(color: UIKit.dividerColor(context), width: UIKit.dividerThickness),
                    ),
                    child: Column(
                      mainAxisSize: MainAxisSize.min,
                      children: items.map((handle) {
                        final src = controller.recentAvatars[handle] ?? (() {
                          final found = controller.presetUsers.firstWhereOrNull((u) {
                            final name = (u['username'] ?? u['handle'] ?? u['name'] ?? '').toString();
                            return name == handle;
                          });
                          return found == null ? null : (found['avatar'] ?? found['avatar_url'] ?? found['avatarUrl'])?.toString();
                        })();
                        final p = imageProviderFor(src);
                        return InkWell(
                          onTap: () {
                            if (isLogin) {
                              controller.emailController.value = TextEditingValue(
                                text: handle,
                                selection: TextSelection.collapsed(offset: handle.length),
                              );
                            } else {
                              controller.usernameController.value = TextEditingValue(
                                text: handle,
                                selection: TextSelection.collapsed(offset: handle.length),
                              );
                            }
                            controller.updateLoginPreviewAvatar();
                          },
                          child: Padding(
                            padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 10),
                            child: Row(
                              children: [
                                ClipRRect(
                                  borderRadius: BorderRadius.circular(10),
                                  child: Container(
                                    width: 28,
                                    height: 28,
                                    color: theme.colorScheme.surfaceContainerHighest,
                                    child: p != null ? Image(image: p, fit: BoxFit.cover) : Icon(Icons.person, size: 18, color: UIKit.textSecondary(context)),
                                  ),
                                ),
                                const SizedBox(width: 10),
                                Expanded(child: Text(handle, style: theme.textTheme.bodyMedium)),
                              ],
                            ),
                          ),
                        );
                      }).toList(),
                    ),
                  );
                }),
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
