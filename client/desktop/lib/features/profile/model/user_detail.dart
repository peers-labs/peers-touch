import 'package:peers_touch_base/model/domain/actor/actor.pb.dart' as pb;

class UserLink {
  const UserLink({required this.label, required this.url});

  factory UserLink.fromJson(Map<String, dynamic> json) =>
      UserLink(label: (json['label'] as String?) ?? '', url: (json['url'] as String?) ?? '');
  
  factory UserLink.fromPb(pb.UserLink link) =>
      UserLink(label: link.label, url: link.url);
  final String label;
  final String url;

  Map<String, dynamic> toJson() => {
        'label': label,
        'url': url,
      };
}

class PeersTouchInfo {
  const PeersTouchInfo({required this.networkId});

  factory PeersTouchInfo.fromJson(Map<String, dynamic> json) => PeersTouchInfo(
        networkId: (json['network_id'] as String?) ?? '',
      );
  
  factory PeersTouchInfo.fromPb(pb.PeersTouchInfo info) =>
      PeersTouchInfo(networkId: info.networkId);
  final String networkId;

  Map<String, dynamic> toJson() => {'network_id': networkId};
}

class UserDetail { // e.g., 7/30/90

  const UserDetail({
    required this.id,
    required this.displayName,
    required this.handle,
    this.summary,
    this.avatarUrl,
    this.coverUrl,
    this.region,
    this.timezone,
    this.tags = const [],
    this.links = const [],
    this.actorUrl,
    this.serverDomain,
    this.keyFingerprint,
    this.verifications = const [],
    this.peersTouch,
    this.acct,
    this.locked,
    this.createdAt,
    this.followersCount,
    this.followingCount,
    this.statusesCount,
    this.showCounts = true,
    this.moments = const [],
    this.defaultVisibility = 'public',
    this.manuallyApprovesFollowers = false,
    this.messagePermission = 'everyone',
    this.autoExpireDays,
  });

  factory UserDetail.fromJson(Map<String, dynamic> json) => UserDetail(
        id: (json['id']?.toString()) ?? '',
        displayName: (json['display_name'] as String?) ?? (json['displayName'] as String?) ?? '',
        handle: (json['username'] as String?) ?? (json['handle'] as String?) ?? '',
        summary: (json['note'] as String?) ?? (json['summary'] as String?),
        avatarUrl: (json['avatar'] as String?) ?? (json['avatarUrl'] as String?),
        coverUrl: (json['header'] as String?) ?? (json['coverUrl'] as String?),
        region: json['region'] as String?,
        timezone: json['timezone'] as String?,
        tags: (json['tags'] as List?)?.map((e) => e.toString()).toList() ?? const [],
        links: (json['links'] as List?)
                ?.map((e) => UserLink.fromJson((e as Map).cast<String, dynamic>()))
                .toList() ??
            const [],
        actorUrl: (json['url'] as String?) ?? (json['actorUrl'] as String?),
        serverDomain: json['serverDomain'] as String?,
        keyFingerprint: json['keyFingerprint'] as String?,
        verifications:
            (json['verifications'] as List?)?.map((e) => e.toString()).toList() ?? const [],
        peersTouch: json['peers_touch'] != null ? PeersTouchInfo.fromJson(json['peers_touch']) : null,
        acct: json['acct'] as String?,
        locked: json['locked'] as bool?,
        createdAt: json['created_at'] as String?,
        followersCount: (json['followers_count'] as num?)?.toInt() ?? (json['followersCount'] as num?)?.toInt(),
        followingCount: (json['following_count'] as num?)?.toInt() ?? (json['followingCount'] as num?)?.toInt(),
        statusesCount: (json['statuses_count'] as num?)?.toInt() ?? (json['statusesCount'] as num?)?.toInt(),
        showCounts: (json['showCounts'] as bool?) ?? true,
        moments: (json['moments'] as List?)?.map((e) => e.toString()).toList() ?? const [],
        defaultVisibility: (json['defaultVisibility'] as String?) ?? 'public',
        manuallyApprovesFollowers: (json['manuallyApprovesFollowers'] as bool?) ?? false,
        messagePermission: (json['messagePermission'] as String?) ?? 'everyone',
        autoExpireDays: (json['autoExpireDays'] as num?)?.toInt(),
      );

