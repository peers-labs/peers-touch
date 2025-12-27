class OnlineActor {
  final int id;
  final String name;
  final String? preferredUsername;
  final String avatarUrl;
  final int status;
  final String lastHeartbeat;
  final double? lat;
  final double? lon;

  OnlineActor({
    required this.id,
    required this.name,
    required this.avatarUrl,
    required this.status,
    required this.lastHeartbeat,
    this.preferredUsername,
    this.lat,
    this.lon,
  });

  factory OnlineActor.fromJson(Map json) {
    return OnlineActor(
      id: int.tryParse(json['id']?.toString() ?? '') ?? (json['actor_id'] ?? 0),
      name: json['name']?.toString() ?? '',
      preferredUsername: json['preferred_username']?.toString(),
      avatarUrl: json['avatar_url']?.toString() ?? '',
      status: int.tryParse(json['status']?.toString() ?? '0') ?? 0,
      lastHeartbeat: json['last_heartbeat']?.toString() ?? '',
      lat: double.tryParse(json['lat']?.toString() ?? ''),
      lon: double.tryParse(json['lon']?.toString() ?? ''),
    );
  }
}
