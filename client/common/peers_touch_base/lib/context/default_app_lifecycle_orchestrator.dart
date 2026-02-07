import 'dart:io';

import 'package:peers_touch_base/context/app_lifecycle_orchestrator.dart';
import 'package:peers_touch_base/context/default_ready_gate.dart';
import 'package:peers_touch_base/context/global_context.dart';
import 'package:peers_touch_base/logger/logging_service.dart';
import 'package:peers_touch_base/storage/secure_storage_adapter.dart';

class DefaultAppLifecycleOrchestrator implements AppLifecycleOrchestrator {
  DefaultAppLifecycleOrchestrator({
    required this.secureStorage,
    required this.globalContext,
    DefaultReadyGate? readyGate,
  }) : readyGate = readyGate ?? DefaultReadyGate();
  final SecureStorageAdapter secureStorage;
  final GlobalContext globalContext;
  final DefaultReadyGate readyGate;

  @override
  Future<void> bootstrapCore() async {}

  @override
  Future<void> registerCoreServices() async {}

  @override
  Future<void> hydrateContext() async {
    await globalContext.hydrate();
  }

  @override
  Future<void> detectProtocol() async {}

  @override
  Future<AppStartupSnapshot> awaitReadyGate() async {
    await hydrateContext();
    
    // Check GlobalContext first (in-memory, restored from LocalStorage)
    var token = globalContext.currentSession?['accessToken']?.toString();
    
    // Fallback to SecureStorage if not in GlobalContext (unlikely if hydrated, but safe)
    if (token == null || token.isEmpty) {
      try {
        token = await secureStorage.get('token_key');
      } catch (_) {}
    }

    bool sessionValid = token != null && token.isNotEmpty;
    
    // If we have a token, try to verify user profile.
    // IMPORTANT: Only clear session for definitive "user not found" (404).
    // Network errors or transient failures should NOT invalidate a valid token.
    if (sessionValid) {
      try {
        LoggingService.info('AppLifecycleOrchestrator: Token found, verifying user profile');
        await globalContext.refreshProfile();
        
        final profile = globalContext.userProfile;
        if (profile == null || profile['id'] == null) {
          LoggingService.warning('AppLifecycleOrchestrator: User profile not found, clearing session');
          await globalContext.setSession(null);
          globalContext.clearProfile();
          sessionValid = false;
        } else {
          LoggingService.info('AppLifecycleOrchestrator: User profile valid: id=${profile['id']}');
        }
      } catch (e) {
        // Distinguish network/transient errors from definitive auth failures.
        // Network errors (SocketException, timeout) should NOT clear the session —
        // the token might still be valid, the server is just unreachable.
        if (_isNetworkError(e)) {
          LoggingService.warning(
            'AppLifecycleOrchestrator: Profile verification skipped (network error): $e. '
            'Keeping session valid — will retry when network recovers.',
          );
          // Keep sessionValid = true so user can enter the app
        } else {
          LoggingService.warning('AppLifecycleOrchestrator: Profile verification failed (auth error): $e');
          await globalContext.setSession(null);
          globalContext.clearProfile();
          sessionValid = false;
        }
      }
    }
    
    final initialRoute = await readyGate.suggestInitialRoute(sessionValid: sessionValid);
    return AppStartupSnapshot(
      storageReady: true,
      servicesReady: true,
      contextHydrated: true,
      protocolDetected: true,
      errors: const [],
      initialRoute: initialRoute,
    );
  }

  /// Check if the error is a transient network error (server unreachable,
  /// timeout, DNS failure, etc.) rather than a definitive auth failure.
  bool _isNetworkError(Object e) {
    if (e is SocketException) return true;
    final msg = e.toString().toLowerCase();
    return msg.contains('socketexception') ||
        msg.contains('connection refused') ||
        msg.contains('connection reset') ||
        msg.contains('connection closed') ||
        msg.contains('timed out') ||
        msg.contains('timeout') ||
        msg.contains('network is unreachable') ||
        msg.contains('host not found') ||
        msg.contains('no route to host');
  }
}
