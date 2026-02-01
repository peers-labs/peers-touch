import 'package:peers_touch_base/storage/chat/chat_cache_service.dart';

/// 搜索结果类型
enum SearchResultType {
  contact,
  group,
  message,
}

/// 搜索结果项
class SearchResult {
  const SearchResult({
    required this.type,
    required this.id,
    required this.title,
    this.subtitle,
    this.avatarUrl,
    this.highlightText,
    this.sessionId,
    this.messageId,
    this.timestamp,
  });

  /// 结果类型
  final SearchResultType type;

  /// 唯一标识
  final String id;

  /// 标题（名称）
  final String title;

  /// 副标题
  final String? subtitle;

  /// 头像
  final String? avatarUrl;

  /// 高亮文本（匹配的内容）
  final String? highlightText;

  /// 会话ID（消息搜索用）
  final String? sessionId;

  /// 消息ID（消息搜索用）
  final String? messageId;

  /// 时间戳
  final DateTime? timestamp;
}

/// 聊天搜索服务
///
/// 提供联系人、群组、消息的本地搜索功能。
class ChatSearchService {
  ChatSearchService._();

  static final ChatSearchService _instance = ChatSearchService._();
  static ChatSearchService get instance => _instance;

  /// 综合搜索
  Future<Map<SearchResultType, List<SearchResult>>> search(
    String query, {
    bool includeContacts = true,
    bool includeGroups = true,
    bool includeMessages = true,
    int limit = 20,
  }) async {
    final results = <SearchResultType, List<SearchResult>>{};

    if (query.trim().isEmpty) {
      return results;
    }

    final futures = <Future>[];

    if (includeContacts) {
      futures.add(searchContacts(query, limit: limit).then((r) {
        if (r.isNotEmpty) results[SearchResultType.contact] = r;
      }));
    }

    if (includeGroups) {
      futures.add(searchGroups(query, limit: limit).then((r) {
        if (r.isNotEmpty) results[SearchResultType.group] = r;
      }));
    }

    if (includeMessages) {
      futures.add(searchMessages(query, limit: limit).then((r) {
        if (r.isNotEmpty) results[SearchResultType.message] = r;
      }));
    }

    await Future.wait(futures);
    return results;
  }

  /// 搜索联系人
  Future<List<SearchResult>> searchContacts(String query, {int limit = 20}) async {
    // TODO: 实现联系人搜索
    // 这需要从好友列表或本地缓存中搜索
    return [];
  }

  /// 搜索群组
  Future<List<SearchResult>> searchGroups(String query, {int limit = 20}) async {
    final cacheService = ChatCacheService.instance;
    final sessions = await cacheService.getGroupSessions();

    final results = <SearchResult>[];
    final lowerQuery = query.toLowerCase();

    for (final session in sessions) {
      if (session.topic?.toLowerCase().contains(lowerQuery) ?? false) {
        results.add(SearchResult(
          type: SearchResultType.group,
          id: session.id,
          title: session.topic ?? '',
          avatarUrl: session.avatarUrl,
          sessionId: session.id,
        ));

        if (results.length >= limit) break;
      }
    }

    return results;
  }

  /// 搜索消息
  Future<List<SearchResult>> searchMessages(
    String query, {
    String? sessionId,
    int limit = 20,
  }) async {
    final cacheService = ChatCacheService.instance;
    final messages = await cacheService.searchMessages(query, sessionId: sessionId);

    final results = <SearchResult>[];
    
    for (final message in messages) {
      if (results.length >= limit) break;

      results.add(SearchResult(
        type: SearchResultType.message,
        id: message.id,
        title: _getSenderName(message.senderId),
        subtitle: message.content ?? '',
        highlightText: _getHighlightText(message.content ?? '', query),
        sessionId: message.sessionId,
        messageId: message.id,
        timestamp: DateTime.fromMillisecondsSinceEpoch(message.sentAt),
      ));
    }

    return results;
  }

  /// 搜索群成员
  Future<List<SearchResult>> searchGroupMembers(
    String groupId,
    String query, {
    int limit = 20,
  }) async {
    final cacheService = ChatCacheService.instance;
    final members = await cacheService.db.groupMemberDao.searchMembers(groupId, query);

    final results = <SearchResult>[];
    
    for (final member in members) {
      if (results.length >= limit) break;

      results.add(SearchResult(
        type: SearchResultType.contact,
        id: member.actorId,
        title: member.displayName ?? member.nickname ?? member.actorId,
        avatarUrl: member.avatarUrl,
      ));
    }

    return results;
  }

  String _getSenderName(String senderId) {
    // TODO: 从缓存获取发送者名称
    return senderId.length > 8 ? senderId.substring(0, 8) : senderId;
  }

  String _getHighlightText(String content, String query) {
    final lowerContent = content.toLowerCase();
    final lowerQuery = query.toLowerCase();
    final index = lowerContent.indexOf(lowerQuery);

    if (index == -1) return content;

    // 提取匹配位置前后的文本
    final start = (index - 20).clamp(0, content.length);
    final end = (index + query.length + 20).clamp(0, content.length);

    String result = content.substring(start, end);
    if (start > 0) result = '...$result';
    if (end < content.length) result = '$result...';

    return result;
  }
}
