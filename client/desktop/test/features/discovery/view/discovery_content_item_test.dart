import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:get/get.dart';
import 'package:peers_touch_desktop/features/discovery/controller/discovery_controller.dart';
import 'package:peers_touch_desktop/features/discovery/model/discovery_item.dart';
import 'package:peers_touch_desktop/features/discovery/view/components/discovery_content_item.dart';

void main() {
  group('DiscoveryContentItem - Comment Section UI', () {
    late DiscoveryController controller;

    setUp(() {
      Get.testMode = true;
      controller = DiscoveryController();
      Get.put(controller);
    });

    tearDown(() {
      Get.delete<DiscoveryController>();
      Get.testMode = false;
    });

    testWidgets('should NOT show comment section by default', (WidgetTester tester) async {
      final item = DiscoveryItem(
        id: 'test-1',
        objectId: 'http://localhost:18080/activitypub/user/objects/123',
        title: 'Test Post',
        content: 'Test content',
        author: 'testuser',
        timestamp: DateTime.now(),
        type: 'Create',
        commentsCount: 5, // 有5条评论
      );

      await tester.pumpWidget(
        GetMaterialApp(
          home: Scaffold(
            body: DiscoveryContentItem(
              item: item,
              controller: controller,
            ),
          ),
        ),
      );

      await tester.pumpAndSettle();

      // 验证评论输入框不可见
      expect(find.text('Write a comment...'), findsNothing);
      
      // 验证评论列表不可见
      expect(find.byType(ListView), findsNothing);
      
      // 但是评论数量应该显示
      expect(find.text('5'), findsOneWidget);
    });

    testWidgets('should show comment section after clicking comment button', (WidgetTester tester) async {
      final item = DiscoveryItem(
        id: 'test-1',
        objectId: 'http://localhost:18080/activitypub/user/objects/123',
        title: 'Test Post',
        content: 'Test content',
        author: 'testuser',
        timestamp: DateTime.now(),
        type: 'Create',
        commentsCount: 3,
      );

      await tester.pumpWidget(
        GetMaterialApp(
          home: Scaffold(
            body: DiscoveryContentItem(
              item: item,
              controller: controller,
            ),
          ),
        ),
      );

      await tester.pumpAndSettle();

      // 点击评论按钮
      final commentButton = find.byIcon(Icons.chat_bubble_outline);
      expect(commentButton, findsOneWidget);
      
      await tester.tap(commentButton);
      await tester.pumpAndSettle();

      // 现在评论输入框应该可见
      expect(find.text('Write a comment...'), findsOneWidget);
    });

    testWidgets('should toggle comment section on multiple clicks', (WidgetTester tester) async {
      final item = DiscoveryItem(
        id: 'test-1',
        objectId: 'http://localhost:18080/activitypub/user/objects/123',
        title: 'Test Post',
        content: 'Test content',
        author: 'testuser',
        timestamp: DateTime.now(),
        type: 'Create',
        commentsCount: 2,
      );

      await tester.pumpWidget(
        GetMaterialApp(
          home: Scaffold(
            body: DiscoveryContentItem(
              item: item,
              controller: controller,
            ),
          ),
        ),
      );

      final commentButton = find.byIcon(Icons.chat_bubble_outline);

      // 第一次点击 - 展开
      await tester.tap(commentButton);
      await tester.pumpAndSettle();
      expect(find.text('Write a comment...'), findsOneWidget);

      // 第二次点击 - 收起
      await tester.tap(commentButton);
      await tester.pumpAndSettle();
      expect(find.text('Write a comment...'), findsNothing);

      // 第三次点击 - 再次展开
      await tester.tap(commentButton);
      await tester.pumpAndSettle();
      expect(find.text('Write a comment...'), findsOneWidget);
    });
  });
}
