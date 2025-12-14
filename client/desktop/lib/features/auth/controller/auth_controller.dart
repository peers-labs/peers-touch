import 'dart:convert';
import 'dart:io';
import 'package:get/get.dart';
import 'package:get_storage/get_storage.dart';
import 'package:peers_touch_desktop/core/network/network_initializer.dart';
import 'package:peers_touch_desktop/core/services/logging_service.dart';
import 'package:peers_touch_desktop/core/network/api_client.dart';

import 'package:peers_touch_base/i18n/generated/app_localizations.dart';

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

  @override
  void onInit() {
    super.onInit();
    debounce(baseUrl, (String url) {
      final trimmed = url.trim();
      if (trimmed.isNotEmpty) {
        GetStorage().write('base_url', trimmed);
        NetworkInitializer.initialize(baseUrl: trimmed);
        try {
          Get.find<ApiClient>().setBaseUrl(trimmed);
        } catch (_) {}
        detectProtocol(trimmed);
        loadPresetUsers(trimmed);
      }
    }, time: const Duration(milliseconds: 800));

    // Restore user info from storage
    final box = GetStorage();
    if (box.hasData('username')) username.value = box.read('username') ?? '';
    if (box.hasData('email')) email.value = box.read('email') ?? '';
  }

  @override
  void onReady() {
    super.onReady();
    final url = baseUrl.value.trim();
    if (url.isNotEmpty) {
      try {
        Get.find<ApiClient>().setBaseUrl(url);
      } catch (_) {}
      loadPresetUsers(url);
      detectProtocol(url);
    }
  }

  void updateBaseUrl(String url) {
    baseUrl.value = url;
  }

  Future<void> loadPresetUsers(String baseUrl) async {
    try {
      final uri = Uri.parse(
        baseUrl.endsWith('/') ? '${baseUrl}actor/list' : '$baseUrl/actor/list',
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
        ident = ident + '@station.local';
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
            if (refresh != null && refresh.isNotEmpty)
              GetStorage().write('refresh_token', refresh);
            if (ttype != null && ttype.isNotEmpty)
              GetStorage().write('auth_token_type', ttype);
          } else {
            token = obj['token']?.toString() ?? '';
          }

          // Try to extract user info from response
          if (obj is Map) {
            final data = obj['data'];
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
        }
        if (token.isNotEmpty) {
          GetStorage().write('auth_token', token);
          // Persist user info
          GetStorage().write('username', username.value);
          GetStorage().write('email', email.value);
          
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
            ? '${useUrl}actor/sign-up'
            : '$useUrl/actor/sign-up',
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
    // displayName is optional for backend currently but required for UI
    final dispOk = displayName.value.trim().isNotEmpty;
    final emailText = email.value.trim();
    final emailOk =
        emailText.isNotEmpty &&
        RegExp(r"^[^\s@]+@[^\s@]+\.[^\s@]+$").hasMatch(emailText);
    final pwd = password.value.trim();
    final pwdOk = pwd.length >= 8;
    final confirmOk = pwd == confirmPassword.value.trim();
    return nameOk && dispOk && emailOk && pwdOk && confirmOk;
  }

  Future<void> detectProtocol(String baseUrl) async {
    try {
      final url = baseUrl.trim();
      if (url.isEmpty) {
        protocol.value = 'peers-touch';
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
      } else {
        protocol.value = 'other activitypub';
      }
    } catch (_) {
      protocol.value = 'other activitypub';
    }
  }
}
