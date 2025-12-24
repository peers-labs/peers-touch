import 'package:flutter/material.dart';
import 'package:get/get.dart';
import 'package:peers_touch_base/i18n/generated/app_localizations.dart';
import 'package:peers_touch_desktop/app/theme/ui_kit.dart';
import 'package:peers_touch_desktop/core/components/language_selector.dart';
import 'package:peers_touch_desktop/features/auth/controller/auth_controller.dart';
import 'package:peers_touch_ui/peers_touch_ui.dart';

class LoginPage extends StatefulWidget {
  const LoginPage({super.key});

  @override
  State<LoginPage> createState() => _LoginPageState();
}

class _LoginPageState extends State<LoginPage> {
  final AuthController controller = Get.find<AuthController>();
  final LayerLink _layerLink = LayerLink();
  OverlayEntry? _overlayEntry;
  final GlobalKey _emailKey = GlobalKey();

  @override
  void initState() {
    super.initState();
    controller.emailFocus.addListener(_onFocusChange);
  }

  @override
  void dispose() {
    controller.emailFocus.removeListener(_onFocusChange);
    _removeOverlay();
    super.dispose();
  }

  void _onFocusChange() {
    if (controller.emailFocus.hasFocus) {
      if (controller.loginHistory.isNotEmpty) {
        // Delay slightly to ensure layout is ready if needed, 
        // but usually instant is fine.
        // We also check if tab is login (0).
        if (controller.authTab.value == 0) {
          _showOverlay();
        }
      }
    } else {
      // Delay removal to allow tap on list item
      Future.delayed(const Duration(milliseconds: 200), () {
        if (mounted && !controller.emailFocus.hasFocus) {
          _removeOverlay();
        }
      });
    }
  }

  void _showOverlay() {
    if (!mounted) return;
    _removeOverlay();
    _overlayEntry = _createOverlayEntry();
    if (_overlayEntry != null) {
      Overlay.of(context).insert(_overlayEntry!);
    }
  }

  void _removeOverlay() {
    _overlayEntry?.remove();
    _overlayEntry = null;
  }

