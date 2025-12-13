class AppStartupSnapshot {
  final bool storageReady;
  final bool servicesReady;
  final bool contextHydrated;
  final bool protocolDetected;
  final List<String> errors;
  final String initialRoute;
  AppStartupSnapshot({
    required this.storageReady,
    required this.servicesReady,
    required this.contextHydrated,
    required this.protocolDetected,
    required this.errors,
    required this.initialRoute,
  });
}

abstract class AppLifecycleOrchestrator {
  Future<void> bootstrapCore();
  Future<void> registerCoreServices();
  Future<void> hydrateContext();
  Future<void> detectProtocol();
  Future<AppStartupSnapshot> awaitReadyGate();
}
