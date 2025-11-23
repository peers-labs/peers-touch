
import 'package:test/test.dart';
import 'package:mockito/annotations.dart';
import 'package:mockito/mockito.dart';
import 'package:peers_touch_base/ai_proxy/provider/provider_manager.dart';
import 'package:peers_touch_base/ai_proxy/service/ai_box_local_storage_service.dart';
import 'package:peers_touch_base/model/domain/ai_box/provider.pb.dart';
import 'package:peers_touch_base/network/dio/peers_frame/service/ai_box_service.dart';

import 'provider_manager_test.mocks.dart';

@GenerateMocks([AiBoxService, AiBoxLocalStorageService])
void main() {
  late MockAiBoxService mockAiBoxService;
  late MockAiBoxLocalStorageService mockLocalStorage;
  late ProviderManager manager;

  setUp(() {
    mockAiBoxService = MockAiBoxService();
    mockLocalStorage = MockAiBoxLocalStorageService();
    manager = ProviderManager(
      aiBoxService: mockAiBoxService,
      localStorage: mockLocalStorage,
    );
  });

  group('ProviderManager', () {
    final testProvider = Provider(id: '1', name: 'Test Provider');

    group('createProvider', () {
      test('should save to remote and local on success', () async {
        when(mockAiBoxService.createProvider(any))
            .thenAnswer((_) async => testProvider);
        when(mockLocalStorage.saveProvider(any)).thenAnswer((_) async {});
        when(mockLocalStorage.getAllProviders()).thenAnswer((_) async => []);

        final result = await manager.createProvider(testProvider);

        expect(result, testProvider);
        verify(mockAiBoxService.createProvider(testProvider)).called(1);
        verify(mockLocalStorage.saveProvider(testProvider)).called(1);
      });

      test('should save to local and throw on remote failure', () async {
        when(mockAiBoxService.createProvider(any))
            .thenThrow(Exception('Remote error'));
        when(mockLocalStorage.saveProvider(any)).thenAnswer((_) async {});
        when(mockLocalStorage.getAllProviders()).thenAnswer((_) async => []);

        await expectLater(manager.createProvider(testProvider),
            throwsA(isA<ProviderSyncException>()));

        verify(mockLocalStorage.saveProvider(testProvider)).called(1);
      });
    });

    group('getProvider', () {
      test('should return from cache if available', () async {
        // Arrange: Set up mocks for the createProvider call to pre-fill the cache
        when(mockAiBoxService.createProvider(any))
            .thenAnswer((_) async => testProvider);
        when(mockLocalStorage.saveProvider(any)).thenAnswer((_) async {});
        when(mockLocalStorage.getAllProviders()).thenAnswer((_) async => []);

        // Act: Pre-fill cache
        await manager.createProvider(testProvider);

        // Assert: Clear interactions from the setup phase before testing getProvider
        clearInteractions(mockAiBoxService);
        clearInteractions(mockLocalStorage);

        final result = await manager.getProvider('1');

        expect(result, testProvider);
        verifyNever(mockAiBoxService.getProvider(any));
        verifyNever(mockLocalStorage.getProvider(any));
      });

      test('should fetch from remote if not in cache', () async {
        when(mockAiBoxService.getProvider('1'))
            .thenAnswer((_) async => testProvider);
        when(mockLocalStorage.saveProvider(any)).thenAnswer((_) async {});

        final result = await manager.getProvider('1');

        expect(result, testProvider);
        verify(mockAiBoxService.getProvider('1')).called(1);
        verify(mockLocalStorage.saveProvider(testProvider)).called(1);
      });

      test('should fetch from local on remote failure', () async {
        when(mockAiBoxService.getProvider('1'))
            .thenThrow(Exception('Remote error'));
        when(mockLocalStorage.getProvider('1')).thenAnswer((_) async =>
            {
              'id': '1', 
              'name': 'Test Provider',
              'accessedAt': DateTime.now().millisecondsSinceEpoch,
              'createdAt': DateTime.now().millisecondsSinceEpoch,
              'updatedAt': DateTime.now().millisecondsSinceEpoch,
            });

        final result = await manager.getProvider('1');

        expect(result, isNotNull);
        expect(result!.id, '1');
        verify(mockLocalStorage.getProvider('1')).called(1);
      });
    });

    group('listProviders', () {
      test('should fetch from remote on success', () async {
        final providers = [testProvider];
        when(mockAiBoxService.listProviders()).thenAnswer((_) async => providers);
        when(mockLocalStorage.saveProvider(any)).thenAnswer((_) async {});

        final result = await manager.listProviders();

        expect(result, providers);
        verify(mockAiBoxService.listProviders()).called(1);
        verify(mockLocalStorage.saveProvider(testProvider)).called(1);
      });

      test('should fetch from local on remote failure', () async {
        when(mockAiBoxService.listProviders())
            .thenThrow(Exception('Remote error'));
        when(mockLocalStorage.getAllProviders()).thenAnswer((_) async => [
              {
                'id': '1', 
                'name': 'Test Provider',
                'accessedAt': DateTime.now().millisecondsSinceEpoch,
                'createdAt': DateTime.now().millisecondsSinceEpoch,
                'updatedAt': DateTime.now().millisecondsSinceEpoch,
              }
            ]);

        final result = await manager.listProviders();

        expect(result, isNotEmpty);
        expect(result.first.id, '1');
        verify(mockLocalStorage.getAllProviders()).called(1);
      });
    });

    group('deleteProvider', () {
      test('should delete from remote and local on success', () async {
        when(mockAiBoxService.deleteProvider('1')).thenAnswer((_) async {});
        when(mockLocalStorage.deleteProvider('1')).thenAnswer((_) async {});

        await manager.deleteProvider('1');

        verify(mockAiBoxService.deleteProvider('1')).called(1);
        verify(mockLocalStorage.deleteProvider('1')).called(1);
      });

      test('should delete from local and throw on remote failure', () async {
        when(mockAiBoxService.deleteProvider('1'))
            .thenThrow(Exception('Remote error'));
        when(mockLocalStorage.deleteProvider('1')).thenAnswer((_) async {});

        await expectLater(
            manager.deleteProvider('1'), throwsA(isA<ProviderSyncException>()));

        verify(mockLocalStorage.deleteProvider('1')).called(1);
      });
    });
  });
}
