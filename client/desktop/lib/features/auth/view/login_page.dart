import 'package:flutter/material.dart';
import 'package:get/get.dart';
import 'package:peers_touch_ui/peers_touch_ui.dart';
import '../controller/auth_controller.dart';

class LoginPage extends GetView<AuthController> {
  const LoginPage({super.key});

  @override
  Widget build(BuildContext context) {
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
                Obx(() => Text(controller.authTab.value == 0 ? 'Sign in' : 'Create account', style: const TextStyle(fontSize: 24, fontWeight: FontWeight.w700))),
                const SizedBox(height: 12),
                Obx(() => Tabs(labels: const ['登录', '注册'], index: controller.authTab.value, onChanged: controller.switchTab)),
                const SizedBox(height: 20),
                Obx(() => TextBox(
                      label: 'Server URL',
                      value: controller.baseUrl.value,
                      description: 'Example: http://localhost:18080',
                      onChanged: (v) => controller.updateBaseUrl(v),
                    )),
                const SizedBox(height: 12),
                Obx(() => controller.authTab.value == 1
                    ? TextBox(
                        label: 'Username',
                        description: 'Required',
                        value: controller.username.value,
                        placeholder: 'Username',
                        showLabel: false,
                        onChanged: (v) => controller.username.value = v,
                      )
                    : TextBox(
                        label: 'Email',
                        description: 'Required',
                        value: controller.email.value,
                        placeholder: 'Email or username',
                        showLabel: false,
                        onChanged: (v) => controller.email.value = v,
                      )),
                Obx(() => controller.authTab.value == 1
                    ? Padding(
                        padding: const EdgeInsets.only(top: 12.0),
                        child: TextBox(
                          label: 'Email',
                          description: 'Required',
                          value: controller.email.value,
                          placeholder: 'Email',
                          showLabel: false,
                          onChanged: (v) => controller.email.value = v,
                        ),
                      )
                    : const SizedBox.shrink()),
                const SizedBox(height: 12),
                Obx(() => PasswordBox(
                      label: 'Password',
                      description: 'Required (min 6 chars)',
                      value: controller.password.value,
                      placeholder: 'Password',
                      onChanged: (v) => controller.password.value = v,
                    )),
                const SizedBox(height: 16),
                Obx(() => PrimaryButton(
                      text: controller.authTab.value == 0 ? 'Sign in' : 'Sign up',
                      loading: controller.loading.value,
                      onPressed: () => controller.authTab.value == 0 ? controller.login() : controller.signup(),
                      fullWidth: true,
                    )),
                Obx(() => controller.authTab.value == 0
                    ? const Padding(
                        padding: EdgeInsets.only(top: 8.0),
                        child: TextButton(onPressed: null, child: Text('Forgot your password?')),
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
