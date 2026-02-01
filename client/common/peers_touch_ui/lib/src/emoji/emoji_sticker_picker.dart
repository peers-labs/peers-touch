import 'package:cached_network_image/cached_network_image.dart';
import 'package:emoji_picker_flutter/emoji_picker_flutter.dart';
import 'package:flutter/foundation.dart' as foundation;
import 'package:flutter/material.dart';

/// 表情/贴纸选择器选中类型
enum EmojiStickerType {
  emoji,
  sticker,
}

/// 选中结果
class EmojiStickerSelection {
  const EmojiStickerSelection({
    required this.type,
    this.emoji,
    this.stickerUrl,
    this.stickerUlid,
  });

  /// 选中类型
  final EmojiStickerType type;

  /// Emoji 字符
  final String? emoji;

  /// 贴纸 URL
  final String? stickerUrl;

  /// 贴纸 ULID
  final String? stickerUlid;

  /// 快速创建 emoji 选中
  factory EmojiStickerSelection.emoji(String emoji) {
    return EmojiStickerSelection(
      type: EmojiStickerType.emoji,
      emoji: emoji,
    );
  }

  /// 快速创建贴纸选中
  factory EmojiStickerSelection.sticker(String ulid, String url) {
    return EmojiStickerSelection(
      type: EmojiStickerType.sticker,
      stickerUlid: ulid,
      stickerUrl: url,
    );
  }
}

/// 贴纸数据模型
class StickerData {
  const StickerData({
    required this.ulid,
    required this.url,
    this.thumbnailUrl,
    this.emoji,
  });

  final String ulid;
  final String url;
  final String? thumbnailUrl;
  final String? emoji;
}

/// 贴纸包数据模型
class StickerPackData {
  const StickerPackData({
    required this.ulid,
    required this.name,
    required this.stickers,
    this.coverUrl,
    this.isAnimated = false,
  });

  final String ulid;
  final String name;
  final String? coverUrl;
  final List<StickerData> stickers;
  final bool isAnimated;
}

/// 表情和贴纸选择器
///
/// 支持系统 emoji 和自定义贴纸包。
/// 使用 Tab 切换 Emoji 和贴纸。
class EmojiStickerPicker extends StatefulWidget {
  const EmojiStickerPicker({
    super.key,
    required this.onEmojiSelected,
    this.onStickerSelected,
    this.onBackspacePressed,
    this.stickerPacks = const [],
    this.recentStickers = const [],
    this.height = 300,
    this.showSearchBar = true,
    this.initialTab = 0,
  });

  /// Emoji 选中回调
  final void Function(String emoji) onEmojiSelected;

  /// 贴纸选中回调
  final void Function(StickerData sticker)? onStickerSelected;

  /// 退格键回调
  final VoidCallback? onBackspacePressed;

  /// 贴纸包列表
  final List<StickerPackData> stickerPacks;

  /// 最近使用的贴纸
  final List<StickerData> recentStickers;

  /// 选择器高度
  final double height;

  /// 是否显示搜索栏
  final bool showSearchBar;

  /// 初始 Tab 索引 (0=emoji, 1+=sticker packs)
  final int initialTab;

  @override
  State<EmojiStickerPicker> createState() => _EmojiStickerPickerState();
}

