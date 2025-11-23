
import 'package:peers_touch_base/ai_proxy/service/ai_box_client_mode_service.dart';
import 'package:peers_touch_base/ai_proxy/service/ai_box_facade_service.dart';
import 'package:peers_touch_base/ai_proxy/service/ai_box_server_mode_service.dart';
import 'package:peers_touch_base/ai_proxy/service/ai_box_service_factory.dart';
import 'package:test/test.dart';

void main() {
  group('AiBoxServiceFactory', () {
    test('getService should return AiBoxClientModeService for client mode', () {
      final service = AiBoxServiceFactory.getService(mode: AiBoxMode.client);
      expect(service, isA<AiBoxClientModeService>());
    });

    test('getService should return AiBoxServerModeService for server mode', () {
      final service = AiBoxServiceFactory.getService(mode: AiBoxMode.server);
      expect(service, isA<AiBoxServerModeService>());
    });

    test('createFacadeService should return AiBoxFacadeService', () {
      final service = AiBoxServiceFactory.createFacadeService();
      expect(service, isA<AiBoxFacadeService>());
    });
  });
}
