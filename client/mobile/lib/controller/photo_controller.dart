import 'dart:async';
import 'dart:io';
import 'dart:convert';
import 'package:flutter/foundation.dart';
import 'package:flutter/services.dart';
import 'package:flutter/material.dart';
import 'package:path_provider/path_provider.dart';
import 'package:get/get.dart';
import 'package:http/http.dart' as http;
import 'package:photo_manager/photo_manager.dart';
import 'package:peers_touch_mobile/model/photo_model.dart';
import 'package:peers_touch_mobile/common/logger/logger.dart';
import 'package:peers_touch_mobile/store/photo_store.dart';
import 'package:peers_touch_mobile/store/sync_manager.dart';
import 'package:peers_touch_mobile/store/server_config_manager.dart';
import 'package:peers_touch_mobile/store/base_store.dart';


import 'package:peers_touch_mobile/pages/photo/photo_selection_sheet.dart';

class PhotoController extends GetxController implements SyncEventListener {
  // Static method channel for storage operations
  static const MethodChannel _storageChannel = MethodChannel(
    'samples.flutter.dev/storage',
  );

  final selectedPhotos = <int>{}.obs;
  final syncedPhotos = <int>{}.obs;
  final photos = <PhotoModel>[].obs;
  final albums = <AssetPathEntity>[].obs;
  final selectedAlbums = <AssetPathEntity>{}.obs;
  final syncedAlbums = <AssetPathEntity>{}.obs;
  final _isShowSyncPhotoDrawerRunning = false.obs;
  final Rx<AssetPathEntity?> currentSelectedAlbum = Rx<AssetPathEntity?>(null);

  // ScrollController for photo grid
  late final ScrollController photoGridScrollController;

  // Timer for periodic server connectivity checks
  Timer? _serverConnectivityTimer;

  // New store layer components
  late PhotoStore photoStore;
  late ServerConfigManager serverConfigManager;
  
  // Get SyncManager from dependency injection
  late SyncManager syncManager;

  // Permission state tracking
  final Rx<PermissionState> _permissionState =
      PermissionState.notDetermined.obs;
  final RxBool _hasCheckedPermission = false.obs;

  // Getters for permission state
  PermissionState get permissionState => _permissionState.value;
  bool get hasPhotoPermission =>
      _permissionState.value == PermissionState.authorized;
  bool get isPermissionDenied =>
      _permissionState.value == PermissionState.denied;
  bool get hasCheckedPermission => _hasCheckedPermission.value;

  @override
  void onInit() {
    super.onInit();
    // Initialize ScrollController
    photoGridScrollController = ScrollController();
    photoGridScrollController.addListener(_scrollListener);
    // Initialize the method channel when the controller is created
    _initializeMethodChannel();
    // Initialize store layer
    _initializeStoreLayer();
    // Check initial permission state
    _checkInitialPermissionState();
    // Note: Periodic server connectivity checks will start when drawer opens
  }
  
  Future<void> _initializeStoreLayer() async {
    try {
      // Initialize server config manager
      serverConfigManager = Get.put(ServerConfigManager());
      
      // Get SyncManager instance
      try {
        syncManager = Get.find<SyncManager>();
      } catch (e) {
        appLogger.warning('SyncManager not found, waiting for initialization');
        // Wait briefly and try again
        await Future.delayed(Duration(milliseconds: 100));
        syncManager = Get.find<SyncManager>();
      }
      
      // Initialize photo store
      photoStore = PhotoStore();
      await photoStore.initialize();
      
      // Register photo store with sync manager
      syncManager.registerStore(photoStore);
      
      // Add sync event listener
      syncManager.addSyncListener(this);
      
      if (kDebugMode) {
        appLogger.info('Store layer initialized successfully');
      }
    } catch (e) {
      appLogger.error('Failed to initialize store layer: $e');
    }
  }
  
  // SyncEventListener implementation
  @override
  void onSyncStarted(String storeName) {
    if (kDebugMode) {
      appLogger.info('Sync started: $storeName');
    }
    isUploading.value = true;
    uploadStatus.value = 'Syncing $storeName...';
  }

  @override
  void onSyncProgress(String storeName, int current, int total) {
    if (kDebugMode) {
      appLogger.info('Sync progress: $storeName - $current/$total');
    }
    uploadProgress.value = total > 0 ? (current / total) : 0.0;
  }

  @override
  void onSyncCompleted(String storeName, SyncResult result) {
    if (kDebugMode) {
      appLogger.info('Sync completed: $storeName - ${result.success}');
    }
    
    isUploading.value = false;
    if (result.success) {
      uploadStatus.value = 'Sync completed';
    } else {
      uploadStatus.value = 'Sync failed: ${result.error}';
      Get.snackbar('Sync Error', result.error ?? 'Sync failed');
    }
  }

  @override
  void onNetworkStatusChanged(NetworkStatus status) {
    if (kDebugMode) {
      appLogger.info('Network status changed: $status');
    }
    // Handle network status changes if needed
  }

  @override
  void onClose() {
    photoGridScrollController.removeListener(_scrollListener);
    photoGridScrollController.dispose();
    // Cancel the periodic timer
    _serverConnectivityTimer?.cancel();
    _disposeStoreLayer();
    super.onClose();
  }
  
