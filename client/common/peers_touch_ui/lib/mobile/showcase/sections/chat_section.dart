import 'package:flutter/material.dart';
import 'package:peers_touch_ui/foundation/avatar.dart';
import 'package:peers_touch_ui/mobile/chat/chat.dart';
import 'package:peers_touch_ui/tokens/tokens.dart';

class ChatSection extends StatelessWidget {
  const ChatSection({super.key});

  @override
  Widget build(BuildContext context) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text(
          '💬 Chat Components',
          style: TextStyle(
            fontFamily: AppTypography.fontFamily,
            fontSize: AppTypography.fontSizeXl,
            fontWeight: AppTypography.fontWeightSemibold,
            color: AppColors.textPrimary,
          ),
        ),
        const SizedBox(height: AppSpacing.md),
        _buildMessageBubbleSection(),
        const SizedBox(height: AppSpacing.md),
        _buildConversationItemSection(),
        const SizedBox(height: AppSpacing.md),
        _buildChatInputSection(),
      ],
    );
  }

  Widget _buildMessageBubbleSection() {
    return _SectionCard(
      title: 'MessageBubble',
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Container(
            padding: const EdgeInsets.all(AppSpacing.sm),
            decoration: BoxDecoration(
              color: AppColors.backgroundSecondary,
              borderRadius: AppRadius.mdBorder,
            ),
            child: Column(
              children: [
                MessageBubble(
                  message: 'Hello! How are you?',
                  type: MessageBubbleType.received,
                  senderName: 'John Doe',
                  time: '10:30',
                  showName: true,
                ),
                MessageBubble(
                  message: 'I\'m doing great, thanks for asking! How about you?',
                  type: MessageBubbleType.sent,
                  time: '10:31',
                ),
                MessageBubble(
                  message: 'Pretty good! Just working on some new features.',
                  type: MessageBubbleType.received,
                  senderName: 'John Doe',
                  time: '10:32',
                ),
                MessageBubble(
                  message: 'That sounds exciting! Let me know if you need any help.',
                  type: MessageBubbleType.sent,
                  time: '10:33',
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }

  Widget _buildConversationItemSection() {
    return _SectionCard(
      title: 'ConversationItem',
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          ConversationItem(
            name: 'John Doe',
            lastMessage: 'Hey, how are you doing?',
            time: '10:30',
            isOnline: true,
            unreadCount: 3,
            onTap: () {},
          ),
          ConversationItem(
            name: 'Jane Smith',
            lastMessage: 'See you tomorrow!',
            time: 'Yesterday',
            isOnline: false,
            onTap: () {},
          ),
          ConversationItem(
            name: 'Team Group',
            lastMessage: 'Alice: I\'ll handle the frontend part.',
            time: 'Mon',
            isPinned: true,
            unreadCount: 12,
            onTap: () {},
          ),
          ConversationItem(
            name: 'Bob Wilson',
            lastMessage: 'Thanks for the update!',
            time: 'Sun',
            isMuted: true,
            onTap: () {},
          ),
        ],
      ),
    );
  }

  Widget _buildChatInputSection() {
    return _SectionCard(
      title: 'ChatInput',
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          const Text('Chat Input Bar:'),
          const SizedBox(height: AppSpacing.xs),
          Container(
            decoration: BoxDecoration(
              border: Border.all(color: AppColors.border),
              borderRadius: AppRadius.mdBorder,
            ),
            child: const ChatInput(
              hintText: 'Type a message...',
            ),
          ),
        ],
      ),
    );
  }
}

class _SectionCard extends StatelessWidget {
  final String title;
  final Widget child;

  const _SectionCard({
    required this.title,
    required this.child,
  });

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.all(AppSpacing.md),
      decoration: BoxDecoration(
        color: AppColors.background,
        borderRadius: AppRadius.lgBorder,
        border: Border.all(
          color: AppColors.border,
          width: 1,
        ),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(
            title,
            style: TextStyle(
              fontFamily: AppTypography.fontFamily,
              fontSize: AppTypography.fontSizeMd,
              fontWeight: AppTypography.fontWeightSemibold,
              color: AppColors.textPrimary,
            ),
          ),
          const SizedBox(height: AppSpacing.sm),
          child,
        ],
      ),
    );
  }
}
