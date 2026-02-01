import 'dart:io';

import 'package:path/path.dart' as p;
import 'package:path_provider/path_provider.dart';

/// Defines the base storage locations available to the application.
enum StorageLocation {
  /// Persistent documents directory.
  /// User-visible on some platforms, backed up by iCloud/Backup.
  /// Use for: User generated content, essential data.
  documents,

  /// Caches directory.
  /// Can be cleared by the OS to save space.
  /// Use for: Downloaded files, temporary artifacts, images.
  cache,

  /// Application Support directory.
  /// Not user-visible, persistent.
  /// Use for: Configuration, databases, internal app data.
  support,
  
  /// Temporary directory.
  /// Cleared on app restart or by OS.
  temporary,
}

/// Defines the top-level directory names to ensure consistency and avoid hardcoding.
/// All storage operations should be scoped under one of these namespaces.
enum StorageNamespace {
  /// Desktop client data root
  peersTouchDesktop('peers_touch_desktop'),
  
  /// Mobile client data root
  peersTouchMobile('peers_touch_mobile'),
  
  /// Shared logs directory
  logs('logs'),
  
  /// Shared cache directory
  cache('cache'),
  
  /// Applet related data
  applets('applets');

  final String path;
  const StorageNamespace(this.path);
}

/// A centralized manager for file storage operations across Desktop and Mobile.
/// 
/// This class abstracts the underlying `path_provider` details and provides
/// a unified interface for accessing scoped directories (namespaces).
class FileStorageManager {
  
  factory FileStorageManager() => _instance;
  
  FileStorageManager._internal();
  static final FileStorageManager _instance = FileStorageManager._internal();

  /// Returns the platform-specific namespace.
  /// 
  /// Desktop (Windows/macOS/Linux) uses [StorageNamespace.peersTouchDesktop].
  /// Mobile (iOS/Android) uses [StorageNamespace.peersTouchMobile].
  StorageNamespace get platformNamespace {
    if (Platform.isIOS || Platform.isAndroid) {
      return StorageNamespace.peersTouchMobile;
    }
    return StorageNamespace.peersTouchDesktop;
  }

  /// Gets a directory using the platform-specific namespace.
  /// 
  /// This is a convenience method that automatically selects the correct
  /// namespace based on the current platform.
  Future<Directory> getPlatformDirectory(StorageLocation location, {String? subDir}) async {
    return getDirectory(location, platformNamespace, subDir: subDir);
  }

  /// Gets a file using the platform-specific namespace.
  Future<File> getPlatformFile(StorageLocation location, String filename, {String? subDir}) async {
    return getFile(location, platformNamespace, filename, subDir: subDir);
  }

  /// Gets the user-scoped directory for chat media.
  /// 
  /// Structure: {platform_namespace}/users/{actorId}/media/{targetType}/{targetId}/
  Future<Directory> getChatMediaDirectory({
    required String actorId,
    required String targetType, // 'friends' or 'groups'
    required String targetId,
  }) async {
    final subDir = 'users/$actorId/media/$targetType/$targetId';
    return getPlatformDirectory(StorageLocation.support, subDir: subDir);
  }

  /// Gets the user-scoped directory for database files.
  /// 
  /// Structure: {platform_namespace}/users/{actorId}/
  Future<Directory> getUserDatabaseDirectory(String actorId) async {
    final subDir = 'users/$actorId';
    return getPlatformDirectory(StorageLocation.support, subDir: subDir);
  }

  /// Gets the raw base directory for a given [location].
  Future<Directory> getBaseDirectory(StorageLocation location) async {
    switch (location) {
      case StorageLocation.documents:
        return await getApplicationDocumentsDirectory();
      case StorageLocation.cache:
        return await getApplicationCacheDirectory();
      case StorageLocation.support:
        return await getApplicationSupportDirectory();
      case StorageLocation.temporary:
        return await getTemporaryDirectory();
    }
  }

  /// Gets a namespaced directory within a specific [location].
  /// 
  /// This is the preferred way to access storage.
  /// Example: `getDirectory(StorageLocation.documents, StorageNamespace.applets)`
  /// 
  /// [namespace] is the top-level directory enum.
  /// [subDir] is an optional subdirectory path (e.g. 'users/123/media').
  /// If the directory does not exist, it will be created.
  Future<Directory> getDirectory(StorageLocation location, StorageNamespace namespace, {String? subDir}) async {
    final base = await getBaseDirectory(location);
    String fullPath = p.join(base.path, namespace.path);
    if (subDir != null && subDir.isNotEmpty) {
      fullPath = p.join(fullPath, subDir);
    }
    
    final dir = Directory(fullPath);
    if (!await dir.exists()) {
      await dir.create(recursive: true);
    }
    return dir;
  }

  /// Gets a file reference within a namespaced directory.
  /// 
  /// Does NOT create the file, only ensures the parent directory exists.
  Future<File> getFile(StorageLocation location, StorageNamespace namespace, String filename, {String? subDir}) async {
    final dir = await getDirectory(location, namespace, subDir: subDir);
    return File(p.join(dir.path, filename));
  }

  /// Deletes a namespaced directory and all its contents.
  Future<void> clearNamespace(StorageLocation location, StorageNamespace namespace) async {
    final base = await getBaseDirectory(location);
    final dir = Directory(p.join(base.path, namespace.path));
    if (await dir.exists()) {
      await dir.delete(recursive: true);
    }
  }
}