  void _disposeStoreLayer() {
    try {
      // Check if syncManager is initialized before using it
      try {
        syncManager.removeSyncListener(this);
        syncManager.unregisterStore('PhotoStore');
      } catch (syncError) {
        appLogger.warning('Error during sync manager cleanup: $syncError');
      }
      
      // Dispose photo store if initialized
      try {
        photoStore.dispose();
      } catch (storeError) {
        appLogger.warning('Error disposing photo store: $storeError');
      }
      
      if (kDebugMode) {
        appLogger.info('Store layer disposed successfully');
      }
    } catch (e) {
      appLogger.error('Error disposing store layer: $e');
    }
  }

  // Check current permission state without requesting
  Future<void> _checkInitialPermissionState() async {
    try {
      final permission = await PhotoManager.getPermissionState(
        requestOption: const PermissionRequestOption(
          iosAccessLevel: IosAccessLevel.readWrite,
        ),
      );
      _permissionState.value = permission;
      _hasCheckedPermission.value = true;

      if (kDebugMode) {
        appLogger.info('Initial permission state: $permission');
      }
    } catch (e) {
      if (kDebugMode) {
        appLogger.error('Error checking initial permission state: $e');
      }
      _hasCheckedPermission.value = true;
    }
  }

  // Start periodic server connectivity checks (only when drawer is open)
  void _startPeriodicServerConnectivityCheck() {
    // Don't start if already running
    if (_serverConnectivityTimer?.isActive == true) return;
    
    // Perform initial check
    checkServerConnectivity();
    
    // Set up periodic timer to check every 20 seconds
    _serverConnectivityTimer = Timer.periodic(
      const Duration(seconds: 20),
      (timer) {
        checkServerConnectivity();
        if (kDebugMode) {
          appLogger.info('Periodic server connectivity check completed (drawer open)');
        }
      },
    );
    
    if (kDebugMode) {
      appLogger.info('Started periodic server connectivity checks for open drawer (every 20 seconds)');
    }
  }

  // Stop periodic server connectivity checks (when drawer is closed)
  void _stopPeriodicServerConnectivityCheck() {
    _serverConnectivityTimer?.cancel();
    _serverConnectivityTimer = null;
    
    if (kDebugMode) {
      appLogger.info('Stopped periodic server connectivity checks (drawer closed)');
    }
  }

  // Check current permission state without requesting
  Future<PermissionState> checkPermissionState() async {
    try {
      final permission = await PhotoManager.getPermissionState(
        requestOption: const PermissionRequestOption(
          iosAccessLevel: IosAccessLevel.readWrite,
        ),
      );
      _permissionState.value = permission;
      _hasCheckedPermission.value = true;
      return permission;
    } catch (e) {
      if (kDebugMode) {
        appLogger.error('Error checking permission state: $e');
      }
      return PermissionState.notDetermined;
    }
  }

  // Request permission with user-friendly dialog
  Future<bool> requestPhotoPermission({bool showDialog = true}) async {
    try {
      // First check current state
      final currentState = await checkPermissionState();

      if (currentState == PermissionState.authorized) {
        return true;
      }

      // Always try to request permission directly first
      final permission = await PhotoManager.requestPermissionExtend();
      _permissionState.value = permission;

      // Only if permission is still denied after requesting, show dialog
      if (permission != PermissionState.authorized && showDialog) {
        // For limited permission on iOS, we can still proceed
        if (permission == PermissionState.limited) {
          return true;
        }

        // Only as a last resort, show settings dialog
        if (permission == PermissionState.denied) {
          return await _showPermissionDialog();
        }
      }

      return permission == PermissionState.authorized ||
          permission == PermissionState.limited;
    } catch (e) {
      if (kDebugMode) {
        appLogger.error('Error requesting photo permission: $e');
      }
      return false;
    }
  }

  // Show permission request dialog
  Future<bool> _showPermissionDialog() async {
    final result = await Get.dialog<bool>(
      AlertDialog(
        title: const Text('Photo Access Required'),
        content: const Text(
          'This app needs access to your photos to display and manage your albums. '
          'Please grant photo access in your device settings to continue.',
        ),
        actions: [
          TextButton(
            onPressed: () => Get.back(result: false),
            child: const Text('Cancel'),
          ),
          ElevatedButton(
            onPressed: () async {
              Get.back(result: true);
              // Try to open app settings
              await PhotoManager.openSetting();
            },
            child: const Text('Open Settings'),
          ),
        ],
      ),
      barrierDismissible: false,
    );

    return result ?? false;
  }

  // Show permission denied dialog
  // Request permission to access photos
  Future<void> loadAlbums() async {
    // Use the new permission handling system
    final hasPermission = await requestPhotoPermission();
    if (!hasPermission) {
      return;
    }

    // Clear existing albums and selected states to ensure fresh load
    albums.clear();
    selectedAlbums.clear();
    syncedAlbums.clear();

    try {
      // Get all media asset paths (albums)
      final List<AssetPathEntity> paths = await PhotoManager.getAssetPathList(
        type: RequestType.common,
      );
      albums.assignAll(paths);

      if (kDebugMode) {
        appLogger.info('Loaded ${paths.length} albums');
      }
    } catch (e) {
      if (kDebugMode) {
        appLogger.error('Error loading albums: $e');
      }
      Get.snackbar('Error', 'Failed to load albums: $e');
    }
  }