  factory UserDetail.fromActorProfile(pb.ActorProfile profile) => UserDetail(
        id: profile.id,
        displayName: profile.displayName,
        handle: profile.username,
        summary: profile.note.isNotEmpty ? profile.note : null,
        avatarUrl: profile.avatar.isNotEmpty ? profile.avatar : null,
        coverUrl: profile.header.isNotEmpty ? profile.header : null,
        region: profile.region.isNotEmpty ? profile.region : null,
        timezone: profile.timezone.isNotEmpty ? profile.timezone : null,
        tags: profile.tags.toList(),
        links: profile.links.map((e) => UserLink.fromPb(e)).toList(),
        actorUrl: profile.url.isNotEmpty ? profile.url : null,
        serverDomain: profile.serverDomain.isNotEmpty ? profile.serverDomain : null,
        keyFingerprint: profile.keyFingerprint.isNotEmpty ? profile.keyFingerprint : null,
        verifications: profile.verifications.toList(),
        peersTouch: profile.hasPeersTouch() ? PeersTouchInfo.fromPb(profile.peersTouch) : null,
        acct: profile.acct.isNotEmpty ? profile.acct : null,
        locked: profile.locked,
        createdAt: profile.createdAt.isNotEmpty ? profile.createdAt : null,
        followersCount: profile.followersCount.toInt(),
        followingCount: profile.followingCount.toInt(),
        statusesCount: profile.statusesCount.toInt(),
        showCounts: profile.showCounts,
        moments: profile.moments.toList(),
        defaultVisibility: profile.defaultVisibility.isNotEmpty ? profile.defaultVisibility : 'public',
        manuallyApprovesFollowers: profile.manuallyApprovesFollowers,
        messagePermission: profile.messagePermission.isNotEmpty ? profile.messagePermission : 'everyone',
        autoExpireDays: profile.autoExpireDays > 0 ? profile.autoExpireDays : null,
      );
  final String id;
  final String displayName;
  final String handle; // @handle (username)
  final String? summary; // bio / note
  final String? avatarUrl;
  final String? coverUrl;
  final String? region;
  final String? timezone;
  final List<String> tags;
  final List<UserLink> links;

  // Identity / federation
  final String? actorUrl; // url
  final String? serverDomain;
  final String? keyFingerprint;
  final List<String> verifications; // e.g., peer/server/self
  
  // Peers Touch extensions
  final PeersTouchInfo? peersTouch;
  final String? acct;
  final bool? locked;
  final String? createdAt;

  // Stats
  final int? followersCount;
  final int? followingCount;
  final int? statusesCount;
  final bool showCounts;

  // Moments preview
  final List<String> moments;

  // Privacy settings
  final String defaultVisibility; // public/unlisted/followers/private
  final bool manuallyApprovesFollowers;
  final String messagePermission; // everyone/mutual/none
  final int? autoExpireDays;

  Map<String, dynamic> toJson() => {
        'id': id,
        'displayName': displayName,
        'handle': handle,
        'summary': summary,
        'avatarUrl': avatarUrl,
        'coverUrl': coverUrl,
        'region': region,
        'timezone': timezone,
        'tags': tags,
        'links': links.map((e) => e.toJson()).toList(),
        'actorUrl': actorUrl,
        'serverDomain': serverDomain,
        'keyFingerprint': keyFingerprint,
        'verifications': verifications,
        'peers_touch': peersTouch?.toJson(),
        'acct': acct,
        'locked': locked,
        'created_at': createdAt,
        'followersCount': followersCount,
        'followingCount': followingCount,
        'statusesCount': statusesCount,
        'showCounts': showCounts,
        'moments': moments,
        'defaultVisibility': defaultVisibility,
        'manuallyApprovesFollowers': manuallyApprovesFollowers,
        'messagePermission': messagePermission,
        'autoExpireDays': autoExpireDays,
      };
}
