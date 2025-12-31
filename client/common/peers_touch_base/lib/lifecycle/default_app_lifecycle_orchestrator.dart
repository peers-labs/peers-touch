import 'package:peers_touch_base/lifecycle/app_lifecycle_orchestrator.dart';
import 'package:peers_touch_base/lifecycle/default_ready_gate.dart';
import 'package:peers_touch_base/storage/secure_storage_adapter.dart';

class DefaultAppLifecycleOrchestrator implements AppLifecycleOrchestrator {
  DefaultAppLifecycleOrchestrator({
    required this.secureStorage,
    DefaultReadyGate? readyGate,
  }) : readyGate = readyGate ?? DefaultReadyGate();
  final SecureStorageAdapter secureStorage;
  final DefaultReadyGate readyGate;

  @override
  Future<void> bootstrapCore() async {}

  @override
  Future<void> registerCoreServices() async {}

  @override
  Future<void> hydrateContext() async {}

  @override
  Future<void> detectProtocol() async {}

  @override
  Future<AppStartupSnapshot> awaitReadyGate() async {
    final token = await secureStorage.get('token_key');
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
