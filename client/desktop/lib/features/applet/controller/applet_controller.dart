import 'dart:convert';

import 'package:flutter_inappwebview/flutter_inappwebview.dart';
import 'package:get/get.dart';
import 'package:logging/logging.dart';
import 'package:peers_touch_base/applet/bridge/bridge_manager.dart';
import 'package:peers_touch_base/applet/models/applet_manifest.dart';

class AppletController extends GetxController {
  AppletController({required this.manifest});
  final AppletManifest manifest;
  final _logger = Logger('AppletController');

  final Rx<InAppWebViewController?> webViewController = Rx<InAppWebViewController?>(null);
  final RxBool isLoading = true.obs;
  final RxString error = ''.obs;

  void onWebViewCreated(InAppWebViewController controller) {
    webViewController.value = controller;
    
    controller.addJavaScriptHandler(
      handlerName: 'PeersBridge',
      callback: (args) {
        if (args.isNotEmpty) {
          handleBridgeMessage(args[0].toString());
        }
      },
    );
  }

  void onLoadStart(InAppWebViewController controller, WebUri? url) {
    isLoading.value = true;
  }

  void onLoadStop(InAppWebViewController controller, WebUri? url) async {
    isLoading.value = false;
    if (url?.toString().contains('applet_shell.html') ?? false) {
      await _injectBundle(manifest.entryPoint);
    }
  }

  void onLoadError(InAppWebViewController controller, WebUri? url, int code, String message) {
    _logger.severe('WebView load error: $message');
    error.value = message;
  }

  Future<void> _injectBundle(String bundleUrl) async {
    if (webViewController.value != null) {
      _logger.info('Injecting bundle: $bundleUrl');
      await webViewController.value!.evaluateJavascript(
        source: 'window.loadAppletBundle("$bundleUrl")',
      );
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
        await webViewController.value!.evaluateJavascript(source: jsCode);
      }
    } catch (e, stack) {
      _logger.severe('Bridge message handling failed', e, stack);
    }
  }
}
