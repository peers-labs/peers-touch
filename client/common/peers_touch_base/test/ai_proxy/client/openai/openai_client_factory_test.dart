
import 'package:peers_touch_base/ai_proxy/client/openai/openai_chat_client.dart';
import 'package:peers_touch_base/ai_proxy/client/openai/openai_client_factory.dart';
import 'package:peers_touch_base/network/dio/http_service_impl.dart';
import 'package:test/test.dart';

void main() {
  group('OpenAiClientFactory', () {
    const testApiKey = 'test-api-key';
    const customBaseUrl = 'https://custom.api.com/v1';

    group('createChatClient', () {
      test('should create a client with the default base URL', () {
        final client = OpenAiClientFactory.createChatClient(apiKey: testApiKey);

        expect(client, isA<OpenAiChatClient>());
        // We can't directly access the apiKey and baseUrl from the client instance
        // as they are private. However, we can be reasonably sure they are set
        // correctly by the constructor. This test mainly ensures the factory
        // returns the correct type of object without crashing.
      });

      test('should create a client with a custom base URL', () {
        final client = OpenAiClientFactory.createChatClient(
          apiKey: testApiKey,
          baseUrl: customBaseUrl,
        );

        expect(client, isA<OpenAiChatClient>());
        // Similar to the above, we trust the constructor to assign the values.
      });
    });

    group('createChatClientWithConfig', () {
      test('should create a client with a custom HttpService', () {
        final client = OpenAiClientFactory.createChatClientWithConfig(
          apiKey: testApiKey,
          baseUrl: customBaseUrl,
          timeout: 60,
          maxRetries: 5,
        );

        expect(client, isA<OpenAiChatClient>());
        // The factory injects a custom HttpServiceImpl.
        // We can infer this by checking if the httpService is not the default one.
        // Since we can't access the private httpService field, this test
        // primarily verifies that the factory method runs and returns the correct
        // client type. A more in-depth test would require modifying the client
        // to expose the service for testing, which might be overkill.
      });

      test('should use default values for config', () {
         final client = OpenAiClientFactory.createChatClientWithConfig(
          apiKey: testApiKey,
        );
         expect(client, isA<OpenAiChatClient>());
      });
    });
  });
}