  // Updated to load photos from system
  Future<void> loadPhotos() async {
    // Use the new permission handling system
    final hasPermission = await requestPhotoPermission();
    if (!hasPermission) {
      return;
    }

    try {
      // Get image assets from system gallery
      final List<AssetPathEntity> paths = await PhotoManager.getAssetPathList(
        onlyAll: true,
        type: RequestType.image,
      );
      if (paths.isEmpty) return;

      // Get first 100 images from the "All Photos" album
      final List<AssetEntity> assets = await paths.first.getAssetListPaged(
        page: 0,
        size: 100,
      );

      final List<PhotoModel> systemPhotos = [];

      for (final asset in assets) {
        final file = await asset.file;
        if (file != null) {
          systemPhotos.add(
            PhotoModel(
              id: int.tryParse(asset.id) ?? asset.id.hashCode,
              path: file.path,
            ),
          );
        }
      }

      photos.assignAll(systemPhotos);

      if (kDebugMode) {
        appLogger.info('Loaded ${systemPhotos.length} photos');
      }
    } catch (e) {
      if (kDebugMode) {
        appLogger.error('Error loading photos: $e');
      }
      Get.snackbar('Error', 'Failed to load photos: $e');
    }
  }

  Future<bool> checkStorageSpace() async {
    try {
      if (kDebugMode) {
        appLogger.info('Starting storage space check...');
      }

      // Initialize the method channel early if needed
      if (!_isMethodChannelInitialized) {
        if (kDebugMode) {
          appLogger.info('Method channel not initialized, initializing now...');
        }
        await _initializeMethodChannel();
      }

      if (kDebugMode) {
        appLogger.info('Getting temporary directory...');
      }
      final directory = await getTemporaryDirectory();

      if (kDebugMode) {
        appLogger.info('Temporary directory path: ${directory.path}');
      }

      final freeSpace = await _getFreeDiskSpace(directory);
      // Assume we need at least 100MB for loading photos
      const requiredSpace = 100 * 1024 * 1024; // 100MB

      if (kDebugMode) {
        appLogger.info(
          'Available storage space: ${(freeSpace / (1024 * 1024)).toStringAsFixed(2)} MB',
        );
        appLogger.info(
          'Required storage space: ${(requiredSpace / (1024 * 1024)).toStringAsFixed(2)} MB',
        );
        appLogger.info(
          'Storage check result: ${freeSpace > requiredSpace ? 'SUFFICIENT' : 'INSUFFICIENT'} space',
        );
      }

      return freeSpace > requiredSpace;
    } catch (e) {
      if (kDebugMode) {
        appLogger.error('Error checking storage space: $e');
        appLogger.error('Stack trace: ${StackTrace.current}');
        appLogger.info('Assuming sufficient space due to error');
      }
      // In case of error, we'll assume there's enough space to avoid false negatives
      // This is safer than blocking the user unnecessarily
      return true;
    }
  }

  // Flag to track if method channel is initialized
  static bool _isMethodChannelInitialized = false;

  // Initialize the method channel
  Future<void> _initializeMethodChannel() async {
    if (_isMethodChannelInitialized) return;

    try {
      // Try to make a simple call to initialize the channel
      // Add a longer delay to ensure the platform side has time to register
      await Future.delayed(const Duration(milliseconds: 500));

      await _storageChannel.invokeMethod('getFreeDiskSpace').catchError((
        error,
      ) {
        // Ignore errors during initialization
        if (kDebugMode) {
          appLogger.debug(
            'Method channel initialization error (expected): $error',
          );
        }
      });
    } catch (e) {
      // Ignore errors during initialization
      if (kDebugMode) {
        appLogger.debug(
          'Method channel initialization exception (expected): $e',
        );
      }
    }

    _isMethodChannelInitialized = true;
  }