class _EmojiStickerPickerState extends State<EmojiStickerPicker>
    with SingleTickerProviderStateMixin {
  late TabController _tabController;

  @override
  void initState() {
    super.initState();
    // Tabs: [Emoji] + [Recent] + [Sticker Packs...]
    final tabCount = 1 + (widget.recentStickers.isNotEmpty ? 1 : 0) + widget.stickerPacks.length;
    _tabController = TabController(
      length: tabCount,
      vsync: this,
      initialIndex: widget.initialTab.clamp(0, tabCount - 1),
    );
  }

  @override
  void dispose() {
    _tabController.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final hasStickers = widget.stickerPacks.isNotEmpty || widget.recentStickers.isNotEmpty;

    return Container(
      height: widget.height,
      decoration: BoxDecoration(
        color: theme.colorScheme.surface,
        border: Border(
          top: BorderSide(
            color: theme.dividerColor,
            width: 0.5,
          ),
        ),
      ),
      child: Column(
        children: [
          if (hasStickers) _buildTabBar(context),
          Expanded(
            child: hasStickers ? _buildTabBarView() : _buildEmojiPicker(context),
          ),
        ],
      ),
    );
  }

  Widget _buildTabBar(BuildContext context) {
    final theme = Theme.of(context);
    final tabs = <Widget>[
      const Tab(icon: Icon(Icons.emoji_emotions_outlined, size: 20)),
    ];

    if (widget.recentStickers.isNotEmpty) {
      tabs.add(const Tab(icon: Icon(Icons.access_time, size: 20)));
    }

    for (final pack in widget.stickerPacks) {
      tabs.add(Tab(
        child: pack.coverUrl != null
            ? ClipRRect(
                borderRadius: BorderRadius.circular(4),
                child: CachedNetworkImage(
                  imageUrl: pack.coverUrl!,
                  width: 24,
                  height: 24,
                  fit: BoxFit.cover,
                  placeholder: (_, __) => const Icon(Icons.image, size: 20),
                  errorWidget: (_, __, ___) => const Icon(Icons.broken_image, size: 20),
                ),
              )
            : Text(
                pack.name.substring(0, 1),
                style: const TextStyle(fontSize: 16),
              ),
      ));
    }

    return Container(
      height: 44,
      decoration: BoxDecoration(
        border: Border(
          bottom: BorderSide(color: theme.dividerColor, width: 0.5),
        ),
      ),
      child: TabBar(
        controller: _tabController,
        isScrollable: true,
        labelColor: theme.colorScheme.primary,
        unselectedLabelColor: theme.colorScheme.onSurfaceVariant,
        indicatorSize: TabBarIndicatorSize.label,
        dividerColor: Colors.transparent,
        tabs: tabs,
      ),
    );
  }

  Widget _buildTabBarView() {
    final views = <Widget>[
      _buildEmojiPicker(context),
    ];

    if (widget.recentStickers.isNotEmpty) {
      views.add(_buildRecentStickers());
    }

    for (final pack in widget.stickerPacks) {
      views.add(_buildStickerGrid(pack.stickers));
    }

    return TabBarView(
      controller: _tabController,
      children: views,
    );
  }

  Widget _buildEmojiPicker(BuildContext context) {
    final theme = Theme.of(context);

    return EmojiPicker(
      onEmojiSelected: (category, emoji) {
        widget.onEmojiSelected(emoji.emoji);
      },
      onBackspacePressed: widget.onBackspacePressed,
      config: Config(
        height: widget.height - (widget.stickerPacks.isNotEmpty ? 44 : 0),
        checkPlatformCompatibility: true,
        emojiViewConfig: EmojiViewConfig(
          columns: 8,
          emojiSizeMax: 28 * (foundation.defaultTargetPlatform == TargetPlatform.iOS ? 1.2 : 1.0),
          verticalSpacing: 0,
          horizontalSpacing: 0,
          gridPadding: EdgeInsets.zero,
          backgroundColor: theme.colorScheme.surface,
          loadingIndicator: const Center(child: CircularProgressIndicator()),
          noRecents: Text(
            'No Recents',
            style: TextStyle(fontSize: 14, color: theme.colorScheme.onSurfaceVariant),
          ),
        ),
        categoryViewConfig: CategoryViewConfig(
          initCategory: Category.RECENT,
          backgroundColor: theme.colorScheme.surface,
          indicatorColor: theme.colorScheme.primary,
          iconColor: theme.colorScheme.onSurfaceVariant,
          iconColorSelected: theme.colorScheme.primary,
          tabIndicatorAnimDuration: kTabScrollDuration,
          categoryIcons: const CategoryIcons(),
        ),
        bottomActionBarConfig: BottomActionBarConfig(
          backgroundColor: theme.colorScheme.surface,
          buttonIconColor: theme.colorScheme.primary,
          buttonColor: theme.colorScheme.surface,
          showBackspaceButton: widget.onBackspacePressed != null,
          showSearchViewButton: widget.showSearchBar,
        ),
        searchViewConfig: SearchViewConfig(
          backgroundColor: theme.colorScheme.surface,
          buttonIconColor: theme.colorScheme.primary,
          hintText: 'Search emoji...',
        ),
      ),
    );
  }

  Widget _buildRecentStickers() {
    return _buildStickerGrid(widget.recentStickers);
  }

  Widget _buildStickerGrid(List<StickerData> stickers) {
    return GridView.builder(
      padding: const EdgeInsets.all(8),
      gridDelegate: const SliverGridDelegateWithFixedCrossAxisCount(
        crossAxisCount: 4,
        crossAxisSpacing: 8,
        mainAxisSpacing: 8,
      ),
      itemCount: stickers.length,
      itemBuilder: (context, index) {
        final sticker = stickers[index];
        return _buildStickerItem(sticker);
      },
    );
  }

  Widget _buildStickerItem(StickerData sticker) {
    return InkWell(
      onTap: () {
        widget.onStickerSelected?.call(sticker);
      },
      borderRadius: BorderRadius.circular(8),
      child: Container(
        decoration: BoxDecoration(
          borderRadius: BorderRadius.circular(8),
        ),
        child: CachedNetworkImage(
          imageUrl: sticker.thumbnailUrl ?? sticker.url,
          fit: BoxFit.contain,
          placeholder: (_, __) => const Center(
            child: SizedBox(
              width: 20,
              height: 20,
              child: CircularProgressIndicator(strokeWidth: 2),
            ),
          ),
          errorWidget: (_, __, ___) => const Icon(
            Icons.broken_image_outlined,
            color: Colors.grey,
          ),
        ),
      ),
    );
  }
}

/// 简化版 Emoji 选择器（仅 Emoji，无贴纸）
class SimpleEmojiPicker extends StatelessWidget {
  const SimpleEmojiPicker({
    super.key,
    required this.onEmojiSelected,
    this.onBackspacePressed,
    this.height = 260,
  });

  final void Function(String emoji) onEmojiSelected;
  final VoidCallback? onBackspacePressed;
  final double height;

  @override
  Widget build(BuildContext context) {
    return EmojiStickerPicker(
      onEmojiSelected: onEmojiSelected,
      onBackspacePressed: onBackspacePressed,
      height: height,
      stickerPacks: const [],
    );
  }
}
