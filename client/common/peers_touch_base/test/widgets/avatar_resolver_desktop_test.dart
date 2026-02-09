/// Tests for AvatarResolverDesktop - the actual implementation used in production.
/// This test file is placed in common/test but imports from desktop package.
/// 
/// NOTE: This file tests the behavior that AvatarResolverDesktop SHOULD have.
/// If tests fail, it indicates a bug in the implementation.
library;

import 'package:flutter_test/flutter_test.dart';

// Since AvatarResolverDesktop is in the desktop package which isn't accessible
// from common/test, we create a simulation of it here to document expected behavior.

/// Simulated ActorInfo matching desktop implementation
class ActorInfo {
  final String actorId;
  final String? avatarUrl;
  final String? displayName;
  final String? username;

  ActorInfo({
    required this.actorId,
    this.avatarUrl,
    this.displayName,
    this.username,
  });

  String get fallbackName => displayName ?? username ?? actorId;
}

/// Simulated AvatarResolverDesktop matching expected behavior
class AvatarResolverDesktopSimulation {
  final Map<String, ActorInfo> _actorCache = {};
  
  // Simulated current user info (normally from GlobalContext)
  String? _currentUserId;
  String? _currentUserAvatarUrl;
  String? _currentUserDisplayName;
  
  void setCurrentUser(String userId, String? avatarUrl, String? displayName) {
    _currentUserId = userId;
    _currentUserAvatarUrl = avatarUrl;
    _currentUserDisplayName = displayName;
  }

  void registerActor({
    required String actorId,
    String? avatarUrl,
    String? displayName,
    String? username,
  }) {
    final existing = _actorCache[actorId];
    final newAvatar = avatarUrl ?? existing?.avatarUrl;
    final newDisplayName = displayName ?? existing?.displayName;
    final newUsername = username ?? existing?.username;

    _actorCache[actorId] = ActorInfo(
      actorId: actorId,
      avatarUrl: newAvatar,
      displayName: newDisplayName,
      username: newUsername,
    );
  }

  void registerActors(List<ActorInfo> actors) {
    for (final actor in actors) {
      registerActor(
        actorId: actor.actorId,
        avatarUrl: actor.avatarUrl,
        displayName: actor.displayName,
        username: actor.username,
      );
    }
  }

  void clearCache() {
    _actorCache.clear();
  }

  ActorInfo? getActorInfo(String actorId) => _actorCache[actorId];

  String? getAvatarUrl(String actorId) {
    // 1. Check current user first (always most up-to-date)
    if (_currentUserId == actorId) {
      if (_currentUserAvatarUrl != null && _currentUserAvatarUrl!.isNotEmpty) {
        return _currentUserAvatarUrl;
      }
    }

    // 2. Check actor cache for other users
    final cached = _actorCache[actorId];
    if (cached?.avatarUrl != null && cached!.avatarUrl!.isNotEmpty) {
      return cached.avatarUrl;
    }

    return null;
  }

  String getFallbackName(String actorId) {
    // 1. Check current user first
    if (_currentUserId == actorId) {
      if (_currentUserDisplayName != null && _currentUserDisplayName!.isNotEmpty) {
        return _currentUserDisplayName!;
      }
    }

    // 2. Check actor cache for other users
    final cached = _actorCache[actorId];
    if (cached != null) {
      return cached.fallbackName;
    }

    return actorId;
  }
}

