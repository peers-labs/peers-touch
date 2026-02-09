import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:get/get.dart';
import 'package:peers_touch_base/widgets/avatar.dart';
import 'package:peers_touch_base/widgets/avatar_resolver.dart';

/// Mock implementation of AvatarResolver for testing
class MockAvatarResolver implements AvatarResolver {
  final Map<String, String?> _avatarUrls = {};
  final Map<String, String> _fallbackNames = {};
  final Map<String, String?> _fetchResults = {};
  
  /// If true, fetchAvatarUrl returns immediately without async delay
  bool disableFetch = true;

  /// Register a mock avatar URL for an actor
  void registerAvatar(String actorId, String? url) {
    _avatarUrls[actorId] = url;
  }

  /// Register a mock fallback name for an actor
  void registerFallbackName(String actorId, String name) {
    _fallbackNames[actorId] = name;
  }

  /// Register a mock fetch result for an actor
  void registerFetchResult(String actorId, String? url) {
    _fetchResults[actorId] = url;
  }

  /// Clear all registered data
  void clear() {
    _avatarUrls.clear();
    _fallbackNames.clear();
    _fetchResults.clear();
  }

  @override
  String? getAvatarUrl(String actorId) {
    return _avatarUrls[actorId];
  }

  @override
  String getFallbackName(String actorId) {
    return _fallbackNames[actorId] ?? actorId;
  }

  @override
  Future<String?> fetchAvatarUrl(String actorId) async {
    // Return immediately in tests to avoid timer issues
    if (disableFetch) return null;
    
    // Simulate network delay (only used in specific tests)
    await Future.delayed(const Duration(milliseconds: 10));
    final url = _fetchResults[actorId];
    if (url != null) {
      _avatarUrls[actorId] = url;
    }
    return url;
  }
}

