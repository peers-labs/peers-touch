
import 'package:test/test.dart';
import 'package:mockito/annotations.dart';
import 'package:mockito/mockito.dart';
import 'package:peers_touch_base/ai_proxy/adapter/ai_proxy_adapter.dart';
import 'package:peers_touch_base/network/dio/peers_frame/service/ai_box_service.dart';
import 'package:peers_touch_base/model/domain/ai_box/provider.pb.dart';
import 'dart:convert';

import 'ai_proxy_adapter_test.mocks.dart';

@GenerateMocks([AiBoxService])
void main() {
  group('AiProxyAdapter', () {
    late MockAiBoxService mockAiBoxService;
    late AiProxyAdapter adapter;

    setUp(() {
      mockAiBoxService = MockAiBoxService();
      adapter = AiProxyAdapter(mockAiBoxService);
    });

    test('initialize should fetch and map providers', () async {
      final providers = [
        Provider(id: '1', name: 'Provider 1', sourceType: 'openai', settingsJson: '{}', configJson: '{}'),
        Provider(id: '2', name: 'Provider 2', sourceType: 'openai', settingsJson: '{}', configJson: '{}'),
      ];
      when(mockAiBoxService.listProviders()).thenAnswer((_) async => providers);

      await adapter.initialize();

      expect(adapter.allProviders.length, 2);
      expect(adapter.allProviders[0].id, '1');
      expect(adapter.allProviders[1].name, 'Provider 2');
    });

    test('getProviderForModel should return the correct provider', () async {
      final providers = [
        Provider(
            id: '1',
            name: 'Provider 1',
            sourceType: 'openai',
            settingsJson: '{}',
            configJson: jsonEncode({
              'models': [
                {'id': 'model-a', 'name': 'Model A'},
                {'id': 'model-b', 'name': 'Model B'}
              ]
            })),
        Provider(
            id: '2',
            name: 'Provider 2',
            sourceType: 'openai',
            settingsJson: '{}',
            configJson: jsonEncode({
              'models': [
                {'id': 'model-c', 'name': 'Model C'}
              ]
            })),
      ];
      when(mockAiBoxService.listProviders()).thenAnswer((_) async => providers);
      await adapter.initialize();

      final provider = adapter.getProviderForModel('model-b');
      expect(provider, isNotNull);
      expect(provider!.id, '1');
    });

    test('getProviderForModel should return null if no provider has the model', () async {
      final providers = [
        Provider(
            id: '1',
            name: 'Provider 1',
            sourceType: 'openai',
            settingsJson: '{}',
            configJson: jsonEncode({
              'models': [
                {'id': 'model-a', 'name': 'Model A'}
              ]
            })),
      ];
      when(mockAiBoxService.listProviders()).thenAnswer((_) async => providers);
      await adapter.initialize();

      final provider = adapter.getProviderForModel('model-x');
      expect(provider, isNull);
    });

    test('getProvider should return the correct provider by id', () async {
      final providers = [
        Provider(id: '1', name: 'Provider 1', sourceType: 'openai', settingsJson: '{}', configJson: '{}'),
        Provider(id: '2', name: 'Provider 2', sourceType: 'openai', settingsJson: '{}', configJson: '{}'),
      ];
      when(mockAiBoxService.listProviders()).thenAnswer((_) async => providers);
      await adapter.initialize();

      final provider = adapter.getProvider('2');
      expect(provider, isNotNull);
      expect(provider!.id, '2');
    });

    test('getProvider should return null if provider with id is not found', () async {
      final providers = [
        Provider(id: '1', name: 'Provider 1', sourceType: 'openai', settingsJson: '{}', configJson: '{}'),
      ];
      when(mockAiBoxService.listProviders()).thenAnswer((_) async => providers);
      await adapter.initialize();

      final provider = adapter.getProvider('3');
      expect(provider, isNull);
    });
  });
}
