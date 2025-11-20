import 'package:peers_touch_base/model/domain/ai_box/chat.pb.dart';
import 'package:peers_touch_base/ai_proxy/service/ai_box_service.dart';

class AiBoxServerModeService implements IAiBoxService {
  @override
  Stream<ChatCompletionResponse> chat(ChatCompletionRequest request) {
    throw UnimplementedError('Server mode is not implemented yet.');
  }

  @override
  Future<ChatCompletionResponse> chatSync(ChatCompletionRequest request) {
    throw UnimplementedError('Server mode is not implemented yet.');
  }

  @override
  Future<List<String>> getModels(String providerId) {
    throw UnimplementedError('Server mode is not implemented yet.');
  }

  @override
  Future<bool> testConnection(String providerId) {
    throw UnimplementedError('Server mode is not implemented yet.');
  }
}