  Future<int> _getFreeDiskSpace(Directory directory) async {
    try {
      // First try to use the platform-specific implementation
      if (Platform.isAndroid || Platform.isIOS) {
        try {
          // Add a longer delay to ensure the method channel is registered
          await Future.delayed(const Duration(milliseconds: 500));

          if (kDebugMode) {
            appLogger.info(
              'Attempting to get free disk space via method channel...',
            );
          }

          final Map<String, dynamic>? result = await _storageChannel
              .invokeMapMethod<String, dynamic>('getFreeDiskSpace');
          if (result != null && result.containsKey('freeSpace')) {
            final freeSpace = result['freeSpace'];
            // Convert to int if it's not already
            if (freeSpace is int) {
              if (kDebugMode) {
                appLogger.info(
                  'Successfully got free space from method channel: ${(freeSpace / (1024 * 1024)).toStringAsFixed(2)} MB',
                );
              }
              return freeSpace;
            } else if (freeSpace is double) {
              if (kDebugMode) {
                appLogger.info(
                  'Successfully got free space from method channel (double): ${(freeSpace / (1024 * 1024)).toStringAsFixed(2)} MB',
                );
              }
              return freeSpace.toInt();
            } else {
              if (kDebugMode) {
                appLogger.warning(
                  'Unexpected type for freeSpace: ${freeSpace.runtimeType}',
                );
              }
            }
          } else {
            if (kDebugMode) {
              appLogger.warning(
                'Method channel returned invalid result: $result',
              );
            }
          }
        } catch (methodError) {
          if (kDebugMode) {
            appLogger.error('Method channel error: $methodError');
          }
          // Continue to fallback methods
        }
      }

      // Try to get disk space information using dart:io
      try {
        if (kDebugMode) {
          appLogger.info(
            'Attempting to get free disk space via directory.statSync()...',
          );
        }

        // On some platforms, we can get disk space from the directory stats
        final statFs = directory.statSync();
        final freeSpace = statFs.size;

        if (kDebugMode) {
          appLogger.info(
            'Got free space from statSync: ${(freeSpace / (1024 * 1024)).toStringAsFixed(2)} MB',
          );
        }

        // If we get a reasonable value (more than 10MB), use it
        if (freeSpace > 10 * 1024 * 1024) {
          return freeSpace;
        } else {
          if (kDebugMode) {
            appLogger.warning(
              'statSync returned unreasonably small value: $freeSpace bytes',
            );
          }
        }
      } catch (statError) {
        if (kDebugMode) {
          appLogger.error('Stat error: $statError');
        }
      }

      // If all else fails, assume there's enough space (500MB)
      // This prevents false negatives when we can't accurately determine free space
      if (kDebugMode) {
        appLogger.info('Using default free space value: 500 MB');
      }
      return 500 * 1024 * 1024; // 500MB default
    } catch (e) {
      if (kDebugMode) {
        appLogger.error('Error getting free disk space: $e');
      }
      // Return a reasonable default in case of error
      return 500 * 1024 * 1024; // Assume 500MB free as fallback
    }
  }

  // Track pagination state for each album
  final Map<String, int> _albumPageMap = {};
  final int _pageSize = 20; // Number of photos to load per page
  final RxBool isLoadingMore = false.obs;
  final RxBool isUploading = false.obs;
  final RxDouble uploadProgress = 0.0.obs;
  final RxString uploadStatus = ''.obs;
  final RxInt totalFilesToUpload = 0.obs;
  final RxInt uploadedFilesCount = 0.obs;
  bool _uploadCancelled = false;

  Future<void> loadPhotosForAlbum(AssetPathEntity album) async {
    bool shouldContinue = true;

    if (kDebugMode) {
      appLogger.info('loadPhotosForAlbum called for album: ${album.name}');
    }

    // Defer reactive updates until after current build cycle
    WidgetsBinding.instance.addPostFrameCallback((_) async {
      // Set the current selected album
      currentSelectedAlbum.value = album;
      if (kDebugMode) {
        appLogger.info('Set currentSelectedAlbum.value to: ${album.name}');
        appLogger.info(
          'currentSelectedAlbum.value is now: ${currentSelectedAlbum.value?.name}',
        );
      }

      // Reset pagination when loading a new album
      _albumPageMap[album.id] = 0;
      photos.clear();
      update(); // Force update to ensure UI reflects the change

      try {
        if (kDebugMode) {
          appLogger.info('Checking storage space before loading photos...');
        }

        final hasEnoughSpace = await checkStorageSpace();
        if (!hasEnoughSpace) {
          if (kDebugMode) {
            appLogger.warning(
              'Not enough storage space detected, showing error to user',
            );
          }

          Get.snackbar(
            'Storage Error',
            'Not enough storage space on the device to load photos. Please free up at least 100MB of space and try again.',
            duration: const Duration(seconds: 5),
            snackPosition: SnackPosition.BOTTOM,
            backgroundColor: Colors.red[100],
            colorText: Colors.red[900],
            borderRadius: 8,
            margin: const EdgeInsets.all(8),
          );
          shouldContinue = false;
        }
      } catch (e) {
        if (kDebugMode) {
          appLogger.error('Error in storage check: $e');
          appLogger.error('Stack trace: ${StackTrace.current}');
          appLogger.info(
            'Continuing with photo loading despite storage check error',
          );
        }
        // Continue loading photos even if storage check fails
        // This prevents blocking the user unnecessarily
      }

      if (!shouldContinue) {
        if (kDebugMode) {
          appLogger.warning(
            'Aborting photo loading due to insufficient storage',
          );
        }
        return;
      }

      try {
        if (kDebugMode) {
          appLogger.info(
            'Loading first page of photos for album: ${album.name}',
          );
        }

        await loadMorePhotos(album);
      } catch (e) {
        if (kDebugMode) {
          appLogger.error('Error getting asset list for album: $e');
          appLogger.error('Stack trace: ${StackTrace.current}');
        }
        Get.snackbar('Error', 'Failed to load photos from album: $e');
      }
    });
  }

