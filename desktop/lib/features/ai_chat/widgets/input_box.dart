import 'package:flutter/material.dart';
import 'package:get/get.dart';
import 'package:peers_touch_desktop/app/theme/lobe_tokens.dart';
import 'package:peers_touch_desktop/features/ai_chat/controller/ai_chat_input_controller.dart';


class InputBox extends StatelessWidget {
  final TextEditingController textController;
  final VoidCallback onSend;
  final bool isLoading;

  const InputBox({
    super.key,
    required this.textController,
    required this.onSend,
    this.isLoading = false,
  });

  @override
  Widget build(BuildContext context) {
    final tokens = Theme.of(context).extension<LobeTokens>()!;

    return Container(
      margin: const EdgeInsets.all(12),
      padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 8),
      decoration: BoxDecoration(
        color: tokens.bgLevel2,
        borderRadius: BorderRadius.circular(12),
        border: Border.all(color: tokens.divider, width: 1.5),
      ),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.center,
        children: [
          _buildIconButton(tokens, Icons.attach_file_outlined, '附件', () {}),
          const SizedBox(width: 4),
          _buildTextButton(tokens, Icons.psychology_outlined, '深度思考', () {}),
          const SizedBox(width: 8),
          _buildTextButton(tokens, Icons.interests_outlined, '技能', () {}),
          const SizedBox(width: 12),
          Expanded(
            child: TextField(
              controller: textController,
              style: TextStyle(color: tokens.textPrimary, fontSize: 14),
              decoration: InputDecoration(
                hintText: '发消息或输入 / 选择技能',
                hintStyle: TextStyle(color: tokens.textTertiary),
                border: InputBorder.none,
              ),
            ),
          ),
          const SizedBox(width: 12),
          _buildIconButton(tokens, Icons.cut, '剪切', () {}),
          const SizedBox(width: 4),
          _buildIconButton(tokens, Icons.phone_in_talk_outlined, '通话', () {}),
          const SizedBox(width: 4),
          _buildIconButton(tokens, Icons.mic_none_outlined, '语音输入', () {}),
          const SizedBox(width: 8),
          _buildSendButton(tokens),
        ],
      ),
    );
  }

  Widget _buildIconButton(LobeTokens tokens, IconData icon, String tooltip, VoidCallback onPressed) {
    return IconButton(
      icon: Icon(icon, color: tokens.textSecondary, size: 20),
      tooltip: tooltip,
      onPressed: isLoading ? null : onPressed,
      style: IconButton.styleFrom(padding: const EdgeInsets.all(8)),
    );
  }

  Widget _buildTextButton(LobeTokens tokens, IconData icon, String label, VoidCallback onPressed) {
    return TextButton.icon(
      onPressed: isLoading ? null : onPressed,
      style: TextButton.styleFrom(
        foregroundColor: tokens.textSecondary,
        backgroundColor: tokens.bgLevel3,
        padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(8)),
      ),
      icon: Icon(icon, size: 16),
      label: Text(label, style: const TextStyle(fontSize: 12, fontWeight: FontWeight.bold)),
    );
  }

  Widget _buildSendButton(LobeTokens tokens) {
    return Container(
      decoration: BoxDecoration(
        color: isLoading ? tokens.bgLevel3 : tokens.brandAccent,
        shape: BoxShape.circle,
      ),
      child: IconButton(
        icon: isLoading
            ? SizedBox(
                width: 16,
                height: 16,
                child: CircularProgressIndicator(
                  strokeWidth: 2,
                  valueColor: AlwaysStoppedAnimation<Color>(tokens.textPrimary),
                ),
              )
            : Icon(Icons.arrow_upward, color: tokens.textPrimary, size: 20),
        tooltip: '发送',
        onPressed: isLoading ? null : onSend,
        style: IconButton.styleFrom(padding: const EdgeInsets.all(8)),
      ),
    );
  }
}