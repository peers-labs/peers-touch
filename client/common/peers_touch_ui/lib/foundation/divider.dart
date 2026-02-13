import 'package:flutter/material.dart';
import 'package:peers_touch_ui/tokens/tokens.dart';

enum DividerDirection { horizontal, vertical }

class AppDivider extends StatelessWidget {
  final DividerDirection direction;
  final double? thickness;
  final Color? color;
  final double? length;
  final EdgeInsetsGeometry? margin;

  const AppDivider({
    super.key,
    this.direction = DividerDirection.horizontal,
    this.thickness,
    this.color,
    this.length,
    this.margin,
  });

  @override
  Widget build(BuildContext context) {
    final dividerColor = color ?? AppColors.border;
    final dividerThickness = thickness ?? 1;

    Widget divider;

    if (direction == DividerDirection.horizontal) {
      divider = Container(
        height: dividerThickness,
        width: length,
        color: dividerColor,
      );
    } else {
      divider = Container(
        width: dividerThickness,
        height: length,
        color: dividerColor,
      );
    }

    if (margin != null) {
      divider = Padding(
        padding: margin!,
        child: divider,
      );
    }

    return divider;
  }
}

class SectionDivider extends StatelessWidget {
  final String? title;
  final EdgeInsetsGeometry? margin;

  const SectionDivider({
    super.key,
    this.title,
    this.margin,
  });

  @override
  Widget build(BuildContext context) {
    Widget divider;

    if (title != null) {
      divider = Row(
        children: [
          Expanded(
            child: Container(
              height: 1,
              color: AppColors.border,
            ),
          ),
          Padding(
            padding: const EdgeInsets.symmetric(horizontal: AppSpacing.md),
            child: Text(
              title!,
              style: TextStyle(
                fontFamily: AppTypography.fontFamily,
                fontSize: AppTypography.fontSizeSm,
                fontWeight: AppTypography.fontWeightMedium,
                color: AppColors.textTertiary,
              ),
            ),
          ),
          Expanded(
            child: Container(
              height: 1,
              color: AppColors.border,
            ),
          ),
        ],
      );
    } else {
      divider = Container(
        height: 1,
        color: AppColors.border,
      );
    }

    if (margin != null) {
      divider = Padding(
        padding: margin!,
        child: divider,
      );
    }

    return divider;
  }
}
