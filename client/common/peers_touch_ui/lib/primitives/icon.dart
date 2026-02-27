import 'package:flutter/material.dart';
import 'package:peers_touch_ui/theme/theme.dart';

enum IconSize { xxs, xs, sm, md, lg, xl, xxl }

class AppIcon extends StatelessWidget {
  final IconData icon;
  final IconSize size;
  final Color? color;
  final VoidCallback? onTap;

  const AppIcon({
    super.key,
    required this.icon,
    this.size = IconSize.md,
    this.color,
    this.onTap,
  });

  double get _size {
    switch (size) {
      case IconSize.xxs:
        return 12;
      case IconSize.xs:
        return 14;
      case IconSize.sm:
        return 16;
      case IconSize.md:
        return 20;
      case IconSize.lg:
        return 24;
      case IconSize.xl:
        return 32;
      case IconSize.xxl:
        return 40;
    }
  }

  @override
  Widget build(BuildContext context) {
    Widget iconWidget = Icon(
      icon,
      size: _size,
      color: color ?? AppColors.textSecondary,
    );

    if (onTap != null) {
      iconWidget = GestureDetector(
        onTap: onTap,
        child: iconWidget,
      );
    }

    return iconWidget;
  }
}
