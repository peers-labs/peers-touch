import 'package:flutter/material.dart';
import 'package:get/get.dart';
import 'package:peers_touch_base/i18n/generated/app_localizations.dart';
import 'package:peers_touch_desktop/app/theme/ui_kit.dart';
import 'package:peers_touch_desktop/core/components/language_selector.dart';
import 'package:peers_touch_desktop/core/utils/image_utils.dart';
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
                  final hovering = controller.isDropdownHovering.value;
                  final items = controller.currentSuggestions;
                  
                  // Keep visible if input is focused OR mouse is hovering over the dropdown
                  if ((!focused && !hovering) || items.isEmpty) return const SizedBox.shrink();
                  
                  return MouseRegion(
                    onEnter: (_) => controller.isDropdownHovering.value = true,
                    onExit: (_) => controller.isDropdownHovering.value = false,
                    child: Container(
                      margin: const EdgeInsets.only(top: 8),
                      decoration: BoxDecoration(
                        color: theme.colorScheme.surface,
                        borderRadius: BorderRadius.circular(12),
                        boxShadow: UIKit.panelShadow(context),
                        border: Border.all(color: UIKit.dividerColor(context), width: UIKit.dividerThickness),
                      ),
                      child: Column(
                        mainAxisSize: MainAxisSize.min,
                        children: items.asMap().entries.map((entry) {
                          final index = entry.key;
                          final handle = entry.value;
                        final src = controller.recentAvatars[handle] ?? (() {
                          final found = controller.presetUsers.firstWhereOrNull((u) {
                            final name = (u['username'] ?? u['handle'] ?? u['name'] ?? '').toString();
                            return name == handle;
                          });
                          return found == null ? null : (found['avatar'] ?? found['avatar_url'] ?? found['avatarUrl'])?.toString();
                        })();
                        final p = imageProviderFor(src);
                        return Obx(() {
                          final isHighlighted = controller.highlightedIndex.value == index;
                          return InkWell(
                            onTap: () => controller.selectHighlightedItem(handle),
                            onHover: (v) { if (v) controller.highlightedIndex.value = index; },
                            child: Container(
                              color: isHighlighted 
                                  ? theme.colorScheme.primaryContainer.withValues(alpha: 0.3) 
                                  : null,
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
                        });
                      }).toList(),
                    ),
                  ));
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
          Positioned(
            bottom: 24,
            right: 24,
            child: IconButton(
              icon: const Icon(Icons.settings),
              onPressed: () => _showSettingsDrawer(context),
              tooltip: '设置',
            ),
          ),
        ],
      ),
    );
  }

  void _showSettingsDrawer(BuildContext context) {
    showGeneralDialog(
      context: context,
      barrierDismissible: true,
      barrierLabel: MaterialLocalizations.of(context).modalBarrierDismissLabel,
      barrierColor: Colors.black54,
      transitionDuration: const Duration(milliseconds: 200),
      pageBuilder: (context, animation, secondaryAnimation) {
        return Align(
          alignment: Alignment.centerRight,
          child: Material(
            elevation: 16,
            child: Container(
              width: 320,
              height: double.infinity,
              color: Theme.of(context).colorScheme.surface,
              child: _buildSettingsContent(context),
            ),
          ),
        );
      },
      transitionBuilder: (context, animation, secondaryAnimation, child) {
        return SlideTransition(
          position: Tween<Offset>(
            begin: const Offset(1, 0),
            end: Offset.zero,
          ).animate(CurvedAnimation(
            parent: animation,
            curve: Curves.easeOut,
          )),
          child: child,
        );
      },
    );
  }

  Widget _buildSettingsContent(BuildContext context) {
    final theme = Theme.of(context);
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Container(
          padding: const EdgeInsets.all(24),
          decoration: BoxDecoration(
            border: Border(
              bottom: BorderSide(
                color: theme.colorScheme.outlineVariant,
                width: 1,
              ),
            ),
          ),
          child: Row(
            children: [
              Text(
                '设置',
                style: theme.textTheme.titleLarge,
              ),
              const Spacer(),
              IconButton(
                icon: const Icon(Icons.close),
                onPressed: () => Navigator.of(context).pop(),
              ),
            ],
          ),
        ),
        Expanded(
          child: ListView(
            padding: const EdgeInsets.all(16),
            children: [
              _buildSettingsSection(
                context,
                title: '数据管理',
                children: [
                  _buildSettingsItem(
                    context,
                    icon: Icons.delete_outline,
                    title: '清除所有缓存',
                    subtitle: '删除本地保存的所有数据',
                    onTap: () => _showClearCacheDialog(context),
                  ),
                ],
              ),
            ],
          ),
        ),
      ],
    );
  }

  Widget _buildSettingsSection(
    BuildContext context, {
    required String title,
    required List<Widget> children,
  }) {
    final theme = Theme.of(context);
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Padding(
          padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 8),
          child: Text(
            title,
            style: theme.textTheme.titleSmall?.copyWith(
              color: theme.colorScheme.primary,
              fontWeight: FontWeight.w600,
            ),
          ),
        ),
        ...children,
        const SizedBox(height: 16),
      ],
    );
  }

  Widget _buildSettingsItem(
    BuildContext context, {
    required IconData icon,
    required String title,
    String? subtitle,
    required VoidCallback onTap,
  }) {
    final theme = Theme.of(context);
    return InkWell(
      onTap: onTap,
      borderRadius: BorderRadius.circular(8),
      child: Padding(
        padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 12),
        child: Row(
          children: [
            Icon(icon, size: 24, color: theme.colorScheme.onSurface),
            const SizedBox(width: 16),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    title,
                    style: theme.textTheme.bodyLarge,
                  ),
                  if (subtitle != null) ...[
                    const SizedBox(height: 4),
                    Text(
                      subtitle,
                      style: theme.textTheme.bodySmall?.copyWith(
                        color: UIKit.textSecondary(context),
                      ),
                    ),
                  ],
                ],
              ),
            ),
            Icon(
              Icons.chevron_right,
              size: 20,
              color: UIKit.textSecondary(context),
            ),
          ],
        ),
      ),
    );
  }

  void _showClearCacheDialog(BuildContext context) {
    showDialog(
      context: context,
      builder: (context) => AlertDialog(
        title: const Text('清除所有缓存'),
        content: const Text(
          '此操作将删除所有本地缓存数据，包括：\n'
          '• 历史登录用户\n'
          '• 用户头像\n'
          '• 保存的邮箱\n'
          '• 其他本地数据\n\n'
          '此操作无法撤销，确定要继续吗？',
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.of(context).pop(),
            child: const Text('取消'),
          ),
          FilledButton(
            onPressed: () async {
              Navigator.of(context).pop();
              await _clearAllCache(context);
            },
            child: const Text('确定'),
          ),
        ],
      ),
    );
  }

  Future<void> _clearAllCache(BuildContext context) async {
    try {
      await controller.clearAllCache();
      
      if (context.mounted) {
        Navigator.of(context).pop();
        
        Get.snackbar(
          '成功',
          '所有缓存已清除',
          snackPosition: SnackPosition.TOP,
          duration: const Duration(seconds: 2),
          backgroundColor: Colors.green,
          colorText: Colors.white,
        );
      }
    } catch (e) {
      if (context.mounted) {
        Get.snackbar(
          '失败',
          '清除缓存失败: $e',
          snackPosition: SnackPosition.TOP,
          duration: const Duration(seconds: 3),
          backgroundColor: Colors.red,
          colorText: Colors.white,
        );
      }
    }
  }
}
