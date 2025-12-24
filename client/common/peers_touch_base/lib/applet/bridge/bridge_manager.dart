
import 'dart:async';
import 'package:flutter/services.dart';
import 'guard.dart';
import 'protocol.dart';
import '../capabilities/capability_base.dart';

class BridgeManager {
  static final BridgeManager _instance = BridgeManager._internal();
  factory BridgeManager() => _instance;
  BridgeManager._internal();

  final Map<String, AppletCapability> _capabilities = {};
  AppletGuard _guard = DefaultAppletGuard();

  void registerCapability(AppletCapability capability) {
    _capabilities[capability.moduleName] = capability;
  }

  void setGuard(AppletGuard guard) {
    _guard = guard;
  }

  /// Entry point for messages from JS (via MethodChannel or WebF)
  Future<BridgeResponse> handleInvoke(String appId, Map<String, dynamic> messageMap) async {
    try {
      final message = BridgeMessage.fromMap(messageMap);
      
      // 1. Guard check
      final allowed = await _guard.onRequest(appId, message.module, message.action, message.params);
      if (!allowed) {
        return BridgeResponse.failure("Permission denied: ${message.module}.${message.action}");
      }

      // 2. Find capability
      final capability = _capabilities[message.module];
      if (capability == null) {
        return BridgeResponse.failure("Module not found: ${message.module}");
      }

      // 3. Execute
      final result = await capability.handle(message.action, message.params, appId);
      return BridgeResponse.success(result);
    } catch (e, stack) {
      print("Bridge Error: $e\n$stack");
      return BridgeResponse.failure(e.toString());
    }
  }
}
