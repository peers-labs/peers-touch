
import 'dart:convert';

import 'package:mockito/mockito.dart';
import 'package:peers_touch_base/ai_proxy/service/ai_box_local_storage_service.dart';
import 'package:peers_touch_base/model/domain/ai_box/provider.pb.dart';
import 'package:peers_touch_base/model/google/protobuf/timestamp.pb.dart';
import 'package:test/test.dart';
import 'package:fixnum/fixnum.dart';

import 'mock_local_storage.mocks.dart';

void main() {
  late AiBoxLocalStorageService service;
  late MockLocalStorage mockLocalStorage;

  setUp(() {
    mockLocalStorage = MockLocalStorage();
    service = AiBoxLocalStorageService(localStorage: mockLocalStorage);
    reset(mockLocalStorage);
  });

  tearDown(() {
    verifyNoMoreInteractions(mockLocalStorage);
  });

  group('Provider Management', () {
    final now = DateTime.now();
    final timestamp = Timestamp()
      ..seconds = Int64(now.millisecondsSinceEpoch ~/ 1000)
      ..nanos = (now.millisecondsSinceEpoch % 1000) * 1000000;

    final provider = Provider(
      id: '1',
      name: 'Test Provider',
      accessedAt: timestamp,
      createdAt: timestamp,
      updatedAt: timestamp,
    );
    final providerMap = {
      'id': '1',
      'name': 'Test Provider',
      'peersUserId': '',
      'sort': 0,
      'enabled': false,
      'checkModel': '',
      'logo': '',
      'description': '',
      'keyVaults': [],
      'sourceType': '',
      'settingsJson': '',
      'configJson': '',
      'accessedAt': now.millisecondsSinceEpoch,
      'createdAt': now.millisecondsSinceEpoch,
      'updatedAt': now.millisecondsSinceEpoch,
    };

    test('getAllProviders should return a list of providers', () async {
      when(mockLocalStorage.get<List<dynamic>>('ai_box_providers'))
          .thenAnswer((_) async => [providerMap]);

      final result = await service.getAllProviders();

      expect(result, [providerMap]);
      verify(mockLocalStorage.get<List<dynamic>>('ai_box_providers')).called(1);
    });

    test('getProvider should return a provider by id', () async {
      when(mockLocalStorage.get<List<dynamic>>('ai_box_providers'))
          .thenAnswer((_) async => [providerMap]);

      final result = await service.getProvider('1');

      expect(result, providerMap);
      verify(mockLocalStorage.get<List<dynamic>>('ai_box_providers')).called(1);
    });

    test('saveProvider should save a new provider', () async {
      when(mockLocalStorage.get<List<dynamic>>('ai_box_providers'))
          .thenAnswer((_) async => []);
      when(mockLocalStorage.set(any, any)).thenAnswer((_) async {});

      await service.saveProvider(provider);

      final captured = verify(mockLocalStorage.set('ai_box_providers', captureAny)).captured.single as List;
      expect(captured, hasLength(1));
      expect(captured.first['id'], '1');
      verify(mockLocalStorage.get<List<dynamic>>('ai_box_providers')).called(1);
    });

    test('saveProvider should update an existing provider', () async {
      when(mockLocalStorage.get<List<dynamic>>('ai_box_providers'))
          .thenAnswer((_) async => [providerMap]);
      when(mockLocalStorage.set(any, any)).thenAnswer((_) async {});

      final updatedProvider = Provider(id: '1', name: 'Updated Provider', accessedAt: timestamp, createdAt: timestamp, updatedAt: timestamp);

      await service.saveProvider(updatedProvider);

      final captured = verify(mockLocalStorage.set('ai_box_providers', captureAny)).captured.single as List;
      expect(captured, hasLength(1));
      expect(captured.first['name'], 'Updated Provider');
      verify(mockLocalStorage.get<List<dynamic>>('ai_box_providers')).called(1);
    });

    test('deleteProvider should delete a provider', () async {
      when(mockLocalStorage.get<List<dynamic>>('ai_box_providers'))
          .thenAnswer((_) async => [providerMap]);
      when(mockLocalStorage.set(any, any)).thenAnswer((_) async {});

      await service.deleteProvider('1');

      verify(mockLocalStorage.set('ai_box_providers', [])).called(1);
      verify(mockLocalStorage.get<List<dynamic>>('ai_box_providers')).called(1);
    });

    test('getDefaultProviderId should return the default provider id',
        () async {
      when(mockLocalStorage.get<String>('ai_box_default_provider_id'))
          .thenAnswer((_) async => '1');

      final result = await service.getDefaultProviderId();

      expect(result, '1');
      verify(mockLocalStorage.get<String>('ai_box_default_provider_id')).called(1);
    });

    test('setDefaultProviderId should set the default provider id', () async {
      when(mockLocalStorage.set(any, any)).thenAnswer((_) async {});
      await service.setDefaultProviderId('1');

      verify(mockLocalStorage.set('ai_box_default_provider_id', '1')).called(1);
    });

    test('getCurrentProviderId should return the current provider id',
        () async {
      when(mockLocalStorage.get<String>('ai_box_current_provider_id'))
          .thenAnswer((_) async => '1');

      final result = await service.getCurrentProviderId();

      expect(result, '1');
      verify(mockLocalStorage.get<String>('ai_box_current_provider_id')).called(1);
    });

    test('setCurrentProviderId should set the current provider id', () async {
      when(mockLocalStorage.set(any, any)).thenAnswer((_) async {});
      await service.setCurrentProviderId('1');

      verify(mockLocalStorage.set('ai_box_current_provider_id', '1')).called(1);
    });
  });
}
