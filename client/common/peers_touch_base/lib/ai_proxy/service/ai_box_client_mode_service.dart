import 'package:peers_touch_base/model/domain/ai_box/chat.pb.dart';
import 'package:peers_touch_base/ai_proxy/adapter/ai_proxy_adapter.dart';
import 'package:peers_touch_base/ai_proxy/client/chat_client.dart';
import 'package:peers_touch_base/ai_proxy/service/ai_box_service.dart';

class AiBoxClientModeService implements IAiBoxService {
  final AiProxyAdapter _adapter;

  AiBoxClientModeService(this._adapter);

  @override
  Stream<ChatCompletionResponse> chat(ChatCompletionRequest request) {
    try {
      // 1. Find the responsible provider for the requested model.
      final provider = _adapter.getProviderForModel(request.model);
      if (provider == null) {
        return Stream.error(
          Exception('Provider for model "${request.model}" not found.'),
        );
      }

      // 2. "Tell" the provider to create a chat client.
      final ChatClient client = provider.createChatClient(request.model);

      // 3. Delegate the request to that client.
      return client.chat(request);
    } catch (e) {
      return Stream.error(e);
    }
  }

  @override
  Future<ChatCompletionResponse> chatSync(ChatCompletionRequest request) async {
    try {
      // 1. Find the responsible provider for the requested model.
      final provider = _adapter.getProviderForModel(request.model);
      if (provider == null) {
        throw Exception('Provider for model "\${request.model}" not found.');
      }

      // 2. "Tell" the provider to create a chat client.
      final ChatClient client = provider.createChatClient(request.model);

      // 3. Delegate the request to that client and get the complete response.
      // Since we're in sync mode, we need to collect all stream events and return the final response.
      final response = ChatCompletionResponse();
      await for (final chunk in client.chat(request)) {
        response.mergeFromMessage(chunk);
      }
      
      return response;
    } catch (e) {
      throw e;
    }
  }
}
