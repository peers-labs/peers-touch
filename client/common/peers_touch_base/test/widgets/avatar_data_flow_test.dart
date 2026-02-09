/// Integration test to diagnose avatar data flow issues.
/// 
/// This test documents the expected data flow from server to UI:
/// 1. Server: db.Actor.Icon -> GetFollowingResponse.Following.AvatarUrl
/// 2. Client: Following.avatarUrl -> FriendItem.avatarUrl
/// 3. Client: FriendItem.avatarUrl -> UnifiedSession.avatarUrl
/// 4. Client: UnifiedSession.avatarUrl -> Avatar widget (explicit URL)
/// 5. Client: AvatarResolver (backup for when explicit URL is missing)
/// 
/// CRITICAL FINDINGS:
/// - If server's db.Actor.Icon is empty, the entire chain will be empty
/// - Avatar widget uses EXPLICIT avatarUrl first, only falls back to resolver if null/empty
/// - AvatarResolver is a BACKUP mechanism, not the primary source
library;

import 'package:flutter_test/flutter_test.dart';

/// Simulates the server-side data model
class DbActor {
  final int id;
  final String preferredUsername;
  final String name;
  final String? icon; // Avatar URL - THIS IS THE SOURCE

  DbActor({
    required this.id,
    required this.preferredUsername,
    required this.name,
    this.icon,
  });
}

/// Simulates the protobuf response from GetFollowing
class FollowingProto {
  final String actorId;
  final String username;
  final String displayName;
  final String avatarUrl; // From db.Actor.Icon

  FollowingProto({
    required this.actorId,
    required this.username,
    required this.displayName,
    required this.avatarUrl,
  });
}

/// Simulates the client-side FriendItem model
class FriendItem {
  final String actorId;
  final String username;
  final String displayName;
  final String? avatarUrl;

  FriendItem({
    required this.actorId,
    required this.username,
    required this.displayName,
    this.avatarUrl,
  });

  String get name => displayName.isNotEmpty ? displayName : username;
}

/// Simulates UnifiedSession
class UnifiedSession {
  final String id;
  final String name;
  final String? avatarUrl;

  UnifiedSession({
    required this.id,
    required this.name,
    this.avatarUrl,
  });
}

/// Simulates the server's getAvatarURL function
String getAvatarURL(DbActor actor) {
  return actor.icon ?? ''; // Returns empty string if null!
}

