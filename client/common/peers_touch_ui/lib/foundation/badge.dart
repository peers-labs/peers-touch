import 'package:flutter/material.dart';
import 'package:peers_touch_ui/tokens/tokens.dart';

enum BadgeSize { small, medium, large }

enum BadgeVariant { dot, count, text }

class Badge extends StatelessWidget {
  final BadgeVariant variant;
  final BadgeSize size;
  final int? count;
  final String? text;
  final Color? backgroundColor;
  final Color? textColor;
  final Widget? child;
  final bool showZero;
  final int maxCount;

  const Badge({
    super.key,
    this.variant = BadgeVariant.dot,
    this.size = BadgeSize.medium,
    this.count,
    this.text,
    this.backgroundColor,
    this.textColor,
    this.child,
    this.showZero = false,
    this.maxCount = 99,
  });

  double get _dotSize {
    switch (size) {
      case BadgeSize.small:
        return 6;
      case BadgeSize.medium:
        return 8;
      case BadgeSize.large:
        return 10;
    }
  }

  double get _fontSize {
    switch (size) {
      case BadgeSize.small:
        return AppTypography.fontSizeXs;
      case BadgeSize.medium:
        return AppTypography.fontSizeXs;
      case BadgeSize.large:
        return AppTypography.fontSizeSm;
    }
  }

  double get _padding {
    switch (size) {
      case BadgeSize.small:
        return 2;
      case BadgeSize.medium:
        return 4;
      case BadgeSize.large:
        return 6;
    }
  }

  String get _displayText {
    if (variant == BadgeVariant.text && text != null) {
      return text!;
    }
    if (variant == BadgeVariant.count && count != null) {
      if (count! > maxCount) {
        return '$maxCount+';
      }
      return count.toString();
    }
    return '';
  }

  bool get _shouldShow {
    if (variant == BadgeVariant.dot) return true;
    if (variant == BadgeVariant.count) {
      if (count == null) return false;
      if (count == 0 && !showZero) return false;
      return true;
    }
    if (variant == BadgeVariant.text) return text != null && text!.isNotEmpty;
    return false;
  }

  @override
  Widget build(BuildContext context) {
    if (child == null) {
      return _buildBadge();
    }

    return Stack(
      clipBehavior: Clip.none,
      children: [
        child!,
        if (_shouldShow)
          Positioned(
            right: variant == BadgeVariant.dot ? -_dotSize / 2 : -4,
            top: variant == BadgeVariant.dot ? -_dotSize / 2 : -4,
            child: _buildBadge(),
          ),
      ],
    );
  }

  Widget _buildBadge() {
    final bgColor = backgroundColor ?? AppColors.error;

    if (variant == BadgeVariant.dot) {
      return Container(
        width: _dotSize,
        height: _dotSize,
        decoration: BoxDecoration(
          color: bgColor,
          shape: BoxShape.circle,
          border: Border.all(
            color: AppColors.background,
            width: 1,
          ),
        ),
      );
    }

    return Container(
      padding: EdgeInsets.symmetric(
        horizontal: _padding,
        vertical: _padding / 2,
      ),
      decoration: BoxDecoration(
        color: bgColor,
        borderRadius: AppRadius.fullBorder,
        border: Border.all(
          color: AppColors.background,
          width: 1,
        ),
      ),
      child: Text(
        _displayText,
        style: TextStyle(
          fontFamily: AppTypography.fontFamily,
          fontSize: _fontSize,
          fontWeight: AppTypography.fontWeightMedium,
          color: textColor ?? AppColors.white,
          height: 1,
        ),
      ),
    );
  }
}
