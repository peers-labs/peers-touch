import 'package:peers_touch_base/context/ready_gate.dart';

class DefaultReadyGate implements ReadyGate {
  @override
  Future<bool> storageReady() async => true;
  @override
  Future<bool> servicesReady() async => true;
  @override
  Future<bool> contextHydrated() async => true;
  @override
  Future<bool> protocolDetected() async => true;
  @override
  Future<String> suggestInitialRoute({required bool sessionValid}) async {
    return sessionValid ? '/shell' : '/login';
  }
}
