class UserLink {
  final String label;
  final String url;
  const UserLink({required this.label, required this.url});

  factory UserLink.fromJson(Map<String, dynamic> json) =>
      UserLink(label: (json['label'] as String?) ?? '', url: (json['url'] as String?) ?? '');

  Map<String, dynamic> toJson() => {
        'label': label,
        'url': url,
      };
}

class UserDetail {
  final String id;
  final String displayName;
  final String handle; // @handle
  final String? summary;
  final String? avatarUrl;
  final String? coverUrl;
  final String? region;
  final String? timezone;
  final List<String> tags;
  final List<UserLink> links;

  // Identity / federation
  final String? actorUrl;
  final String? serverDomain;
  final String? keyFingerprint;
  final List<String> verifications; // e.g., peer/server/self

  // Stats
  final int? followersCount;
  final int? followingCount;
  final bool showCounts;

  // Moments preview
  final List<String> moments;

  // Privacy settings
  final String defaultVisibility; // public/unlisted/followers/private
  final bool manuallyApprovesFollowers;
  final String messagePermission; // everyone/mutual/none
  final int? autoExpireDays; // e.g., 7/30/90

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
    this.followersCount,
    this.followingCount,
    this.showCounts = true,
    this.moments = const [],
    this.defaultVisibility = 'public',
    this.manuallyApprovesFollowers = false,
    this.messagePermission = 'everyone',
    this.autoExpireDays,
  });

  factory UserDetail.fromJson(Map<String, dynamic> json) => UserDetail(
        id: (json['id']?.toString()) ?? '',
        displayName: (json['displayName'] as String?) ?? '',
        handle: (json['handle'] as String?) ?? '',
        summary: json['summary'] as String?,
        avatarUrl: json['avatarUrl'] as String?,
        coverUrl: json['coverUrl'] as String?,
        region: json['region'] as String?,
        timezone: json['timezone'] as String?,
        tags: (json['tags'] as List?)?.map((e) => e.toString()).toList() ?? const [],
        links: (json['links'] as List?)
                ?.map((e) => UserLink.fromJson((e as Map).cast<String, dynamic>()))
                .toList() ??
            const [],
        actorUrl: json['actorUrl'] as String?,
        serverDomain: json['serverDomain'] as String?,
        keyFingerprint: json['keyFingerprint'] as String?,
        verifications:
            (json['verifications'] as List?)?.map((e) => e.toString()).toList() ?? const [],
        followersCount: (json['followersCount'] as num?)?.toInt(),
        followingCount: (json['followingCount'] as num?)?.toInt(),
        showCounts: (json['showCounts'] as bool?) ?? true,
        moments: (json['moments'] as List?)?.map((e) => e.toString()).toList() ?? const [],
        defaultVisibility: (json['defaultVisibility'] as String?) ?? 'public',
        manuallyApprovesFollowers: (json['manuallyApprovesFollowers'] as bool?) ?? false,
        messagePermission: (json['messagePermission'] as String?) ?? 'everyone',
        autoExpireDays: (json['autoExpireDays'] as num?)?.toInt(),
      );

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
        'followersCount': followersCount,
        'followingCount': followingCount,
        'showCounts': showCounts,
        'moments': moments,
        'defaultVisibility': defaultVisibility,
        'manuallyApprovesFollowers': manuallyApprovesFollowers,
        'messagePermission': messagePermission,
        'autoExpireDays': autoExpireDays,
      };
}