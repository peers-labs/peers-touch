import 'dart:convert';

class Endpoints {

  Endpoints({
    this.uploadMedia,
    this.oauthAuthorizationEndpoint,
    this.oauthTokenEndpoint,
    this.provideClientKey,
    this.signClientKey,
    this.sharedInbox,
  });
  final String? uploadMedia;
  final String? oauthAuthorizationEndpoint;
  final String? oauthTokenEndpoint;
  final String? provideClientKey;
  final String? signClientKey;
  final String? sharedInbox;

  Map<String, dynamic> toJson() => {
        'upload_media': uploadMedia,
        'oauth_authorization_endpoint': oauthAuthorizationEndpoint,
        'oauth_token_endpoint': oauthTokenEndpoint,
        'provide_client_key': provideClientKey,
        'sign_client_key': signClientKey,
        'shared_inbox': sharedInbox,
      };

  static Endpoints? fromJson(Map<String, dynamic>? json) {
    if (json == null) return null;
    return Endpoints(
      uploadMedia: json['upload_media'] as String?,
      oauthAuthorizationEndpoint: json['oauth_authorization_endpoint'] as String?,
      oauthTokenEndpoint: json['oauth_token_endpoint'] as String?,
      provideClientKey: json['provide_client_key'] as String?,
      signClientKey: json['sign_client_key'] as String?,
      sharedInbox: json['shared_inbox'] as String?,
    );
  }
}

class PublicKey {

  PublicKey({this.id, this.owner, this.publicKeyPem});
  final String? id;
  final String? owner;
  final String? publicKeyPem;

  Map<String, dynamic> toJson() => {
        'id': id,
        'owner': owner,
        'public_key_pem': publicKeyPem,
      };

  static PublicKey? fromJson(Map<String, dynamic>? json) {
    if (json == null) return null;
    return PublicKey(
      id: json['id'] as String?,
      owner: json['owner'] as String?,
      publicKeyPem: json['public_key_pem'] as String?,
    );
  }
}

enum ActorType { unspecified, application, group, organization, person, service }

class Actor {

  Actor({
    this.id,
    this.type = ActorType.unspecified,
    this.name,
    this.summary,
    this.content,
    this.preferredUsername,
    this.url,
    this.icon,
    this.image,
    this.inbox,
    this.outbox,
    this.to,
    this.cc,
    this.bto,
    this.bcc,
    this.audience,
    this.following,
    this.followers,
    this.liked,
    this.streams,
    this.tags,
    this.attachments,
    this.endpoints,
    this.publicKey,
    this.publishedAt,
    this.updatedAt,
    this.startTime,
    this.endTime,
    this.durationSeconds,
  });
  final String? id;
  final ActorType type;
  final Map<String, String>? name;
  final Map<String, String>? summary;
  final Map<String, String>? content;
  final String? preferredUsername;
  final String? url;
  final String? icon;
  final String? image;
  final String? inbox;
  final String? outbox;
  final List<String>? to;
  final List<String>? cc;
  final List<String>? bto;
  final List<String>? bcc;
  final List<String>? audience;
  final List<String>? following;
  final List<String>? followers;
  final List<String>? liked;
  final List<String>? streams;
  final List<String>? tags;
  final List<String>? attachments;
  final Endpoints? endpoints;
  final PublicKey? publicKey;
  final DateTime? publishedAt;
  final DateTime? updatedAt;
  final DateTime? startTime;
  final DateTime? endTime;
  final int? durationSeconds;

  Map<String, dynamic> toJson() => {
        'id': id,
        'type': _typeToString(type),
        'name': name,
        'summary': summary,
        'content': content,
        'preferred_username': preferredUsername,
        'url': url,
        'icon': icon,
        'image': image,
        'inbox': inbox,
        'outbox': outbox,
        'to': to,
        'cc': cc,
        'bto': bto,
        'bcc': bcc,
        'audience': audience,
        'following': following,
        'followers': followers,
        'liked': liked,
        'streams': streams,
        'tags': tags,
        'attachments': attachments,
        'endpoints': endpoints?.toJson(),
        'public_key': publicKey?.toJson(),
        'published_at': _toIso(publishedAt),
        'updated_at': _toIso(updatedAt),
        'start_time': _toIso(startTime),
        'end_time': _toIso(endTime),
        'duration_seconds': durationSeconds,
      };

  static Actor fromJson(Map<String, dynamic> json) {
    return Actor(
      id: json['id'] as String?,
      type: _typeFromString(json['type'] as String?),
      name: (json['name'] as Map?)?.cast<String, String>(),
      summary: (json['summary'] as Map?)?.cast<String, String>(),
      content: (json['content'] as Map?)?.cast<String, String>(),
      preferredUsername: json['preferred_username'] as String?,
      url: json['url'] as String?,
      icon: json['icon'] as String?,
      image: json['image'] as String?,
      inbox: json['inbox'] as String?,
      outbox: json['outbox'] as String?,
      to: _asStringList(json['to']),
      cc: _asStringList(json['cc']),
      bto: _asStringList(json['bto']),
      bcc: _asStringList(json['bcc']),
      audience: _asStringList(json['audience']),
      following: _asStringList(json['following']),
      followers: _asStringList(json['followers']),
      liked: _asStringList(json['liked']),
      streams: _asStringList(json['streams']),
      tags: _asStringList(json['tags']),
      attachments: _asStringList(json['attachments']),
      endpoints: Endpoints.fromJson(json['endpoints'] as Map<String, dynamic>?),
      publicKey: PublicKey.fromJson(json['public_key'] as Map<String, dynamic>?),
      publishedAt: _parseIso(json['published_at'] as String?),
      updatedAt: _parseIso(json['updated_at'] as String?),
      startTime: _parseIso(json['start_time'] as String?),
      endTime: _parseIso(json['end_time'] as String?),
      durationSeconds: (json['duration_seconds'] as num?)?.toInt(),
    );
  }

  static String? _toIso(DateTime? dt) => dt?.toUtc().toIso8601String();
  static DateTime? _parseIso(String? s) => s == null ? null : DateTime.parse(s);
  static List<String>? _asStringList(dynamic v) => v == null ? null : List<String>.from(v as List);

  static String _typeToString(ActorType t) {
    switch (t) {
      case ActorType.application:
        return 'Application';
      case ActorType.group:
        return 'Group';
      case ActorType.organization:
        return 'Organization';
      case ActorType.person:
        return 'Person';
      case ActorType.service:
        return 'Service';
      case ActorType.unspecified:
      default:
        return '';
    }
  }

  static ActorType _typeFromString(String? s) {
    switch (s) {
      case 'Application':
        return ActorType.application;
      case 'Group':
        return ActorType.group;
      case 'Organization':
        return ActorType.organization;
      case 'Person':
        return ActorType.person;
      case 'Service':
        return ActorType.service;
      default:
        return ActorType.unspecified;
    }
  }

  String toJsonString() => jsonEncode(toJson());
  static Actor fromJsonString(String s) => fromJson(jsonDecode(s) as Map<String, dynamic>);
}

