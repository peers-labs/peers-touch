import 'package:flutter/material.dart';
import 'package:peers_touch_mobile/l10n/app_localizations.dart';
import 'package:peers_touch_mobile/common/logger/logger.dart';
import 'package:peers_touch_mobile/pages/chat/models/friend_model.dart';
import 'package:peers_touch_mobile/pages/chat/models/message_model.dart';
import 'package:peers_touch_mobile/pages/chat/chat_message_bubble.dart';
import 'package:peers_touch_mobile/pages/chat/chat_message_input.dart';

class ChatDetailPage extends StatefulWidget {
  final FriendModel friend;

  const ChatDetailPage({super.key, required this.friend});

  @override
  State<ChatDetailPage> createState() => _ChatDetailPageState();
}

class _ChatDetailPageState extends State<ChatDetailPage> {
  final ScrollController _scrollController = ScrollController();
  final TextEditingController _messageController = TextEditingController();
  final List<MessageModel> _messages = [];
  bool _isLoading = false;
  bool _hasMoreMessages = true;

  @override
  void initState() {
    super.initState();
    _loadInitialMessages();
    _scrollController.addListener(_scrollListener);

    // Mark messages as read when entering chat
    WidgetsBinding.instance.addPostFrameCallback((_) {
      // In a real app, this would update the unread count in the database
      appLogger.info('Marking messages as read for ${widget.friend.friendId}');
    });
  }

  @override
  void dispose() {
    _scrollController.removeListener(_scrollListener);
    _scrollController.dispose();
    _messageController.dispose();
    super.dispose();
  }

  void _scrollListener() {
    if (_scrollController.position.pixels ==
        _scrollController.position.minScrollExtent) {
      _loadMoreMessages();
    }
  }

  void _loadInitialMessages() {
    // Mock initial messages
    final now = DateTime.now();
    final List<MessageModel> initialMessages = [
      MessageModel(
        messageId: 'msg_1',
        chatId: 'chat_user1001_${widget.friend.friendId}',
        senderId: widget.friend.friendId,
        receiverId: 'user1001',
        content: '你好，最近在忙什么？',
        timestamp:
            now
                .subtract(const Duration(days: 1, hours: 2))
                .millisecondsSinceEpoch,
        status: 'read',
        isMine: false,
        messageType: 'text',
        isForwarded: false,
      ),
      MessageModel(
        messageId: 'msg_2',
        chatId: 'chat_user1001_${widget.friend.friendId}',
        senderId: 'user1001',
        receiverId: widget.friend.friendId,
        content: '在准备新项目的演示，你呢？',
        timestamp:
            now
                .subtract(const Duration(days: 1, hours: 1, minutes: 45))
                .millisecondsSinceEpoch,
        status: 'read',
        isMine: true,
        messageType: 'text',
        isForwarded: false,
      ),
      MessageModel(
        messageId: 'msg_3',
        chatId: 'chat_user1001_${widget.friend.friendId}',
        senderId: widget.friend.friendId,
        receiverId: 'user1001',
        content: '我在处理一些客户反馈，明天开会时间是10点，别忘了。',
        timestamp:
            now.subtract(const Duration(hours: 5)).millisecondsSinceEpoch,
        status: 'read',
        isMine: false,
        messageType: 'text',
        isForwarded: false,
      ),
    ];

    setState(() {
      _messages.addAll(initialMessages);
    });

    // Scroll to bottom after messages are loaded
    WidgetsBinding.instance.addPostFrameCallback((_) {
      _scrollToBottom();
    });
  }

  Future<void> _loadMoreMessages() async {
    if (_isLoading || !_hasMoreMessages) return;

    setState(() {
      _isLoading = true;
    });

    // Simulate network delay
    await Future.delayed(const Duration(seconds: 1));

    // Mock older messages
    final now = DateTime.now();
    final List<MessageModel> olderMessages = [
      MessageModel(
        messageId: 'msg_older_1',
        chatId: 'chat_user1001_${widget.friend.friendId}',
        senderId: 'user1001',
        receiverId: widget.friend.friendId,
        content: '上周的会议总结发给我了吗？',
        timestamp: now.subtract(const Duration(days: 3)).millisecondsSinceEpoch,
        status: 'read',
        isMine: true,
        messageType: 'text',
        isForwarded: false,
      ),
      MessageModel(
        messageId: 'msg_older_2',
        chatId: 'chat_user1001_${widget.friend.friendId}',
        senderId: widget.friend.friendId,
        receiverId: 'user1001',
        content: '已经发到你邮箱了，请查收。',
        timestamp:
            now
                .subtract(const Duration(days: 3, minutes: 15))
                .millisecondsSinceEpoch,
        status: 'read',
        isMine: false,
        messageType: 'text',
        isForwarded: false,
      ),
    ];

    // In a real app, we would check if there are no more messages to load
    setState(() {
      _messages.insertAll(0, olderMessages);
      _isLoading = false;
      _hasMoreMessages =
          false; // For demo purposes, we only load one batch of older messages
    });
  }

