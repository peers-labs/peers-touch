import 'package:flutter/material.dart';
import 'package:get/get.dart';
import 'package:peers_touch_ui/peers_touch_ui.dart';
import '../controller/auth_controller.dart';

import 'package:peers_touch_base/i18n/generated/app_localizations.dart';

class LoginPage extends GetView<AuthController> {
  const LoginPage({super.key});

  @override
  Widget build(BuildContext context) {
    final l = AppLocalizations.of(context)!;
    return Scaffold(
      body: Center(
        child: ConstrainedBox(
          constraints: const BoxConstraints(maxWidth: 420),
          child: Padding(
            padding: const EdgeInsets.symmetric(horizontal: 24.0, vertical: 32.0),
            child: SingleChildScrollView(child: Column(
              mainAxisSize: MainAxisSize.min,
              crossAxisAlignment: CrossAxisAlignment.center,
              children: [
                const SizedBox(height: 12),
                Obx(() => Text(controller.authTab.value == 0 ? l.signIn : l.createAccount, style: const TextStyle(fontSize: 24, fontWeight: FontWeight.w700))),
                const SizedBox(height: 12),
                Obx(() => Tabs(labels: [l.loginTab, l.registerTab], index: controller.authTab.value, onChanged: controller.switchTab)),
                const SizedBox(height: 20),
                Obx(() => Row(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Expanded(
                          flex: 2,
                          child: TextBox(
                            label: l.serverUrl,
                            value: controller.baseUrl.value,
                            description: l.serverUrlExample,
                            onChanged: (v) => controller.updateBaseUrl(v),
                          ),
                        ),
                        const SizedBox(width: 12),
                        Expanded(
                          flex: 1,
                          child: _ProtocolDropdown(
                            value: controller.protocol.value,
                            onChanged: (v) {},
                          ),
                        ),
                      ],
                    )),
                const SizedBox(height: 12),
                Obx(() => controller.authTab.value == 1
                    ? TextBox(
                        label: l.username,
                        description: l.required,
                        value: controller.username.value,
                        placeholder: l.username,
                        showLabel: false,
                        onChanged: (v) => controller.username.value = v,
                      )
                    : TextBox(
                        label: l.email,
                        description: l.required,
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
                          description: l.required,
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
                      description: l.requiredMinChars,
                      value: controller.password.value,
                      placeholder: l.password,
                      onChanged: (v) => controller.password.value = v,
                    )),
                const SizedBox(height: 16),
                Obx(() => PrimaryButton(
                      text: controller.authTab.value == 0 ? l.signIn : l.signUp,
                      loading: controller.loading.value,
                      onPressed: () => controller.authTab.value == 0 ? controller.login() : controller.signup(),
                      fullWidth: true,
                    )),
                Obx(() => controller.authTab.value == 0
                    ? Padding(
                        padding: const EdgeInsets.only(top: 8.0),
                        child: TextButton(onPressed: null, child: Text(l.forgotPassword)),
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
    );
  }
}

class _ProtocolDropdown extends StatelessWidget {
  final String? value;
  final ValueChanged<String?> onChanged;
  const _ProtocolDropdown({required this.value, required this.onChanged});

  static const List<String> _items = [
    'peers-touch',
    'mastodon',
    'other activitypub',
  ];

  static String _desc(String v) {
    switch (v) {
      case 'peers-touch':
        return '默认协议，内置 Peers Touch 兼容 ActivityPub/Mastodon API';
      case 'mastodon':
        return 'Mastodon 服务器，使用 /api/v1/* 接口兼容';
      default:
        return '其他 ActivityPub 实现，部分功能可能不完整';
    }
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text('协议服务', style: theme.textTheme.bodyLarge?.copyWith(fontWeight: FontWeight.w500)),
        const SizedBox(height: 8),
        InputDecorator(
          decoration: const InputDecoration(border: OutlineInputBorder()),
          child: DropdownButtonHideUnderline(
            child: DropdownButton<String>(
              isExpanded: true,
              value: value ?? 'peers-touch',
              items: _items
                  .map((e) => DropdownMenuItem<String>(
                        value: e,
                        enabled: false,
                        child: Tooltip(message: _desc(e), child: Text(e)),
                      ))
                  .toList(),
              onChanged: onChanged,
            ),
          ),
        ),
      ],
    );
  }
}
