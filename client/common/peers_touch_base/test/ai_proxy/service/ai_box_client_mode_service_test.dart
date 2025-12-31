import 'package:mockito/mockito.dart';
import 'package:peers_touch_base/ai_proxy/service/ai_box_client_mode_service.dart';
import 'package:peers_touch_base/model/domain/ai_box/chat.pb.dart';
import 'package:test/test.dart';

import 'mock_ai_proxy_adapter.mocks.dart';

void main() {
  late AiBoxClientModeService service;
  late MockAiProxyAdapter mockAdapter;
  late MockRichProvider mockProvider;
  late MockChatClient mockChatClient;

  setUp(() {
    mockAdapter = MockAiProxyAdapter();
    mockProvider = MockRichProvider();
    mockChatClient = MockChatClient();
    service = AiBoxClientModeService(mockAdapter);
  });

  tearDown(() {
    verifyNoMoreInteractions(mockAdapter);
    verifyNoMoreInteractions(mockProvider);
    verifyNoMoreInteractions(mockChatClient);
  });

  group('AiBoxClientModeService', () {
    test('chat returns stream when provider is found', () {
      final request = ChatCompletionRequest()..model = 'test-model';
      final responseStream = Stream.value(ChatCompletionResponse());

      when(mockAdapter.getProviderForModel('test-model')).thenReturn(mockProvider);
      when(mockProvider.createChatClient(request.model)).thenReturn(mockChatClient);
      when(mockChatClient.chat(request)).thenAnswer((_) => responseStream);

      final result = service.chat(request);

      expect(result, isA<Stream<ChatCompletionResponse>>());
      result.listen(expectAsync1((response) {
        expect(response, isA<ChatCompletionResponse>());
      }));

      verify(mockAdapter.getProviderForModel('test-model')).called(1);
      verify(mockProvider.createChatClient(request.model)).called(1);
      verify(mockChatClient.chat(request)).called(1);
    });

    test('chat returns error stream when provider is not found', () {
      final request = ChatCompletionRequest()..model = 'unknown-model';

      when(mockAdapter.getProviderForModel('unknown-model')).thenReturn(null);

      final result = service.chat(request);

      expect(result, emitsError(isA<Exception>().having((e) => e.toString(), 'toString', 'Exception: Provider for model "unknown-model" not found.')));

      verify(mockAdapter.getProviderForModel('unknown-model')).called(1);
    });

    test('chat returns error stream when createChatClient fails', () {
      final request = ChatCompletionRequest()..model = 'test-model';
      final exception = Exception('Failed to create client');

      when(mockAdapter.getProviderForModel('test-model')).thenReturn(mockProvider);
      when(mockProvider.createChatClient(request.model)).thenThrow(exception);

      final result = service.chat(request);

      expect(result, emitsError(exception));

      verify(mockAdapter.getProviderForModel('test-model')).called(1);
      verify(mockProvider.createChatClient(request.model)).called(1);
    });

    test('getModels returns models from provider', () async {
      const providerId = 'test-provider';
      final models = ['model1', 'model2'];
      
      when(mockAdapter.getProvider(providerId)).thenReturn(mockProvider);
      when(mockProvider.getSupportedModels()).thenReturn(models);

      final result = await service.getModels(providerId);

      expect(result, models);
      
      verify(mockAdapter.getProvider(providerId)).called(1);
      verify(mockProvider.getSupportedModels()).called(1);
    });

    test('getModels throws exception when provider is not found', () async {
      const providerId = 'unknown-provider';
      
      when(mockAdapter.getProvider(providerId)).thenReturn(null);

      expect(() => service.getModels(providerId), throwsA(isA<Exception>().having((e) => e.toString(), 'toString', 'Exception: Provider "unknown-provider" not found.')));

      verify(mockAdapter.getProvider(providerId)).called(1);
    });

    test('testConnection returns true when provider is found and connection is successful', () async {
      const providerId = 'test-provider';
      
      when(mockAdapter.getProvider(providerId)).thenReturn(mockProvider);
      when(mockProvider.testConnection()).thenAnswer((_) async => true);

      final result = await service.testConnection(providerId);

      expect(result, isTrue);
      
      verify(mockAdapter.getProvider(providerId)).called(1);
      verify(mockProvider.testConnection()).called(1);
    });

    test('testConnection returns false when provider is not found', () async {
      const providerId = 'unknown-provider';
      
      when(mockAdapter.getProvider(providerId)).thenReturn(null);

      final result = await service.testConnection(providerId);

      expect(result, isFalse);

      verify(mockAdapter.getProvider(providerId)).called(1);
    });

    test('testConnection returns false when provider throws exception', () async {
      const providerId = 'test-provider';
      
      when(mockAdapter.getProvider(providerId)).thenReturn(mockProvider);
      when(mockProvider.testConnection()).thenThrow(Exception('Connection failed'));

      final result = await service.testConnection(providerId);

      expect(result, isFalse);

      verify(mockAdapter.getProvider(providerId)).called(1);
      verify(mockProvider.testConnection()).called(1);
    });

  });
}
