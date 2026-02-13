import 'package:flutter/material.dart';
import 'package:peers_touch_ui/tokens/tokens.dart';

enum TagSize { small, medium, large }

enum TagVariant { default_, primary, success, warning, error, info }

class Tag extends StatelessWidget {
  final String text;
  final TagSize size;
  final TagVariant variant;
  final IconData? icon;
  final IconData? closeIcon;
  final VoidCallback? onClose;
  final VoidCallback? onTap;
  final Color? backgroundColor;
  final Color? textColor;
  final Color? borderColor;

  const Tag({
    super.key,
    required this.text,
    this.size = TagSize.medium,
    this.variant = TagVariant.default_,
    this.icon,
    this.closeIcon,
    this.onClose,
    this.onTap,
    this.backgroundColor,
    this.textColor,
    this.borderColor,
  });

  double get _fontSize {
    switch (size) {
      case TagSize.small:
        return AppTypography.fontSizeXs;
      case TagSize.medium:
        return AppTypography.fontSizeSm;
      case TagSize.large:
        return AppTypography.fontSizeMd;
    }
  }

  double get _paddingHorizontal {
    switch (size) {
      case TagSize.small:
        return AppSpacing.xxs;
      case TagSize.medium:
        return AppSpacing.xs;
      case TagSize.large:
        return AppSpacing.sm;
    }
  }

  double get _paddingVertical {
    switch (size) {
      case TagSize.small:
        return 1;
      case TagSize.medium:
        return AppSpacing.xxs;
      case TagSize.large:
        return AppSpacing.xs / 2;
    }
  }

  double get _iconSize {
    switch (size) {
      case TagSize.small:
        return 10;
      case TagSize.medium:
        return 12;
      case TagSize.large:
        return 14;
    }
  }

  Color get _backgroundColor {
    if (backgroundColor != null) return backgroundColor!;

    switch (variant) {
      case TagVariant.default_:
        return AppColors.backgroundSecondary;
      case TagVariant.primary:
        return AppColors.primaryBackground;
      case TagVariant.success:
        return AppColors.successBackground;
      case TagVariant.warning:
        return AppColors.warningBackground;
      case TagVariant.error:
        return AppColors.errorBackground;
      case TagVariant.info:
        return AppColors.infoBackground;
    }
  }

  Color get _textColor {
    if (textColor != null) return textColor!;

    switch (variant) {
      case TagVariant.default_:
        return AppColors.textSecondary;
      case TagVariant.primary:
        return AppColors.primary;
      case TagVariant.success:
        return AppColors.success;
      case TagVariant.warning:
        return AppColors.warning;
      case TagVariant.error:
        return AppColors.error;
      case TagVariant.info:
        return AppColors.info;
    }
  }

  Color get _borderColor {
    if (borderColor != null) return borderColor!;

    switch (variant) {
      case TagVariant.default_:
        return AppColors.border;
      case TagVariant.primary:
        return AppColors.primaryLight;
      case TagVariant.success:
        return AppColors.successLight;
      case TagVariant.warning:
        return AppColors.warningLight;
      case TagVariant.error:
        return AppColors.errorLight;
      case TagVariant.info:
        return AppColors.infoLight;
    }
  }

  @override
  Widget build(BuildContext context) {
    Widget tagContent = Row(
      mainAxisSize: MainAxisSize.min,
      children: [
        if (icon != null) ...[
          Icon(
            icon,
            size: _iconSize,
            color: _textColor,
          ),
          SizedBox(width: AppSpacing.xxs),
        ],
        Text(
          text,
          style: TextStyle(
            fontFamily: AppTypography.fontFamily,
            fontSize: _fontSize,
            fontWeight: AppTypography.fontWeightMedium,
            color: _textColor,
          ),
        ),
        if (onClose != null) ...[
          SizedBox(width: AppSpacing.xxs),
          GestureDetector(
            onTap: onClose,
            child: Icon(
              closeIcon ?? Icons.close,
              size: _iconSize,
              color: _textColor,
            ),
          ),
        ],
      ],
    );

    if (onTap != null) {
      tagContent = GestureDetector(
        onTap: onTap,
        child: tagContent,
      );
    }

    return Container(
      padding: EdgeInsets.symmetric(
        horizontal: _paddingHorizontal,
        vertical: _paddingVertical,
      ),
      decoration: BoxDecoration(
        color: _backgroundColor,
        borderRadius: AppRadius.tagRadius,
        border: Border.all(
          color: _borderColor,
          width: 1,
        ),
      ),
      child: tagContent,
    );
  }
}
