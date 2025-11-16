import 'package:flutter/material.dart';
import 'package:peers_touch_desktop/app/theme/theme_tokens.dart';
import 'package:peers_touch_desktop/app/theme/lobe_tokens.dart';

/// 统一 UI 尺寸与间距访问入口
/// - 避免在业务代码中散落“魔法数字”
/// - 优先从 ThemeExtension tokens 读取（WeChatTokens/LobeTokens）
/// - 提供少量布局固定宽度的集中常量，便于治理
class UIKit {
  // 布局固定宽度（骨架级，不随主题改变）
  static const double primaryMenuWidth = 64; // 一级菜单栏
  static const double secondaryNavWidth = 280; // 二级导航（会话列表）
  static const double rightPanelWidth = 280; // 右侧辅助面板默认宽度
  static const double rightPanelMinWidth = 240; // 右侧辅助面板最小宽度
  static const double rightPanelMaxWidth = 420; // 右侧辅助面板最大宽度
  static const double splitHandleWidth = 8; // 面板分隔拖拽把手宽度
  // 折叠态宽度：采用折叠按钮尺寸的 120%，两侧各留 10%
  static const double rightPanelCollapsedWidth = controlHeightMd * 1.2; // 48px（基于 40px 按钮）
  static const double topBarHeight = 64; // 顶部栏统一高度
  static const double controlHeightMd = 40; // 中等控件高度（如按钮）
  static const double buttonMinWidthSm = 92; // 小按钮最小宽度
  static const double dividerThickness = 1; // 细分割线厚度
  static const double contentMaxWidth = 1200; // 页面内容最大宽度（仅用于某些居中显示场景）
  static const double indicatorSizeSm = 24; // 小型进度指示尺寸
  static const double avatarBlockHeight = 80; // 一级菜单头像/尾部块高度
  static const double anchorBarWidth = 20; // 锚点条宽度（旧组件）

  // 间距（优先读取 tokens，fallback 到合理默认）
  static double spaceXs(BuildContext context) =>
      _wx(context)?.spaceXs ?? _lobe(context)?.spaceXs ?? 4;
  static double spaceSm(BuildContext context) =>
      _wx(context)?.spaceSm ?? _lobe(context)?.spaceSm ?? 8;
  static double spaceMd(BuildContext context) =>
      _wx(context)?.spaceMd ?? _lobe(context)?.spaceMd ?? 12;
  static double spaceLg(BuildContext context) =>
      _wx(context)?.spaceLg ?? _lobe(context)?.spaceLg ?? 16;
  static double spaceXl(BuildContext context) =>
      _wx(context)?.spaceXl ?? _lobe(context)?.spaceXl ?? 24;

  // 圆角（同样从 tokens 读取）
  static double radiusSm(BuildContext context) =>
      _wx(context)?.radiusSm ?? _lobe(context)?.radiusSm ?? 6;
  static double radiusMd(BuildContext context) =>
      _wx(context)?.radiusMd ?? _lobe(context)?.radiusMd ?? 8;
  static double radiusLg(BuildContext context) =>
      _wx(context)?.radiusLg ?? _lobe(context)?.radiusLg ?? 12;

  // 颜色抽象：气泡、错误提示等
  static Color userBubbleBg(BuildContext context) {
    final theme = Theme.of(context);
    final lobe = _lobe(context);
    return (lobe?.brandAccent ?? theme.colorScheme.primary).withOpacity(0.12);
  }

  static Color assistantBubbleBg(BuildContext context) {
    final theme = Theme.of(context);
    final lobe = _lobe(context);
    final base = lobe?.bgLevel3 ?? theme.colorScheme.surfaceVariant;
    return base.withOpacity(0.12);
  }

  static Color errorColor(BuildContext context) => Theme.of(context).colorScheme.error;

  static Color dividerColor(BuildContext context) {
    final wx = _wx(context);
    final lobe = _lobe(context);
    return wx?.divider ?? lobe?.divider ?? Theme.of(context).colorScheme.outlineVariant;
  }

  static Color textPrimary(BuildContext context) {
    final wx = _wx(context);
    final lobe = _lobe(context);
    return wx?.textPrimary ?? lobe?.textPrimary ?? Theme.of(context).colorScheme.onSurface;
  }

  static Color textSecondary(BuildContext context) {
    final wx = _wx(context);
    final lobe = _lobe(context);
    return wx?.textSecondary ?? lobe?.textSecondary ?? Theme.of(context).colorScheme.onSurfaceVariant;
  }

  // 阴影抽象：面板阴影
  static List<BoxShadow> panelShadow(BuildContext context) => [
        BoxShadow(
          color: Theme.of(context).shadowColor.withOpacity(0.3),
          blurRadius: 8,
          offset: const Offset(-2, 0),
        ),
      ];

