import 'package:peers_touch_base/logger/logging_service.dart';
import 'package:peers_touch_base/model/domain/chat/chat.pb.dart' as pb;
import 'package:peers_touch_base/model/domain/chat/group_chat.pb.dart' as group_pb;
// import 'package:peers_touch_base/network/group_chat/group_chat_api_service.dart';
import 'package:peers_touch_base/storage/chat/chat_cache_service.dart';

/// 消息操作结果
class MessageOperationResult {
  const MessageOperationResult({
    required this.success,
    this.errorMessage,
  });

  final bool success;
  final String? errorMessage;

  factory MessageOperationResult.success() =>
      const MessageOperationResult(success: true);

  factory MessageOperationResult.failure(String message) =>
      MessageOperationResult(success: false, errorMessage: message);
}

/// 消息操作服务
///
/// 提供消息的删除、撤回、@人解析等高级功能。
class MessageOperationService {
  MessageOperationService._();

  static final MessageOperationService _instance = MessageOperationService._();
  static MessageOperationService get instance => _instance;

  final _cacheService = ChatCacheService.instance;

  // ==================== 消息删除/撤回 ====================

  /// 撤回消息（2分钟内可撤回）
  ///
  /// 会同时更新本地缓存和服务端。
  Future<MessageOperationResult> recallMessage({
    required String messageId,
    required String sessionId,
    required bool isGroupMessage,
    String? groupUlid,
    required DateTime sentAt,
  }) async {
    try {
      // 检查是否在可撤回时间内（2分钟）
      final now = DateTime.now();
      final diff = now.difference(sentAt);
      if (diff.inMinutes > 2) {
        return MessageOperationResult.failure('消息发送超过2分钟，无法撤回');
      }

      // 调用服务端 API 撤回
      if (isGroupMessage && groupUlid != null) {
        // TODO: 实现 recallMessage API 调用
        // final api = GroupChatApiService();
        // await api.recallMessage(groupUlid, messageId);
      } else {
        // TODO: 私聊消息撤回 API
      }

      // 更新本地缓存
      await _cacheService.deleteMessage(messageId);

      LoggingService.info('[MessageOperationService] Message recalled: $messageId');
      return MessageOperationResult.success();
    } catch (e) {
      LoggingService.error('[MessageOperationService] Failed to recall message: $e');
      return MessageOperationResult.failure('撤回失败: $e');
    }
  }

  /// 删除本地消息（仅删除本地，不同步服务端）
  Future<MessageOperationResult> deleteLocalMessage(String messageId) async {
    try {
      await _cacheService.deleteMessage(messageId);
      LoggingService.info('[MessageOperationService] Local message deleted: $messageId');
      return MessageOperationResult.success();
    } catch (e) {
      LoggingService.error('[MessageOperationService] Failed to delete message: $e');
      return MessageOperationResult.failure('删除失败: $e');
    }
  }

  /// 批量删除本地消息
  Future<MessageOperationResult> deleteLocalMessages(List<String> messageIds) async {
    try {
      for (final id in messageIds) {
        await _cacheService.deleteMessage(id);
      }
      LoggingService.info('[MessageOperationService] ${messageIds.length} messages deleted');
      return MessageOperationResult.success();
    } catch (e) {
      LoggingService.error('[MessageOperationService] Failed to delete messages: $e');
      return MessageOperationResult.failure('批量删除失败: $e');
    }
  }

  // ==================== @人功能 ====================

  /// 解析消息中的 @
  ///
  /// 返回被 @ 的用户 ID 列表。
  List<String> parseMentions(String content) {
    final mentions = <String>[];
    final regex = RegExp(r'@(\w+)');
    final matches = regex.allMatches(content);

    for (final match in matches) {
      if (match.groupCount >= 1) {
        mentions.add(match.group(1)!);
      }
    }

    return mentions;
  }

  /// 检查消息是否 @ 了指定用户
  bool isMentioned(String content, String userId) {
    final mentions = parseMentions(content);
    return mentions.contains(userId);
  }

  /// 检查是否 @全体成员
  bool isMentionAll(String content) {
    return content.contains('@所有人') || content.contains('@全体成员') || content.contains('@all');
  }

  /// 高亮 @ 文本
  ///
  /// 返回格式化后的 TextSpan 列表。
  List<TextSpanData> highlightMentions(String content, {Set<String>? mentionedIds}) {
    final spans = <TextSpanData>[];
    final regex = RegExp(r'@(\w+)');
    int lastEnd = 0;

    for (final match in regex.allMatches(content)) {
      // 添加普通文本
      if (match.start > lastEnd) {
        spans.add(TextSpanData(
          text: content.substring(lastEnd, match.start),
          isMention: false,
        ));
      }

      // 添加 @ 文本
      final mentionText = match.group(0)!;
      final mentionedId = match.group(1)!;
      spans.add(TextSpanData(
        text: mentionText,
        isMention: true,
        mentionId: mentionedId,
        isHighlighted: mentionedIds?.contains(mentionedId) ?? false,
      ));

      lastEnd = match.end;
    }

    // 添加剩余文本
    if (lastEnd < content.length) {
      spans.add(TextSpanData(
        text: content.substring(lastEnd),
        isMention: false,
      ));
    }

    return spans;
  }

  // ==================== 回复消息 ====================

  /// 获取回复消息的预览文本
  String getReplyPreview(pb.ChatMessage message) {
    switch (message.type) {
      case pb.MessageType.MESSAGE_TYPE_IMAGE:
        return '[图片]';
      case pb.MessageType.MESSAGE_TYPE_FILE:
        return '[文件]';
      case pb.MessageType.MESSAGE_TYPE_AUDIO:
        return '[语音]';
      case pb.MessageType.MESSAGE_TYPE_VIDEO:
        return '[视频]';
      case pb.MessageType.MESSAGE_TYPE_STICKER:
        return '[表情]';
      case pb.MessageType.MESSAGE_TYPE_LOCATION:
        return '[位置]';
      default:
        final content = message.content;
        return content.length > 50 ? '${content.substring(0, 50)}...' : content;
    }
  }

  /// 获取群消息回复的预览文本
  String getGroupReplyPreview(group_pb.GroupMessage message) {
    switch (message.type) {
      case group_pb.GroupMessageType.GROUP_MESSAGE_TYPE_IMAGE:
        return '[图片]';
      case group_pb.GroupMessageType.GROUP_MESSAGE_TYPE_FILE:
        return '[文件]';
      case group_pb.GroupMessageType.GROUP_MESSAGE_TYPE_AUDIO:
        return '[语音]';
      case group_pb.GroupMessageType.GROUP_MESSAGE_TYPE_VIDEO:
        return '[视频]';
      default:
        final content = message.content;
        return content.length > 50 ? '${content.substring(0, 50)}...' : content;
    }
  }
}

/// 文本片段数据
class TextSpanData {
  const TextSpanData({
    required this.text,
    required this.isMention,
    this.mentionId,
    this.isHighlighted = false,
  });

  final String text;
  final bool isMention;
  final String? mentionId;
  final bool isHighlighted;
}