  // Load more photos for pagination
  Future<bool> loadMorePhotos(AssetPathEntity album) async {
    if (isLoadingMore.value) return false;

    WidgetsBinding.instance.addPostFrameCallback((_) {
      isLoadingMore.value = true;
    });

    try {
      final int currentPage = _albumPageMap[album.id] ?? 0;

      if (kDebugMode) {
        appLogger.info('Loading page $currentPage for album: ${album.name}');
      }

      List<AssetEntity> assets = [];
      try {
        assets = await album.getAssetListPaged(
          page: currentPage,
          size: _pageSize,
        );

        if (kDebugMode) {
          appLogger.info(
            'Found ${assets.length} assets in album for page $currentPage',
          );
        }

        // If no more assets, return false
        if (assets.isEmpty) {
          return false;
        }
      } catch (e) {
        if (kDebugMode) {
          appLogger.error('Error getting asset list for album: $e');
          appLogger.error('Stack trace: ${StackTrace.current}');
        }
        Get.snackbar('Error', 'Failed to load more photos: $e');
        return false;
      }

      final List<PhotoModel> albumPhotos = [];

      for (final asset in assets) {
        try {
          // Try to get the file path directly first
          String? filePath;

          // Try to get the file
          final file = await asset.file;
          if (file != null) {
            filePath = file.path;
          } else {
            // If file is null, try to get the original file path
            filePath = await asset.originFile.then((f) => f?.path);
            if (filePath == null) {
              // As a last resort, try to get the thumbnail path
              final thumbData = await asset.thumbnailData;
              if (thumbData != null) {
                // Save thumbnail to a temporary file
                final tempDir = await getTemporaryDirectory();
                final tempFile = File('${tempDir.path}/${asset.id}.jpg');
                await tempFile.writeAsBytes(thumbData);
                filePath = tempFile.path;
              }
            }
          }

          if (filePath != null) {
            albumPhotos.add(
              PhotoModel(
                id: int.tryParse(asset.id) ?? asset.id.hashCode,
                path: filePath,
              ),
            );
          }
        } catch (e) {
          if (kDebugMode) {
            appLogger.error('Error getting file for asset ${asset.id}: $e');
          }
        }
      }

      // Filter out photos with invalid paths
      final validPhotos = <PhotoModel>[];
      for (final photo in albumPhotos) {
        try {
          if (photo.fileExistsSync()) {
            validPhotos.add(photo);
          }
        } catch (e) {
          if (kDebugMode) {
            appLogger.error('Error checking photo path: $e');
          }
        }
      }

      if (kDebugMode) {
        appLogger.info(
          'Found ${validPhotos.length} valid photos for page $currentPage',
        );
      }

      // Defer reactive updates to avoid build-time setState errors
      WidgetsBinding.instance.addPostFrameCallback((_) {
        // Add photos to the existing list
        photos.addAll(validPhotos);

        // Increment the page number for next load
        _albumPageMap[album.id] = currentPage + 1;

        update(); // Ensure UI updates
        isLoadingMore.value = false;
      });
      return true;
    } catch (e) {
      if (kDebugMode) {
        appLogger.error('Error loading more photos: $e');
      }
      Get.snackbar('Error', 'Failed to load more photos: $e');
      WidgetsBinding.instance.addPostFrameCallback((_) {
        isLoadingMore.value = false;
      });
      return false;
    }
  }

  void togglePhotoSelection(int photoId) {
    if (selectedPhotos.contains(photoId)) {
      selectedPhotos.remove(photoId);
    } else {
      selectedPhotos.add(photoId);
    }
  }

  void toggleAlbumSelection(AssetPathEntity album) {
    if (selectedAlbums.contains(album)) {
      selectedAlbums.remove(album);
    } else {
      selectedAlbums.add(album);
    }
  }

  // Scroll listener for photo grid
  void _scrollListener() {
    if (photoGridScrollController.position.pixels >= 
        photoGridScrollController.position.maxScrollExtent - 500) {
      _loadMorePhotos();
    }
  }

  // Load more photos when scrolling
  void _loadMorePhotos() {
    if (isLoadingMore.value || currentSelectedAlbum.value == null) return;
    loadMorePhotos(currentSelectedAlbum.value!);
  }

  // Initialize photo grid (called when grid is first displayed)
  void initializePhotoGrid() {
    checkPhotoExistence();
    checkServerConnectivity();
  }

  // Check photo existence on server
  void checkPhotoExistence() async {
    if (photos.isNotEmpty && currentSelectedAlbum.value != null) {
      final albumName = currentSelectedAlbum.value!.name;
      await checkMultiplePhotosExistence(
        photos,
        albumName: albumName,
      );
    }
  }



  // Cancel upload process
  void cancelUpload() {
    _uploadCancelled = true;
    uploadStatus.value = 'Cancelling upload...';
  }

