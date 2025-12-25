
import 'dart:convert';
import 'dart:io';
import 'package:crypto/crypto.dart';
import 'package:peers_touch_base/logger/logging_service.dart';
import 'package:peers_touch_base/storage/file_storage_manager.dart';
import '../models/applet_manifest.dart';

class AppletManager {
  static final AppletManager _instance = AppletManager._internal();
  factory AppletManager() => _instance;
  AppletManager._internal();

  // In-memory cache of installed applets
  final Map<String, AppletManifest> _installedApplets = {};
  bool _initialized = false;

  /// Initialize the manager by loading installed applets from storage
  Future<void> initialize() async {
    if (_initialized) return;
    
    try {
      final file = await _getManifestFile();
      if (await file.exists()) {
        final content = await file.readAsString();
        if (content.isNotEmpty) {
          final List<dynamic> jsonList = jsonDecode(content);
          for (var item in jsonList) {
            final manifest = AppletManifest.fromJson(item);
            _installedApplets[manifest.appId] = manifest;
          }
        }
      }
    } catch (e) {
      LoggingService.error('Failed to load installed applets', e);
    }
    
    _initialized = true;
  }

  Future<void> installApplet(AppletManifest manifest) async {
    _installedApplets[manifest.appId] = manifest;
    await _saveManifests();
  }

  Future<void> uninstallApplet(String appId) async {
    _installedApplets.remove(appId);
    await _saveManifests();
    // TODO: Remove bundle files
  }

  /// Verifies if the bundle file at [filePath] matches the [expectedHash].
  /// Returns true if valid or if [expectedHash] is null (for development).
  Future<bool> verifyBundle(File bundleFile, String? expectedHash) async {
    if (expectedHash == null) {
      LoggingService.warning("Verify bundle skipped: No expected hash provided.");
      return true;
    }

    if (!await bundleFile.exists()) {
      LoggingService.error("Verify bundle failed: File not found at ${bundleFile.path}");
      return false;
    }

    try {
      final stream = bundleFile.openRead();
      final digest = await sha256.bind(stream).first;
      final actualHash = digest.toString();
      
      final isValid = actualHash == expectedHash;
      if (!isValid) {
        LoggingService.error("Verify bundle failed: Hash mismatch. Expected $expectedHash, got $actualHash");
      }
      return isValid;
    } catch (e) {
      LoggingService.error("Verify bundle failed: Exception during hashing", e);
      return false;
    }
  }

  List<AppletManifest> getInstalledApplets() {
    return _installedApplets.values.toList();
  }

  AppletManifest? getApplet(String appId) {
    return _installedApplets[appId];
  }

  /// Helper to get the manifests storage file
  Future<File> _getManifestFile() async {
    return FileStorageManager().getFile(
      StorageLocation.support,
      StorageNamespace.applets,
      'installed_manifests.json',
    );
  }

  /// Persist current in-memory state to disk
  Future<void> _saveManifests() async {
    try {
      final file = await _getManifestFile();
      final list = _installedApplets.values.map((e) => e.toJson()).toList();
      await file.writeAsString(jsonEncode(list));
    } catch (e) {
      LoggingService.error('Failed to save applet manifests', e);
    }
  }
}
