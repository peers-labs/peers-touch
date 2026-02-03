import 'dart:convert';
import 'dart:io';

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:get/get.dart';
import 'package:peers_touch_base/context/global_context.dart';
import 'package:peers_touch_base/i18n/generated/app_localizations.dart';
import 'package:peers_touch_base/storage/config_database.dart';
import 'package:peers_touch_base/storage/global_users_storage.dart';
import 'package:peers_touch_base/storage/kv/kv_database.dart';
import 'package:peers_touch_base/storage/local_storage.dart';
import 'package:peers_touch_base/storage/secure_storage.dart';
import 'package:peers_touch_desktop/core/constants/storage_keys.dart';
import 'package:peers_touch_desktop/core/services/logging_service.dart';
import 'package:peers_touch_desktop/core/services/network_initializer.dart';

enum ServerStatus {
  unknown,
  checking,
  reachable,
  unreachable,
  notFound,
}

class AuthController extends GetxController {
  final email = ''.obs;
  final password = ''.obs;
  final confirmPassword = ''.obs;
  final username = ''.obs;
  final displayName = ''.obs;
  final loading = false.obs;
  final error = RxnString();
  final presetUsers = <Map<String, dynamic>>[].obs;
  final recentUsers = <String>[].obs;
  final recentAvatars = <String, String>{}.obs;
  final loginPreviewAvatar = RxnString();
  final baseUrl = NetworkInitializer.currentBaseUrl.obs;
  final lastStatus = RxnInt();
  final lastBody = RxnString();
  final authTab = 0.obs; // 0: login, 1: signup
  final protocol = 'peers-touch'.obs;
  final serverStatus = ServerStatus.unknown.obs;
  final SecureStorage _secureStorage = SecureStorageImpl();

  late final TextEditingController emailController;
  late final TextEditingController passwordController;
  late final TextEditingController confirmPasswordController;
  late final TextEditingController usernameController;
  late final TextEditingController displayNameController;
  late final TextEditingController baseUrlController;

  late final FocusNode emailFocus;
  late final FocusNode passwordFocus;
  late final FocusNode confirmPasswordFocus;
  late final FocusNode usernameFocus;
  late final FocusNode displayNameFocus;
  late final FocusNode baseUrlFocus;
  final emailFocused = false.obs;
  final usernameFocused = false.obs;
  final isDropdownHovering = false.obs;
  final highlightedIndex = (-1).obs;

  @override
  void onInit() {
    super.onInit();
    
    // Initialize controllers
    emailController = TextEditingController();
    passwordController = TextEditingController();
    confirmPasswordController = TextEditingController();
    usernameController = TextEditingController();
    displayNameController = TextEditingController();
    baseUrlController = TextEditingController();

    // Initialize focus nodes with key listeners
    emailFocus = FocusNode(onKeyEvent: onKeyDown);
    passwordFocus = FocusNode();
    confirmPasswordFocus = FocusNode();
    usernameFocus = FocusNode(onKeyEvent: onKeyDown);
    displayNameFocus = FocusNode();
    baseUrlFocus = FocusNode();

    // Focus listeners for silky dropdown behavior
    emailFocus.addListener(() {
      emailFocused.value = emailFocus.hasFocus;
    });
    usernameFocus.addListener(() {
      usernameFocused.value = usernameFocus.hasFocus;
    });

    // Bind controllers to Rx variables
    emailController.addListener(() {
      if (email.value != emailController.text) {
        email.value = emailController.text;
      }
    });
    passwordController.addListener(() {
      if (password.value != passwordController.text) {
        password.value = passwordController.text;
      }
    });
    confirmPasswordController.addListener(() {
      if (confirmPassword.value != confirmPasswordController.text) {
        confirmPassword.value = confirmPasswordController.text;
      }
    });
    usernameController.addListener(() {
      if (username.value != usernameController.text) {
        username.value = usernameController.text;
      }
    });
    displayNameController.addListener(() {
      if (displayName.value != displayNameController.text) {
        displayName.value = displayNameController.text;
      }
    });
    baseUrlController.addListener(() {
      final t = baseUrlController.text;
      if (baseUrl.value != t) {
        updateBaseUrl(t);
      }
    });

    debounce(baseUrl, (String url) async {
      final trimmed = url.trim();
      if (trimmed.isNotEmpty) {
        await LocalStorage().set('base_url', trimmed);
        NetworkInitializer.initialize(baseUrl: trimmed);
        detectProtocol(trimmed);
        updateLoginPreviewAvatar();
      }
    }, time: const Duration(milliseconds: 800));

    // Restore user info from storage
    _restoreUserInfo();
    
    // Sync baseUrl
    baseUrlController.text = baseUrl.value;

    // React to input changes to update avatar preview
    ever(email, (_) {
      updateLoginPreviewAvatar();
      highlightedIndex.value = -1;
    });
    ever(username, (_) {
      updateLoginPreviewAvatar();
      highlightedIndex.value = -1;
    });
    ever(authTab, (_) => updateLoginPreviewAvatar());
  }

