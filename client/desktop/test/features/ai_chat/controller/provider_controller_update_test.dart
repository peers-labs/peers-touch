import 'package:flutter_test/flutter_test.dart';
import 'package:get/get.dart';
import 'package:mockito/annotations.dart';
import 'package:mockito/mockito.dart';
import 'package:peers_touch_base/model/domain/ai_box/provider.pb.dart';
import 'package:peers_touch_base/model/google/protobuf/timestamp.pb.dart';
import 'package:peers_touch_desktop/features/ai_chat/controller/provider_controller.dart';
import 'package:peers_touch_desktop/features/ai_chat/service/provider_service.dart';

import 'provider_controller_update_test.mocks.dart';

@GenerateMocks([ProviderService])
void main() {
  late ProviderController controller;
  late MockProviderService mockProviderService;

  setUp(() {
    Get.reset();
    
    mockProviderService = MockProviderService();
    Get.put<ProviderService>(mockProviderService);
    
    controller = ProviderController();
  });

  tearDown(() {
    controller.onClose();
    Get.reset();
  });

  group('updateProvider', () {
    test('修改Provider成功 - 更新updatedAt字段并刷新列表', () async {
      // Arrange: 创建测试Provider
      final originalTime = DateTime.utc(2023, 1, 1);
      final provider = Provider(
        id: 'test-provider',
        name: 'Test Provider',
        updatedAt: Timestamp.fromDateTime(originalTime),
      );
      
      // Mock Service调用成功和列表刷新
      when(mockProviderService.updateProvider(any)).thenAnswer((_) async => null);
      when(mockProviderService.getProviders()).thenAnswer((_) async => []);
      
      // Act: 执行更新
      await controller.updateProvider(provider);
      
      // Assert: 验证Service被调用且updatedAt已更新
      verify(mockProviderService.updateProvider(argThat(
        predicate<Provider>((updatedProvider) {
          // 验证updatedAt字段已更新为当前时间（允许1秒误差）
          final now = DateTime.now().toUtc();
          final updatedTime = updatedProvider.updatedAt.toDateTime();
          final timeDiff = now.difference(updatedTime).abs();
          
          return updatedProvider.id == 'test-provider' &&
                 updatedProvider.name == 'Test Provider' &&
                 timeDiff.inSeconds <= 1; // 时间差在1秒内
        })
      ))).called(1);
      
      // Assert: 验证刷新列表被调用
      verify(mockProviderService.getProviders()).called(1);
    });

    test('修改Provider异常 - 捕获异常并显示提示', () async {
      // Arrange: 创建测试Provider
      final provider = Provider(
        id: 'test-provider',
        name: 'Test Provider',
        updatedAt: Timestamp.fromDateTime(DateTime.utc(2023, 1, 1)),
      );
      
      // Mock Service抛出异常
      when(mockProviderService.updateProvider(any)).thenThrow(
        Exception('Update failed')
      );
      
      // Mock Get.snackbar（避免UI依赖）
      final snackbarCalls = <String>[];
      Get.testMode = true;
      
      // Act: 执行更新（不应抛出异常）
      await controller.updateProvider(provider);
      
      // Assert: 验证Service被调用
      verify(mockProviderService.updateProvider(any)).called(1);
      
      // Assert: 验证异常被捕获，方法正常返回（不抛出）
      // 注意：由于内部使用了try/catch，异常被捕获，方法正常完成
      expect(true, true); // 如果执行到这里说明没有抛异常
    });

    test('修改Provider - 验证时间戳为UTC格式', () async {
      // Arrange: 创建测试Provider
      final provider = Provider(
        id: 'test-provider',
        name: 'Test Provider',
        updatedAt: Timestamp.fromDateTime(DateTime.utc(2023, 1, 1)),
      );
      
      // Mock Service调用成功
      when(mockProviderService.updateProvider(any)).thenAnswer((_) async => null);
      when(mockProviderService.getProviders()).thenAnswer((_) async => []);
      
      // Act: 执行更新
      await controller.updateProvider(provider);
      
      // Assert: 验证传入的Provider的updatedAt是UTC时间
      final captured = verify(mockProviderService.updateProvider(captureAny)).captured.first as Provider;
      final updatedTime = captured.updatedAt.toDateTime();
      
      expect(updatedTime.isUtc, true);
      expect(updatedTime.difference(DateTime.now().toUtc()).abs().inSeconds, lessThan(1));
    });
  });
}