  // 页面区块背景色（根据当前主题 tokens 映射）
  // - 左侧助手侧栏背景
  static Color assistantSidebarBg(BuildContext context) {
    final wx = _wx(context);
    final lobe = _lobe(context);
    return wx?.bgLevel2 ?? lobe?.bgLevel2 ?? Theme.of(context).colorScheme.surfaceVariant;
  }

  // - 中间聊天内容区背景
  static Color chatAreaBg(BuildContext context) {
    final wx = _wx(context);
    final lobe = _lobe(context);
    return wx?.bgLevel1 ?? lobe?.bgLevel1 ?? Theme.of(context).colorScheme.surface;
  }

  // - 右侧扩展主题面板背景
  static Color chatRightPanelBg(BuildContext context) {
    final wx = _wx(context);
    final lobe = _lobe(context);
    return wx?.bgLevel3 ?? lobe?.bgLevel3 ?? Theme.of(context).colorScheme.surfaceContainerHighest;
  }

  // 统一的正方形圆角图标按钮样式（用于顶部工具栏等）
  // - 尺寸：使用全局控件高度（中等）保证正方形
  // - 圆角：使用全局中号圆角，遵循主题 tokens
  // - 颜色：采用主题主色容器/文字色，兼顾明暗主题
  static ButtonStyle squareIconButtonStyle(BuildContext context) {
    final theme = Theme.of(context);
    final radius = radiusMd(context);
    final bg = theme.colorScheme.primaryContainer;
    final fg = theme.colorScheme.onPrimaryContainer;
    return IconButton.styleFrom(
      backgroundColor: bg,
      foregroundColor: fg,
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(radius)),
      padding: EdgeInsets.zero,
      minimumSize: Size.square(controlHeightMd),
      fixedSize: Size.square(controlHeightMd),
    );
  }

  // —— 输入/搜索框统一样式 ——
  // 浅填充色（在当前主题的基础上稍微提亮）
  static Color inputFillLight(BuildContext context) {
    final wx = _wx(context);
    final lobe = _lobe(context);
    final base = wx?.bgLevel3 ?? lobe?.bgLevel3 ?? Theme.of(context).colorScheme.surfaceVariant;
    return _lighten(base, 0.06);
  }

  // 统一主要按钮样式
  static ButtonStyle primaryButtonStyle(BuildContext context) {
    final theme = Theme.of(context);
    return ElevatedButton.styleFrom(
      backgroundColor: theme.colorScheme.primary,
      foregroundColor: theme.colorScheme.onPrimary,
      minimumSize: const Size(buttonMinWidthSm, controlHeightMd),
      shape: RoundedRectangleBorder(
        borderRadius: BorderRadius.circular(radiusMd(context)),
      ),
    );
  }

  // 透明边框
  static OutlineInputBorder transparentBorder(BuildContext context) {
    return OutlineInputBorder(
      borderSide: const BorderSide(color: Colors.transparent, width: dividerThickness),
      borderRadius: BorderRadius.circular(radiusSm(context)),
    );
  }

  // 统一输入框样式
  static InputDecoration inputDecoration(BuildContext context) {
    final tokens = _lobe(context)!;
    return InputDecoration(
      filled: true,
      fillColor: inputFillLight(context),
      border: inputOutlineBorder(context),
      enabledBorder: inputOutlineBorder(context),
      focusedBorder: inputFocusedBorder(context),
      contentPadding: EdgeInsets.symmetric(
        horizontal: spaceSm(context),
        vertical: spaceSm(context),
      ),
      hintStyle: TextStyle(color: tokens.textSecondary.withOpacity(0.7)),
    );
  }

  // 通用朴素边框（未聚焦/启用）
  static OutlineInputBorder inputOutlineBorder(BuildContext context) {
    return OutlineInputBorder(
      borderSide: BorderSide(color: dividerColor(context), width: dividerThickness),
      borderRadius: BorderRadius.circular(radiusSm(context)),
    );
  }

  // 聚焦边框（强调主色，但保持统一圆角与厚度）
  static OutlineInputBorder inputFocusedBorder(BuildContext context) {
    final theme = Theme.of(context);
    return OutlineInputBorder(
      borderSide: BorderSide(color: theme.colorScheme.primary, width: dividerThickness),
      borderRadius: BorderRadius.circular(radiusSm(context)),
    );
  }

  // 轻量的提亮函数（HSL空域，控制亮度）
  static Color _lighten(Color color, double amount) {
    final hsl = HSLColor.fromColor(color);
    final l = (hsl.lightness + amount).clamp(0.0, 1.0);
    return hsl.withLightness(l).toColor();
  }

  // 私有：读取不同主题的 tokens
  static WeChatTokens? _wx(BuildContext context) =>
      Theme.of(context).extension<WeChatTokens>();
  static LobeTokens? _lobe(BuildContext context) =>
      Theme.of(context).extension<LobeTokens>();
}