import 'package:flutter/material.dart';
import 'package:emoji_picker_flutter/emoji_picker_flutter.dart';
import 'package:peers_touch_ui/theme/colors.dart';

class EmojiPickerPanel extends StatelessWidget {
  final Function(String) onEmojiSelected;
  final TextEditingController? textController;
  final List<String>? recentEmojis;
  final List<String>? favoriteEmojis;
  final Function(String)? onAddFavorite;
  final Function(String)? onRemoveFavorite;

  const EmojiPickerPanel({
    super.key,
    required this.onEmojiSelected,
    this.textController,
    this.recentEmojis,
    this.favoriteEmojis,
    this.onAddFavorite,
    this.onRemoveFavorite,
  });

  @override
  Widget build(BuildContext context) {
    return Container(
      height: 320,
      decoration: BoxDecoration(
        color: AppColors.surface,
        border: Border(
          top: BorderSide(
            color: AppColors.border,
            width: 0.5,
          ),
        ),
      ),
      child: Column(
        children: [
          Expanded(
            child: EmojiPicker(
              onEmojiSelected: (category, emoji) {
                onEmojiSelected(emoji.emoji);
              },
              config: Config(
                height: 280,
                checkPlatformCompatibility: true,
                emojiViewConfig: EmojiViewConfig(
                  emojiSizeMax: 24,
                  columns: 8,
                  verticalSpacing: 8,
                  horizontalSpacing: 8,
                  gridPadding: const EdgeInsets.all(12),
                  backgroundColor: AppColors.surface,
                ),
                categoryViewConfig: CategoryViewConfig(
                  iconColorSelected: AppColors.primary,
                  indicatorColor: AppColors.primary,
                  backgroundColor: AppColors.surface,
                  iconColor: AppColors.iconSecondary,
                  tabBarHeight: 48,
                ),
                bottomActionBarConfig: BottomActionBarConfig(
                  enabled: false,
                ),
                searchViewConfig: SearchViewConfig(
                  backgroundColor: AppColors.surface,
                  buttonColor: AppColors.primary,
                  buttonIconColor: AppColors.surface,
                  hintText: '搜索表情',
                ),
              ),
            ),
          ),
          if (recentEmojis != null && recentEmojis!.isNotEmpty)
            _buildRecentEmojisBar(context),
        ],
      ),
    );
  }

  Widget _buildRecentEmojisBar(BuildContext context) {
    return Container(
      height: 56,
      padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
      decoration: BoxDecoration(
        color: AppColors.surface,
        border: Border(
          top: BorderSide(
            color: AppColors.border,
            width: 0.5,
          ),
        ),
      ),
      child: Row(
        children: [
          Container(
            padding: const EdgeInsets.only(right: 12),
            child: Text(
              '最近使用',
              style: TextStyle(
                fontSize: 12,
                color: AppColors.textSecondary,
              ),
            ),
          ),
          Expanded(
            child: ListView.builder(
              scrollDirection: Axis.horizontal,
              itemCount: recentEmojis!.length,
              itemBuilder: (context, index) {
                final emoji = recentEmojis![index];
                return GestureDetector(
                  onTap: () => onEmojiSelected(emoji),
                  child: Container(
                    padding: const EdgeInsets.symmetric(horizontal: 8),
                    child: Text(
                      emoji,
                      style: const TextStyle(fontSize: 24),
                    ),
                  ),
                );
              },
            ),
          ),
        ],
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
      height: 320,
      decoration: BoxDecoration(
        color: AppColors.surface,
        border: Border(
          top: BorderSide(
            color: AppColors.border,
            width: 0.5,
          ),
        ),
      ),
      child: Column(
        mainAxisAlignment: MainAxisAlignment.center,
        children: [
          Icon(
            Icons.emoji_emotions_outlined,
            size: 64,
            color: AppColors.iconSecondary,
          ),
          const SizedBox(height: 16),
          Text(
            '贴纸功能开发中',
            style: TextStyle(
              fontSize: 16,
              color: AppColors.textSecondary,
            ),
          ),
          const SizedBox(height: 8),
          Text(
            '敬请期待',
            style: TextStyle(
              fontSize: 14,
              color: AppColors.textTertiary,
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
  final List<String>? recentEmojis;
  final List<String>? favoriteEmojis;
  final Function(String)? onAddFavorite;
  final Function(String)? onRemoveFavorite;

  const EmojiAndStickerPicker({
    super.key,
    required this.onEmojiSelected,
    this.onStickerSelected,
    this.textController,
    this.recentEmojis,
    this.favoriteEmojis,
    this.onAddFavorite,
    this.onRemoveFavorite,
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
      height: 376,
      decoration: BoxDecoration(
        color: AppColors.surface,
        border: Border(
          top: BorderSide(
            color: AppColors.border,
            width: 0.5,
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
            labelColor: AppColors.primary,
            unselectedLabelColor: AppColors.textSecondary,
            indicatorColor: AppColors.primary,
          ),
          Expanded(
            child: TabBarView(
              controller: _tabController,
              children: [
                EmojiPickerPanel(
                  onEmojiSelected: widget.onEmojiSelected,
                  textController: widget.textController,
                  recentEmojis: widget.recentEmojis,
                  favoriteEmojis: widget.favoriteEmojis,
                  onAddFavorite: widget.onAddFavorite,
                  onRemoveFavorite: widget.onRemoveFavorite,
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
