
import 'dart:convert';
import 'dart:io';
import 'package:flutter/foundation.dart';
import 'package:get/get.dart';
import 'package:flutter_inappwebview/flutter_inappwebview.dart';
import 'package:logging/logging.dart';
import 'package:path/path.dart' as p;
import 'package:peers_touch_base/applet/bridge/bridge_manager.dart';
import 'package:peers_touch_base/applet/models/applet_manifest.dart';

class AppletController extends GetxController {
  final AppletManifest manifest;
  final _logger = Logger('AppletController');
  
  // Observable state for UI
  final Rx<InAppWebViewController?> webViewController = Rx<InAppWebViewController?>(null);
  final RxBool isLoading = true.obs;
  final RxString error = ''.obs;

  String? _initialUrl;

  AppletController({required this.manifest});

  /// Called by the view to set the initial URL
  void initializeWebView(String initialUrl) {
    _initialUrl = initialUrl;
  }

  void onWebViewCreated(InAppWebViewController controller) {
    webViewController.value = controller;
    
    controller.addJavaScriptHandler(
      handlerName: 'PeersBridge',
      callback: (args) {
        if (args.isNotEmpty) {
          handleBridgeMessage(args[0].toString());
        }
      }
    );

    if (_initialUrl != null) {
      _loadContent(_initialUrl!);
    }
  }

  Future<void> _loadContent(String initialUrl) async {
    final controller = webViewController.value;
    if (controller == null) return;

    try {
      if (initialUrl.startsWith('http') || initialUrl.startsWith('template://')) {
        // For remote URLs or Templates, we load the local shell first
        final shellUrl = await _resolveAssetUrl('assets/applet/applet_shell.html');
        await controller.loadUrl(urlRequest: URLRequest(url: WebUri(shellUrl)));
      } else if (initialUrl.startsWith('file://')) {
        await controller.loadUrl(urlRequest: URLRequest(url: WebUri(initialUrl)));
      } else if (initialUrl.startsWith('assets://')) {
        final assetKey = initialUrl.replaceFirst('assets:///', '');
        final url = await _resolveAssetUrl(assetKey);
        await controller.loadUrl(urlRequest: URLRequest(url: WebUri(url)));
      } else {
        error.value = "Unsupported URL scheme: $initialUrl";
      }
    } catch (e) {
      error.value = "Failed to load content: $e";
      _logger.severe("Load content error", e);
    }
  }

  Future<String> _resolveAssetUrl(String assetKey) async {
    if (kIsWeb) return 'assets/$assetKey';
    
    if (Platform.isWindows || Platform.isLinux) {
       final basePath = p.dirname(Platform.resolvedExecutable);
       final assetPath = p.join(basePath, 'data', 'flutter_assets', assetKey);
       return Uri.file(assetPath).toString();
    }
    
    // For macOS, we might need to find the Resources folder.
    // But typically InAppWebView on macOS handles assets if referenced correctly?
    // Let's try the standard Flutter asset path for Android as fallback, 
    // but for macOS desktop it is usually inside Resources/flutter_assets.
    // If running from IDE, it might be different.
    
    // Simple fallback for now (works on Android/iOS)
    return 'file:///android_asset/flutter_assets/$assetKey';
  }
  
  void onLoadStart(String? url) {
    isLoading.value = true;
  }

  void onLoadStop(String? url) {
    isLoading.value = false;
    // If we just loaded the shell, inject the bundle
    if (url != null && url.contains('applet_shell.html') && _initialUrl != null) {
       _injectBundle(_initialUrl!);
    }
  }

  void onReceivedError(String description) {
    _logger.severe("WebView resource error: $description");
  }

  void _injectBundle(String bundleUrl) {
    if (webViewController.value != null) {
      _logger.info("Injecting bundle: $bundleUrl");
      webViewController.value!.evaluateJavascript(source: 'window.loadAppletBundle("$bundleUrl")');
    }
  }
  
  /// Handle message from JS (via JavaScriptChannel)
  /// Expected format: JSON string of BridgeMessage
  Future<void> handleBridgeMessage(String messageJson) async {
    try {
      final Map<String, dynamic> args = jsonDecode(messageJson);
      
      // Check structure: { module: '...', action: '...', params: {...}, callbackId: '...' }
      
      final response = await BridgeManager().handleInvoke(manifest.appId, args);
      
      // If there is a callbackId, we should send the response back to JS
      final callbackId = args['callbackId'];
      if (callbackId != null && webViewController.value != null) {
         final responseJson = jsonEncode(response.toMap());
         final jsCode = 'window.PeersBridge.onCallback("$callbackId", $responseJson)';
         webViewController.value!.evaluateJavascript(source: jsCode);
      }
      
    } catch (e, stack) {
      _logger.severe("Bridge message handling failed", e, stack);
    }
  }

  @override
  void onClose() {
    super.onClose();
  }
}
