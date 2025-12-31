import 'package:peers_touch_base/ai_proxy/service/ai_box_server_mode_service.dart';
import 'package:peers_touch_base/model/domain/ai_box/chat.pb.dart';
import 'package:test/test.dart';

void main() {
  group('AiBoxServerModeService', () {
    late AiBoxServerModeService service;

    setUp(() {
      service = AiBoxServerModeService();
    });

    test('chat throws UnimplementedError', () {
      expect(() => service.chat(ChatCompletionRequest()), throwsUnimplementedError);
    });

    test('chatSync throws UnimplementedError', () {
      expect(() => service.chatSync(ChatCompletionRequest()), throwsUnimplementedError);
    });

    test('getModels throws UnimplementedError', () {
      expect(() => service.getModels('provider-id'), throwsUnimplementedError);
    });

    test('testConnection throws UnimplementedError', () {
      expect(() => service.testConnection('provider-id'), throwsUnimplementedError);
    });
  });
}
