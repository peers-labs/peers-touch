
class AppletManifest {
  final String appId;
  final String version;
  final String name;
  final String? description;
  final String? icon;
  String entryPoint;
  final String? minSdkVersion;
  final List<String> permissions;
  final String? bundleHash; // SHA-256 hash of the bundle file

  AppletManifest({
    required this.appId,
    required this.version,
    required this.name,
    this.description,
    this.icon,
    required this.entryPoint,
    this.minSdkVersion,
    required this.permissions,
    this.bundleHash,
  });

  factory AppletManifest.fromJson(Map<String, dynamic> json) {
    return AppletManifest(
      appId: json['appId'] as String,
      version: json['version'] as String,
      name: json['name'] as String,
      description: json['description'] as String?,
      icon: json['icon'] as String?,
      entryPoint: json['entry_point'] as String,
      minSdkVersion: json['min_sdk_version'] as String?,
      permissions: (json['permissions'] as List<dynamic>?)?.map((e) => e as String).toList() ?? [],
      bundleHash: json['bundle_hash'] as String?,
    );
  }

  Map<String, dynamic> toJson() {
    return {
      'appId': appId,
      'version': version,
      'name': name,
      'description': description,
      'icon': icon,
      'entry_point': entryPoint,
      'min_sdk_version': minSdkVersion,
      'permissions': permissions,
      'bundle_hash': bundleHash,
    };
  }
}