  // Upload method to sync selected photos with progress tracking using new store layer
  Future<bool> uploadSelectedPhotos() async {
    if (kDebugMode) {
      appLogger.info('uploadSelectedPhotos called');
      appLogger.info('Selected photos count: ${selectedPhotos.length}');
      appLogger.info('Selected albums count: ${selectedAlbums.length}');
    }
    
    if (isUploading.value) {
       if (kDebugMode) {
          appLogger.info('Upload already in progress, returning false');
        }
       return false;
     }

    // Reset upload state
    isUploading.value = true;
    _uploadCancelled = false;
    uploadProgress.value = 0.0;
    uploadedFilesCount.value = 0;

    try {
      // Calculate total files to upload
      int totalFiles = selectedPhotos.length;

      // Add photos from selected albums
      for (final album in selectedAlbums) {
        final List<AssetEntity> assets = await album.getAssetListRange(
          start: 0,
          end: 9999,
        );
        totalFiles += assets.length;
      }

      totalFilesToUpload.value = totalFiles;
      
      if (kDebugMode) {
        appLogger.info('Total files to upload: $totalFiles');
      }
      
      // Check if there are files to upload
      if (totalFiles == 0) {
        if (kDebugMode) {
          appLogger.info('No files to upload, showing snackbar');
        }
        _resetUploadState();
        Get.snackbar(
          'No Photos Selected',
          'Please select photos to upload.',
          duration: const Duration(seconds: 3),
        );
        return false;
      }
      
      uploadStatus.value = 'Starting upload...';

      // Show progress dialog
      _showUploadProgressDialog();

      // Upload individual selected photos using store layer
      for (final photoId in selectedPhotos) {
        if (_uploadCancelled) {
          Get.back(); // Close dialog
          _resetUploadState();
          return false;
        }

        final photo = photos.firstWhereOrNull((p) => p.id == photoId);
        if (photo != null) {
          final file = File(photo.path);
          if (await file.exists()) {
            uploadStatus.value = 'Uploading ${file.path.split('/').last}...';
            
            // Create PhotoData and save to store
            final photoData = PhotoData(
              id: photo.id.toString(),
              path: photo.path,
              localPath: photo.path,
              albumId: currentSelectedAlbum.value?.id,
              syncStatus: SyncStatus.localOnly,
              createdAt: DateTime.now(),
            );
            
            await photoStore.saveLocally(photoData);
            _updateProgress();
          }
        }
      }

      // Upload photos from selected albums using store layer
      for (final album in selectedAlbums) {
        if (_uploadCancelled) {
          Get.back(); // Close dialog
          _resetUploadState();
          return false;
        }

        final List<AssetEntity> assets = await album.getAssetListRange(
          start: 0,
          end: 9999,
        );

        for (final asset in assets) {
          if (_uploadCancelled) {
            Get.back(); // Close dialog
            _resetUploadState();
            return false;
          }

          final file = await asset.file;
          if (file != null) {
            uploadStatus.value =
                'Uploading ${file.path.split('/').last} from ${album.name}...';
            
            // Create PhotoData and save to store
            final photoData = PhotoData(
              id: asset.id,
              path: file.path,
              localPath: file.path,
              albumId: album.id,
              syncStatus: SyncStatus.localOnly,
              createdAt: DateTime.now(),
            );
            
            await photoStore.saveLocally(photoData);
            _updateProgress();
          }
        }
      }

      // Trigger sync using sync manager
      uploadStatus.value = 'Starting sync...';
      await syncManager.syncAll();

      // Mark selected photos and albums as synced
      syncedPhotos.addAll(selectedPhotos);
      syncedAlbums.addAll(selectedAlbums);

      // Clear selected items after successful upload
      selectedPhotos.clear();
      selectedAlbums.clear();

      uploadStatus.value = 'Upload completed successfully!';
      await Future.delayed(const Duration(seconds: 1));
      Get.back(); // Close dialog
      _resetUploadState();

      return true;
    } catch (e) {
      appLogger.error('Error uploading photos: $e');
      Get.back(); // Close dialog
      _resetUploadState();
      Get.snackbar('Upload Error', 'An unexpected error occurred: $e');
      return false;
    }
  }

  void _updateProgress() {
    uploadedFilesCount.value++;
    uploadProgress.value = uploadedFilesCount.value / totalFilesToUpload.value;
  }

  void _resetUploadState() {
    isUploading.value = false;
    uploadProgress.value = 0.0;
    uploadStatus.value = '';
    totalFilesToUpload.value = 0;
    uploadedFilesCount.value = 0;
    _uploadCancelled = false;
  }

  /// Check server connectivity using sync manager
  Future<bool> checkServerConnectivity() async {
    isCheckingServerConnection.value = true;
    
    try {
      if (kDebugMode) {
        appLogger.info('Checking server connectivity via sync manager...');
      }

      // Use sync manager to check connectivity
      final isConnected = syncManager.networkStatus == NetworkStatus.connected;
      
      isServerAvailable.value = isConnected;
      
      if (kDebugMode) {
        appLogger.info('Server connectivity result: $isConnected');
      }

      return isConnected;
    } catch (e) {
      if (kDebugMode) {
        appLogger.error('Server connectivity check failed: $e');
      }
      isServerAvailable.value = false;
      return false;
    } finally {
      isCheckingServerConnection.value = false;
    }
  }
  


  void _showUploadProgressDialog() {
    if (kDebugMode) {
      appLogger.info('Showing upload progress dialog');
    }
    
    Get.dialog(
      PopScope(
        canPop: false,
        onPopInvokedWithResult: (didPop, result) {
          if (!didPop) {
            cancelUpload();
          }
        },
        child: AlertDialog(
          title: const Text('Uploading Photos'),
          content: Obx(
            () => Column(
              mainAxisSize: MainAxisSize.min,
              children: [
                LinearProgressIndicator(
                  value: uploadProgress.value,
                  backgroundColor: Colors.grey[300],
                  valueColor: const AlwaysStoppedAnimation<Color>(Colors.blue),
                ),
                const SizedBox(height: 16),
                Text(
                  '${uploadedFilesCount.value} / ${totalFilesToUpload.value} files uploaded',
                  style: const TextStyle(fontSize: 14),
                ),
                const SizedBox(height: 8),
                Text(
                  uploadStatus.value,
                  style: const TextStyle(fontSize: 12, color: Colors.grey),
                  maxLines: 2,
                  overflow: TextOverflow.ellipsis,
                ),
              ],
            ),
          ),
          actions: [
            TextButton(
              onPressed: () {
                cancelUpload();
              },
              child: const Text('Cancel'),
            ),
          ],
        ),
      ),
      barrierDismissible: false,
    );
  }


