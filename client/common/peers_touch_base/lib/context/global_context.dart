import 'package:peers_touch_base/model/domain/actor/actor.pb.dart';
import 'package:peers_touch_base/model/domain/actor/preferences.pb.dart';
import 'package:peers_touch_base/model/domain/actor/session.pb.dart';

abstract class GlobalContext {
  ActorSessionSnapshot? get session;

  ActorProfile? get profile;

  List<ActorSessionSnapshot> get accounts;

  ActorPreferences get preferences;

  String? get protocolTag;

  String? get actorId;

  String? get actorHandle;

  Stream<ActorSessionSnapshot?> get onSessionChange;

  Stream<ActorProfile?> get onProfileChange;

  Stream<List<ActorSessionSnapshot>> get onAccountsChange;

  Stream<ActorPreferences> get onPreferencesChange;

  Stream<String?> get onProtocolChange;

  Stream<List<String>> get onNetworkStatusChange;

  Future<void> setSession(ActorSessionSnapshot? session);

  Future<void> switchAccount(String actorId, String baseUrl);

  Future<void> updatePreferences(ActorPreferences prefs);

  Future<void> setProtocolTag(String? tag);

  Future<bool> isOnline();

  Future<void> hydrate();

  Future<void> refreshProfile();

  void setProfile(ActorProfile? profile);

  void clearProfile();
}
