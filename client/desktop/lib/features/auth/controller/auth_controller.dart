import 'dart:convert';
import 'dart:io';
import 'package:get/get.dart';
import 'package:get_storage/get_storage.dart';
import 'package:peers_touch_desktop/core/network/network_initializer.dart';
import 'package:peers_touch_desktop/core/services/logging_service.dart';

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

  @override
  void onReady() {
    super.onReady();
    loadPresetUsers(baseUrl.value);
  }

  Future<void> loadPresetUsers(String baseUrl) async {
    try {
      final uri = Uri.parse(baseUrl.endsWith('/') ? '${baseUrl}actor/list' : '$baseUrl/actor/list');
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
        presetUsers.assignAll(list.whereType<Map>().map((e) => e.map((k, v) => MapEntry(k.toString(), v))).toList());
        lastStatus.value = resp.statusCode;
        lastBody.value = text;
        LoggingService.info('Loaded preset users (${list.length}) from $baseUrl');
      }
    } catch (_) {}
  }

  void updateBaseUrl(String url) {
    baseUrl.value = url.trim();
    if (baseUrl.isEmpty) return;
    GetStorage().write('base_url', baseUrl.value);
    NetworkInitializer.initialize(baseUrl: baseUrl.value);
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
      final uri = Uri.parse(useUrl.endsWith('/') ? '${useUrl}activitypub/login' : '$useUrl/activitypub/login');
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
          final tokensMap = (dmap != null && dmap['tokens'] is Map) ? (dmap['tokens'] as Map).cast<String, dynamic>() : dmap;
          if (tokensMap != null) {
            token = tokensMap['token']?.toString() ??
                tokensMap['access_token']?.toString() ??
                tokensMap['accessToken']?.toString() ?? '';
            final refresh = tokensMap['refresh_token']?.toString() ?? tokensMap['refreshToken']?.toString();
            final ttype = tokensMap['token_type']?.toString() ?? tokensMap['tokenType']?.toString();
            if (refresh != null && refresh.isNotEmpty) GetStorage().write('refresh_token', refresh);
            if (ttype != null && ttype.isNotEmpty) GetStorage().write('auth_token_type', ttype);
          } else {
            token = obj['token']?.toString() ?? '';
          }
        }
        if (token.isNotEmpty) {
          GetStorage().write('auth_token', token);
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
      final uri = Uri.parse(useUrl.endsWith('/') ? '${useUrl}actor/sign-up' : '$useUrl/actor/sign-up');
      final req = await HttpClient().postUrl(uri);
      req.headers.contentType = ContentType.json;
      req.write(json.encode({'name': username.value, 'email': email.value, 'password': password.value}));
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
    final emailOk = emailText.isNotEmpty && RegExp(r"^[^\s@]+@[^\s@]+\.[^\s@]+$").hasMatch(emailText);
    final pwd = password.value.trim();
    final pwdOk = pwd.length >= 8;
    final confirmOk = pwd == confirmPassword.value.trim();
    return nameOk && dispOk && emailOk && pwdOk && confirmOk;
  }
}
