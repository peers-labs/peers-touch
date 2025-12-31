
import 'dart:convert';

import 'package:mockito/annotations.dart';
import 'package:mockito/mockito.dart';
import 'package:peers_touch_base/ai_proxy/provider/i_provider_manager.dart';
import 'package:peers_touch_base/ai_proxy/provider/local_provider_manager.dart';
import 'package:peers_touch_base/ai_proxy/service/ai_box_local_storage_service.dart';
import 'package:peers_touch_base/model/domain/ai_box/provider.pb.dart';
import 'package:test/test.dart';

import 'local_provider_manager_test.mocks.dart';

@GenerateMocks([AiBoxLocalStorageService])
void main() {
  late MockAiBoxLocalStorageService mockLocalStorage;
  late LocalProviderManager manager;

  setUp(() {
    mockLocalStorage = MockAiBoxLocalStorageService();
    manager = LocalProviderManager(localStorage: mockLocalStorage);
  });

  group('LocalProviderManager', () {
    group('newProvider', () {
      test('should create a new OpenAI provider with correct defaults', () {
        final provider = manager.newProvider(ProviderType.openai, 'url', 'key');

        expect(provider.sourceType, 'openai');
        expect(provider.name, 'OpenAI');
        expect(provider.checkModel, 'gpt-4o');
        final config = jsonDecode(provider.configJson);
        expect(config['api_key'], 'key');
        expect(config['base_url'], 'url');
        expect(config['model'], 'gpt-4o');
      });

      test('should create a new Ollama provider with correct defaults', () {
        final provider = manager.newProvider(ProviderType.ollama, 'url', 'key');

        expect(provider.sourceType, 'ollama');
        expect(provider.name, 'Ollama');
        expect(provider.checkModel, 'llama3');
      });
    });

    group('createProvider', () {
      test('should save the provider to local storage', () async {
        final provider = Provider(id: '1');
        when(mockLocalStorage.saveProvider(any))
            .thenAnswer((_) async => Future.value());
        when(mockLocalStorage.getAllProviders()).thenAnswer((_) async => []);

        await manager.createProvider(provider);

        verify(mockLocalStorage.saveProvider(provider)).called(1);
      });

      test('should set as default if it is the first provider', () async {
        final provider = Provider(id: '1');
        when(mockLocalStorage.saveProvider(any))
            .thenAnswer((_) async => Future.value());
        // Simulate this being the first provider
        when(mockLocalStorage.getAllProviders())
            .thenAnswer((_) async => [jsonDecode(provider.writeToJson()) as Map<String, dynamic>]);
        when(mockLocalStorage.setDefaultProviderId(any))
            .thenAnswer((_) async => Future.value());

        await manager.createProvider(provider);

        verify(mockLocalStorage.saveProvider(provider)).called(1);
        verify(mockLocalStorage.setDefaultProviderId('1')).called(1);
      });
    });

    group('getProvider', () {
      test('should return a provider from local storage', () async {
        final providerJson = Provider(id: '1', name: 'Test').writeToJson();
        when(mockLocalStorage.getProvider('1'))
            .thenAnswer((_) async => jsonDecode(providerJson));

        final result = await manager.getProvider('1');

        expect(result, isA<Provider>());
        expect(result!.id, '1');
        expect(result.name, 'Test');
      });

      test('should return null if provider does not exist', () async {
        when(mockLocalStorage.getProvider('1')).thenAnswer((_) async => null);

        final result = await manager.getProvider('1');

        expect(result, isNull);
      });
    });

    group('listProviders', () {
      test('should return a list of providers from local storage', () async {
        final providersJson = [
          jsonDecode(Provider(id: '1', name: 'Test1').writeToJson()) as Map<String, dynamic>,
          jsonDecode(Provider(id: '2', name: 'Test2').writeToJson()) as Map<String, dynamic>,
        ];
        when(mockLocalStorage.getAllProviders())
            .thenAnswer((_) async => providersJson);

        final result = await manager.listProviders();

        expect(result, isA<List<Provider>>());
        expect(result.length, 2);
        expect(result.first.name, 'Test1');
      });
    });

    group('updateProvider', () {
      test('should save the updated provider to local storage', () async {
        final provider = Provider(id: '1');
        when(mockLocalStorage.saveProvider(any))
            .thenAnswer((_) async => Future.value());

        await manager.updateProvider(provider);

        verify(mockLocalStorage.saveProvider(provider)).called(1);
      });
    });

    group('deleteProvider', () {
      test('should delete the provider from local storage', () async {
        when(mockLocalStorage.deleteProvider(any))
            .thenAnswer((_) async => Future.value());

        await manager.deleteProvider('1');

        verify(mockLocalStorage.deleteProvider('1')).called(1);
      });
    });

    group('Default and Current Provider', () {
      test('getDefaultProvider should fetch from local storage', () async {
        when(mockLocalStorage.getDefaultProviderId())
            .thenAnswer((_) async => 'default-id');
        final providerJson =
            Provider(id: 'default-id', name: 'Default').writeToJson();
        when(mockLocalStorage.getProvider('default-id'))
            .thenAnswer((_) async => jsonDecode(providerJson));

        final result = await manager.getDefaultProvider();

        expect(result, isNotNull);
        expect(result!.id, 'default-id');
      });

      test('setDefaultProvider should save to local storage', () async {
        when(mockLocalStorage.setDefaultProviderId(any))
            .thenAnswer((_) async => Future.value());

        await manager.setDefaultProvider('1');

        verify(mockLocalStorage.setDefaultProviderId('1')).called(1);
      });

      test('getCurrentProvider should fetch from local storage', () async {
        when(mockLocalStorage.getCurrentProviderId())
            .thenAnswer((_) async => 'current-id');
        final providerJson =
            Provider(id: 'current-id', name: 'Current').writeToJson();
        when(mockLocalStorage.getProvider('current-id'))
            .thenAnswer((_) async => jsonDecode(providerJson));

        final result = await manager.getCurrentProvider();

        expect(result, isNotNull);
        expect(result!.id, 'current-id');
      });

      test('setCurrentProvider should save to local storage', () async {
        when(mockLocalStorage.setCurrentProviderId(any))
            .thenAnswer((_) async => Future.value());

        await manager.setCurrentProvider('1');

        verify(mockLocalStorage.setCurrentProviderId('1')).called(1);
      });
    });
  });
}
