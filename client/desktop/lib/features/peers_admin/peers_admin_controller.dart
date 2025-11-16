import 'package:flutter/widgets.dart';
import 'package:get/get.dart';
import 'package:dio/dio.dart' as dio;
import 'package:peers_touch_desktop/core/network/api_client.dart';
import 'package:peers_touch_desktop/core/storage/local_storage.dart';
import 'package:peers_touch_desktop/core/storage/secure_storage.dart';
import 'package:peers_touch_desktop/core/constants/storage_keys.dart';
import 'package:peers_touch_desktop/features/shell/controller/shell_controller.dart';

/// PeersAdmin 控制器：负责读取后端地址、执行管理与 Peer 相关请求
class PeersAdminController extends GetxController {
  final ApiClient apiClient;
  final LocalStorage localStorage;
  final SecureStorage secureStorage;

  PeersAdminController({
    required this.apiClient,
    required this.localStorage,
    required this.secureStorage,
  });

  // 后端地址（从设置中读取）
  final backendUrl = ''.obs;

  // 最近一次结果或错误
  final lastResponse = Rxn<Map<String, dynamic>>();
  final lastError = RxnString();
  final isLoading = false.obs;
  // 当前左侧选择的功能分区（遵循 ShellThreePane 的左栏）
  final currentSection = 'management'.obs;

  @override
  void onInit() {
    super.onInit();
    _syncSettingsToRuntime();
  }

  /// 切换当前分区
  void setSection(String id) {
    currentSection.value = id;
  }

  /// 注入右侧扩展页（暂为空白页）
  void openBlankExtension() {
    try {
      final shell = Get.find<ShellController>();
      shell.openRightPanelWithOptions(
        (ctx) => const SizedBox.shrink(),
        width: 420,
        showCollapseButton: true,
        clearCenter: false,
        collapsedByDefault: false,
      );
    } catch (_) {}
  }

  /// 从设置读取 backend_url 和 auth_token，并同步到运行时（包括拦截器读取的 token_key）
  Future<void> _syncSettingsToRuntime() async {
    // 后端地址存储键：settings:global_business:backend_url
    final url = localStorage.get<String>('settings:global_business:backend_url') ?? '';
    backendUrl.value = _normalizeBaseUrl(url);

    // 令牌：settings:global_business:auth_token（敏感，存 SecureStorage）
    try {
      final authToken = await secureStorage.get('settings:global_business:auth_token');
      if (authToken != null && authToken.isNotEmpty) {
        await secureStorage.set(StorageKeys.tokenKey, authToken);
      }
    } catch (_) {
      // ignore
    }
  }

  String _normalizeBaseUrl(String input) {
    var v = input.trim();
    if (v.isEmpty) return v;
    // 移除尾部斜杠，避免拼接出现双斜杠
    while (v.endsWith('/')) {
      v = v.substring(0, v.length - 1);
    }
    return v;
  }

  String _buildUrl(String family, String path) {
    final base = backendUrl.value;
    if (base.isEmpty) return '';
    return '$base/$family$path';
  }

  // ---------------- 管理端点 ----------------
  Future<void> healthCheck() async {
    await _get(_buildUrl('management', '/health'));
  }

  Future<void> ping() async {
    await _get(_buildUrl('management', '/ping'));
  }

  // ---------------- Peer 端点 ----------------
  Future<void> getMyPeerInfo() async {
    await _get(_buildUrl('peer', '/get-my-peer-info'));
  }

  Future<void> setPeerAddr({required String peerId, required String addr, required String typ}) async {
    final url = _buildUrl('peer', '/set-addr');
    await _post(url, data: {
      'peer_id': peerId,
      'addr': addr,
      'typ': typ,
    });
  }

  Future<void> touchHiTo({required String peerAddress}) async {
    final url = _buildUrl('peer', '/touch-hi-to');
    await _post(url, data: {
      'peer_address': peerAddress,
    });
  }

  // ---------------- 网络调用封装 ----------------
  Future<void> _get(String url, {Map<String, dynamic>? queryParameters}) async {
    if (url.isEmpty) {
      lastError.value = '后端地址未配置';
      return;
    }
    isLoading.value = true;
    lastError.value = null;
    lastResponse.value = null;
    try {
      // ApiClient.get uses named parameter `query` for query string
      final resp = await apiClient.get<Map<String, dynamic>>(url, query: queryParameters);
      lastResponse.value = _wrapResponse(resp);
    } on dio.DioException catch (e) {
      lastError.value = e.message ?? '请求失败';
    } catch (e) {
      lastError.value = e.toString();
    } finally {
      isLoading.value = false;
    }
  }

