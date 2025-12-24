
import 'dart:convert';
import 'package:get/get.dart';
import 'package:webf/webf.dart';
import 'package:logging/logging.dart';
import 'package:peers_touch_base/applet/bridge/bridge_manager.dart';
import 'package:peers_touch_base/applet/models/applet_manifest.dart';

class AppletController extends GetxController {
  final AppletManifest manifest;
  final _logger = Logger('AppletController');
  WebFController? webFController;
  
  // Observable state for UI
  final RxBool isLoading = true.obs;
  final RxString error = ''.obs;

  AppletController({required this.manifest});

  void onWebFCreated(WebFController controller) {
    webFController = controller;
    isLoading.value = false;
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
      if (callbackId != null && webFController != null) {
         final responseJson = jsonEncode(response.toMap());
         // Execute JS callback
         // Assuming JS side exposes a global callback handler: window.PeersBridge.onCallback(id, response)
         // webFController!.evaluateJavascript('window.PeersBridge.onCallback("$callbackId", $responseJson)');
      }
      
    } catch (e, stack) {
      _logger.severe("Bridge message handling failed", e, stack);
    }
  }

  void onWebFError(Object error, StackTrace stack) {
    this.error.value = error.toString();
    isLoading.value = false;
    _logger.severe("WebF Error in ${manifest.appId}", error, stack);
  }

  @override
  void onClose() {
    webFController?.dispose();
    super.onClose();
  }
}
