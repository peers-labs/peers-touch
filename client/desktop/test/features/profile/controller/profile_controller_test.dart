import 'dart:io';

import 'package:dio/dio.dart' as dio;
import 'package:flutter_test/flutter_test.dart';
import 'package:get/get.dart';
import 'package:mockito/annotations.dart';
import 'package:mockito/mockito.dart';
import 'package:peers_touch_base/context/global_context.dart';
import 'package:peers_touch_base/logger/logging_service.dart';
import 'package:peers_touch_base/network/dio/http_service.dart';
import 'package:peers_touch_base/network/dio/http_service_locator.dart';
import 'package:peers_touch_base/storage/local_storage.dart';
import 'package:peers_touch_desktop/core/services/oss_service.dart';
import 'package:peers_touch_desktop/features/profile/controller/profile_controller.dart';
import 'package:peers_touch_desktop/features/profile/model/user_detail.dart';

import 'profile_controller_test.mocks.dart';

@GenerateMocks([OssService, IHttpService, GlobalContext])
void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  late MockOssService mockOssService;
  late MockIHttpService mockHttpService;
  late MockGlobalContext mockGlobalContext;
  late ProfileController controller;

  setUp(() {
    LoggingService.initialize();
    
    mockOssService = MockOssService();
    mockHttpService = MockIHttpService();
    mockGlobalContext = MockGlobalContext();

    Get.put<OssService>(mockOssService);
    Get.put<GlobalContext>(mockGlobalContext);
    
    LocalStorage.mockInstance = _MockLocalStorage();
    
    HttpServiceLocator().initialize(
      baseUrl: 'http://localhost:18080',
      interceptors: [],
    );
    
    final locator = HttpServiceLocator();
    locator.initialize(
      baseUrl: 'http://localhost:18080',
      interceptors: [],
    );
    
    when(mockHttpService.patchResponse<dynamic>(any, data: anyNamed('data')))
        .thenAnswer((_) async => dio.Response(
              requestOptions: dio.RequestOptions(path: ''),
              statusCode: 200,
              data: {},
            ));

    when(mockGlobalContext.userProfile).thenReturn(null);
    when(mockGlobalContext.onProfileChange).thenAnswer((_) => Stream.value(null));

    controller = ProfileController();
  });

  tearDown(() {
    Get.reset();
    LocalStorage.mockInstance = null;
  });

  group('uploadFile', () {
    test('上传成功时返回正确的UploadResult', () async {
      final testFile = File('test.jpg');
      final mockOssResponse = {
        'key': 'test-key-123',
        'url': '/storage/test-key-123.jpg',
        'size': 1024,
        'mime': 'image/jpeg',
        'backend': 'local',
      };

      when(mockOssService.uploadFile(any))
          .thenAnswer((_) async => mockOssResponse);

      final result = await controller.uploadFile(testFile, category: 'avatar');

      expect(result, isNotNull);
      expect(result!.remoteUrl, equals('/storage/test-key-123.jpg'));
      expect(result.localPath, isNull);
      
      verify(mockOssService.uploadFile(testFile)).called(1);
    });

    test('OSS返回空url时返回null', () async {
      final testFile = File('test.jpg');
      final mockOssResponse = {
        'key': 'test-key-123',
        'url': '',
        'size': 1024,
        'mime': 'image/jpeg',
        'backend': 'local',
      };

      when(mockOssService.uploadFile(any))
          .thenAnswer((_) async => mockOssResponse);

      final result = await controller.uploadFile(testFile, category: 'avatar');

      expect(result, isNull);
    });

    test('OSS返回null url时返回null', () async {
      final testFile = File('test.jpg');
      final mockOssResponse = {
        'key': 'test-key-123',
        'size': 1024,
        'mime': 'image/jpeg',
        'backend': 'local',
      };

      when(mockOssService.uploadFile(any))
          .thenAnswer((_) async => mockOssResponse);

      final result = await controller.uploadFile(testFile, category: 'avatar');

      expect(result, isNull);
    });

    test('上传失败时返回null并记录错误', () async {
      final testFile = File('test.jpg');

      when(mockOssService.uploadFile(any))
          .thenThrow(Exception('Upload failed'));

      final result = await controller.uploadFile(testFile, category: 'avatar');

      expect(result, isNull);
      verify(mockOssService.uploadFile(testFile)).called(1);
    });
  });

  group('uploadImage', () {
    test('验证uploadFile被正确调用', () async {
      final mockOssResponse = {
        'key': 'test-key',
        'url': '/storage/test.jpg',
        'size': 1024,
        'mime': 'image/jpeg',
        'backend': 'local',
      };

      when(mockOssService.uploadFile(any))
          .thenAnswer((_) async => mockOssResponse);

      final result = await controller.uploadFile(File('test.jpg'), category: 'avatar');

      expect(result, isNotNull);
      expect(result!.remoteUrl, equals('/storage/test.jpg'));
      verify(mockOssService.uploadFile(any)).called(1);
    });
  });
}

UserDetail _createMockUserDetail() {
  return const UserDetail(
    id: '123',
    displayName: 'Test User',
    handle: 'test-user',
    summary: 'Test summary',
    avatarUrl: '/storage/test-avatar.jpg',
    coverUrl: '/storage/test-cover.jpg',
  );
}

class _MockLocalStorage implements LocalStorage {
  final Map<String, dynamic> _storage = {};

  @override
  Future<T?> get<T>(String key) async => _storage[key] as T?;

  @override
  Future<void> set<T>(String key, T value) async => _storage[key] = value;

  @override
  Future<void> remove(String key) async => _storage.remove(key);

  @override
  Future<void> clear() async => _storage.clear();
}
