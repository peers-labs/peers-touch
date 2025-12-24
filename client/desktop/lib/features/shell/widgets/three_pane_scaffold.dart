import 'dart:math' as math;

import 'package:flutter/material.dart';
import 'package:peers_touch_desktop/app/theme/theme_tokens.dart';
import 'package:peers_touch_desktop/app/theme/ui_kit.dart';

enum ScrollPolicy { none, auto, always }

class PaneProps {
  const PaneProps({
    this.width,
    this.minWidth,
    this.maxWidth,
    this.padding,
    this.scrollPolicy = ScrollPolicy.auto,
    this.horizontalPolicy = ScrollPolicy.auto,
  });
  final double? width; // 初始宽度（仅左 pane 使用）
  final double? minWidth; // 最小宽度
  final double? maxWidth; // 最大宽度
  final EdgeInsets? padding;
  // 垂直滚动策略（原 scrollPolicy）
  final ScrollPolicy scrollPolicy;
  // 水平滚动策略
  final ScrollPolicy horizontalPolicy;
}

/// 三段式骨架：left（可选，可调宽，受限范围）+ center（填充）
/// 右扩展页仍由 ShellPage 控制，不在此组件内处理。
class ShellThreePane extends StatelessWidget {
  const ShellThreePane({
    super.key,
    this.leftBuilder,
    required this.centerBuilder,
    this.leftProps = const PaneProps(width: 280.0, minWidth: 220.0, maxWidth: 360.0, scrollPolicy: ScrollPolicy.always),
    this.centerProps = const PaneProps(scrollPolicy: ScrollPolicy.none),
    this.goldenMaxRatio = 0.618,
    this.leftWidth,
    this.onLeftWidthChange,
  });
  final WidgetBuilder? leftBuilder;
  final WidgetBuilder centerBuilder;
  final PaneProps leftProps;
  final PaneProps centerProps;
  final double goldenMaxRatio;
  final double? leftWidth;
  final ValueChanged<double>? onLeftWidthChange;

  static const double _handleWidth = UIKit.splitHandleWidth;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final tokens = theme.extension<WeChatTokens>();
    return LayoutBuilder(
      builder: (ctx, constraints) {
        final availableW = constraints.maxWidth.isFinite
            ? constraints.maxWidth
            : MediaQuery.of(ctx).size.width;
        final minLeft = leftProps.minWidth ?? 220.0;
        final maxAllowedByProps = leftProps.maxWidth ?? 360.0;
        final centerMin = (centerProps.minWidth ?? math.max(360.0, availableW * 0.33));
        final goldenMax = availableW * goldenMaxRatio;
        final maxLeftByCenter = math.max(0.0, availableW - _handleWidth - centerMin);
        final maxLeft = math.min(maxAllowedByProps, math.min(goldenMax, maxLeftByCenter));
        final base = (leftWidth ?? leftProps.width ?? 280.0).toDouble();
        final clamped = base.clamp(minLeft, math.max(minLeft, maxLeft)).toDouble();
        return Row(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        if (leftBuilder != null) ...[
          Container(
              width: clamped,
              decoration: BoxDecoration(
                color: tokens?.bgLevel2 ?? theme.colorScheme.surface,
              ),
              child: _wrapScroll(
                context,
                Builder(builder: leftBuilder!),
                leftProps,
              ),
            ),
          // 垂直拖拽把手（受限范围），支持调节左栏宽度
          MouseRegion(
            cursor: SystemMouseCursors.resizeColumn,
            child: GestureDetector(
              behavior: HitTestBehavior.opaque,
              onPanUpdate: (details) {
                final dynamicMaxLeftByCenter = math.max(0.0, availableW - _handleWidth - centerMin);
                final dynamicMaxLeft = math.max(minLeft, math.min(maxAllowedByProps, math.min(goldenMax, dynamicMaxLeftByCenter)));
                final nextRaw = clamped + details.delta.dx;
                final next = nextRaw.clamp(minLeft, dynamicMaxLeft).toDouble();
                if (onLeftWidthChange != null) onLeftWidthChange!(next);
              },
              child: Container(
                width: _handleWidth,
                // 仅保留中间的 2px 线作为视觉把手，不填充背景色
                color: Colors.transparent,
                child: Center(
                  child: Container(
                    width: 2,
                    height: 24,
                    color: UIKit.dividerColor(context),
                  ),
                ),
              ),
            ),
          ),
        ],
        // 中心填充区（遵循滚动策略），不限制最大宽高，窗口可自由拉伸
        Expanded(
          child: _wrapScroll(
            context,
            Builder(builder: centerBuilder),
            centerProps,
          ),
        ),
      ],
        );
      },
    );
  }

  Widget _wrapScroll(BuildContext context, Widget child, PaneProps props) {
    final padding = props.padding ?? EdgeInsets.zero;
    // 简化包装：暂时移除滚动与约束逻辑，仅应用内边距，避免在复杂嵌套场景下产生未布局错误。
    return Padding(padding: padding, child: child);
  }
}
