
import '../models/applet_manifest.dart';

class AppletManager {
  static final AppletManager _instance = AppletManager._internal();
  factory AppletManager() => _instance;
  AppletManager._internal();

  // In-memory cache of installed applets for MVP
  final Map<String, AppletManifest> _installedApplets = {};

  Future<void> installApplet(AppletManifest manifest) async {
    _installedApplets[manifest.appId] = manifest;
    // TODO: Persist to local storage (SQLite/JSON)
  }

  Future<void> uninstallApplet(String appId) async {
    _installedApplets.remove(appId);
    // TODO: Remove from storage and delete bundle files
  }

  List<AppletManifest> getInstalledApplets() {
    return _installedApplets.values.toList();
  }

  AppletManifest? getApplet(String appId) {
    return _installedApplets[appId];
  }
}
