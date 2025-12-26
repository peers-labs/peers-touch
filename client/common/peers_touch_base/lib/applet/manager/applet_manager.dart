
import 'dart:convert';
import 'dart:io';
import 'package:crypto/crypto.dart';
import 'package:peers_touch_base/applet/network/station_applet_client.dart';
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

  /// Fetch list of available applets from Station
  Future<List<AppletManifest>> fetchAvailableApplets() async {
    try {
      return await StationAppletClient().fetchAppletList();
    } catch (e) {
      LoggingService.error('Failed to fetch applets from station', e);
      return [];
    }
  }

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
    // Check if we need to download/update bundle
    final current = _installedApplets[manifest.appId];
    if (current == null || current.version != manifest.version) {
        await _downloadAndUnzipBundle(manifest);
    }

    _installedApplets[manifest.appId] = manifest;
    await _saveManifests();
  }

  Future<void> _downloadAndUnzipBundle(AppletManifest manifest) async {
      // 1. Prepare target directory
      final appDir = await FileStorageManager().getDirectory(
          StorageLocation.documents, 
          StorageNamespace.applets, 
          subDir: '${manifest.appId}/${manifest.version}'
      );
      
      // 2. Mock Download & Unzip logic for "mock_zip://" protocol
      if (manifest.entryPoint.startsWith('mock_zip://')) {
          await _simulateInstallFromMock(manifest, appDir);
          // Update entry point to local file
          manifest.entryPoint = 'file://${appDir.path}/index.html';
          return;
      }

      // 3. Real Download Logic (TODO)
      // download(manifest.entryPoint) -> temp.zip
      // verifyBundle(temp.zip, manifest.bundleHash)
      // unzip(temp.zip, appDir)
      // manifest.entryPoint = 'file://${appDir.path}/index.html';
  }

  Future<void> _simulateInstallFromMock(AppletManifest manifest, Directory targetDir) async {
      LoggingService.info("Simulating install for ${manifest.appId} to ${targetDir.path}");
      final color = manifest.entryPoint.replaceFirst('mock_zip://', '');
      
      // Create index.html using FileStorageManager to ensure consistency
      // Note: targetDir is already a subdirectory managed by FileStorageManager
      // But to be strictly compliant, we could use getFile if we didn't already have targetDir.
      // Since we have targetDir (which is namespaced), using File() with its path is technically safe,
      // but let's use the Manager's getFile with the subDir we used to get targetDir.
      
      final subDirPath = '${manifest.appId}/${manifest.version}';
      final indexHtml = await FileStorageManager().getFile(
          StorageLocation.documents,
          StorageNamespace.applets,
          'index.html',
          subDir: subDirPath,
      );

      await indexHtml.writeAsString('''
<!DOCTYPE html>
<html>
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <style>
        body { margin: 0; display: flex; justify-content: center; align-items: center; height: 100vh; background-color: $color; font-family: sans-serif; }
    </style>
</head>
<body>
    <div style="text-align:center">
        <h1>${manifest.name}</h1>
        <p>Version: ${manifest.version}</p>
        <p>Running from local storage!</p>
        <button onclick="testBridge()">Test Bridge</button>
        <div id="status"></div>
    </div>
    <script>
        // Mock Bridge Logic
        function testBridge() {
             document.getElementById('status').innerText = "Bridge invoked!";
             if(window.PeersBridge) {
                 window.PeersBridge.invoke('storage', 'set', {key:'test', value:'123'});
             }
        }
    </script>
</body>
</html>
      ''');
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
