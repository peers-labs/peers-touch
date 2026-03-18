import 'package:flutter/material.dart';

enum AttachmentOption {
  IMAGE,
  FILE,
  LOCATION,
  AUDIO,
  VIDEO,
  CONTACT,
}

class AttachmentSelector extends StatelessWidget {
  final Function(AttachmentOption) onOptionSelected;

  const AttachmentSelector({
    super.key,
    required this.onOptionSelected,
  });

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.all(20),
      decoration: BoxDecoration(
        color: Theme.of(context).colorScheme.surface,
        borderRadius: const BorderRadius.vertical(top: Radius.circular(20)),
        boxShadow: [
          BoxShadow(
            color: Colors.black.withOpacity(0.1),
            blurRadius: 10,
            offset: const Offset(0, -2),
          ),
        ],
      ),
      child: SafeArea(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Container(
              width: 40,
              height: 4,
              margin: const EdgeInsets.only(bottom: 20),
              decoration: BoxDecoration(
                color: Colors.grey[300],
                borderRadius: BorderRadius.circular(2),
              ),
            ),
            Text(
              '选择附件类型',
              style: Theme.of(context).textTheme.titleMedium?.copyWith(
                    fontWeight: FontWeight.bold,
                  ),
            ),
            const SizedBox(height: 20),
            GridView.count(
              shrinkWrap: true,
              crossAxisCount: 3,
              mainAxisSpacing: 16,
              crossAxisSpacing: 16,
              physics: const NeverScrollableScrollPhysics(),
              children: [
                _AttachmentOption(
                  icon: Icons.image,
                  label: '图片',
                  color: Colors.purple,
                  onTap: () {
                    Navigator.pop(context);
                    onOptionSelected(AttachmentOption.IMAGE);
                  },
                ),
                _AttachmentOption(
                  icon: Icons.insert_drive_file,
                  label: '文件',
                  color: Colors.blue,
                  onTap: () {
                    Navigator.pop(context);
                    onOptionSelected(AttachmentOption.FILE);
                  },
                ),
                _AttachmentOption(
                  icon: Icons.location_on,
                  label: '位置',
                  color: Colors.green,
                  onTap: () {
                    Navigator.pop(context);
                    onOptionSelected(AttachmentOption.LOCATION);
                  },
                ),
                _AttachmentOption(
                  icon: Icons.mic,
                  label: '语音',
                  color: Colors.orange,
                  onTap: () {
                    Navigator.pop(context);
                    onOptionSelected(AttachmentOption.AUDIO);
                  },
                ),
                _AttachmentOption(
                  icon: Icons.videocam,
                  label: '视频',
                  color: Colors.red,
                  onTap: () {
                    Navigator.pop(context);
                    onOptionSelected(AttachmentOption.VIDEO);
                  },
                ),
                _AttachmentOption(
                  icon: Icons.person,
                  label: '名片',
                  color: Colors.teal,
                  onTap: () {
                    Navigator.pop(context);
                    onOptionSelected(AttachmentOption.CONTACT);
                  },
                ),
              ],
            ),
            const SizedBox(height: 10),
          ],
        ),
      ),
    );
  }

  static Future<AttachmentOption?> show(
    BuildContext context, {
    required Function(AttachmentOption) onOptionSelected,
  }) {
    return showModalBottomSheet<AttachmentOption>(
      context: context,
      backgroundColor: Colors.transparent,
      isScrollControlled: true,
      builder: (context) => AttachmentSelector(
        onOptionSelected: onOptionSelected,
      ),
    );
  }
}

class _AttachmentOption extends StatelessWidget {
  final IconData icon;
  final String label;
  final Color color;
  final VoidCallback onTap;

  const _AttachmentOption({
    required this.icon,
    required this.label,
    required this.color,
    required this.onTap,
  });

  @override
  Widget build(BuildContext context) {
    return InkWell(
      onTap: onTap,
      borderRadius: BorderRadius.circular(12),
      child: Column(
        mainAxisAlignment: MainAxisAlignment.center,
        children: [
          Container(
            width: 56,
            height: 56,
            decoration: BoxDecoration(
              color: color.withOpacity(0.1),
              borderRadius: BorderRadius.circular(12),
            ),
            child: Icon(
              icon,
              color: color,
              size: 28,
            ),
          ),
          const SizedBox(height: 8),
          Text(
            label,
            style: Theme.of(context).textTheme.bodySmall,
            textAlign: TextAlign.center,
          ),
        ],
      ),
    );
  }
}
