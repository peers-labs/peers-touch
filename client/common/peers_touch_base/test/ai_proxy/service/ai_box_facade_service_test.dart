import 'dart:convert';

import 'package:dio/dio.dart';
import 'package:mockito/mockito.dart';
import 'package:peers_touch_base/ai_proxy/service/ai_box_facade_service.dart';
import 'package:peers_touch_base/model/domain/ai_box/provider.pb.dart';
import 'package:test/test.dart';

import 'mock_provider_manager.mocks.dart';

// Mock for Dio HttpClientAdapter
class MockHttpClientAdapter extends Mock implements HttpClientAdapter {}

void main() {
  group('AiBoxFacadeService', () {
    group('Provider management (no network)', () {
      late AiBoxFacadeService service;
      late MockIProviderManager mockProviderManager;

      setUp(() {
        mockProviderManager = MockIProviderManager();
        service = AiBoxFacadeService.internal(mockProviderManager);
      });

      tearDown(() {
        verifyNoMoreInteractions(mockProviderManager);
      });

      test('getProviders calls providerManager.listProviders', () async {
        final providers = [Provider()..id = '1'];
        when(mockProviderManager.listProviders()).thenAnswer((_) async => providers);
        final result = await service.getProviders();
        expect(result, providers);
        verify(mockProviderManager.listProviders()).called(1);
      });

      test('getProvider calls providerManager.getProvider', () async {
        final provider = Provider()..id = '1';
        when(mockProviderManager.getProvider('1')).thenAnswer((_) async => provider);
        final result = await service.getProvider('1');
        expect(result, provider);
        verify(mockProviderManager.getProvider('1')).called(1);
      });

      test('createProvider calls providerManager.createProvider', () async {
        final provider = Provider()..id = '1';
        when(mockProviderManager.createProvider(provider)).thenAnswer((_) async => provider);
        await service.createProvider(provider);
        verify(mockProviderManager.createProvider(provider)).called(1);
      });

      test('updateProvider calls providerManager.updateProvider', () async {
        final provider = Provider()..id = '1';
        when(mockProviderManager.updateProvider(provider)).thenAnswer((_) async => provider);
        await service.updateProvider(provider);
        verify(mockProviderManager.updateProvider(provider)).called(1);
      });

      test('deleteProvider calls providerManager.deleteProvider', () async {
        when(mockProviderManager.deleteProvider('1')).thenAnswer((_) async {
          return null;
        });
        await service.deleteProvider('1');
        verify(mockProviderManager.deleteProvider('1')).called(1);
      });
    });

    group('with network mocking', () {
      late MockIProviderManager mockProviderManager;
      late Dio dio;
      late MockHttpClientAdapter mockHttpClientAdapter;

      setUp(() {
        mockProviderManager = MockIProviderManager();
        dio = Dio();
        mockHttpClientAdapter = MockHttpClientAdapter();
        dio.httpClientAdapter = mockHttpClientAdapter;
      });

      test('getProviderModels fetches and parses models from Ollama correctly', () async {
        final provider = Provider(
          id: 'ollama-test',
          sourceType: 'ollama',
          configJson: '{"base_url": "http://localhost:11434"}',
        );
        when(mockProviderManager.getProvider('ollama-test')).thenAnswer((_) async => provider);

        final responsePayload = {
          'models': [
            {'name': 'llama3.2-vision:latest'},
            {'name': 'qwen:latest'}
          ]
        };
        final responseBody = ResponseBody.fromString(jsonEncode(responsePayload), 200, headers: {Headers.contentTypeHeader: [Headers.jsonContentType]});

        when(mockHttpClientAdapter.fetch(any, any, any)).thenAnswer((_) async => responseBody);

        final serviceWithMockedDio = AiBoxFacadeService.internal(mockProviderManager, dioForTest: dio);
        final models = await serviceWithMockedDio.getProviderModels('ollama-test');

        expect(models, equals(['llama3.2-vision:latest', 'qwen:latest']));
        verify(mockProviderManager.getProvider('ollama-test')).called(1);
        final captured = verify(mockHttpClientAdapter.fetch(captureAny, any, any)).captured;
        expect(captured.first.path, '/api/tags');
      });

      test('testProviderConnection returns true for a valid connection', () async {
        final provider = Provider(id: 'ollama-test', sourceType: 'ollama', configJson: '{"base_url": "http://localhost:11434"}');
        when(mockProviderManager.getProvider('ollama-test')).thenAnswer((_) async => provider);

        final responseBody = ResponseBody.fromString('', 200);
        when(mockHttpClientAdapter.fetch(any, any, any)).thenAnswer((_) async => responseBody);

        final serviceWithMockedDio = AiBoxFacadeService.internal(mockProviderManager, dioForTest: dio);
        final result = await serviceWithMockedDio.testProviderConnection('ollama-test');

        expect(result, isTrue);
        verify(mockProviderManager.getProvider('ollama-test')).called(1);
        final captured = verify(mockHttpClientAdapter.fetch(captureAny, any, any)).captured;
        expect(captured.first.path, '/api/tags');
      });

      test('testProviderConnection returns false for a failed connection', () async {
        final provider = Provider(id: 'ollama-test', sourceType: 'ollama', configJson: '{"base_url": "http://localhost:11434"}');
        when(mockProviderManager.getProvider('ollama-test')).thenAnswer((_) async => provider);

        when(mockHttpClientAdapter.fetch(any, any, any)).thenThrow(DioException(requestOptions: RequestOptions(path: '/api/tags')));

        final serviceWithMockedDio = AiBoxFacadeService.internal(mockProviderManager, dioForTest: dio);
        final result = await serviceWithMockedDio.testProviderConnection('ollama-test');

        expect(result, isFalse);
        verify(mockProviderManager.getProvider('ollama-test')).called(1);
      });
    });
  });
}