  List<String> get currentSuggestions {
    final isLogin = authTab.value == 0;
    final text = isLogin ? email.value : username.value;
    final list = <String>{}
      ..addAll(recentUsers)
      ..addAll(presetUsers
          .map((e) => (e['username'] ?? e['handle'] ?? e['name'] ?? '').toString())
          .where((e) => e.isNotEmpty));
    return list
        .where((e) => text.isEmpty || e.toLowerCase().contains(text.toLowerCase()))
        .take(6)
        .toList();
  }

  KeyEventResult onKeyDown(FocusNode node, KeyEvent event) {
    if (event is! KeyDownEvent) return KeyEventResult.ignored;
    
    final suggestions = currentSuggestions;
    if (suggestions.isEmpty) return KeyEventResult.ignored;

    if (event.logicalKey == LogicalKeyboardKey.arrowDown) {
      if (highlightedIndex.value < suggestions.length - 1) {
        highlightedIndex.value++;
      } else {
        highlightedIndex.value = 0;
      }
      return KeyEventResult.handled;
    } else if (event.logicalKey == LogicalKeyboardKey.arrowUp) {
      if (highlightedIndex.value > 0) {
        highlightedIndex.value--;
      } else if (highlightedIndex.value == -1) {
        highlightedIndex.value = suggestions.length - 1;
      }
      return KeyEventResult.handled;
    } else if (event.logicalKey == LogicalKeyboardKey.enter) {
      if (highlightedIndex.value != -1) {
        selectHighlightedItem(suggestions[highlightedIndex.value]);
        return KeyEventResult.handled;
      }
    }
    return KeyEventResult.ignored;
  }

  void selectHighlightedItem(String handle) {
    if (authTab.value == 0) {
      // Login mode: try to find the email for this handle
      String emailToFill = handle;
      
      // Check if handle is already an email
      if (!handle.contains('@')) {
        // Look for the user in presetUsers to get their email
        final found = presetUsers.firstWhereOrNull((u) {
          final username = (u['username'] ?? u['handle'] ?? u['name'] ?? '').toString();
          return username == handle;
        });
        
        if (found != null) {
          final userEmail = found['email']?.toString();
          if (userEmail != null && userEmail.isNotEmpty) {
            emailToFill = userEmail;
          }
        }
      }
      
      emailController.value = TextEditingValue(
        text: emailToFill,
        selection: TextSelection.collapsed(offset: emailToFill.length),
      );
    } else {
      usernameController.value = TextEditingValue(
        text: handle,
        selection: TextSelection.collapsed(offset: handle.length),
      );
    }
    updateLoginPreviewAvatar();
    highlightedIndex.value = -1;
  }

  Future<void> _restoreUserInfo() async {
    final ls = LocalStorage();
    final u = await ls.get<String>('username');
    if (u != null) {
      username.value = u;
      usernameController.text = u;
    }
    final e = await ls.get<String>('email');
    if (e != null) {
      email.value = e;
      emailController.text = e;
    }
    final recent = await ls.get<List>('recent_users');
    if (recent != null) {
      recentUsers.assignAll(recent.whereType<String>());
    }
    final avatars = await ls.get<Map>('recent_avatars');
    if (avatars != null) {
      recentAvatars.assignAll(avatars.map((k, v) => MapEntry(k.toString(), v.toString())));
    }
    
    final emails = await ls.get<Map>('recent_emails');
    if (emails != null) {
      final emailMap = emails.cast<String, String>();
      for (final handle in recentUsers) {
        final userEmail = emailMap[handle];
        if (userEmail != null && userEmail.isNotEmpty) {
          final existing = presetUsers.firstWhereOrNull((u) {
            final name = (u['username'] ?? u['handle'] ?? u['name'] ?? '').toString();
            return name == handle;
          });
          if (existing != null) {
            existing['email'] = userEmail;
          } else {
            presetUsers.add({
              'username': handle,
              'handle': handle,
              'email': userEmail,
            });
          }
        }
      }
    }
    
    updateLoginPreviewAvatar();
  }