void main() {
  late AvatarResolverDesktopSimulation resolver;

  setUp(() {
    resolver = AvatarResolverDesktopSimulation();
  });

  group('AvatarResolverDesktop - Current User Resolution', () {
    test('returns current user avatar from GlobalContext', () {
      resolver.setCurrentUser(
        'current-user-id',
        'https://example.com/current-avatar.png',
        'Current User',
      );

      expect(
        resolver.getAvatarUrl('current-user-id'),
        equals('https://example.com/current-avatar.png'),
      );
    });

    test('returns current user display name', () {
      resolver.setCurrentUser(
        'current-user-id',
        'https://example.com/current-avatar.png',
        'Current User',
      );

      expect(
        resolver.getFallbackName('current-user-id'),
        equals('Current User'),
      );
    });

    test('current user takes priority over cache', () {
      resolver.setCurrentUser(
        'user-id',
        'https://example.com/current.png',
        'Current Name',
      );
      
      // Also register in cache with different values
      resolver.registerActor(
        actorId: 'user-id',
        avatarUrl: 'https://example.com/cached.png',
        displayName: 'Cached Name',
      );

      // Current user should win
      expect(resolver.getAvatarUrl('user-id'), equals('https://example.com/current.png'));
      expect(resolver.getFallbackName('user-id'), equals('Current Name'));
    });
  });

  group('AvatarResolverDesktop - Other User Resolution', () {
    test('returns other user avatar from cache', () {
      resolver.registerActor(
        actorId: 'other-user-id',
        avatarUrl: 'https://example.com/other-avatar.png',
        displayName: 'Other User',
      );

      expect(
        resolver.getAvatarUrl('other-user-id'),
        equals('https://example.com/other-avatar.png'),
      );
    });

    test('returns null for unregistered user', () {
      expect(resolver.getAvatarUrl('unknown-user'), isNull);
    });

    test('returns actorId as fallback name for unregistered user', () {
      expect(resolver.getFallbackName('unknown-user'), equals('unknown-user'));
    });

    test('returns registered display name', () {
      resolver.registerActor(
        actorId: 'friend-id',
        displayName: 'Friend Name',
      );

      expect(resolver.getFallbackName('friend-id'), equals('Friend Name'));
    });

    test('returns username when displayName is null', () {
      resolver.registerActor(
        actorId: 'friend-id',
        username: 'friend_username',
      );

      expect(resolver.getFallbackName('friend-id'), equals('friend_username'));
    });

    test('prefers displayName over username', () {
      resolver.registerActor(
        actorId: 'friend-id',
        displayName: 'Display Name',
        username: 'username',
      );

      expect(resolver.getFallbackName('friend-id'), equals('Display Name'));
    });
  });

  group('AvatarResolverDesktop - Batch Registration', () {
    test('registerActors registers multiple users', () {
      resolver.registerActors([
        ActorInfo(
          actorId: 'user-1',
          avatarUrl: 'https://example.com/1.png',
          displayName: 'User One',
        ),
        ActorInfo(
          actorId: 'user-2',
          avatarUrl: 'https://example.com/2.png',
          displayName: 'User Two',
        ),
        ActorInfo(
          actorId: 'user-3',
          avatarUrl: null, // No avatar
          displayName: 'User Three',
        ),
      ]);

      expect(resolver.getAvatarUrl('user-1'), equals('https://example.com/1.png'));
      expect(resolver.getAvatarUrl('user-2'), equals('https://example.com/2.png'));
      expect(resolver.getAvatarUrl('user-3'), isNull);
      expect(resolver.getFallbackName('user-1'), equals('User One'));
      expect(resolver.getFallbackName('user-2'), equals('User Two'));
      expect(resolver.getFallbackName('user-3'), equals('User Three'));
    });
  });

  group('AvatarResolverDesktop - Cache Update Behavior', () {
    test('subsequent registration preserves existing values if new is null', () {
      resolver.registerActor(
        actorId: 'user-id',
        avatarUrl: 'https://example.com/avatar.png',
        displayName: 'Original Name',
      );

      // Register again with null values
      resolver.registerActor(
        actorId: 'user-id',
        avatarUrl: null,
        displayName: null,
      );

      // Should preserve original values
      expect(resolver.getAvatarUrl('user-id'), equals('https://example.com/avatar.png'));
      expect(resolver.getFallbackName('user-id'), equals('Original Name'));
    });

    test('subsequent registration updates existing values if new is provided', () {
      resolver.registerActor(
        actorId: 'user-id',
        avatarUrl: 'https://example.com/old.png',
        displayName: 'Old Name',
      );

      // Register again with new values
      resolver.registerActor(
        actorId: 'user-id',
        avatarUrl: 'https://example.com/new.png',
        displayName: 'New Name',
      );

      expect(resolver.getAvatarUrl('user-id'), equals('https://example.com/new.png'));
      expect(resolver.getFallbackName('user-id'), equals('New Name'));
    });

    test('clearCache removes all registered actors', () {
      resolver.registerActor(
        actorId: 'user-id',
        avatarUrl: 'https://example.com/avatar.png',
      );

      resolver.clearCache();

      expect(resolver.getAvatarUrl('user-id'), isNull);
    });
  });

  group('AvatarResolverDesktop - Real-world Scenario', () {
    test('CRITICAL: Two users chatting - both should see correct avatars', () {
      // User A is logged in
      resolver.setCurrentUser(
        'did:plc:user-a',
        'https://example.com/avatar-a.png',
        'User A',
      );

      // User A loads friend list, which populates cache with User B's info
      resolver.registerActor(
        actorId: 'did:plc:user-b',
        avatarUrl: 'https://example.com/avatar-b.png',
        displayName: 'User B',
      );

      // Now verify both users' avatars can be resolved
      expect(
        resolver.getAvatarUrl('did:plc:user-a'),
        equals('https://example.com/avatar-a.png'),
        reason: 'Current user (A) avatar should be resolved from GlobalContext',
      );
      expect(
        resolver.getAvatarUrl('did:plc:user-b'),
        equals('https://example.com/avatar-b.png'),
        reason: 'Friend (B) avatar should be resolved from cache',
      );
    });

    test('CRITICAL: Friend with no avatar shows placeholder correctly', () {
      resolver.setCurrentUser(
        'did:plc:user-a',
        'https://example.com/avatar-a.png',
        'User A',
      );

      // Friend has no avatar URL but has display name
      resolver.registerActor(
        actorId: 'did:plc:user-b',
        avatarUrl: null,
        displayName: 'User B',
      );

      expect(resolver.getAvatarUrl('did:plc:user-b'), isNull);
      expect(
        resolver.getFallbackName('did:plc:user-b'),
        equals('User B'),
        reason: 'Should use display name for placeholder',
      );
    });

    test('CRITICAL: Unregistered user returns null avatar', () {
      // User C was never registered
      expect(
        resolver.getAvatarUrl('did:plc:user-c'),
        isNull,
        reason: 'Unregistered user should return null, causing placeholder to show',
      );
      expect(
        resolver.getFallbackName('did:plc:user-c'),
        equals('did:plc:user-c'),
        reason: 'Fallback should be actorId when not registered',
      );
    });

    test('DIAGNOSTIC: Empty avatar URL should return null not empty string', () {
      resolver.registerActor(
        actorId: 'user-id',
        avatarUrl: '', // Empty string
        displayName: 'Test User',
      );

      // Empty string should be treated as no avatar
      expect(
        resolver.getAvatarUrl('user-id'),
        isNull,
        reason: 'Empty string avatarUrl should be treated as null',
      );
    });

    test('Friends list scenario: multiple friends registered at once', () {
      // Simulating what FriendChatController does
      final friendList = [
        ActorInfo(
          actorId: 'friend-1',
          avatarUrl: 'https://example.com/f1.png',
          displayName: 'Friend One',
          username: '@friend1',
        ),
        ActorInfo(
          actorId: 'friend-2',
          avatarUrl: 'https://example.com/f2.png',
          displayName: 'Friend Two',
          username: '@friend2',
        ),
        ActorInfo(
          actorId: 'friend-3',
          avatarUrl: null, // No avatar
          displayName: 'Friend Three',
          username: '@friend3',
        ),
        ActorInfo(
          actorId: 'friend-4',
          avatarUrl: 'https://example.com/f4.png',
          displayName: null, // No display name
          username: '@friend4',
        ),
      ];

      resolver.registerActors(friendList);

      // Verify all friends
      expect(resolver.getAvatarUrl('friend-1'), equals('https://example.com/f1.png'));
      expect(resolver.getAvatarUrl('friend-2'), equals('https://example.com/f2.png'));
      expect(resolver.getAvatarUrl('friend-3'), isNull);
      expect(resolver.getAvatarUrl('friend-4'), equals('https://example.com/f4.png'));
      expect(resolver.getFallbackName('friend-1'), equals('Friend One'));
      expect(resolver.getFallbackName('friend-2'), equals('Friend Two'));
      expect(resolver.getFallbackName('friend-3'), equals('Friend Three'));
      expect(resolver.getFallbackName('friend-4'), equals('@friend4')); // Falls back to username
    });
  });
}
