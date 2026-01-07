import 'package:flutter_test/flutter_test.dart';
import 'package:get/get.dart';
import 'package:mockito/mockito.dart';
import 'package:mockito/annotations.dart';
import 'package:peers_touch_desktop/features/discovery/controller/discovery_controller.dart';
import 'package:peers_touch_desktop/features/discovery/model/discovery_item.dart';
import 'package:peers_touch_desktop/features/discovery/repository/discovery_repository.dart';

@GenerateMocks([DiscoveryRepository])
import 'discovery_controller_comments_test.mocks.dart';

void main() {
  group('DiscoveryController - Comment Loading', () {
    late DiscoveryController controller;
    late MockDiscoveryRepository mockRepo;

    setUp(() {
      Get.testMode = true;
      mockRepo = MockDiscoveryRepository();
      controller = DiscoveryController();
      Get.put(controller);
    });

    tearDown(() {
      Get.delete<DiscoveryController>();
      Get.testMode = false;
    });

    test('should load comments when item has commentsCount > 0', () async {
      final item = DiscoveryItem(
        id: 'test-1',
        objectId: 'http://localhost:18080/activitypub/user/objects/123',
        title: 'Test Post',
        content: 'Test content',
        author: 'testuser',
        timestamp: DateTime.now(),
        type: 'Create',
        commentsCount: 3, // 数据库有3条评论
      );

      final mockResponse = {
        'orderedItems': [
          {
            'id': 'comment-1',
            'type': 'Note',
            'content': 'First comment',
            'attributedTo': 'http://localhost:18080/activitypub/user1/actor',
            'published': '2026-01-08T00:00:00Z',
          },
          {
            'id': 'comment-2',
            'type': 'Note',
            'content': 'Second comment',
            'attributedTo': 'http://localhost:18080/activitypub/user2/actor',
            'published': '2026-01-08T01:00:00Z',
          },
          {
            'id': 'comment-3',
            'type': 'Note',
            'content': 'Third comment',
            'attributedTo': 'http://localhost:18080/activitypub/user3/actor',
            'published': '2026-01-08T02:00:00Z',
          },
        ],
        'totalItems': 3,
      };

      when(mockRepo.fetchObjectReplies(any)).thenAnswer((_) async => mockResponse);

      await controller.loadComments(item);

      // 验证：评论必须被加载
      expect(item.comments.length, 3, reason: 'Should load all 3 comments from database');
      expect(item.comments[0].content, 'First comment');
      expect(item.comments[1].content, 'Second comment');
      expect(item.comments[2].content, 'Third comment');
    });

    test('should show error when database has comments but API returns empty', () async {
      final item = DiscoveryItem(
        id: 'test-1',
        objectId: 'http://localhost:18080/activitypub/user/objects/123',
        title: 'Test Post',
        content: 'Test content',
        author: 'testuser',
        timestamp: DateTime.now(),
        type: 'Create',
        commentsCount: 5, // 数据库说有5条评论
      );

      // 但是API返回空数组
      final mockResponse = {
        'orderedItems': [], // 空！
        'totalItems': 0,
      };

      when(mockRepo.fetchObjectReplies(any)).thenAnswer((_) async => mockResponse);

      await controller.loadComments(item);

      // 这是一个BUG！数据库有评论但API返回空
      // 测试应该失败，提醒我们有问题
      expect(
        item.comments.length,
        greaterThan(0),
        reason: 'CRITICAL: Database has 5 comments but API returned 0! Check backend query logic.',
      );
    });

    test('should handle API returning fewer comments than commentsCount', () async {
      final item = DiscoveryItem(
        id: 'test-1',
        objectId: 'http://localhost:18080/activitypub/user/objects/123',
        title: 'Test Post',
        content: 'Test content',
        author: 'testuser',
        timestamp: DateTime.now(),
        type: 'Create',
        commentsCount: 10, // 说有10条
      );

      // 但只返回2条
      final mockResponse = {
        'orderedItems': [
          {
            'id': 'comment-1',
            'content': 'Comment 1',
            'attributedTo': 'http://localhost:18080/activitypub/user/actor',
            'published': '2026-01-08T00:00:00Z',
          },
          {
            'id': 'comment-2',
            'content': 'Comment 2',
            'attributedTo': 'http://localhost:18080/activitypub/user/actor',
            'published': '2026-01-08T01:00:00Z',
          },
        ],
        'totalItems': 2,
      };

      when(mockRepo.fetchObjectReplies(any)).thenAnswer((_) async => mockResponse);

      await controller.loadComments(item);

      // 警告：数量不匹配
      expect(
        item.comments.length,
        lessThan(item.commentsCount),
        reason: 'WARNING: commentsCount (10) does not match actual comments (2)',
      );
    });

    test('should verify API is called with correct objectId', () async {
      final item = DiscoveryItem(
        id: 'test-1',
        objectId: 'http://localhost:18080/activitypub/desktop-1/actor/objects/1767752347919249000',
        title: 'Test Post',
        content: 'Test content',
        author: 'testuser',
        timestamp: DateTime.now(),
        type: 'Create',
        commentsCount: 1,
      );

      when(mockRepo.fetchObjectReplies(any)).thenAnswer((_) async => {
        'orderedItems': [],
      });

      await controller.loadComments(item);

      // 验证API被调用时使用了正确的objectId
      final captured = verify(mockRepo.fetchObjectReplies(captureAny)).captured;
      expect(captured[0], item.objectId);
      expect(captured[0], contains('://'), reason: 'objectId must contain ://');
      expect(captured[0], startsWith('http://'), reason: 'objectId must start with http://');
    });

    test('should handle malformed API response gracefully', () async {
      final item = DiscoveryItem(
        id: 'test-1',
        objectId: 'http://localhost:18080/activitypub/user/objects/123',
        title: 'Test Post',
        content: 'Test content',
        author: 'testuser',
        timestamp: DateTime.now(),
        type: 'Create',
        commentsCount: 1,
      );

      // 返回格式错误的数据
      final mockResponse = {
        'orderedItems': [
          {
            // 缺少必要字段
            'id': 'comment-1',
            // 没有 content
            // 没有 attributedTo
          }
        ],
      };

      when(mockRepo.fetchObjectReplies(any)).thenAnswer((_) async => mockResponse);

      await controller.loadComments(item);

      // 应该能处理，不崩溃
      expect(item.comments.length, greaterThanOrEqualTo(0));
    });
  });

  group('DiscoveryController - Database vs UI Consistency', () {
    late DiscoveryController controller;
    late MockDiscoveryRepository mockRepo;

    setUp(() {
      Get.testMode = true;
      mockRepo = MockDiscoveryRepository();
      controller = DiscoveryController();
      Get.put(controller);
    });

    tearDown(() {
      Get.delete<DiscoveryController>();
      Get.testMode = false;
    });

    test('CRITICAL: must show comments when database has them', () async {
      // 这是最关键的测试！
      // 模拟：数据库有评论，但UI不显示的bug

      final item = DiscoveryItem(
        id: 'test-1',
        objectId: 'http://localhost:18080/activitypub/desktop-1/actor/objects/1767752347919249000',
        title: 'Hi，这是第一个，有两张图',
        content: 'Hi，这是第一个，有两张图',
        author: 'desktop-1',
        timestamp: DateTime.parse('2026-01-07T16:12:27.919Z'),
        type: 'Create',
        commentsCount: 1, // 数据库确实有1条评论
      );

      // 模拟后端返回真实数据
      final mockResponse = {
        'orderedItems': [
          {
            'id': 'http://localhost:18080/activitypub/desktop-1/actor/objects/1767752361489365000',
            'type': 'Note',
            'content': 'hi',
            'attributedTo': {
              'type': 'Person',
              'id': 'http://localhost:18080/activitypub/desktop-1/actor',
              'preferredUsername': 'desktop-1',
              'icon': {
                'type': 'Image',
                'url': 'https://i.pravatar.cc/150?u=desktop-1',
              }
            },
            'published': '2026-01-07T16:12:41.489Z',
          }
        ],
        'totalItems': 1,
      };

      when(mockRepo.fetchObjectReplies(item.objectId)).thenAnswer((_) async => mockResponse);

      // 加载评论
      await controller.loadComments(item);

      // 断言：必须有评论！
      expect(
        item.comments.isNotEmpty,
        true,
        reason: 'CRITICAL BUG: Database has 1 comment but UI shows 0!',
      );

      expect(item.comments.length, 1);
      expect(item.comments[0].content, 'hi');
      expect(item.comments[0].authorName, 'desktop-1');
    });
  });
}