  @override
  void onClose() {
    emailController.dispose();
    passwordController.dispose();
    confirmPasswordController.dispose();
    usernameController.dispose();
    displayNameController.dispose();
    baseUrlController.dispose();

    emailFocus.dispose();
    passwordFocus.dispose();
    confirmPasswordFocus.dispose();
    usernameFocus.dispose();
    displayNameFocus.dispose();
    baseUrlFocus.dispose();

    super.onClose();
  }

  @override
  void onReady() {
    super.onReady();
    final url = baseUrl.value.trim();
    if (url.isNotEmpty) {
      detectProtocol(url);
    }
  }

  void updateBaseUrl(String url) {
    if (baseUrl.value != url) {
      baseUrl.value = url;
    }
  }

  // Removed loadPresetUsers - no longer fetching user list from server for security reasons
  // User suggestions now come from local cache only (recent_users, recent_emails, recent_avatars)

  void switchTab(int i) {
    authTab.value = i;
    error.value = null;
  }

  Future<void> logout() async {
    // Clear Rx variables
    email.value = '';
    password.value = '';
    username.value = '';
    displayName.value = '';
    
    // Trigger unified logout through GlobalContext
    // This will clear session, tokens (via SecureStorage), and fire onLogoutRequested event
    try {
      if (Get.isRegistered<GlobalContext>()) {
        Get.find<GlobalContext>().requestLogout(LogoutReason.userInitiated);
      }
    } catch (_) {
      // Fallback: navigate directly if GlobalContext not available
      Get.offAllNamed('/login');
    }
  }

