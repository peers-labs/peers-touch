import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:get/get.dart';
import 'package:mockito/annotations.dart';
import 'package:mockito/mockito.dart';
import 'package:peers_touch_base/model/domain/ai_box/provider.pb.dart';
import 'package:peers_touch_desktop/features/ai_chat/controller/create_provider_controller.dart';
import 'package:peers_touch_desktop/features/ai_chat/controller/provider_controller.dart';
import 'package:peers_touch_desktop/features/ai_chat/service/provider_service.dart';
import 'package:peers_touch_desktop/features/ai_chat/model/request_format.dart';

import 'create_provider_controller_test.mocks.dart';

@GenerateMocks([ProviderService, ProviderController])
void main() {
  late CreateProviderController controller;
  late MockProviderService mockProviderService;
  late MockProviderController mockProviderController;

  setUp(() {
    Get.reset();
    
    mockProviderService = MockProviderService();
    mockProviderController = MockProviderController();
    
    Get.put<ProviderService>(mockProviderService);
    Get.put<ProviderController>(mockProviderController);
    
    controller = CreateProviderController();
  });

  tearDown(() {
    controller.onClose();
    Get.reset();
  });

  group('createProvider', () {
    test('新增Provider成功 - 表单数据正确传递给Service', () async {
      // Arrange: 设置有效的表单数据
      controller.idController.text = 'test-provider';
      controller.nameController.text = 'Test Provider';
      controller.descriptionController.text = 'Test Description';
      controller.logoController.text = 'test-logo.png';
      controller.proxyUrlController.text = 'https://api.test.com';
      controller.apiKeyController.text = 'test-api-key';
      controller.requestFormat.value = RequestFormatType.openai;
      
      // 模拟表单验证通过
      controller.formKey.currentState = MockFormState();
      when(controller.formKey.currentState!.validate()).thenReturn(true);
      
      // Mock Service调用成功
      when(mockProviderService.createProvider(any)).thenAnswer((_) async => null);
      when(mockProviderController.loadProviders()).thenAnswer((_) async => null);
      
      // Act: 执行创建
      await controller.createProvider();
      
      // Assert: 验证Service被正确调用
      verify(mockProviderService.createProvider(argThat(
        predicate<Provider>((provider) =>
          provider.id == 'test-provider' &&
          provider.name == 'Test Provider' &&
          provider.description == 'Test Description' &&
          provider.logo == 'test-logo.png' &&
          provider.sourceType == 'openai' &&
          provider.enabled == true &&
          provider.createdAt != null &&
          provider.updatedAt != null &&
          provider.accessedAt != null
        )
      ))).called(1);
      
      // Assert: 验证刷新列表被调用
      verify(mockProviderController.loadProviders()).called(1);
    });

    test('新增Provider失败 - 表单校验不通过时不调用Service', () async {
      // Arrange: 模拟表单验证失败
      controller.formKey.currentState = MockFormState();
      when(controller.formKey.currentState!.validate()).thenReturn(false);
      
      // Act: 执行创建
      await controller.createProvider();
      
      // Assert: 验证Service未被调用
      verifyNever(mockProviderService.createProvider(any));
      verifyNever(mockProviderController.loadProviders());
    });

    test('新增Provider异常 - Service抛错时向上传播', () async {
      // Arrange: 设置有效的表单数据
      controller.idController.text = 'test-provider';
      controller.nameController.text = 'Test Provider';
      controller.requestFormat.value = RequestFormatType.openai;
      
      // 模拟表单验证通过
      controller.formKey.currentState = MockFormState();
      when(controller.formKey.currentState!.validate()).thenReturn(true);
      
      // Mock Service抛出异常
      when(mockProviderService.createProvider(any)).thenThrow(
        Exception('Service error')
      );
      
      // Act & Assert: 验证异常被传播
      expect(
        () => controller.createProvider(),
        throwsA(isA<Exception>())
      );
      
      // Assert: 验证刷新列表未被调用
      verifyNever(mockProviderController.loadProviders());
    });
  });
}

// Mock表单状态类
class MockFormState extends Fake implements FormState {
  @override
  bool validate() => true;
}