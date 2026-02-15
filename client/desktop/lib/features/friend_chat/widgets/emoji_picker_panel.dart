import 'package:flutter/material.dart';
import 'package:emoji_picker_flutter/emoji_picker_flutter.dart';

class EmojiPickerPanel extends StatelessWidget {
  final Function(String) onEmojiSelected;
  final TextEditingController? textController;

  const EmojiPickerPanel({
    super.key,
    required this.onEmojiSelected,
    this.textController,
  });

  @override
  Widget build(BuildContext context) {
    return Container(
      height: 300,
      decoration: BoxDecoration(
        color: Theme.of(context).colorScheme.surface,
        border: Border(
          top: BorderSide(
            color: Colors.grey[300]!,
            width: 1,
          ),
        ),
      ),
      child: EmojiPicker(
        onEmojiSelected: (category, emoji) {
          onEmojiSelected(emoji.emoji);
        },
        textEditingController: textController,
        config: Config(
          columns: 7,
          emojiSizeMax: 32,
          verticalSpacing: 0,
          horizontalSpacing: 0,
          gridPadding: EdgeInsets.zero,
          initCategory: Category.RECENT,
          bgColor: Theme.of(context).colorScheme.surface,
          indicatorColor: Theme.of(context).colorScheme.primary,
          iconColor: Colors.grey,
          iconColorSelected: Theme.of(context).colorScheme.primary,
          backspaceColor: Theme.of(context).colorScheme.primary,
          skinToneDialogBgColor: Colors.white,
          skinToneIndicatorColor: Colors.grey,
          enableSkinTones: true,
          recentTabBehavior: RecentTabBehavior.RECENT,
          recentsLimit: 28,
          replaceEmojiOnLimitExceed: false,
          noRecents: const Text(
            '没有最近使用的表情',
            style: TextStyle(fontSize: 20, color: Colors.black26),
            textAlign: TextAlign.center,
          ),
          loadingIndicator: const SizedBox.shrink(),
          tabIndicatorAnimDuration: kTabScrollDuration,
          categoryIcons: const CategoryIcons(),
          buttonMode: ButtonMode.MATERIAL,
          checkPlatformCompatibility: true,
        ),
      ),
    );
  }
}

class StickerPickerPanel extends StatelessWidget {
  final Function(String, String) onStickerSelected;

  const StickerPickerPanel({
    super.key,
    required this.onStickerSelected,
  });

  @override
  Widget build(BuildContext context) {
    return Container(
      height: 300,
      decoration: BoxDecoration(
        color: Theme.of(context).colorScheme.surface,
        border: Border(
          top: BorderSide(
            color: Colors.grey[300]!,
            width: 1,
          ),
        ),
      ),
      child: Column(
        mainAxisAlignment: MainAxisAlignment.center,
        children: [
          Icon(
            Icons.emoji_emotions_outlined,
            size: 64,
            color: Colors.grey[400],
          ),
          const SizedBox(height: 16),
          Text(
            '贴纸功能开发中',
            style: TextStyle(
              fontSize: 16,
              color: Colors.grey[600],
            ),
          ),
          const SizedBox(height: 8),
          Text(
            '敬请期待',
            style: TextStyle(
              fontSize: 14,
              color: Colors.grey[400],
            ),
          ),
        ],
      ),
    );
  }
}

class EmojiAndStickerPicker extends StatefulWidget {
  final Function(String) onEmojiSelected;
  final Function(String, String)? onStickerSelected;
  final TextEditingController? textController;

  const EmojiAndStickerPicker({
    super.key,
    required this.onEmojiSelected,
    this.onStickerSelected,
    this.textController,
  });

  @override
  State<EmojiAndStickerPicker> createState() => _EmojiAndStickerPickerState();
}

class _EmojiAndStickerPickerState extends State<EmojiAndStickerPicker>
    with SingleTickerProviderStateMixin {
  late TabController _tabController;

  @override
  void initState() {
    super.initState();
    _tabController = TabController(length: 2, vsync: this);
  }

  @override
  void dispose() {
    _tabController.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return Container(
      height: 340,
      decoration: BoxDecoration(
        color: Theme.of(context).colorScheme.surface,
        border: Border(
          top: BorderSide(
            color: Colors.grey[300]!,
            width: 1,
          ),
        ),
      ),
      child: Column(
        children: [
          TabBar(
            controller: _tabController,
            tabs: const [
              Tab(
                icon: Icon(Icons.emoji_emotions),
                text: 'Emoji',
              ),
              Tab(
                icon: Icon(Icons.collections),
                text: '贴纸',
              ),
            ],
            labelColor: Theme.of(context).colorScheme.primary,
            unselectedLabelColor: Colors.grey,
            indicatorColor: Theme.of(context).colorScheme.primary,
          ),
          Expanded(
            child: TabBarView(
              controller: _tabController,
              children: [
                EmojiPickerPanel(
                  onEmojiSelected: widget.onEmojiSelected,
                  textController: widget.textController,
                ),
                StickerPickerPanel(
                  onStickerSelected: widget.onStickerSelected ??
                      (url, name) {},
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }
}
