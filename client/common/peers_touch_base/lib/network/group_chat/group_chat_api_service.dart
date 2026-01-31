import 'package:peers_touch_base/network/dio/http_service.dart';
import 'package:peers_touch_base/network/dio/http_service_locator.dart';

/// Response model for group info
class GroupInfo {
  final String ulid;
  final String name;
  final String description;
  final String? avatarCid;
  final String ownerDid;
  final int type;
  final int visibility;
  final int memberCount;
  final int maxMembers;
  final bool muted;
  final int createdAt;
  final int updatedAt;

  GroupInfo({
    required this.ulid,
    required this.name,
    required this.description,
    this.avatarCid,
    required this.ownerDid,
    required this.type,
    required this.visibility,
    required this.memberCount,
    required this.maxMembers,
    required this.muted,
    required this.createdAt,
    required this.updatedAt,
  });

  factory GroupInfo.fromJson(Map<String, dynamic> json) {
    return GroupInfo(
      ulid: json['ulid'] ?? '',
      name: json['name'] ?? '',
      description: json['description'] ?? '',
      avatarCid: json['avatar_cid'],
      ownerDid: json['owner_did'] ?? '',
      type: json['type'] ?? 1,
      visibility: json['visibility'] ?? 1,
      memberCount: json['member_count'] ?? 0,
      maxMembers: json['max_members'] ?? 500,
      muted: json['muted'] ?? false,
      createdAt: json['created_at'] ?? 0,
      updatedAt: json['updated_at'] ?? 0,
    );
  }
}

/// Response model for group message
class GroupMessageInfo {
  final String ulid;
  final String groupUlid;
  final String senderDid;
  final int type;
  final String content;
  final String? replyToUlid;
  final List<String> mentionedDids;
  final bool mentionAll;
  final int sentAt;
  final bool deleted;

  GroupMessageInfo({
    required this.ulid,
    required this.groupUlid,
    required this.senderDid,
    required this.type,
    required this.content,
    this.replyToUlid,
    this.mentionedDids = const [],
    this.mentionAll = false,
    required this.sentAt,
    this.deleted = false,
  });

  factory GroupMessageInfo.fromJson(Map<String, dynamic> json) {
    return GroupMessageInfo(
      ulid: json['ulid'] ?? '',
      groupUlid: json['group_ulid'] ?? '',
      senderDid: json['sender_did'] ?? '',
      type: json['type'] ?? 1,
      content: json['content'] ?? '',
      replyToUlid: json['reply_to_ulid'],
      mentionedDids: List<String>.from(json['mentioned_dids'] ?? []),
      mentionAll: json['mention_all'] ?? false,
      sentAt: json['sent_at'] ?? 0,
      deleted: json['deleted'] ?? false,
    );
  }
}

/// Response model for group member
class GroupMemberInfo {
  final String groupUlid;
  final String actorDid;
  final int role;
  final String nickname;
  final bool muted;
  final int mutedUntil;
  final int joinedAt;
  final String invitedBy;

  GroupMemberInfo({
    required this.groupUlid,
    required this.actorDid,
    required this.role,
    required this.nickname,
    required this.muted,
    required this.mutedUntil,
    required this.joinedAt,
    required this.invitedBy,
  });

  factory GroupMemberInfo.fromJson(Map<String, dynamic> json) {
    return GroupMemberInfo(
      groupUlid: json['group_ulid'] ?? '',
      actorDid: json['actor_did'] ?? '',
      role: json['role'] ?? 1,
      nickname: json['nickname'] ?? '',
      muted: json['muted'] ?? false,
      mutedUntil: json['muted_until'] ?? 0,
      joinedAt: json['joined_at'] ?? 0,
      invitedBy: json['invited_by'] ?? '',
    );
  }
}

/// API service for group chat operations
class GroupChatApiService {
  IHttpService get _http => HttpServiceLocator().httpService;

  /// Create a new group
  Future<GroupInfo> createGroup({
    required String name,
    String description = '',
    int type = 1,
    int visibility = 1,
    List<String> initialMemberDids = const [],
  }) async {
    final response = await _http.post('/group-chat/create', data: {
      'name': name,
      'description': description,
      'type': type,
      'visibility': visibility,
      'initial_member_dids': initialMemberDids,
    });
    return GroupInfo.fromJson(response['group'] as Map<String, dynamic>);
  }

  /// Get list of groups the current user belongs to
  Future<List<GroupInfo>> listGroups({int limit = 50, int offset = 0}) async {
    final response = await _http.get('/group-chat/list', queryParameters: {
      'limit': limit,
      'offset': offset,
    });
    final groups = response['groups'] as List? ?? [];
    return groups.map((g) => GroupInfo.fromJson(g as Map<String, dynamic>)).toList();
  }

  /// Get group info
  Future<GroupInfo> getGroupInfo(String groupUlid) async {
    final response = await _http.get('/group-chat/info', queryParameters: {
      'group_ulid': groupUlid,
    });
    return GroupInfo.fromJson(response['group'] as Map<String, dynamic>);
  }

  /// Get group members
  Future<List<GroupMemberInfo>> getMembers(String groupUlid, {int limit = 100, int offset = 0}) async {
    final response = await _http.get('/group-chat/members', queryParameters: {
      'group_ulid': groupUlid,
      'limit': limit,
      'offset': offset,
    });
    final members = response['members'] as List? ?? [];
    return members.map((m) => GroupMemberInfo.fromJson(m as Map<String, dynamic>)).toList();
  }

  /// Send a message to a group
  Future<GroupMessageInfo> sendMessage({
    required String groupUlid,
    required String content,
    int type = 1,
    String? replyToUlid,
    List<String> mentionedDids = const [],
    bool mentionAll = false,
  }) async {
    final response = await _http.post('/group-chat/message/send', data: {
      'group_ulid': groupUlid,
      'type': type,
      'content': content,
      if (replyToUlid != null) 'reply_to_ulid': replyToUlid,
      'mentioned_dids': mentionedDids,
      'mention_all': mentionAll,
    });
    return GroupMessageInfo.fromJson(response['message'] as Map<String, dynamic>);
  }

  /// Get messages from a group
  Future<List<GroupMessageInfo>> getMessages(String groupUlid, {String? beforeUlid, int limit = 50}) async {
    final response = await _http.get('/group-chat/messages', queryParameters: {
      'group_ulid': groupUlid,
      if (beforeUlid != null) 'before_ulid': beforeUlid,
      'limit': limit,
    });
    final messages = response['messages'] as List? ?? [];
    return messages.map((m) => GroupMessageInfo.fromJson(m as Map<String, dynamic>)).toList();
  }

  /// Join a group
  Future<GroupMemberInfo> joinGroup(String groupUlid, {String? invitationUlid}) async {
    final response = await _http.post('/group-chat/join', data: {
      'group_ulid': groupUlid,
      if (invitationUlid != null) 'invitation_ulid': invitationUlid,
    });
    return GroupMemberInfo.fromJson(response['membership'] as Map<String, dynamic>);
  }

  /// Leave a group
  Future<bool> leaveGroup(String groupUlid) async {
    final response = await _http.post('/group-chat/leave', data: {
      'group_ulid': groupUlid,
    });
    return response['success'] == true;
  }

  /// Invite users to a group
  Future<void> inviteToGroup(String groupUlid, List<String> inviteeDids) async {
    await _http.post('/group-chat/invite', data: {
      'group_ulid': groupUlid,
      'invitee_dids': inviteeDids,
    });
  }
}
