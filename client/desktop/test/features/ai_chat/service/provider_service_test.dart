import 'package:flutter_test/flutter_test.dart';
import 'package:mockito/annotations.dart';
import 'package:mockito/mockito.dart';
import 'package:peers_touch_base/ai_proxy/service/ai_box_facade_service.dart';
import 'package:peers_touch_desktop/features/ai_chat/service/provider_service.dart';
import 'package:peers_touch_base/model/domain/ai_box/provider.pb.dart';
import 'package:peers_touch_base/storage/kv/kv_database.dart';
import 'provider_service_test.mocks.dart';

@GenerateMocks([AiBoxFacadeService])
void main() {
  late ProviderService providerService;
  late MockAiBoxFacadeService mockAiBoxFacadeService;
  late AiBoxFacadeService realFacadeService;
  late ProviderService realProviderService;

  setUp(() {
    mockAiBoxFacadeService = MockAiBoxFacadeService();
    providerService = ProviderService(aiBoxFacadeService: mockAiBoxFacadeService);
    realFacadeService = AiBoxFacadeService();
    realProviderService = ProviderService(aiBoxFacadeService: realFacadeService);
  });

  tearDown(() async {
    // Clean up local storage after each test
    await KvDatabase().clear();
  });



  group('ProviderService', () {
    test('getProviders returns a list of providers', () async {
      final providers = [Provider(id: '1', name: 'Test Provider')];
      when(mockAiBoxFacadeService.getProviders()).thenAnswer((_) async => providers);

      final result = await providerService.getProviders();

      expect(result, providers);
      verify(mockAiBoxFacadeService.getProviders());
    });

    test('createProvider calls the facade service', () async {
      final provider = Provider(id: '1', name: 'Test Provider');
      await providerService.createProvider(provider);
      verify(mockAiBoxFacadeService.createProvider(provider));
    });

    test('updateProvider calls the facade service', () async {
      final provider = Provider(id: '1', name: 'Test Provider');
      await providerService.updateProvider(provider);
      verify(mockAiBoxFacadeService.updateProvider(provider));
    });

    test('getCurrentProvider returns a provider', () async {
      final provider = Provider(id: '1', name: 'Test Provider');
      when(mockAiBoxFacadeService.getCurrentProvider()).thenAnswer((_) async => provider);

      final result = await providerService.getCurrentProvider();

      expect(result, provider);
      verify(mockAiBoxFacadeService.getCurrentProvider());
    });

    test('deleteProvider calls the facade service', () async {
      const providerId = '1';
      await providerService.deleteProvider(providerId);
      verify(mockAiBoxFacadeService.deleteProvider(providerId));
    });

    test('setCurrentProvider calls the facade service', () async {
      const providerId = '1';
      await providerService.setCurrentProvider(providerId);
      verify(mockAiBoxFacadeService.setCurrentProvider(providerId));
    });

    test('testProviderConnection returns a boolean', () async {
      final provider = Provider(id: '1', name: 'Test Provider');
      when(mockAiBoxFacadeService.testProviderConnection(provider.id)).thenAnswer((_) async => true);

      final result = await providerService.testProviderConnection(provider);

      expect(result, isTrue);
      verify(mockAiBoxFacadeService.testProviderConnection(provider.id));
    });

    test('fetchProviderModels returns a list of strings', () async {
      final provider = Provider(id: '1', name: 'Test Provider');
      final models = ['model1', 'model2'];
      when(mockAiBoxFacadeService.getProviderModels(provider.id)).thenAnswer((_) async => models);

      final result = await providerService.fetchProviderModels(provider);

      expect(result, models);
      verify(mockAiBoxFacadeService.getProviderModels(provider.id));
    });

    test('createDefaultProvider returns a provider with correct defaults', () {
      final provider = providerService.createDefaultProvider(
        id: '1',
        name: 'Test Provider',
        sourceType: 'openai',
        peersUserId: 'user1',
      );

      expect(provider.id, '1');
      expect(provider.name, 'Test Provider');
      expect(provider.sourceType, 'openai');
      expect(provider.peersUserId, 'user1');
      expect(provider.enabled, isTrue);
    });

    test('create and get provider in local mode', () async {
      final provider = Provider(id: 'local-test', name: 'Local Test Provider');

      await realProviderService.createProvider(provider);
      print('Provider created: \${provider.id}');

      final providersAfterCreate = await realProviderService.getProviders();
      print('Providers after create: \${providersAfterCreate.map((p) => p.id).toList()}');
      expect(providersAfterCreate.any((p) => p.id == 'local-test'), isTrue, reason: 'Provider should exist immediately after creation');

      // Now, call getProviders again to see if it persists
      final providersAfterSecondCall = await realProviderService.getProviders();
      print('Providers after second call: \${providersAfterSecondCall.map((p) => p.id).toList()}');
      expect(providersAfterSecondCall.any((p) => p.id == 'local-test'), isTrue, reason: 'Provider should persist across multiple calls');
    });

    test('session-scoped current provider is independent per session', () async {
      final p1 = Provider(id: 'p1', name: 'Provider 1');
      final p2 = Provider(id: 'p2', name: 'Provider 2');

      await realProviderService.createProvider(p1);
      await realProviderService.createProvider(p2);

      await realProviderService.setCurrentProviderForSession('s1', 'p1');
      await realProviderService.setCurrentProviderForSession('s2', 'p2');

      final s1Current = await realProviderService.getCurrentProviderForSession('s1');
      final s2Current = await realProviderService.getCurrentProviderForSession('s2');

      expect(s1Current?.id, 'p1');
      expect(s2Current?.id, 'p2');
      expect(s1Current?.id == s2Current?.id, isFalse);
    });
  });
}