  void _sendMessage(String text) {
    if (text.trim().isEmpty) return;

    final now = DateTime.now();
    final newMessage = MessageModel(
      messageId: 'msg_${now.millisecondsSinceEpoch}',
      chatId: 'chat_user1001_${widget.friend.friendId}',
      senderId: 'user1001',
      receiverId: widget.friend.friendId,
      content: text,
      timestamp: now.millisecondsSinceEpoch,
      status: 'sending',
      isMine: true,
      messageType: 'text',
      isForwarded: false,
    );

    setState(() {
      _messages.add(newMessage);
      _messageController.clear();
    });

    _scrollToBottom();

    // Simulate message sending delay
    Future.delayed(const Duration(seconds: 1), () {
      setState(() {
        final index = _messages.indexWhere(
          (msg) => msg.messageId == newMessage.messageId,
        );
        if (index != -1) {
          _messages[index] = _messages[index].copyWith(status: 'sent');
        }
      });
    });

    // Simulate message read delay
    Future.delayed(const Duration(seconds: 2), () {
      setState(() {
        final index = _messages.indexWhere(
          (msg) => msg.messageId == newMessage.messageId,
        );
        if (index != -1) {
          _messages[index] = _messages[index].copyWith(status: 'read');
        }
      });
    });

    // Simulate friend reply
    if (_shouldAutoReply(text)) {
      _simulateFriendReply();
    }
  }

  bool _shouldAutoReply(String text) {
    // For demo purposes, auto-reply to all messages
    return true;
  }

  void _simulateFriendReply() {
    // Simulate typing delay
    Future.delayed(const Duration(seconds: 2), () {
      final now = DateTime.now();
      final replyMessage = MessageModel(
        messageId: 'msg_reply_${now.millisecondsSinceEpoch}',
        chatId: 'chat_user1001_${widget.friend.friendId}',
        senderId: widget.friend.friendId,
        receiverId: 'user1001',
        content: '好的，我知道了。',
        timestamp: now.millisecondsSinceEpoch,
        status: 'read',
        isMine: false,
        messageType: 'text',
        isForwarded: false,
      );

      setState(() {
        _messages.add(replyMessage);
      });

      _scrollToBottom();
    });
  }

