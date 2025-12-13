import 'package:peers_touch_base/model/domain/actor/session.pb.dart';
import 'package:peers_touch_base/model/domain/actor/preferences.pb.dart';

/// Global Application Context (single source of truth)
///
/// Maintains Actor session, account list, user preferences, protocol tag and
/// network status. Provides event streams and proto snapshot read/write.
/// Shared across Desktop/Mobile.
abstract class GlobalContext {
  /// Current actor session snapshot (Map compatibility layer)
  /// Keys: `actorId/handle/protocol/baseUrl/accessToken/refreshToken/expiresAt/roles`
  Map<String, dynamic>? get currentSession;

  /// Accounts list (actor session snapshots previously used on this device)
  List<Map<String, dynamic>> get accounts;

  /// Preferences (Map compatibility layer)
  /// Keys: `theme/locale/telemetry/endpoint_overrides/feature_flags/schemaVersion`
  Map<String, dynamic> get preferences;

  /// Protocol tag (`peers-touch` | `mastodon` | `other activitypub`)
  String? get protocolTag;

  /// Actor ID (shortcut)
  String? get actorId;

  /// Actor handle (shortcut)
  String? get actorHandle;

  /// Event: session changed (fires when currentSession updates)
  Stream<Map<String, dynamic>?> get onSessionChange;

  /// Event: accounts changed (fires when accounts updates)
  Stream<List<Map<String, dynamic>>> get onAccountChange;

  /// Event: preferences changed (fires when preferences updates)
  Stream<Map<String, dynamic>> get onPreferencesChange;

  /// Event: protocol tag changed (fires when protocolTag updates)
  Stream<String?> get onProtocolChange;

  /// Event: network status changes (forwarded from connectivity adapter)
  Stream<List<String>> get onNetworkStatusChange;

  /// Set/clear session (Map layer). Also sync to secure storage and local
  /// persistence (including Proto JSON snapshot).
  Future<void> setSession(Map<String, dynamic>? session);

  /// Set session using generated Proto snapshot (preferred path). Automatically
  /// maps to Map layer and persists.
  Future<void> setSessionSnapshot(ActorSessionSnapshot snapshot);

  /// Get current session as Proto snapshot (generated from in-memory state)
  ActorSessionSnapshot? getSessionSnapshot();

  /// Switch account by matching `userId/actorId` and `baseUrl` in accounts,
  /// then set it as current session.
  Future<void> switchAccount(String userId, String baseUrl);

  /// Update preferences (Map layer) and persist (including Proto JSON snapshot)
  Future<void> updatePreferences(Map<String, dynamic> prefs);

  /// Update preferences using generated Proto snapshot (preferred path).
  /// Automatically maps to Map layer and persists.
  Future<void> updatePreferencesSnapshot(ActorPreferences prefs);

  /// Get current preferences as Proto snapshot (generated from in-memory state)
  ActorPreferences? getPreferencesSnapshot();

  /// Set protocol tag (fires protocol event)
  Future<void> setProtocolTag(String? tag);

  /// Query if network is online (via connectivity adapter)
  Future<bool> isOnline();

  /// Hydrate context from local storage (PB-first, Map fallback)
  Future<void> hydrate();
}
