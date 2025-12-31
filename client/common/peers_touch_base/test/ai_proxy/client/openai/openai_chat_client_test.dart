
import 'package:mockito/annotations.dart';
import 'package:mockito/mockito.dart';
import 'package:peers_touch_base/ai_proxy/client/openai/openai_chat_client.dart';
import 'package:peers_touch_base/model/domain/ai_box/chat.pb.dart';
import 'package:peers_touch_base/network/dio/http_service.dart';
import 'package:test/test.dart';

import 'openai_chat_client_test.mocks.dart';

@GenerateMocks([IHttpService])
void main() {
  group('OpenAiChatClient', () {
    late MockIHttpService mockHttpService;
    late OpenAiChatClient client;

    setUp(() {
      mockHttpService = MockIHttpService();
      client = OpenAiChatClient(apiKey: 'test_key', httpService: mockHttpService);
    });

    test('chat should return a stream of ChatCompletionResponse on success', () async {
      final request = ChatCompletionRequest(
        model: 'gpt-3.5-turbo',
        messages: [ChatMessage(role: ChatRole.CHAT_ROLE_USER, content: 'Hello')],
      );

      final response = {
        'id': 'chatcmpl-123',
        'object': 'chat.completion',
        'created': 1677652288,
        'model': 'gpt-3.5-turbo',
        'choices': [
          {
            'index': 0,
            'message': {
              'role': 'assistant',
              'content': 'Hello there! How can I assist you today?',
            },
            'finish_reason': 'stop',
          }
        ],
      };

      when(mockHttpService.post<Map<String, dynamic>>(any, data: anyNamed('data')))
          .thenAnswer((_) async => response);

      final stream = client.chat(request);

      await expectLater(
        stream,
        emitsInOrder([
          isA<ChatCompletionResponse>()..having((r) => r.choices.first.message.content, 'content', 'Hello ther'),
          isA<ChatCompletionResponse>()..having((r) => r.choices.first.message.content, 'content', 'e! How can'),
          isA<ChatCompletionResponse>()..having((r) => r.choices.first.message.content, 'content', ' I assist '),
          isA<ChatCompletionResponse>()..having((r) => r.choices.first.message.content, 'content', 'you today?'),
          emitsDone,
        ]),
      );
    });

    test('chat should return a stream with an error message on failure', () async {
      final request = ChatCompletionRequest(
        model: 'gpt-3.5-turbo',
        messages: [ChatMessage(role: ChatRole.CHAT_ROLE_USER, content: 'Hello')],
      );

      when(mockHttpService.post<Map<String, dynamic>>(any, data: anyNamed('data')))
          .thenThrow(Exception('Network error'));

      final stream = client.chat(request);

      await expectLater(
        stream,
        emits(
          isA<ChatCompletionResponse>()
              .having((r) => r.choices.first.message.content, 'content', 'Error: Exception: Network error'),
        ),
      );
    });
  });
}