  Future<void> login([String? overrideBaseUrl]) async {
    loading.value = true;
    error.value = null;
    try {
      final useUrl = (overrideBaseUrl ?? baseUrl.value).trim();
      var ident = email.value.trim();
      if (!ident.contains('@') && ident.isNotEmpty) {
        ident = '$ident@station.local';
      }
      final uri = Uri.parse(
        useUrl.endsWith('/')
            ? '${useUrl}activitypub/login'
            : '$useUrl/activitypub/login',
      );
      final req = await HttpClient().postUrl(uri);
      req.headers.contentType = ContentType.json;
      req.write(json.encode({
        'email': ident,
        'password': password.value,
        'device_type': 'desktop', // For kick detection
      }));
      final resp = await req.close();
      final text = await resp.transform(const Utf8Decoder()).join();
      lastStatus.value = resp.statusCode;
      lastBody.value = text;
      LoggingService.info('Login resp ${resp.statusCode}: $text');
      if (resp.statusCode == 200) {
        final obj = json.decode(text);
        String token = '';
        String? actorIdFromResponse;  // Declare outside to use later
        String? sessionId;
        String? refreshToken;
        if (obj is Map) {
          final data = obj['data'];
          Map<String, dynamic>? dmap;
          if (data is Map) {
            dmap = data.cast<String, dynamic>();
          }
          final tokensMap = (dmap != null && dmap['tokens'] is Map)
              ? (dmap['tokens'] as Map).cast<String, dynamic>()
              : dmap;
          if (tokensMap != null) {
            token =
                tokensMap['token']?.toString() ??
                tokensMap['access_token']?.toString() ??
                tokensMap['accessToken']?.toString() ??
                '';
            refreshToken =
                tokensMap['refresh_token']?.toString() ??
                tokensMap['refreshToken']?.toString();
            // Token storage is handled by GlobalContext.setSession()
            // No direct LocalStorage operations here
          } else {
            token = obj['token']?.toString() ?? '';
          }
          
          // Extract session_id for kick detection
          sessionId = dmap?['session_id']?.toString() ?? obj['session_id']?.toString();
          if (sessionId != null && sessionId.isNotEmpty) {
            await _secureStorage.set(StorageKeys.sessionIdKey, sessionId);
            LoggingService.info('Session ID stored: ${sessionId.substring(0, 8)}...');
          }

          // Try to extract user info from response
          Map<String, dynamic>? userMap;
          if (dmap != null) {
            // Standard structure: data: { user: {...}, token: ... } or data: { ...user fields... }
            if (dmap['user'] is Map) {
              userMap = dmap['user'];
            } else if (dmap['actor'] is Map) {
              userMap = dmap['actor'];
            } else {
              // Assume data itself might contain user fields if not nested
              userMap = dmap;
            }
          } else if (obj['user'] is Map) {
            userMap = obj['user'];
          } else if (obj['actor'] is Map) {
            userMap = obj['actor'];
          }

          // Extract actor_id (DID) from response - this is the numeric ID used for P2P signaling
          if (userMap != null) {
            final name = userMap['username'] ?? userMap['handle'] ?? userMap['name'];
            if (name != null) username.value = name.toString();
            
            final mail = userMap['email'];
            if (mail != null) email.value = mail.toString();
            
            final disp = userMap['display_name'] ?? userMap['displayName'];
            if (disp != null) displayName.value = disp.toString();
            
            // Extract the numeric actor_id (DID) - critical for P2P signaling
            actorIdFromResponse = userMap['actor_id']?.toString() ?? 
                                  userMap['actorId']?.toString() ??
                                  userMap['id']?.toString();
            LoggingService.info('Extracted actor_id from login response: $actorIdFromResponse');
          }
                }

        if (token.isNotEmpty) {
          // Persist user info for UI (not token-related)
          await LocalStorage().set('username', username.value);
          await LocalStorage().set('email', email.value);
          
          try {
            if (Get.isRegistered<GlobalContext>()) {
              final gc = Get.find<GlobalContext>();
              final handle = username.value.isNotEmpty
                  ? username.value
                  : (email.value.isNotEmpty
                        ? email.value.split('@').first
                        : '');
              
              final avatarUrl = await _fetchAndSaveUserAvatar(handle, baseUrl: (overrideBaseUrl ?? baseUrl.value).trim());
              
              await _saveRecentUser(
                handle, 
                email: email.value.isNotEmpty ? email.value : null,
                avatarUrl: avatarUrl.isNotEmpty ? avatarUrl : null,
              );
              
              // Use numeric actor_id (DID) for actorId - critical for P2P signaling
              // Fall back to handle only if actor_id not in response
              final effectiveActorId = (actorIdFromResponse != null && actorIdFromResponse.isNotEmpty) 
                  ? actorIdFromResponse 
                  : handle;
              
              await gc.setSession({
                'actorId': effectiveActorId,
                'handle': handle,
                'email': email.value,
                'protocol': protocol.value,
                'baseUrl': (overrideBaseUrl ?? baseUrl.value).trim(),
                'accessToken': token,
                'refreshToken': refreshToken,
                'avatarUrl': avatarUrl,
                'sessionId': sessionId, // For kick detection
              });
              LoggingService.info('GlobalContext session updated for user: $handle, actorId: $effectiveActorId');
              
              await _saveUserToGlobalList(handle, email: email.value, avatarUrl: avatarUrl, serverUrl: (overrideBaseUrl ?? baseUrl.value).trim());
              
              await _switchToUser(handle);
            }
          } catch (_) {}
          Get.offAllNamed('/shell');
        } else {
          error.value = 'Invalid login response';
        }
      } else {
        error.value = 'Login failed (${resp.statusCode})';
      }
    } catch (e) {
      error.value = e.toString();
    }
    loading.value = false;
  }

  void updateLoginPreviewAvatar() async {
    final handle = _currentHandle();
    if (handle.isEmpty) {
      loginPreviewAvatar.value = null;
      return;
    }
    // Prefer recent avatars stored locally
    final local = recentAvatars[handle];
    if (local != null && local.isNotEmpty) {
      loginPreviewAvatar.value = local;
      return;
    }
    // Fallback to preset users list
    final found = presetUsers.firstWhereOrNull((u) {
      final name = (u['username'] ?? u['handle'] ?? u['name'] ?? '').toString();
      return name == handle;
    });
    if (found != null) {
      final url = (found['avatar'] ?? found['avatar_url'] ?? found['avatarUrl'] ?? '').toString();
      loginPreviewAvatar.value = url.isNotEmpty ? url : null;
      return;
    }
    loginPreviewAvatar.value = null;
  }

  String _currentHandle() {
    if (authTab.value == 1) {
      final h = username.value.trim();
      return h;
    }
    final ident = email.value.trim();
    if (ident.isEmpty) return '';
    if (ident.contains('@')) return ident.split('@').first;
    return ident;
  }