  OverlayEntry? _createOverlayEntry() {
    RenderBox? renderBox = _emailKey.currentContext?.findRenderObject() as RenderBox?;
    if (renderBox == null) return null;
    final size = renderBox.size;

    return OverlayEntry(
      builder: (context) => Positioned(
        width: size.width,
        child: CompositedTransformFollower(
          link: _layerLink,
          showWhenUnlinked: false,
          offset: Offset(0.0, size.height + 4.0),
          child: Material(
            elevation: 8.0,
            shadowColor: Colors.black.withAlpha(40),
            borderRadius: BorderRadius.circular(12),
            color: Theme.of(context).cardColor,
            child: Container(
              decoration: BoxDecoration(
                borderRadius: BorderRadius.circular(12),
                border: Border.all(
                  color: Theme.of(context).dividerColor.withAlpha(20),
                  width: 1,
                ),
              ),
              child: ConstrainedBox(
                constraints: const BoxConstraints(maxHeight: 280),
                child: Obx(() {
                  if (controller.loginHistory.isEmpty) {
                    WidgetsBinding.instance.addPostFrameCallback((_) {
                       if (mounted && controller.loginHistory.isEmpty) _removeOverlay();
                    });
                    return const SizedBox.shrink();
                  }
                  return ListView.separated(
                    padding: const EdgeInsets.symmetric(vertical: 8),
                    shrinkWrap: true,
                    itemCount: controller.loginHistory.length,
                    separatorBuilder: (context, index) => Divider(
                      height: 1,
                      indent: 56,
                      endIndent: 16,
                      color: Theme.of(context).dividerColor.withAlpha(15),
                    ),
                    itemBuilder: (context, index) {
                      final item = controller.loginHistory[index];
                      final disp = item['displayName'] ?? '';
                      final mail = item['email'] ?? '';
                      final url = item['baseUrl'] ?? '';
                      final initial = disp.isNotEmpty ? disp[0] : (mail.isNotEmpty ? mail[0] : '?');

                      return InkWell(
                        onTap: () {
                          controller.emailController.text = mail;
                          controller.baseUrlController.text = url;
                          controller.updateBaseUrl(url);
                          _removeOverlay();
                          controller.passwordFocus.requestFocus();
                        },
                        child: Padding(
                          padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 10),
                          child: Row(
                            children: [
                              CircleAvatar(
                                radius: 18,
                                backgroundColor: Theme.of(context).colorScheme.primary.withAlpha(30),
                                child: Text(
                                  initial.toUpperCase(),
                                  style: TextStyle(
                                    fontSize: 14,
                                    fontWeight: FontWeight.w600,
                                    color: Theme.of(context).colorScheme.primary,
                                  ),
                                ),
                              ),
                              const SizedBox(width: 12),
                              Expanded(
                                child: Column(
                                  crossAxisAlignment: CrossAxisAlignment.start,
                                  mainAxisSize: MainAxisSize.min,
                                  children: [
                                    Text(
                                      mail,
                                      style: const TextStyle(
                                        fontSize: 14,
                                        fontWeight: FontWeight.w500,
                                      ),
                                      maxLines: 1,
                                      overflow: TextOverflow.ellipsis,
                                    ),
                                    Text(
                                      url,
                                      style: TextStyle(
                                        fontSize: 12,
                                        color: Theme.of(context).textTheme.bodySmall?.color?.withAlpha(150),
                                      ),
                                      maxLines: 1,
                                      overflow: TextOverflow.ellipsis,
                                    ),
                                  ],
                                ),
                              ),
                              IconButton(
                                icon: Icon(
                                  Icons.close,
                                  size: 14,
                                  color: Theme.of(context).textTheme.bodySmall?.color?.withAlpha(100),
                                ),
                                onPressed: () => controller.removeLoginHistory(index),
                                splashRadius: 16,
                                padding: EdgeInsets.zero,
                                constraints: const BoxConstraints(),
                              ),
                            ],
                          ),
                        ),
                      );
                    },
                  );
                }),
              ),
            ),
          ),
        ),
      ),
    );
  }

  Widget _buildSimpleTab(BuildContext context, String label, int index) {
    // Need to wrap Obx around usage in build, or use Obx here if controller changes.
    // The controller.authTab is Rx.
    return Obx(() {
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
    });
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
                    SizedBox(height: MediaQuery.of(context).size.height * 0.15), // Fixed top spacer
                    Row(
                      mainAxisAlignment: MainAxisAlignment.center,
                      children: [
                        _buildSimpleTab(context, l.loginTab, 0),
                        const SizedBox(width: 32),
                        _buildSimpleTab(context, l.registerTab, 1),
                      ],
                    ),
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
                    Obx(() {
                      if (controller.authTab.value == 1) {
                        return TextBox(
                          key: const ValueKey('username_input'),
                          controller: controller.usernameController,
                          focusNode: controller.usernameFocus,
                          label: l.username,
                          value: '',
                          placeholder: l.username,
                          showLabel: false,
                          onChanged: (v) {},
                        );
                      } else {
                        // Login Email Input with History Dropdown
                        return CompositedTransformTarget(
                          link: _layerLink,
                          child: TextBox(
                            key: _emailKey, // Use GlobalKey to get size
                            controller: controller.emailController,
                            focusNode: controller.emailFocus,
                            label: l.email,
                            value: '',
                            placeholder: l.emailOrUsername,
                            showLabel: false,
                            onChanged: (v) {},
                          ),
                        );
                      }
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
                    Obx(() => SizedBox(
                      width: double.infinity,
                      height: UIKit.controlHeightLg,
                      child: FilledButton(
                        onPressed: controller.loading.value
                            ? null
                            : (controller.authTab.value == 0
                                ? controller.login
                                : controller.signup),
                        child: controller.loading.value
                            ? const SizedBox(
                                width: 20,
                                height: 20,
                                child: CircularProgressIndicator(strokeWidth: 2),
                              )
                            : Text(
                                controller.authTab.value == 0 ? l.signIn : l.signUp,
                                style: const TextStyle(fontSize: 16),
                              ),
                      ),
                    )),
                    const SizedBox(height: 16),
                    Obx(() => controller.error.value != null
                        ? Text(
                            controller.error.value!,
                            style: TextStyle(color: theme.colorScheme.error),
                          )
                        : const SizedBox.shrink()),
                    
                    // Language Selector
                    const SizedBox(height: 40),
                    const LanguageSelector(),
                  ],
                )),
              ),
            ),
          ),
        ],
      ),
    );
  }
}
