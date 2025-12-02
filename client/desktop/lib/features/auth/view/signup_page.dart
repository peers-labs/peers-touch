import 'package:flutter/material.dart';
import 'package:get/get.dart';
import 'package:peers_touch_ui/peers_touch_ui.dart';
import 'package:peers_touch_desktop/core/network/network_initializer.dart';
import '../controller/auth_controller.dart';

class SignupPage extends GetView<AuthController> {
  const SignupPage({super.key});

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('Sign Up')),
      body: Padding(
        padding: const EdgeInsets.all(16.0),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Obx(() => TextBox(
                  label: 'Server URL',
                  value: controller.baseUrl.value,
                  description: 'Example: http://localhost:18080',
                  onChanged: (v) => controller.updateBaseUrl(v),
                )),
            const SizedBox(height: 12),
            Obx(() => TextBox(label: 'Username', value: controller.username.value, onChanged: (v) => controller.username.value = v)),
            const SizedBox(height: 12),
            Obx(() => TextBox(label: 'Email', value: controller.email.value, onChanged: (v) => controller.email.value = v)),
            const SizedBox(height: 12),
            Obx(() => PasswordBox(label: 'Password', value: controller.password.value, onChanged: (v) => controller.password.value = v, description: '8-20 chars, letters/numbers/symbols')),
            const SizedBox(height: 12),
            Row(
              children: [
                Obx(() => PrimaryButton(text: 'Create', onPressed: () => controller.signup(), loading: controller.loading.value)),
                const SizedBox(width: 12),
                SecondaryButton(text: 'Back to Login', onPressed: () => Get.back()),
              ],
            ),
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
          ],
        ),
      ),
    );
  }
}