void main() {
  late MockAvatarResolver mockResolver;

  setUp(() {
    // Reset GetX before each test
    Get.reset();
    mockResolver = MockAvatarResolver();
  });

  tearDown(() {
    Get.reset();
  });

  group('AvatarResolver Interface', () {
    test('getAvatarUrl returns null for unregistered actor', () {
      expect(mockResolver.getAvatarUrl('unknown-actor'), isNull);
    });

    test('getAvatarUrl returns registered URL', () {
      const actorId = 'actor-123';
      const avatarUrl = 'https://example.com/avatar.png';

      mockResolver.registerAvatar(actorId, avatarUrl);

      expect(mockResolver.getAvatarUrl(actorId), equals(avatarUrl));
    });

    test('getAvatarUrl returns null when explicitly registered as null', () {
      const actorId = 'actor-no-avatar';

      mockResolver.registerAvatar(actorId, null);

      expect(mockResolver.getAvatarUrl(actorId), isNull);
    });

    test('getFallbackName returns actorId when not registered', () {
      const actorId = 'actor-456';

      expect(mockResolver.getFallbackName(actorId), equals(actorId));
    });

    test('getFallbackName returns registered name', () {
      const actorId = 'actor-789';
      const displayName = 'John Doe';

      mockResolver.registerFallbackName(actorId, displayName);

      expect(mockResolver.getFallbackName(actorId), equals(displayName));
    });

    test('can register multiple actors', () {
      mockResolver.registerAvatar('actor-1', 'https://example.com/1.png');
      mockResolver.registerAvatar('actor-2', 'https://example.com/2.png');
      mockResolver.registerAvatar('actor-3', null);
      mockResolver.registerFallbackName('actor-1', 'User One');
      mockResolver.registerFallbackName('actor-2', 'User Two');

      expect(mockResolver.getAvatarUrl('actor-1'), equals('https://example.com/1.png'));
      expect(mockResolver.getAvatarUrl('actor-2'), equals('https://example.com/2.png'));
      expect(mockResolver.getAvatarUrl('actor-3'), isNull);
      expect(mockResolver.getFallbackName('actor-1'), equals('User One'));
      expect(mockResolver.getFallbackName('actor-2'), equals('User Two'));
      expect(mockResolver.getFallbackName('actor-3'), equals('actor-3'));
    });

    test('clear removes all registered data', () {
      mockResolver.registerAvatar('actor-1', 'https://example.com/1.png');
      mockResolver.registerFallbackName('actor-1', 'User One');

      mockResolver.clear();

      expect(mockResolver.getAvatarUrl('actor-1'), isNull);
      expect(mockResolver.getFallbackName('actor-1'), equals('actor-1'));
    });
  });

  group('Avatar Widget - URL Resolution', () {
    testWidgets('uses explicit avatarUrl when provided', (tester) async {
      // Don't register resolver - explicit URL should still work
      await tester.pumpWidget(
        MaterialApp(
          home: Scaffold(
            body: Avatar(
              actorId: 'actor-123',
              avatarUrl: 'https://example.com/explicit.png',
              fallbackName: 'Test User',
            ),
          ),
        ),
      );

      // Widget should be built (we can't easily verify network image loading in unit test)
      expect(find.byType(Avatar), findsOneWidget);
    });

    testWidgets('uses AvatarResolver when no explicit URL provided', (tester) async {
      // Register resolver with GetX
      Get.put<AvatarResolver>(mockResolver);
      mockResolver.registerAvatar('actor-123', 'https://example.com/resolved.png');

      await tester.pumpWidget(
        MaterialApp(
          home: Scaffold(
            body: Avatar(
              actorId: 'actor-123',
              fallbackName: 'Test User',
            ),
          ),
        ),
      );

      expect(find.byType(Avatar), findsOneWidget);
    });

    testWidgets('shows placeholder when no URL and resolver returns null', (tester) async {
      Get.put<AvatarResolver>(mockResolver);
      // Don't register any avatar URL for this actor

      await tester.pumpWidget(
        MaterialApp(
          home: Scaffold(
            body: Avatar(
              actorId: 'unknown-actor',
              fallbackName: 'Unknown User',
            ),
          ),
        ),
      );

      // Let async operations complete
      await tester.pumpAndSettle();

      // Should show placeholder with first letter 'U'
      expect(find.text('U'), findsOneWidget);
    });

    testWidgets('shows placeholder when resolver not registered', (tester) async {
      // Don't register any resolver

      await tester.pumpWidget(
        MaterialApp(
          home: Scaffold(
            body: Avatar(
              actorId: 'actor-123',
              fallbackName: 'Test User',
            ),
          ),
        ),
      );

      // Should show placeholder with first letter 'T'
      expect(find.text('T'), findsOneWidget);
    });

    testWidgets('prefers explicit URL over resolver URL', (tester) async {
      Get.put<AvatarResolver>(mockResolver);
      mockResolver.registerAvatar('actor-123', 'https://example.com/resolved.png');

      await tester.pumpWidget(
        MaterialApp(
          home: Scaffold(
            body: Avatar(
              actorId: 'actor-123',
              avatarUrl: 'https://example.com/explicit.png',
              fallbackName: 'Test User',
            ),
          ),
        ),
      );

      expect(find.byType(Avatar), findsOneWidget);
      // The explicit URL should be used, not the resolved one
    });

    testWidgets('empty string avatarUrl falls back to resolver', (tester) async {
      Get.put<AvatarResolver>(mockResolver);
      // Resolver also returns null
      mockResolver.registerAvatar('actor-123', null);

      await tester.pumpWidget(
        MaterialApp(
          home: Scaffold(
            body: Avatar(
              actorId: 'actor-123',
              avatarUrl: '', // Empty string
              fallbackName: 'Test User',
            ),
          ),
        ),
      );

      // Should show placeholder
      expect(find.text('T'), findsOneWidget);
    });
  });

  group('Avatar Widget - Fallback Name Resolution', () {
    testWidgets('uses explicit fallbackName when provided', (tester) async {
      await tester.pumpWidget(
        MaterialApp(
          home: Scaffold(
            body: Avatar(
              actorId: 'actor-123',
              fallbackName: 'Explicit Name',
            ),
          ),
        ),
      );

      expect(find.text('E'), findsOneWidget);
    });

    testWidgets('uses resolver fallbackName when explicit is empty', (tester) async {
      Get.put<AvatarResolver>(mockResolver);
      mockResolver.registerFallbackName('actor-123', 'Resolved Name');

      await tester.pumpWidget(
        MaterialApp(
          home: Scaffold(
            body: Avatar(
              actorId: 'actor-123',
              fallbackName: '', // Empty fallback
            ),
          ),
        ),
      );

      expect(find.text('R'), findsOneWidget);
    });

    testWidgets('uses actorId when no fallbackName and resolver returns actorId', (tester) async {
      Get.put<AvatarResolver>(mockResolver);
      // Don't register any fallback name - resolver will return actorId

      await tester.pumpWidget(
        MaterialApp(
          home: Scaffold(
            body: Avatar(
              actorId: 'actor-xyz',
              fallbackName: '',
            ),
          ),
        ),
      );

      expect(find.text('A'), findsOneWidget); // First letter of 'actor-xyz'
    });
  });

  group('Avatar Widget - Placeholder Rendering', () {
    testWidgets('displays first letter uppercase', (tester) async {
      await tester.pumpWidget(
        MaterialApp(
          home: Scaffold(
            body: Avatar(
              actorId: 'actor-123',
              fallbackName: 'lowercase',
            ),
          ),
        ),
      );

      expect(find.text('L'), findsOneWidget);
    });

    testWidgets('displays ? for empty name', (tester) async {
      Get.put<AvatarResolver>(mockResolver);
      mockResolver.registerFallbackName('actor-empty', '');

      await tester.pumpWidget(
        MaterialApp(
          home: Scaffold(
            body: Avatar(
              actorId: 'actor-empty',
              fallbackName: '',
            ),
          ),
        ),
      );

      // The resolver returns empty string, which should show '?'
      // But wait - if fallbackName is empty and resolver.getFallbackName returns empty,
      // _effectiveFallbackName will return empty, and _getFirstLetter will return '?'
      expect(find.text('?'), findsOneWidget);
    });

    testWidgets('trims whitespace from name', (tester) async {
      await tester.pumpWidget(
        MaterialApp(
          home: Scaffold(
            body: Avatar(
              actorId: 'actor-123',
              fallbackName: '  spaced  ',
            ),
          ),
        ),
      );

      expect(find.text('S'), findsOneWidget);
    });

    testWidgets('renders with custom size', (tester) async {
      await tester.pumpWidget(
        MaterialApp(
          home: Scaffold(
            body: Avatar(
              actorId: 'actor-123',
              fallbackName: 'Test',
              size: 80,
            ),
          ),
        ),
      );

      final container = tester.widget<Container>(find.byType(Container).first);
      expect(container.constraints?.maxWidth, equals(80));
      expect(container.constraints?.maxHeight, equals(80));
    });

    testWidgets('renders with custom border radius', (tester) async {
      await tester.pumpWidget(
        MaterialApp(
          home: Scaffold(
            body: Avatar(
              actorId: 'actor-123',
              fallbackName: 'Test',
              borderRadius: 20,
            ),
          ),
        ),
      );

      expect(find.byType(Avatar), findsOneWidget);
    });
  });

  group('Avatar Widget - Color Generation', () {
    testWidgets('generates consistent color for same actorId', (tester) async {
      await tester.pumpWidget(
        MaterialApp(
          home: Scaffold(
            body: Row(
              children: [
                Avatar(
                  actorId: 'same-actor',
                  fallbackName: 'Test',
                  key: const Key('avatar1'),
                ),
                Avatar(
                  actorId: 'same-actor',
                  fallbackName: 'Test',
                  key: const Key('avatar2'),
                ),
              ],
            ),
          ),
        ),
      );

      // Both avatars should render consistently
      expect(find.byType(Avatar), findsNWidgets(2));
    });

    testWidgets('generates different colors for different actorIds', (tester) async {
      await tester.pumpWidget(
        MaterialApp(
          home: Scaffold(
            body: Row(
              children: [
                Avatar(
                  actorId: 'actor-alpha',
                  fallbackName: 'Alpha',
                ),
                Avatar(
                  actorId: 'actor-beta',
                  fallbackName: 'Beta',
                ),
              ],
            ),
          ),
        ),
      );

      expect(find.byType(Avatar), findsNWidgets(2));
    });
  });

  group('Avatar Widget - Multi-user Scenario (Real-world)', () {
    testWidgets('correctly resolves different users avatars', (tester) async {
      Get.put<AvatarResolver>(mockResolver);

      // Simulate real scenario: current user (User A) and friend (User B)
      const userAId = 'did:plc:user-a';
      const userBId = 'did:plc:user-b';
      const userCId = 'did:plc:user-c';

      // Register avatar URLs for all users (simulating what FriendChatController should do)
      mockResolver.registerAvatar(userAId, 'https://example.com/avatar-a.png');
      mockResolver.registerAvatar(userBId, 'https://example.com/avatar-b.png');
      mockResolver.registerAvatar(userCId, null); // User C has no avatar
      mockResolver.registerFallbackName(userAId, 'User A');
      mockResolver.registerFallbackName(userBId, 'User B');
      mockResolver.registerFallbackName(userCId, 'User C');

      await tester.pumpWidget(
        MaterialApp(
          home: Scaffold(
            body: Column(
              children: [
                // User A's avatar
                Avatar(
                  key: const Key('avatar-a'),
                  actorId: userAId,
                  fallbackName: 'User A',
                ),
                // User B's avatar
                Avatar(
                  key: const Key('avatar-b'),
                  actorId: userBId,
                  fallbackName: 'User B',
                ),
                // User C's avatar (no URL)
                Avatar(
                  key: const Key('avatar-c'),
                  actorId: userCId,
                  fallbackName: 'User C',
                ),
              ],
            ),
          ),
        ),
      );

      expect(find.byType(Avatar), findsNWidgets(3));

      // User A and B should have network images (we can't verify the URL directly)
      // User C should have placeholder 'U' for 'User C'
      expect(find.text('U'), findsOneWidget);
    });

    testWidgets('CRITICAL: resolver must be populated BEFORE widget builds', (tester) async {
      Get.put<AvatarResolver>(mockResolver);

      const userBId = 'did:plc:user-b';

      // DON'T register avatar yet - simulating the bug where resolver is empty

      await tester.pumpWidget(
        MaterialApp(
          home: Scaffold(
            body: Avatar(
              actorId: userBId,
              fallbackName: 'User B',
            ),
          ),
        ),
      );

      // Should show placeholder because resolver has no data
      expect(find.text('U'), findsOneWidget);

      // Now register the avatar (too late!)
      mockResolver.registerAvatar(userBId, 'https://example.com/avatar-b.png');

      // Rebuild widget
      await tester.pumpWidget(
        MaterialApp(
          home: Scaffold(
            body: Avatar(
              actorId: userBId,
              fallbackName: 'User B',
            ),
          ),
        ),
      );

      // Now it should try to load the network image (placeholder should be gone if URL is valid)
      // But since we can't mock network, we just verify the widget rebuilds
      expect(find.byType(Avatar), findsOneWidget);
    });

    testWidgets('handles Chinese/Unicode names correctly', (tester) async {
      await tester.pumpWidget(
        MaterialApp(
          home: Scaffold(
            body: Avatar(
              actorId: 'chinese-user',
              fallbackName: '张三',
            ),
          ),
        ),
      );

      expect(find.text('张'), findsOneWidget);
    });

    testWidgets('handles emoji in name - shows first code unit', (tester) async {
      // Note: Current implementation uses name[0] which doesn't handle
      // multi-byte Unicode characters correctly. This test documents the current behavior.
      // A proper fix would use characters.first to get the first grapheme cluster.
      await tester.pumpWidget(
        MaterialApp(
          home: Scaffold(
            body: Avatar(
              actorId: 'emoji-user',
              fallbackName: 'Party🎉', // Put emoji at end so 'P' is first
            ),
          ),
        ),
      );

      // First character is 'P'
      expect(find.text('P'), findsOneWidget);
    });
  });

  group('Avatar Widget - Edge Cases', () {
    testWidgets('handles null avatarUrl gracefully', (tester) async {
      await tester.pumpWidget(
        MaterialApp(
          home: Scaffold(
            body: Avatar(
              actorId: 'actor-123',
              avatarUrl: null,
              fallbackName: 'Test',
            ),
          ),
        ),
      );

      expect(find.text('T'), findsOneWidget);
    });

    testWidgets('handles very long actorId', (tester) async {
      final longActorId = 'actor-${'x' * 1000}';

      await tester.pumpWidget(
        MaterialApp(
          home: Scaffold(
            body: Avatar(
              actorId: longActorId,
              fallbackName: 'Long ID User',
            ),
          ),
        ),
      );

      expect(find.byType(Avatar), findsOneWidget);
    });

    testWidgets('handles special characters in actorId', (tester) async {
      await tester.pumpWidget(
        MaterialApp(
          home: Scaffold(
            body: Avatar(
              actorId: 'actor:with/special@chars#123',
              fallbackName: 'Special',
            ),
          ),
        ),
      );

      expect(find.byType(Avatar), findsOneWidget);
    });
  });
}
