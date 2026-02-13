import 'package:flutter/material.dart';
import 'package:peers_touch_ui/desktop/chat/chat.dart';
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
        Wrap(
          spacing: AppSpacing.lg,
          runSpacing: AppSpacing.lg,
          children: [
            SizedBox(width: 400, child: _buildMessageBubbleSection()),
            SizedBox(width: 400, child: _buildConversationItemSection()),
          ],
        ),
        const SizedBox(height: AppSpacing.lg),
        _buildChatInputSection(),
      ],
    );
  }

  Widget _buildMessageBubbleSection() {
    return _SectionCard(
      title: 'MessageBubble',
      child: Container(
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
              message: 'I\'m doing great, thanks!',
              type: MessageBubbleType.sent,
              time: '10:31',
            ),
            MessageBubble(
              message: 'That sounds good!',
              type: MessageBubbleType.received,
              senderName: 'John Doe',
              time: '10:32',
            ),
          ],
        ),
      ),
    );
  }

  Widget _buildConversationItemSection() {
    return _SectionCard(
      title: 'ConversationItem',
      child: Column(
        children: [
          ConversationItem(
            name: 'John Doe',
            lastMessage: 'Hey, how are you?',
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
            isSelected: true,
            onTap: () {},
          ),
          ConversationItem(
            name: 'Team Group',
            lastMessage: 'Alice: I\'ll handle the frontend.',
            time: 'Mon',
            isPinned: true,
            unreadCount: 12,
            onTap: () {},
          ),
        ],
      ),
    );
  }

  Widget _buildChatInputSection() {
    return _SectionCard(
      title: 'ChatInput',
      child: Container(
        decoration: BoxDecoration(
          border: Border.all(color: AppColors.border),
          borderRadius: AppRadius.mdBorder,
        ),
        child: const ChatInput(
          hintText: 'Type a message...',
        ),
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
