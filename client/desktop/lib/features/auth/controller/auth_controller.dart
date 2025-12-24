import 'dart:convert';
import 'dart:io';

import 'package:flutter/widgets.dart';
import 'package:get/get.dart';
import 'package:peers_touch_base/context/global_context.dart';
import 'package:peers_touch_base/i18n/generated/app_localizations.dart';
import 'package:peers_touch_base/storage/local_storage.dart';
import 'package:peers_touch_base/storage/secure_storage_adapter.dart';
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
  final baseUrl = NetworkInitializer.currentBaseUrl.obs;
  final lastStatus = RxnInt();
  final lastBody = RxnString();
  final authTab = 0.obs; // 0: login, 1: signup
  final protocol = 'peers-touch'.obs;
  final serverStatus = ServerStatus.unknown.obs;
  late final SecureStorageAdapter _secureStorage;

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

  @override
  void onInit() {
    super.onInit();
    _secureStorage = Get.find<SecureStorageAdapter>();
    
    // Initialize controllers
    emailController = TextEditingController();
    passwordController = TextEditingController();
    confirmPasswordController = TextEditingController();
    usernameController = TextEditingController();
    displayNameController = TextEditingController();
    baseUrlController = TextEditingController();

    // Initialize focus nodes
    emailFocus = FocusNode();
    passwordFocus = FocusNode();
    confirmPasswordFocus = FocusNode();
    usernameFocus = FocusNode();
    displayNameFocus = FocusNode();
    baseUrlFocus = FocusNode();

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
        NetworkInitializer.updateBaseUrl(trimmed);
        detectProtocol(trimmed);
        loadPresetUsers(trimmed);
      }
    }, time: const Duration(milliseconds: 800));

    // Restore user info from storage
    _restoreUserInfo();
    
    // Sync baseUrl
    baseUrlController.text = baseUrl.value;
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
      loadPresetUsers(url);
      detectProtocol(url);
    }
  }

  void updateBaseUrl(String url) {
    if (baseUrl.value != url) {
      baseUrl.value = url;
    }
  }

  Future<void> loadPresetUsers(String baseUrl) async {
    try {
      final uri = Uri.parse(
        baseUrl.endsWith('/') ? '${baseUrl}activitypub/list' : '$baseUrl/activitypub/list',
      );
      final resp = await (await HttpClient().getUrl(uri)).close();
      if (resp.statusCode == 200) {
        final text = await resp.transform(const Utf8Decoder()).join();
        final obj = json.decode(text);
        List list = [];
        if (obj is Map) {
          final data = obj['data'];
          if (data is List) {
            list = data;
          } else if (data is Map && data['items'] is List) {
            list = data['items'] as List;
          }
        }
        presetUsers.assignAll(
          list
              .whereType<Map>()
              .map((e) => e.map((k, v) => MapEntry(k.toString(), v)))
              .toList(),
        );
        lastStatus.value = resp.statusCode;
        lastBody.value = text;
        LoggingService.info(
          'Loaded preset users (${list.length}) from $baseUrl',
        );
      }
    } catch (_) {}
  }

  void switchTab(int i) {
    authTab.value = i;
    error.value = null;
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
      req.write(json.encode({'email': ident, 'password': password.value}));
      final resp = await req.close();
      final text = await resp.transform(const Utf8Decoder()).join();
      lastStatus.value = resp.statusCode;
      lastBody.value = text;
      LoggingService.info('Login resp ${resp.statusCode}: $text');
      if (resp.statusCode == 200) {
        final obj = json.decode(text);
        String token = '';
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
            final refresh =
                tokensMap['refresh_token']?.toString() ??
                tokensMap['refreshToken']?.toString();
            final ttype =
                tokensMap['token_type']?.toString() ??
                tokensMap['tokenType']?.toString();
            if (refresh != null && refresh.isNotEmpty) {
              await LocalStorage().set('refresh_token', refresh);
              try {
                await _secureStorage.set(StorageKeys.refreshTokenKey, refresh);
              } catch (_) {}
            }
            if (ttype != null && ttype.isNotEmpty) {
              await LocalStorage().set('auth_token_type', ttype);
            }
          } else {
            token = obj['token']?.toString() ?? '';
          }

          // Try to extract user info from response
          Map<String, dynamic>? userMap;
          if (data is Map) {
            // Standard structure: data: { user: {...}, token: ... } or data: { ...user fields... }
            if (data['user'] is Map) {
              userMap = data['user'];
            } else if (data['actor'] is Map) {
              userMap = data['actor'];
            } else {
              // Assume data itself might contain user fields if not nested
              userMap = data as Map<String, dynamic>;
            }
          } else if (obj['user'] is Map) {
            userMap = obj['user'];
          } else if (obj['actor'] is Map) {
            userMap = obj['actor'];
          }

          if (userMap != null) {
            final name = userMap['username'] ?? userMap['handle'] ?? userMap['name'];
            if (name != null) username.value = name.toString();
            
            final mail = userMap['email'];
            if (mail != null) email.value = mail.toString();
            
            final disp = userMap['display_name'] ?? userMap['displayName'];
            if (disp != null) displayName.value = disp.toString();
          }
                }

        if (token.isNotEmpty) {
          await LocalStorage().set('auth_token', token);
          try {
            await _secureStorage.set(StorageKeys.tokenKey, token);
            LoggingService.info('Token stored in SecureStorage');
          } catch (e) {
            LoggingService.warning('SecureStorage write failed: $e');
          }
          
          // Persist user info
          await LocalStorage().set('username', username.value);
          await LocalStorage().set('email', email.value);
          
          try {
            if (Get.isRegistered<GlobalContext>()) {
              final refresh = await LocalStorage().get<String>('refresh_token');
              final gc = Get.find<GlobalContext>();
              final handle = username.value.isNotEmpty
                  ? username.value
                  : (email.value.isNotEmpty
                        ? email.value.split('@').first
                        : '');
              await gc.setSession({
                'actorId': handle,
                'handle': handle,
                'protocol': protocol.value,
                'baseUrl': (overrideBaseUrl ?? baseUrl.value).trim(),
                'accessToken': token,
                'refreshToken': refresh,
              });
              LoggingService.info('GlobalContext session updated for user: $handle');
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

  Future<void> logout() async {
    loading.value = true;
    try {
      // 1. Clear GlobalContext
      try {
        if (Get.isRegistered<GlobalContext>()) {
          final gc = Get.find<GlobalContext>();
          await gc.setSession(null);
        }
      } catch (_) {}

      // 2. Clear LocalStorage
      final ls = LocalStorage();
      await ls.remove('auth_token');
      await ls.remove('refresh_token');
      await ls.remove('auth_token_type');
      await ls.remove('username');
      await ls.remove('email');
      
      // 3. Clear SecureStorage
      try {
        await _secureStorage.remove(StorageKeys.tokenKey);
        await _secureStorage.remove(StorageKeys.refreshTokenKey);
      } catch (_) {}

      // 4. Reset Controller State
      username.value = '';
      email.value = '';
      displayName.value = '';
      password.value = '';
      confirmPassword.value = '';
      usernameController.clear();
      emailController.clear();
      passwordController.clear();
      confirmPasswordController.clear();
      displayNameController.clear();
      
      // 5. Navigate to Login
      Get.offAllNamed('/login');
    } catch (e) {
      error.value = e.toString();
    } finally {
      loading.value = false;
    }
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
      } else if (resp.statusCode == 404) {
        protocol.value = 'peers-touch';
        serverStatus.value = ServerStatus.notFound;
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
    } on SocketException {
      protocol.value = 'peers-touch';
      serverStatus.value = ServerStatus.unreachable;
      try {
        if (Get.isRegistered<GlobalContext>()) {
          await Get.find<GlobalContext>().setProtocolTag(protocol.value);
        }
      } catch (_) {}
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
}
