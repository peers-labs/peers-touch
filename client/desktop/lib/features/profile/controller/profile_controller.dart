import 'package:get/get.dart';
import 'package:peers_touch_desktop/core/models/actor_base.dart';
import 'package:peers_touch_desktop/features/profile/model/user_detail.dart';
import 'package:peers_touch_desktop/core/storage/local_storage.dart';
import 'package:get_storage/get_storage.dart';
import 'package:peers_touch_desktop/core/network/api_client.dart';
import 'package:peers_touch_desktop/features/auth/controller/auth_controller.dart';

class ProfileController extends GetxController {
  final Rx<ActorBase?> user = Rx<ActorBase?>(null);
  final Rx<UserDetail?> detail = Rx<UserDetail?>(null);
  final RxBool following = false.obs;

  @override
  void onInit() {
    super.onInit();
    // Initialize with mock data for immediate display, will be updated by fetchProfile
    user.value = ActorBase(id: '1', name: 'Alice', avatar: null);
    detail.value = const UserDetail(
      id: '1',
      displayName: 'Alice',
      handle: 'alice',
      summary: '去中心化爱好者，关注隐私与联邦社交。',
      region: 'Shenzhen, CN',
      timezone: 'Asia/Shanghai',
      tags: ['privacy', 'federation', 'open-source'],
      links: [UserLink(label: 'Website', url: 'https://alice.example')],
      followersCount: 128,
      followingCount: 56,
      showCounts: true,
      moments: [
        'https://picsum.photos/seed/a/80/80',
        'https://picsum.photos/seed/b/80/80',
        'https://picsum.photos/seed/c/80/80',
        'https://picsum.photos/seed/d/80/80',
      ],
      defaultVisibility: 'public',
      manuallyApprovesFollowers: true,
      messagePermission: 'mutual',
      actorUrl: 'peers://alice@node.local',
      serverDomain: 'node.local',
      keyFingerprint: 'E3:9A:7B:...:12',
      verifications: ['self', 'peer'],
      peersTouch: PeersTouchInfo(networkId: 'pt-mock-id-12345'),
    );
    
    // Fetch real data
    fetchProfile();
  }

  Future<void> fetchProfile() async {
    try {
      final auth = Get.find<AuthController>();
      // Use authenticated user's username if available, or fallback to 'alice' for dev/demo
      final username = auth.username.value.isNotEmpty ? auth.username.value : 'alice';
      
      final client = Get.find<ApiClient>();
      // Using /activitypub prefix as the router is mounted under this name
      final response = await client.get('/activitypub/$username/profile');
      
      if (response.statusCode == 200 && response.data != null) {
        detail.value = UserDetail.fromJson(response.data);
      }
    } catch (e) {
      // Log error but keep mock data if fetch fails
      print('Failed to fetch profile: $e');
    }
  }

  void toggleFollowing() => following.value = !following.value;

  void setDefaultVisibility(String v) {
    final d = detail.value;
    if (d != null) {
      detail.value = UserDetail(
        id: d.id,
        displayName: d.displayName,
        handle: d.handle,
        summary: d.summary,
        avatarUrl: d.avatarUrl,
        coverUrl: d.coverUrl,
        region: d.region,
        timezone: d.timezone,
        tags: d.tags,
        links: d.links,
        actorUrl: d.actorUrl,
        serverDomain: d.serverDomain,
        keyFingerprint: d.keyFingerprint,
        verifications: d.verifications,
        followersCount: d.followersCount,
        followingCount: d.followingCount,
        showCounts: d.showCounts,
        moments: d.moments,
        defaultVisibility: v,
        manuallyApprovesFollowers: d.manuallyApprovesFollowers,
        messagePermission: d.messagePermission,
        autoExpireDays: d.autoExpireDays,
      );
    }
  }

  void setManuallyApprovesFollowers(bool value) {
    final d = detail.value;
    if (d != null) {
      detail.value = UserDetail(
        id: d.id,
        displayName: d.displayName,
        handle: d.handle,
        summary: d.summary,
        avatarUrl: d.avatarUrl,
        coverUrl: d.coverUrl,
        region: d.region,
        timezone: d.timezone,
        tags: d.tags,
        links: d.links,
        actorUrl: d.actorUrl,
        serverDomain: d.serverDomain,
        keyFingerprint: d.keyFingerprint,
        verifications: d.verifications,
        followersCount: d.followersCount,
        followingCount: d.followingCount,
        showCounts: d.showCounts,
        moments: d.moments,
        defaultVisibility: d.defaultVisibility,
        manuallyApprovesFollowers: value,
        messagePermission: d.messagePermission,
        autoExpireDays: d.autoExpireDays,
      );
    }
  }

  void setMessagePermission(String value) {
    final d = detail.value;
    if (d != null) {
      detail.value = UserDetail(
        id: d.id,
        displayName: d.displayName,
        handle: d.handle,
        summary: d.summary,
        avatarUrl: d.avatarUrl,
        coverUrl: d.coverUrl,
        region: d.region,
        timezone: d.timezone,
        tags: d.tags,
        links: d.links,
        actorUrl: d.actorUrl,
        serverDomain: d.serverDomain,
        keyFingerprint: d.keyFingerprint,
        verifications: d.verifications,
        followersCount: d.followersCount,
        followingCount: d.followingCount,
        showCounts: d.showCounts,
        moments: d.moments,
        defaultVisibility: d.defaultVisibility,
        manuallyApprovesFollowers: d.manuallyApprovesFollowers,
        messagePermission: value,
        autoExpireDays: d.autoExpireDays,
      );
    }
  }

  Future<void> logout() async {
    try {
      await LocalStorage().remove('auth_token');
      await LocalStorage().remove('refresh_token');
      await LocalStorage().remove('auth_token_type');
      await GetStorage().remove('auth_token');
      await GetStorage().remove('refresh_token');
      await GetStorage().remove('auth_token_type');
    } catch (_) {}
    Get.offAllNamed('/login');
  }
}
