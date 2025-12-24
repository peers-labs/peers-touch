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
    var token = await secureStorage.get('token_key');
    if (token == null || token.isEmpty) {
      // Rehydrate from LocalStorage if available
      try {
        final lsToken = await LocalStorage().get<String>('auth_token');
        if (lsToken != null && lsToken.isNotEmpty) {
          await secureStorage.set('token_key', lsToken);
          token = lsToken;
        }
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