  Future<void> _post(String url, {dynamic data}) async {
    if (url.isEmpty) {
      lastError.value = '后端地址未配置';
      return;
    }
    isLoading.value = true;
    lastError.value = null;
    lastResponse.value = null;
    try {
      final resp = await apiClient.post<Map<String, dynamic>>(url, data: data);
      lastResponse.value = _wrapResponse(resp);
    } on dio.DioException catch (e) {
      lastError.value = e.message ?? '请求失败';
    } catch (e) {
      lastError.value = e.toString();
    } finally {
      isLoading.value = false;
    }
  }

  Map<String, dynamic> _wrapResponse(dio.Response<Map<String, dynamic>> resp) {
    final data = resp.data ?? <String, dynamic>{};
    return {
      'status': resp.statusCode ?? 0,
      'data': data,
    };
  }

  // ---------------- ActivityPub 端点 ----------------
  Future<void> getApActor({required String username}) async {
    await _get(_buildUrl('activitypub', '/$username/actor'));
  }

  Future<void> getApInbox({required String username}) async {
    await _get(_buildUrl('activitypub', '/$username/inbox'));
  }

  Future<void> postApInbox({required String username, String? activity}) async {
    await _post(_buildUrl('activitypub', '/$username/inbox'), data: {
      if (activity != null && activity.isNotEmpty) 'activity': activity,
    });
  }

  Future<void> getApOutbox({required String username}) async {
    await _get(_buildUrl('activitypub', '/$username/outbox'));
  }

  Future<void> postApOutbox({required String username, String? activity}) async {
    await _post(_buildUrl('activitypub', '/$username/outbox'), data: {
      if (activity != null && activity.isNotEmpty) 'activity': activity,
    });
  }

  Future<void> getApFollowers({required String username}) async {
    await _get(_buildUrl('activitypub', '/$username/followers'));
  }

  Future<void> getApFollowing({required String username}) async {
    await _get(_buildUrl('activitypub', '/$username/following'));
  }

  Future<void> getApLiked({required String username}) async {
    await _get(_buildUrl('activitypub', '/$username/liked'));
  }

  Future<void> postApFollow({required String username, required String target}) async {
    await _post(_buildUrl('activitypub', '/$username/follow'), data: {
      'target': target,
    });
  }

  Future<void> postApUnfollow({required String username, required String target}) async {
    await _post(_buildUrl('activitypub', '/$username/unfollow'), data: {
      'target': target,
    });
  }

  Future<void> postApLike({required String username, required String objectId}) async {
    await _post(_buildUrl('activitypub', '/$username/like'), data: {
      'object_id': objectId,
    });
  }

  Future<void> postApUndo({required String username, required String activityId}) async {
    await _post(_buildUrl('activitypub', '/$username/undo'), data: {
      'activity_id': activityId,
    });
  }

  Future<void> postApChat({required String username, required String message}) async {
    await _post(_buildUrl('activitypub', '/$username/chat'), data: {
      'message': message,
    });
  }

  // ---------------- Well-Known / WebFinger 端点 ----------------
  Future<void> callWellKnownHello() async {
    await _post(_buildUrl('.well-known', '/'));
  }

  Future<void> webfinger({required String resource, String? activityPubVersion, List<String>? rels}) async {
    final qp = <String, dynamic>{
      'resource': resource,
      if (activityPubVersion != null && activityPubVersion.isNotEmpty) 'activity_pub_version': activityPubVersion,
    };
    if (rels != null && rels.isNotEmpty) {
      // Server supports comma-separated rels
      qp['rel'] = rels.join(',');
    }
    await _get(_buildUrl('.well-known', '/webfinger'), queryParameters: qp);
  }

  // ---------------- Actor 端点 ----------------
  Future<void> actorSignUp({required String name, required String email, required String password}) async {
    await _post(_buildUrl('actor', '/sign-up'), data: {
      'name': name,
      'email': email,
      'password': password,
    });
  }

  Future<void> actorLogin({required String email, required String password}) async {
    await _post(_buildUrl('actor', '/login'), data: {
      'email': email,
      'password': password,
    });
  }

  Future<void> getActorProfile() async {
    await _get(_buildUrl('actor', '/profile'));
  }

  Future<void> updateActorProfile({String? profilePhoto, String? gender, String? region, String? email, String? whatsUp}) async {
    await _post(_buildUrl('actor', '/profile'), data: {
      if (profilePhoto != null && profilePhoto.isNotEmpty) 'profile_photo': profilePhoto,
      if (gender != null && gender.isNotEmpty) 'gender': gender,
      if (region != null && region.isNotEmpty) 'region': region,
      if (email != null && email.isNotEmpty) 'email': email,
      if (whatsUp != null && whatsUp.isNotEmpty) 'whats_up': whatsUp,
    });
  }
}