import 'package:flutter/material.dart';
import 'package:get/get.dart';
import 'package:peers_touch_base/applet/models/applet_manifest.dart';
import 'package:peers_touch_desktop/app/theme/theme_tokens.dart';
import 'package:peers_touch_desktop/features/applet/controller/applet_controller.dart';
import 'package:webview_flutter/webview_flutter.dart';

class AppletContainer extends StatelessWidget {
  const AppletContainer({
    super.key,
    required this.manifest,
    required this.bundleUrl,
  });
  final AppletManifest manifest;
  final String bundleUrl;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final tokens = theme.extension<WeChatTokens>()!;

    final controller = Get.put(
      AppletController(manifest: manifest),
      tag: manifest.appId,
    );

    controller.initializeWebView(bundleUrl);

    return Scaffold(
      backgroundColor: tokens.bgLevel1,
      body: Stack(
        children: [
          Obx(() {
            if (controller.webViewController.value != null) {
              return WebViewWidget(
                key: Key(manifest.appId),
                controller: controller.webViewController.value!,
              );
            }
            return const SizedBox.shrink();
          }),
          Obx(() {
            if (controller.isLoading.value) {
              return Center(
                child: CircularProgressIndicator(color: tokens.brandAccent),
              );
            }
            return const SizedBox.shrink();
          }),
          Obx(() {
            if (controller.error.value.isNotEmpty) {
              return Center(
                child: Column(
                  mainAxisAlignment: MainAxisAlignment.center,
                  children: [
                    Icon(Icons.error_outline, color: Colors.red, size: 48),
                    const SizedBox(height: 16),
                    Text(
                      'Applet Error',
                      style: theme.textTheme.titleLarge
                          ?.copyWith(color: tokens.textPrimary),
                    ),
                    const SizedBox(height: 8),
                    Text(
                      controller.error.value,
                      style: const TextStyle(color: Colors.red),
                      textAlign: TextAlign.center,
                    ),
                  ],
                ),
              );
            }
            return const SizedBox.shrink();
          }),
        ],
      ),
    );
  }
}
