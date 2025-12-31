import 'dart:convert';

import 'package:get/get.dart';
import 'package:logging/logging.dart';
import 'package:peers_touch_base/applet/bridge/bridge_manager.dart';
import 'package:peers_touch_base/applet/models/applet_manifest.dart';
import 'package:webview_flutter/webview_flutter.dart';

class AppletController extends GetxController {
  AppletController({required this.manifest});
  final AppletManifest manifest;
  final _logger = Logger('AppletController');

  final Rx<WebViewController?> webViewController = Rx<WebViewController?>(null);
  final RxBool isLoading = true.obs;
  final RxString error = ''.obs;

  void initializeWebView(String initialUrl) {
    if (webViewController.value != null) return;

    final controller = WebViewController()
      ..setJavaScriptMode(JavaScriptMode.unrestricted)
      ..setNavigationDelegate(
        NavigationDelegate(
          onProgress: (int progress) {},
          onPageStarted: (String url) {
            isLoading.value = true;
          },
          onPageFinished: (String url) {
            isLoading.value = false;
            if (url.contains('applet_shell.html')) {
              _injectBundle(initialUrl);
            }
          },
          onWebResourceError: (WebResourceError e) {
            _logger.severe('WebView resource error: ${e.description}');
          },
        ),
      )
      ..addJavaScriptChannel(
        'PeersBridge',
        onMessageReceived: (JavaScriptMessage message) {
          handleBridgeMessage(message.message);
        },
      );

    if (initialUrl.startsWith('http') || initialUrl.startsWith('template://')) {
      controller.loadFlutterAsset('assets/applet/applet_shell.html');
    } else if (initialUrl.startsWith('file://')) {
      controller.loadFile(initialUrl.replaceFirst('file://', ''));
    } else if (initialUrl.startsWith('assets://')) {
      final assetKey = initialUrl.replaceFirst('assets:///', '');
      controller.loadFlutterAsset(assetKey);
    } else {
      error.value = 'Unsupported URL scheme: $initialUrl';
    }

    webViewController.value = controller;
  }

  void _injectBundle(String bundleUrl) {
    if (webViewController.value != null) {
      _logger.info('Injecting bundle: $bundleUrl');
      webViewController.value!.runJavaScript('window.loadAppletBundle("$bundleUrl")');
    }
  }

  Future<void> handleBridgeMessage(String messageJson) async {
    try {
      final Map<String, dynamic> args = jsonDecode(messageJson);
      final response = await BridgeManager().handleInvoke(manifest.appId, args);
      final callbackId = args['callbackId'];
      if (callbackId != null && webViewController.value != null) {
        final responseJson = jsonEncode(response.toMap());
        final jsCode = 'window.PeersBridge.onCallback("$callbackId", $responseJson)';
        webViewController.value!.runJavaScript(jsCode);
      }
    } catch (e, stack) {
      _logger.severe('Bridge message handling failed', e, stack);
    }
  }

}