  Future<void> _saveRecentUser(String handle, {String? email, String? avatarUrl}) async {
    try {
      final ls = LocalStorage();
      
      final ru = (await ls.get<List>('recent_users'))?.whereType<String>().toList() ?? <String>[];
      if (!ru.contains(handle)) {
        ru.insert(0, handle);
      } else {
        ru.remove(handle);
        ru.insert(0, handle);
      }
      await ls.set('recent_users', ru);
      recentUsers.assignAll(ru);
      
      if (email != null && email.isNotEmpty) {
        final emailMap = (await ls.get<Map>('recent_emails'))?.cast<String, String>() ?? <String, String>{};
        emailMap[handle] = email;
        await ls.set('recent_emails', emailMap);
        
        final userObj = presetUsers.firstWhereOrNull((u) {
          final name = (u['username'] ?? u['handle'] ?? u['name'] ?? '').toString();
          return name == handle;
        });
        if (userObj != null) {
          userObj['email'] = email;
        } else {
          presetUsers.add({'username': handle, 'handle': handle, 'email': email});
        }
      }
      
      if (avatarUrl != null && avatarUrl.isNotEmpty) {
        final ram = (await ls.get<Map>('recent_avatars'))?.cast<String, String>() ?? <String, String>{};
        ram[handle] = avatarUrl;
        await ls.set('recent_avatars', ram);
        recentAvatars[handle] = avatarUrl;
        loginPreviewAvatar.value = avatarUrl;
      }
    } catch (e) {
      LoggingService.error('Failed to save recent user: $e');
    }
  }
  
  Future<String> _fetchAndSaveUserAvatar(String handle, {required String baseUrl}) async {
    try {
      final uri = Uri.parse(baseUrl.endsWith('/')
          ? '${baseUrl}activitypub/$handle/profile'
          : '$baseUrl/activitypub/$handle/profile');
      final resp = await (await HttpClient().getUrl(uri)).close();
      if (resp.statusCode == 200) {
        final text = await resp.transform(const Utf8Decoder()).join();
        final obj = json.decode(text);
        Map<String, dynamic>? data;
        if (obj is Map) {
          data = (obj['data'] is Map) ? (obj['data'] as Map).cast<String, dynamic>() : obj.cast<String, dynamic>();
        }
        String url = '';
        if (data != null) {
          url = (data['avatar'] ?? data['avatar_url'] ?? data['avatarUrl'] ?? '').toString();
        }
        
        if (url.isNotEmpty) {
          await _saveRecentUser(handle, avatarUrl: url);
          return url;
        }
      }
    } catch (_) {}
    return '';
  }

  Future<void> signup([String? overrideBaseUrl]) async {
    loading.value = true;
    error.value = null;
    try {
      if (!_validateSignupInputs()) {
        final context = Get.context;
        error.value = context != null
            ? AppLocalizations.of(context)!.signupValidationErrorMessage
            : 'Please fill in all information, and passwords must match and be at least 8 characters.';
        lastStatus.value = null;
        lastBody.value = null;
        loading.value = false;
        return;
      }
      final useUrl = (overrideBaseUrl ?? baseUrl.value).trim();
      final uri = Uri.parse(
        useUrl.endsWith('/')
            ? '${useUrl}activitypub/sign-up'
            : '$useUrl/activitypub/sign-up',
      );
      final req = await HttpClient().postUrl(uri);
      req.headers.contentType = ContentType.json;
      req.write(
        json.encode({
          'name': username.value,
          'email': email.value,
          'password': password.value,
        }),
      );
      final resp = await req.close();
      final text = await resp.transform(const Utf8Decoder()).join();
      lastStatus.value = resp.statusCode;
      lastBody.value = text;
      LoggingService.info('Signup resp ${resp.statusCode}: $text');
      if (resp.statusCode == 200) {
        await login(useUrl);
      } else {
        error.value = 'Signup failed';
      }
    } catch (e) {
      error.value = e.toString();
    }
    loading.value = false;
  }

  bool _validateSignupInputs() {
    final nameOk = username.value.trim().isNotEmpty;
    final emailText = email.value.trim();
    final emailOk =
        emailText.isNotEmpty &&
        RegExp(r'^[^\s@]+@[^\s@]+\.[^\s@]+$').hasMatch(emailText);
    final pwd = password.value.trim();
    final pwdOk = pwd.length >= 8;
    final confirmOk = pwd == confirmPassword.value.trim();
    return nameOk && emailOk && pwdOk && confirmOk;
  }

