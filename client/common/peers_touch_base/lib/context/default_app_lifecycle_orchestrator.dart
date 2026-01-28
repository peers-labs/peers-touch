import 'package:peers_touch_base/context/app_lifecycle_orchestrator.dart';
import 'package:peers_touch_base/context/default_ready_gate.dart';
import 'package:peers_touch_base/context/global_context.dart';
import 'package:peers_touch_base/logger/logging_service.dart';
import 'package:peers_touch_base/storage/local_storage.dart';
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

    // Legacy fallback
    if (token == null || token.isEmpty) {
      try {
        final lsToken = await LocalStorage().get<String>('auth_token');
        if (lsToken != null && lsToken.isNotEmpty) {
          token = lsToken;
        }
      } catch (_) {}
    }
    
    // Attempt to sync back to SecureStorage if we have a valid token but it wasn't there
    if (token != null && token.isNotEmpty) {
      try {
         // Best effort sync
         await secureStorage.set('token_key', token);
      } catch (_) {}
    }

    bool sessionValid = token != null && token.isNotEmpty;
    
    // If we have a token, verify user profile exists
    if (sessionValid) {
      try {
        LoggingService.info('AppLifecycleOrchestrator: Token found, verifying user profile');
        await globalContext.refreshProfile();
        
        final profile = globalContext.userProfile;
        if (profile == null || profile['id'] == null) {
          LoggingService.warning('AppLifecycleOrchestrator: User profile not found, clearing session');
          // User doesn't exist anymore, clear session and go to login
          await globalContext.setSession(null);
          globalContext.clearProfile();
          try {
            await secureStorage.remove('token_key');
          } catch (_) {}
          // Also clear legacy token
          try {
            await LocalStorage().remove('auth_token');
          } catch (_) {}
          sessionValid = false;
        } else {
          LoggingService.info('AppLifecycleOrchestrator: User profile valid: id=${profile['id']}');
        }
      } catch (e) {
        LoggingService.warning('AppLifecycleOrchestrator: Profile verification failed: $e');
        // Profile verification failed, clear session and go to login
        await globalContext.setSession(null);
        globalContext.clearProfile();
        try {
          await secureStorage.remove('token_key');
        } catch (_) {}
        // Also clear legacy token
        try {
          await LocalStorage().remove('auth_token');
        } catch (_) {}
        sessionValid = false;
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
}
