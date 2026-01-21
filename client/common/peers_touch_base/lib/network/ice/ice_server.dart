class IceServer {

  IceServer({
    required this.urls,
    this.username,
    this.credential,
  });

  factory IceServer.fromJson(Map<String, dynamic> json) {
    final rawUrls = json['urls'];
    List<String> urls;
    if (rawUrls is List) {
      urls = rawUrls.map((e) => e.toString()).toList();
    } else if (rawUrls is String) {
      urls = [rawUrls];
    } else {
      urls = [];
    }

    return IceServer(
      urls: urls,
      username: json['username'] as String?,
      credential: json['credential'] as String?,
    );
  }

  final List<String> urls;
  final String? username;
  final String? credential;

  bool get isSTUN => urls.any((url) => url.toLowerCase().startsWith('stun:'));

  bool get isTURN => urls.any((url) => url.toLowerCase().startsWith('turn:'));

  Map<String, dynamic> toJson() {
    return {
      'urls': urls,
      if (username != null) 'username': username,
      if (credential != null) 'credential': credential,
    };
  }

  Map<String, dynamic> toRTCIceServer() {
    return {
      'urls': urls,
      if (username != null) 'username': username,
      if (credential != null) 'credential': credential,
    };
  }

  @override
  String toString() {
    return 'IceServer(urls: $urls, username: $username, credential: ${credential != null ? '***' : null})';
  }

  @override
  bool operator ==(Object other) {
    if (identical(this, other)) return true;
    if (other is! IceServer) return false;
    if (urls.length != other.urls.length) return false;
    for (var i = 0; i < urls.length; i++) {
      if (urls[i] != other.urls[i]) return false;
    }
    return username == other.username && credential == other.credential;
  }

  @override
  int get hashCode => Object.hash(Object.hashAll(urls), username, credential);
}