  Future<void> detectProtocol(String baseUrl) async {
    try {
      final url = baseUrl.trim();
      serverStatus.value = ServerStatus.checking;
      if (url.isEmpty) {
        protocol.value = 'peers-touch';
        serverStatus.value = ServerStatus.unknown;
        try {
          if (Get.isRegistered<GlobalContext>()) {
            await Get.find<GlobalContext>().setProtocolTag(protocol.value);
          }
        } catch (_) {}
        return;
      }
      final uri = Uri.parse(
        url.endsWith('/') ? '${url}api/v1/instance' : '$url/api/v1/instance',
      );
      final resp = await (await HttpClient().getUrl(uri)).close();
      final text = await resp.transform(const Utf8Decoder()).join();
      lastStatus.value = resp.statusCode;
      lastBody.value = text;
      if (resp.statusCode == 200) {
        serverStatus.value = ServerStatus.reachable;
        String ver = '';
        String title = '';
        try {
          final obj = json.decode(text);
          if (obj is Map) {
            ver = obj['version']?.toString() ?? '';
            title = obj['title']?.toString() ?? '';
          }
        } catch (_) {}
        final lowVer = ver.toLowerCase();
        final lowTitle = title.toLowerCase();
        if (lowVer.contains('peerstouch') || lowTitle.contains('peers touch')) {
          protocol.value = 'peers-touch';
        } else if (lowVer.contains('mastodon') ||
            lowTitle.contains('mastodon') ||
            ver.isNotEmpty ||
            title.isNotEmpty) {
          protocol.value = 'mastodon';
        } else {
          protocol.value = 'other activitypub';
        }
        try {
          if (Get.isRegistered<GlobalContext>()) {
            await Get.find<GlobalContext>().setProtocolTag(protocol.value);
          }
        } catch (_) {}
      } else {
        protocol.value = 'peers-touch';
        serverStatus.value = ServerStatus.unknown;
        try {
          if (Get.isRegistered<GlobalContext>()) {
            await Get.find<GlobalContext>().setProtocolTag(protocol.value);
          }
        } catch (_) {}
      }
    } catch (_) {
      protocol.value = 'peers-touch';
      serverStatus.value = ServerStatus.unknown;
      try {
        if (Get.isRegistered<GlobalContext>()) {
          await Get.find<GlobalContext>().setProtocolTag(protocol.value);
        }
      } catch (_) {}
    }
  }

  Future<void> _saveUserToGlobalList(String handle, {String? email, String? avatarUrl, required String serverUrl}) async {
    try {
      await GlobalUsersStorage().saveUser(
        handle: handle,
        email: email,
        avatarUrl: avatarUrl,
        serverUrl: serverUrl,
      );
      LoggingService.info('User saved to global list: $handle');
    } catch (e) {
      LoggingService.error('Failed to save user to global list: $e');
    }
  }

  Future<void> _switchToUser(String handle) async {
    try {
      final currentUser = await ConfigDatabase().getCurrentUser();
      
      if (currentUser == handle) {
        LoggingService.info('Same user login, no need to switch context');
        return;
      }
      
      await ConfigDatabase().setCurrentUser(handle);
      LoggingService.info('Set current user: $handle');
      
      KvDatabase.setUserHandle(handle);
      SecureStorageImpl.setUserHandle(handle);
      LoggingService.info('Switched user context to: $handle');
    } catch (e) {
      LoggingService.error('Failed to switch user: $e');
    }
  }

  Future<void> clearAllCache() async {
    try {
      final ls = LocalStorage();
      
      // Clear UI-related cache (not token-related)
      await ls.remove('username');
      await ls.remove('email');
      await ls.remove('recent_users');
      await ls.remove('recent_emails');
      await ls.remove('recent_avatars');
      
      // Clear session through GlobalContext (handles token cleanup)
      if (Get.isRegistered<GlobalContext>()) {
        await Get.find<GlobalContext>().setSession(null);
      }
      
      recentUsers.clear();
      recentAvatars.clear();
      presetUsers.clear();
      loginPreviewAvatar.value = null;
      
      username.value = '';
      email.value = '';
      usernameController.clear();
      emailController.clear();
      
      LoggingService.info('All cache cleared successfully');
    } catch (e) {
      LoggingService.error('Failed to clear cache: $e');
      rethrow;
    }
  }
}
