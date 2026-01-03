import 'package:flutter/material.dart';
import 'package:flutter_inappwebview/flutter_inappwebview.dart';
import 'package:get/get.dart';
import 'package:peers_touch_base/applet/models/applet_manifest.dart';
import 'package:peers_touch_desktop/app/theme/theme_tokens.dart';
import 'package:peers_touch_desktop/features/applet/controller/applet_controller.dart';

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

    return Scaffold(
      backgroundColor: tokens.bgLevel1,
      body: Stack(
        children: [
          InAppWebView(
            key: Key(manifest.appId),
            initialSettings: InAppWebViewSettings(
              javaScriptEnabled: true,
              allowFileAccessFromFileURLs: true,
              allowUniversalAccessFromFileURLs: true,
              useOnLoadResource: true,
            ),
            initialUrlRequest: URLRequest(
              url: WebUri(_getInitialUrl(bundleUrl)),
            ),
            onWebViewCreated: controller.onWebViewCreated,
            onLoadStart: controller.onLoadStart,
            onLoadStop: controller.onLoadStop,
            onReceivedError: (webViewController, request, error) {
              controller.onLoadError(
                webViewController,
                request.url,
                error.type.toNativeValue() ?? -1,
                error.description,
              );
            },
          ),
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
                    const Icon(Icons.error_outline, color: Colors.red, size: 48),
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

  String _getInitialUrl(String url) {
    if (url.startsWith('http') || url.startsWith('https')) {
      return url;
    } else if (url.startsWith('file://')) {
      return url;
    } else if (url.startsWith('assets://')) {
      return 'file:///android_asset/${url.replaceFirst('assets://', '')}';
    } else if (url.startsWith('template://')) {
      return 'assets/applet/applet_shell.html';
    }
    return 'assets/applet/applet_shell.html';
  }
}