  void _scrollToBottom() {
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (_scrollController.hasClients) {
        _scrollController.animateTo(
          _scrollController.position.maxScrollExtent,
          duration: const Duration(milliseconds: 300),
          curve: Curves.easeOut,
        );
      }
    });
  }

  void _showMessageOptions(BuildContext context, MessageModel message) {
    final l10n = AppLocalizations.of(context)!;

    showModalBottomSheet(
      context: context,
      shape: const RoundedRectangleBorder(
        borderRadius: BorderRadius.vertical(top: Radius.circular(8)),
      ),
      builder: (context) {
        return SafeArea(
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              ListTile(
                leading: const Icon(Icons.copy),
                title: Text(l10n.copy),
                onTap: () {
                  Navigator.pop(context);
                  // Copy message to clipboard
                  appLogger.info('Copying message: ${message.content}');
                },
              ),
              ListTile(
                leading: const Icon(Icons.forward),
                title: Text(l10n.forward),
                onTap: () {
                  Navigator.pop(context);
                  // TODO: Implement message forwarding
                  appLogger.info('Forwarding message: ${message.content}');
                },
              ),
              ListTile(
                leading: const Icon(Icons.delete, color: Colors.red),
                title: Text(
                  l10n.delete,
                  style: const TextStyle(color: Colors.red),
                ),
                onTap: () {
                  Navigator.pop(context);
                  _showDeleteConfirmation(context, message);
                },
              ),
            ],
          ),
        );
      },
    );
  }

  void _showDeleteConfirmation(BuildContext context, MessageModel message) {
    final l10n = AppLocalizations.of(context)!;

    showDialog(
      context: context,
      builder: (context) {
        return AlertDialog(
          title: Text(l10n.deleteMessage),
          content: Text(l10n.deleteMessageConfirmation),
          actions: [
            TextButton(
              onPressed: () => Navigator.pop(context),
              child: Text(l10n.cancel),
            ),
            TextButton(
              onPressed: () {
                Navigator.pop(context);
                setState(() {
                  _messages.removeWhere(
                    (m) => m.messageId == message.messageId,
                  );
                });
              },
              style: TextButton.styleFrom(foregroundColor: Colors.red),
              child: Text(l10n.delete),
            ),
          ],
        );
      },
    );
  }

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context)!;
    final friend = widget.friend;
    final displayName =
        friend.remarkName.isNotEmpty ? friend.remarkName : friend.realName;

    return Scaffold(
      appBar: AppBar(
        leading: IconButton(
          icon: const Icon(Icons.arrow_back),
          onPressed: () => Navigator.pop(context),
        ),
        title: Column(
          crossAxisAlignment: CrossAxisAlignment.center,
          children: [
            Text(
              displayName,
              style: const TextStyle(fontSize: 18, fontWeight: FontWeight.bold),
            ),
            Text(
              friend.onlineStatus == 'online'
                  ? l10n.online
                  : l10n.lastSeen(friend.getLastActiveTimeString(context)),
              style: const TextStyle(fontSize: 12, color: Colors.grey),
            ),
          ],
        ),
        centerTitle: true,
        actions: [
          IconButton(
            icon: const Icon(Icons.more_vert),
            onPressed: () {
              // TODO: Show chat options menu
              appLogger.info('Chat options menu pressed');
            },
          ),
        ],
      ),
      body: Column(
        children: [
          // Network status indicator (if needed)
          // _buildNetworkStatusBar(),

          // Messages list
          Expanded(child: _buildMessagesList()),

          // Input area
          MessageInput(controller: _messageController, onSend: _sendMessage),
        ],
      ),
    );
  }

  Widget _buildMessagesList() {
    if (_messages.isEmpty) {
      return Center(child: Text(AppLocalizations.of(context)!.noMessages));
    }

    return ListView.builder(
      controller: _scrollController,
      padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 8),
      itemCount: _isLoading ? _messages.length + 1 : _messages.length,
      itemBuilder: (context, index) {
        if (_isLoading && index == 0) {
          return const Center(
            child: Padding(
              padding: EdgeInsets.symmetric(vertical: 16),
              child: CircularProgressIndicator(),
            ),
          );
        }

        final messageIndex = _isLoading ? index - 1 : index;
        final message = _messages[messageIndex];
        final previousMessage =
            messageIndex > 0 ? _messages[messageIndex - 1] : null;

        // Check if we need to show date separator
        final showDateSeparator =
            previousMessage == null || !message.isSameDay(previousMessage);

        return Column(
          children: [
            if (showDateSeparator) _buildDateSeparator(message.timestamp),
            MessageBubble(
              message: message,
              friend: widget.friend,
              onLongPress: () => _showMessageOptions(context, message),
            ),
          ],
        );
      },
    );
  }

  Widget _buildDateSeparator(int timestamp) {
    final date = DateTime.fromMillisecondsSinceEpoch(timestamp);
    final now = DateTime.now();
    final yesterday = DateTime(now.year, now.month, now.day - 1);

    String dateText;
    if (date.year == now.year &&
        date.month == now.month &&
        date.day == now.day) {
      dateText = AppLocalizations.of(context)!.today;
    } else if (date.year == yesterday.year &&
        date.month == yesterday.month &&
        date.day == yesterday.day) {
      dateText = AppLocalizations.of(context)!.yesterday;
    } else {
      dateText =
          '${date.year}-${date.month.toString().padLeft(2, '0')}-${date.day.toString().padLeft(2, '0')}';
    }

    return Container(
      margin: const EdgeInsets.symmetric(vertical: 16),
      child: Center(
        child: Container(
          padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
          decoration: BoxDecoration(
            color: Colors.grey[200],
            borderRadius: BorderRadius.circular(8),
            border: Border.all(color: Colors.grey[300]!),
          ),
          child: Text(
            dateText,
            style: const TextStyle(fontSize: 12, color: Colors.grey),
          ),
        ),
      ),
    );
  }

}
