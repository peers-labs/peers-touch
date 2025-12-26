
import 'dart:convert';
import 'package:flutter/services.dart';
import 'package:get/get.dart';
import 'package:webview_flutter/webview_flutter.dart';
import 'package:logging/logging.dart';
import 'package:peers_touch_base/applet/bridge/bridge_manager.dart';
import 'package:peers_touch_base/applet/models/applet_manifest.dart';

class AppletController extends GetxController {
  final AppletManifest manifest;
  final _logger = Logger('AppletController');
  
  // Observable state for UI
  final Rx<WebViewController?> webViewController = Rx<WebViewController?>(null);
  final RxBool isLoading = true.obs;
  final RxString error = ''.obs;

  AppletController({required this.manifest});

  void initializeWebView(String initialUrl) {
    if (webViewController.value != null) return;

    final controller = WebViewController()
      ..setJavaScriptMode(JavaScriptMode.unrestricted)
      ..setNavigationDelegate(
        NavigationDelegate(
          onProgress: (int progress) {
            // Update loading bar.
          },
          onPageStarted: (String url) {
            isLoading.value = true;
          },
          onPageFinished: (String url) {
            isLoading.value = false;
            // If we just loaded the shell, inject the bundle
            if (url.contains('applet_shell.html')) {
               _injectBundle(initialUrl);
            }
          },
          onWebResourceError: (WebResourceError e) {
            _logger.severe("WebView resource error: ${e.description}");
            // Don't block UI on resource error, but log it
          },
        ),
      )
      ..addJavaScriptChannel(
        'PeersBridge',
        onMessageReceived: (JavaScriptMessage message) {
          handleBridgeMessage(message.message);
        },
      );

      // Handle loading based on URL type
      if (initialUrl.startsWith('http') || initialUrl.startsWith('template://')) {
        // For remote URLs or Templates, we load the local shell first
        // Then inject the bundle URL
        controller.loadFlutterAsset('assets/applet/applet_shell.html');
      } else if (initialUrl.startsWith('file://')) {
        controller.loadFile(initialUrl.replaceFirst('file://', ''));
      } else if (initialUrl.startsWith('assets://')) {
        final assetKey = initialUrl.replaceFirst('assets:///', '');
        controller.loadFlutterAsset(assetKey);
      } else {
        error.value = "Unsupported URL scheme: $initialUrl";
      }

    webViewController.value = controller;
  }
  
  void _injectBundle(String bundleUrl) {
    if (webViewController.value != null) {
      _logger.info("Injecting bundle: $bundleUrl");
      webViewController.value!.runJavaScript('window.loadAppletBundle("$bundleUrl")');
    }
  }
  
  /// Handle message from JS (via JavaScriptChannel)
  /// Expected format: JSON string of BridgeMessage
  Future<void> handleBridgeMessage(String messageJson) async {
    try {
      final Map<String, dynamic> args = jsonDecode(messageJson);
      
      // Check structure: { module: '...', action: '...', params: {...}, callbackId: '...' }
      // This matches the protocol we defined in base/applet/bridge/protocol.dart
      
      final response = await BridgeManager().handleInvoke(manifest.appId, args);
      
      // If there is a callbackId, we should send the response back to JS
      final callbackId = args['callbackId'];
      if (callbackId != null && webViewController.value != null) {
         final responseJson = jsonEncode(response.toMap());
         // Execute JS callback
         // Assuming JS side exposes a global callback handler: window.PeersBridge.onCallback(id, response)
         final jsCode = 'window.PeersBridge.onCallback("$callbackId", $responseJson)';
         webViewController.value!.runJavaScript(jsCode);
      }
      
    } catch (e, stack) {
      _logger.severe("Bridge message handling failed", e, stack);
    }
  }

  @override
  void onClose() {
    // WebViewController doesn't need explicit disposal
    super.onClose();
  }
}
