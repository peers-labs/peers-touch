abstract class ReadyGate {
  Future<bool> storageReady();
  Future<bool> servicesReady();
  Future<bool> contextHydrated();
  Future<bool> protocolDetected();
  Future<String> suggestInitialRoute({required bool sessionValid});
}
