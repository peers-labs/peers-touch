import 'package:flutter/material.dart';
import 'package:get/get.dart';
import 'package:peers_touch_desktop/features/ai_chat/presentation/controllers/ai_input_controller.dart';
import 'package:peers_touch_desktop/features/ai_chat/domain/models/ai_attachment.dart';

class AttachmentTray extends StatelessWidget {
  final AiInputController controller;
  const AttachmentTray({super.key, required this.controller});

  @override
  Widget build(BuildContext context) {
    return Obx(() {
      final items = controller.attachments;
      if (items.isEmpty) return const SizedBox.shrink();
      return SizedBox(
        height: 56,
        child: ListView.separated(
          scrollDirection: Axis.horizontal,
          padding: const EdgeInsets.symmetric(horizontal: 8),
          itemCount: items.length,
          separatorBuilder: (_, __) => const SizedBox(width: 8),
          itemBuilder: (_, i) {
            final a = items[i];
            return Chip(
              label: Text(_labelOf(a)),
              avatar: Icon(_iconOf(a)),
              onDeleted: () => controller.removeAttachment(a.id),
            );
          },
        ),
      );
    });
  }

  String _labelOf(AiAttachment a) => a.name ?? a.type.name;
  IconData _iconOf(AiAttachment a) {
    switch (a.type) {
      case AiAttachmentType.image:
        return Icons.image_outlined;
      case AiAttachmentType.file:
        return Icons.insert_drive_file_outlined;
      case AiAttachmentType.audio:
        return Icons.mic_none;
    }
  }
}