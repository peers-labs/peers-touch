
import 'package:flutter/material.dart';
import 'package:get/get.dart';
import 'package:webf/webf.dart';
import 'package:peers_touch_base/applet/models/applet_manifest.dart';
import 'package:peers_touch_desktop/app/theme/theme_tokens.dart';
import '../controller/applet_controller.dart';

class AppletContainer extends StatelessWidget {
  final AppletManifest manifest;
  final String bundleUrl; // Local path or Remote URL

  const AppletContainer({
    Key? key,
    required this.manifest,
    required this.bundleUrl,
  }) : super(key: key);

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final tokens = theme.extension<WeChatTokens>()!;

    // Create a unique tag for GetX controller based on AppID to support multiple instances
    final controller = Get.put(
      AppletController(manifest: manifest),
      tag: manifest.appId,
    );

    return Scaffold(
      backgroundColor: tokens.bgLevel1,
      body: Stack(
        children: [
          // The WebF View
          WebF(
            key: Key(manifest.appId),
            bundle: WebFBundle.fromUrl(bundleUrl),
            onControllerCreated: controller.onWebFCreated,
            onLoadError: (error, stack) => controller.onWebFError(error, stack),
          ),

          // Loading Indicator
          Obx(() {
            if (controller.isLoading.value) {
              return Center(
                child: CircularProgressIndicator(color: tokens.brandAccent),
              );
            }
            return const SizedBox.shrink();
          }),

          // Error View
          Obx(() {
            if (controller.error.value.isNotEmpty) {
              return Center(
                child: Column(
                  mainAxisAlignment: MainAxisAlignment.center,
                  children: [
                    Icon(Icons.error_outline, color: Colors.red, size: 48),
                    const SizedBox(height: 16),
                    Text(
                      "Applet Error",
                      style: theme.textTheme.titleLarge?.copyWith(color: tokens.textPrimary),
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