  Future<void> showSyncPhotoDrawer() async {
    if (_isShowSyncPhotoDrawerRunning.value) return;
    _isShowSyncPhotoDrawerRunning.value = true;

    if (kDebugMode) {
      appLogger.info('Showing sync photo drawer');
    }

    try {
      // Start periodic server connectivity checks when drawer opens
      _startPeriodicServerConnectivityCheck();
      
      // Always load albums to ensure fresh data (no caching)
      if (kDebugMode) {
        appLogger.info('Loading albums (no caching)');
      }
      await loadAlbums();
      // Add a small delay to ensure UI updates
      await Future.delayed(const Duration(milliseconds: 100));

      // Clear any existing photo data to start fresh
      photos.clear();
      currentSelectedAlbum.value = null;
      update();

      if (kDebugMode) {
        appLogger.info('Showing bottom sheet');
        appLogger.info(
          'Current selected album: ${currentSelectedAlbum.value?.name ?? "None"}',
        );
      }

      // Show the bottom sheet after albums are loaded
      await Get.bottomSheet(
        const PhotoSelectionSheet(),
        isScrollControlled: true,
        ignoreSafeArea: false,
      ).whenComplete(() {
        // Stop periodic server connectivity checks when drawer is closed
        _stopPeriodicServerConnectivityCheck();
        
        // Clear data when the drawer is closed
        if (kDebugMode) {
          appLogger.info('Bottom sheet closed, clearing data');
        }
        clearAlbumAndPhotoData();
      });
    } catch (e) {
      appLogger.error('Error showing sync photo drawer: $e');
    } finally {
      _isShowSyncPhotoDrawerRunning.value = false;
    }
  }

  void clearAlbumAndPhotoData() {
    if (kDebugMode) {
      appLogger.info('Clearing album and photo data');
      appLogger.info(
        'Current selected album before clearing: ${currentSelectedAlbum.value?.name ?? "None"}',
      );
    }

    photos.clear();
    selectedPhotos.clear();
    syncedPhotos.clear();
    selectedAlbums.clear();
    syncedAlbums.clear();
    currentSelectedAlbum.value = null;

    if (kDebugMode) {
      appLogger.info(
        'Current selected album after clearing: ${currentSelectedAlbum.value?.name ?? "None"}',
      );
    }

    update();
  }

  // Backend photo fetching methods
  final RxList<Map<String, dynamic>> backendAlbums =
      <Map<String, dynamic>>[].obs;
  final RxBool isLoadingBackendPhotos = false.obs;

  /// Fetch photo list from backend
  Future<bool> fetchBackendPhotoList({String? albumFilter}) async {
    if (isLoadingBackendPhotos.value) return false;

    isLoadingBackendPhotos.value = true;

    try {
      String url = 'http://192.168.31.19:8082/family/photo/list';
      if (albumFilter != null && albumFilter.isNotEmpty) {
        url += '?album=${Uri.encodeComponent(albumFilter)}';
      }

      final response = await http.get(Uri.parse(url));

      if (response.statusCode == 200) {
        final Map<String, dynamic> data = json.decode(response.body);
        final List<dynamic> albumsData = data['albums'] ?? [];

        backendAlbums.assignAll(albumsData.cast<Map<String, dynamic>>());

        if (kDebugMode) {
          appLogger.info('Fetched ${backendAlbums.length} albums from backend');
        }

        return true;
      } else {
        appLogger.error(
          'Failed to fetch backend photos: ${response.statusCode}',
        );
        Get.snackbar('Error', 'Failed to load photos from server');
        return false;
      }
    } catch (e) {
      appLogger.error('Error fetching backend photos: $e');
      Get.snackbar('Error', 'Network error while loading photos');
      return false;
    } finally {
      isLoadingBackendPhotos.value = false;
    }
  }

  /// Get photo URL for displaying from backend
  String getBackendPhotoUrl(String album, String filename) {
    return 'http://192.168.31.19:8082/family/photo/get?album=${Uri.encodeComponent(album)}&filename=${Uri.encodeComponent(filename)}';
  }

  /// Download photo from backend to local storage
  Future<File?> downloadBackendPhoto(String album, String filename) async {
    try {
      final url = getBackendPhotoUrl(album, filename);
      final response = await http.get(Uri.parse(url));

      if (response.statusCode == 200) {
        final Directory tempDir = await getTemporaryDirectory();
        final String filePath = '${tempDir.path}/${album}_$filename';
        final File file = File(filePath);

        await file.writeAsBytes(response.bodyBytes);

        if (kDebugMode) {
          appLogger.info('Downloaded photo: $filename from album: $album');
        }

        return file;
      } else {
        appLogger.error('Failed to download photo: ${response.statusCode}');
        return null;
      }
    } catch (e) {
      appLogger.error('Error downloading photo: $e');
      return null;
    }
  }

  /// Get all photos from a specific backend album
  List<Map<String, dynamic>> getPhotosFromBackendAlbum(String albumName) {
    final album = backendAlbums.firstWhereOrNull(
      (album) => album['name'] == albumName,
    );

    if (album != null) {
      return List<Map<String, dynamic>>.from(album['photos'] ?? []);
    }

    return [];
  }

