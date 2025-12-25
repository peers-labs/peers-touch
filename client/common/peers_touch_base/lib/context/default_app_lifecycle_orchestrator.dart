import '../storage/secure_storage_adapter.dart';
import '../storage/local_storage.dart';
import 'app_lifecycle_orchestrator.dart';
import 'default_ready_gate.dart';
import 'global_context.dart';

class DefaultAppLifecycleOrchestrator implements AppLifecycleOrchestrator {
  final SecureStorageAdapter secureStorage;
  final GlobalContext globalContext;
  final DefaultReadyGate readyGate;
  DefaultAppLifecycleOrchestrator({
    required this.secureStorage,
    required this.globalContext,
    DefaultReadyGate? readyGate,
  }) : readyGate = readyGate ?? DefaultReadyGate();

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

    final sessionValid = token != null && token.isNotEmpty;
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