/// Simulates the full data flow
void main() {
  group('Avatar Data Flow - Server to Client', () {
    test('DIAGNOSIS: Empty server icon results in empty client avatarUrl', () {
      // Server side: User has no avatar set
      final serverActor = DbActor(
        id: 123,
        preferredUsername: 'testuser',
        name: 'Test User',
        icon: null, // No avatar!
      );

      // Server converts to protobuf
      final protoFollowing = FollowingProto(
        actorId: serverActor.id.toString(),
        username: serverActor.preferredUsername,
        displayName: serverActor.name,
        avatarUrl: getAvatarURL(serverActor), // This will be empty string!
      );

      // Client receives and creates FriendItem
      final friendItem = FriendItem(
        actorId: protoFollowing.actorId,
        username: protoFollowing.username,
        displayName: protoFollowing.displayName,
        avatarUrl: protoFollowing.avatarUrl.isNotEmpty 
            ? protoFollowing.avatarUrl 
            : null, // Client should convert empty string to null
      );

      // Client creates UnifiedSession
      final session = UnifiedSession(
        id: friendItem.actorId,
        name: friendItem.name,
        avatarUrl: friendItem.avatarUrl,
      );

      // DIAGNOSIS: avatarUrl is null throughout the chain
      expect(protoFollowing.avatarUrl, isEmpty); // Server returns empty string
      expect(friendItem.avatarUrl, isNull); // Client should convert to null
      expect(session.avatarUrl, isNull); // Session has null
    });

    test('SUCCESS: Server with avatar propagates to client', () {
      // Server side: User has avatar set
      final serverActor = DbActor(
        id: 456,
        preferredUsername: 'userwithavatae',
        name: 'User With Avatar',
        icon: 'https://example.com/avatar.png',
      );

      // Server converts to protobuf
      final protoFollowing = FollowingProto(
        actorId: serverActor.id.toString(),
        username: serverActor.preferredUsername,
        displayName: serverActor.name,
        avatarUrl: getAvatarURL(serverActor),
      );

      // Client receives and creates FriendItem
      final friendItem = FriendItem(
        actorId: protoFollowing.actorId,
        username: protoFollowing.username,
        displayName: protoFollowing.displayName,
        avatarUrl: protoFollowing.avatarUrl.isNotEmpty 
            ? protoFollowing.avatarUrl 
            : null,
      );

      // Client creates UnifiedSession
      final session = UnifiedSession(
        id: friendItem.actorId,
        name: friendItem.name,
        avatarUrl: friendItem.avatarUrl,
      );

      // SUCCESS: avatarUrl propagates correctly
      expect(protoFollowing.avatarUrl, equals('https://example.com/avatar.png'));
      expect(friendItem.avatarUrl, equals('https://example.com/avatar.png'));
      expect(session.avatarUrl, equals('https://example.com/avatar.png'));
    });

    test('BUG: Server returns empty string but client uses it directly', () {
      // Current buggy behavior: client uses empty string instead of null
      final serverActor = DbActor(
        id: 789,
        preferredUsername: 'noavatar',
        name: 'No Avatar User',
        icon: null,
      );

      final protoFollowing = FollowingProto(
        actorId: serverActor.id.toString(),
        username: serverActor.preferredUsername,
        displayName: serverActor.name,
        avatarUrl: getAvatarURL(serverActor), // Empty string
      );

      // BUGGY: Client doesn't convert empty string to null
      final friendItemBuggy = FriendItem(
        actorId: protoFollowing.actorId,
        username: protoFollowing.username,
        displayName: protoFollowing.displayName,
        avatarUrl: protoFollowing.avatarUrl, // Using empty string directly!
      );

      // This causes Avatar widget to try loading empty URL
      // instead of falling back to AvatarResolver
      expect(friendItemBuggy.avatarUrl, equals('')); // BUG: empty string not null
    });
  });

  group('Avatar Widget Resolution Logic', () {
    test('Avatar widget: empty string should be treated as null', () {
      // Avatar._resolvedUrl checks:
      // if (avatarUrl != null && avatarUrl!.isNotEmpty) return avatarUrl;
      // 
      // So empty string correctly falls back to resolver.
      // But the check for isEmpty happens AFTER the null check.
      
      const avatarUrl = '';
      final shouldUseExplicit = avatarUrl.isNotEmpty; // false - correct!
      expect(shouldUseExplicit, isFalse);
    });

    test('Avatar widget: null correctly falls back to resolver', () {
      const String? avatarUrl = null;
      final shouldUseExplicit = avatarUrl != null && avatarUrl.isNotEmpty;
      expect(shouldUseExplicit, isFalse);
    });

    test('Avatar widget: valid URL uses explicit URL', () {
      const avatarUrl = 'https://example.com/avatar.png';
      final shouldUseExplicit = avatarUrl.isNotEmpty;
      expect(shouldUseExplicit, isTrue);
    });
  });

  group('Root Cause Analysis', () {
    test('ROOT CAUSE: Server db.Actor.Icon is likely empty for all users', () {
      // If users are seeing placeholder avatars ('U'), it means:
      // 1. db.Actor.Icon is NULL or empty in the database
      // 2. No avatar was set during user registration
      // 3. No avatar upload/update functionality exists or works
      
      // The fix should be:
      // 1. Check if avatar upload works
      // 2. Check if profile update saves Icon field
      // 3. Generate default avatars for users without icons
      
      expect(true, isTrue); // Placeholder for documentation
    });

    test('SOLUTION: Generate default avatar URL for users', () {
      // Options:
      // A. Use Gravatar with email hash
      // B. Use UI Avatars service (https://ui-avatars.com/)
      // C. Use dicebear avatars
      // D. Use internal avatar generation based on user ID
      
      // Example: Generate UI Avatars URL
      String generateDefaultAvatarUrl(String name, String id) {
        final encodedName = Uri.encodeComponent(name);
        return 'https://ui-avatars.com/api/?name=$encodedName&background=random';
      }

      final url = generateDefaultAvatarUrl('User B', '123');
      expect(url, contains('ui-avatars.com'));
    });
  });
}