  /// Refresh backend photos
  Future<void> refreshBackendPhotos() async {
    await fetchBackendPhotoList();
  }

  // Photo existence checking methods
  final RxMap<String, bool> photoExistenceCache = <String, bool>{}.obs;
  final RxBool isCheckingPhotoExistence = false.obs;
  
  // Server connectivity status
  final RxBool isCheckingServerConnection = false.obs;
  final RxBool isServerAvailable = false.obs;

  /// Check if a photo already exists on the server by filename
  Future<bool> checkPhotoExistsOnServer(String filename, {String? albumName}) async {
    // Check cache first
    final cacheKey = albumName != null ? '${albumName}_$filename' : filename;
    if (photoExistenceCache.containsKey(cacheKey)) {
      return photoExistenceCache[cacheKey]!;
    }

    try {
      // Fetch backend photos if not already loaded
      if (backendAlbums.isEmpty) {
        await fetchBackendPhotoList();
      }

      bool exists = false;
      
      if (albumName != null) {
        // Check specific album
        final albumPhotos = getPhotosFromBackendAlbum(albumName);
        exists = albumPhotos.any((photo) => photo['filename'] == filename);
      } else {
        // Check all albums
        for (final album in backendAlbums) {
          final photos = List<Map<String, dynamic>>.from(album['photos'] ?? []);
          if (photos.any((photo) => photo['filename'] == filename)) {
            exists = true;
            break;
          }
        }
      }

      // Cache the result
      photoExistenceCache[cacheKey] = exists;
      return exists;
    } catch (e) {
      appLogger.error('Error checking photo existence: $e');
      return false;
    }
  }

  /// Check multiple photos for existence on server
  Future<Map<String, bool>> checkMultiplePhotosExistence(
    List<PhotoModel> photos, {
    String? albumName,
  }) async {
    if (isCheckingPhotoExistence.value) {
      return {};
    }

    isCheckingPhotoExistence.value = true;
    final results = <String, bool>{};

    try {
      // Fetch backend photos if not already loaded
      if (backendAlbums.isEmpty) {
        await fetchBackendPhotoList();
      }

      for (final photo in photos) {
        final filename = photo.path.split('/').last;
        final exists = await checkPhotoExistsOnServer(filename, albumName: albumName);
        results[photo.path] = exists;
      }

      if (kDebugMode) {
        final existingCount = results.values.where((exists) => exists).length;
        appLogger.info('Checked ${photos.length} photos: $existingCount already exist on server');
      }

      return results;
    } catch (e) {
      appLogger.error('Error checking multiple photos existence: $e');
      return {};
    } finally {
      isCheckingPhotoExistence.value = false;
    }
  }

  /// Get photos that don't exist on server (new photos to upload)
  Future<List<PhotoModel>> getNewPhotosToUpload(
    List<PhotoModel> photos, {
    String? albumName,
  }) async {
    final existenceMap = await checkMultiplePhotosExistence(photos, albumName: albumName);
    
    return photos.where((photo) {
      final exists = existenceMap[photo.path] ?? false;
      return !exists; // Return photos that don't exist on server
    }).toList();
  }

  /// Get photos that already exist on server
  Future<List<PhotoModel>> getExistingPhotosOnServer(
    List<PhotoModel> photos, {
    String? albumName,
  }) async {
    final existenceMap = await checkMultiplePhotosExistence(photos, albumName: albumName);
    
    return photos.where((photo) {
      final exists = existenceMap[photo.path] ?? false;
      return exists; // Return photos that exist on server
    }).toList();
  }

  /// Clear photo existence cache
  void clearPhotoExistenceCache() {
    photoExistenceCache.clear();
  }

  /// Check if a specific photo path exists on server (for UI indicators)
  bool isPhotoUploadedToServer(String photoPath) {
    final filename = photoPath.split('/').last;
    // Check cache for any album containing this filename
    for (final entry in photoExistenceCache.entries) {
      if (entry.key.endsWith('_$filename') || entry.key == filename) {
        return entry.value;
      }
    }
    return false; // Default to not uploaded if not in cache
  }
  
  /// Configure server settings for photo sync
  Future<void> configurePhotoServer(String baseUrl, String apiKey) async {
    try {
      final serverConfig = ServerConfig(
        id: 'photo_server',
        name: 'Photo Server',
        baseUrl: baseUrl,
        apiKey: apiKey,
      );
      
      await serverConfigManager.addServerConfig('photos', serverConfig);
      
      if (kDebugMode) {
        appLogger.info('Photo server configured: $baseUrl');
      }
    } catch (e) {
      appLogger.error('Failed to configure photo server: $e');
      Get.snackbar('Configuration Error', 'Failed to configure server: $e');
    }
  }
  
  /// Get current sync status for UI display
  SyncStatus getCurrentSyncStatus() {
    return syncManager.autoSyncEnabled && 
           syncManager.networkStatus == NetworkStatus.connected
        ? SyncStatus.synced
        : SyncStatus.localOnly;
  }
  
  /// Enable/disable auto sync
  void toggleAutoSync(bool enabled) {
    syncManager.setAutoSyncEnabled(enabled);
  }
  
  /// Get network status for UI display
  NetworkStatus getNetworkStatus() {
    return syncManager.networkStatus;
  }
}
