import 'package:flutter/material.dart';
import 'package:peers_touch_ui/tokens/tokens.dart';

enum ButtonType { primary, secondary, ghost, text }

enum ButtonSize { small, medium, large }

class Button extends StatefulWidget {
  final String text;
  final ButtonType type;
  final ButtonSize size;
  final VoidCallback? onPressed;
  final bool loading;
  final bool disabled;
  final IconData? icon;
  final IconData? iconAfter;
  final bool block;

  const Button({
    super.key,
    required this.text,
    this.type = ButtonType.primary,
    this.size = ButtonSize.medium,
    this.onPressed,
    this.loading = false,
    this.disabled = false,
    this.icon,
    this.iconAfter,
    this.block = false,
  });

  @override
  State<Button> createState() => _ButtonState();
}

class _ButtonState extends State<Button> {
  bool _isHovered = false;
  bool _isPressed = false;

  bool get _isDisabled => widget.disabled || widget.loading;

  double get _paddingHorizontal {
    switch (widget.size) {
      case ButtonSize.small:
        return AppSpacing.sm;
      case ButtonSize.medium:
        return AppSpacing.buttonPaddingHorizontal;
      case ButtonSize.large:
        return AppSpacing.lg;
    }
  }

  double get _paddingVertical {
    switch (widget.size) {
      case ButtonSize.small:
        return AppSpacing.xs / 2;
      case ButtonSize.medium:
        return AppSpacing.buttonPaddingVertical;
      case ButtonSize.large:
        return AppSpacing.md;
    }
  }

  double get _fontSize {
    switch (widget.size) {
      case ButtonSize.small:
        return AppTypography.fontSizeSm;
      case ButtonSize.medium:
        return AppTypography.fontSizeMd;
      case ButtonSize.large:
        return AppTypography.fontSizeLg;
    }
  }

  double get _iconSize {
    switch (widget.size) {
      case ButtonSize.small:
        return 14;
      case ButtonSize.medium:
        return 16;
      case ButtonSize.large:
        return 18;
    }
  }

  double get _elevation {
    if (_isDisabled) return 0;
    if (_isPressed) return 2;
    if (_isHovered) return 4;
    return 2;
  }

  Color get _backgroundColor {
    if (_isDisabled) {
      switch (widget.type) {
        case ButtonType.primary:
          return AppColors.backgroundTertiary;
        case ButtonType.secondary:
        case ButtonType.ghost:
        case ButtonType.text:
          return Colors.transparent;
      }
    }

    if (_isPressed) {
      switch (widget.type) {
        case ButtonType.primary:
          return AppColors.primaryActive;
        case ButtonType.secondary:
          return AppColors.backgroundTertiary;
        case ButtonType.ghost:
        case ButtonType.text:
          return AppColors.backgroundHover;
      }
    }

    if (_isHovered) {
      switch (widget.type) {
        case ButtonType.primary:
          return AppColors.primaryHover;
        case ButtonType.secondary:
          return AppColors.backgroundHover;
        case ButtonType.ghost:
        case ButtonType.text:
          return AppColors.backgroundHover;
      }
    }

    switch (widget.type) {
      case ButtonType.primary:
        return AppColors.primary;
      case ButtonType.secondary:
        return AppColors.backgroundSecondary;
      case ButtonType.ghost:
      case ButtonType.text:
        return Colors.transparent;
    }
  }

  Color get _textColor {
    if (_isDisabled) {
      switch (widget.type) {
        case ButtonType.primary:
          return AppColors.textTertiary;
        case ButtonType.secondary:
        case ButtonType.ghost:
        case ButtonType.text:
          return AppColors.textQuaternary;
      }
    }

    switch (widget.type) {
      case ButtonType.primary:
        return AppColors.white;
      case ButtonType.secondary:
      case ButtonType.ghost:
      case ButtonType.text:
        return AppColors.textPrimary;
    }
  }

  Color get _borderColor {
    if (_isDisabled) {
      switch (widget.type) {
        case ButtonType.primary:
          return Colors.transparent;
        case ButtonType.secondary:
          return AppColors.border;
        case ButtonType.ghost:
        case ButtonType.text:
          return Colors.transparent;
      }
    }

    if (_isPressed || _isHovered) {
      switch (widget.type) {
        case ButtonType.primary:
          return Colors.transparent;
        case ButtonType.secondary:
          return AppColors.borderActive;
        case ButtonType.ghost:
        case ButtonType.text:
          return Colors.transparent;
      }
    }

    switch (widget.type) {
      case ButtonType.primary:
        return Colors.transparent;
      case ButtonType.secondary:
        return AppColors.border;
      case ButtonType.ghost:
      case ButtonType.text:
        return Colors.transparent;
    }
  }

  List<BoxShadow> get _shadows {
    if (widget.type == ButtonType.primary && !_isDisabled) {
      return [
        BoxShadow(
          color: AppColors.primary.withOpacity(0.2),
          blurRadius: _elevation * 2,
          offset: Offset(0, _elevation),
        ),
      ];
    }
    return [];
  }

  void _handleTap() {
    if (!_isDisabled && widget.onPressed != null) {
      widget.onPressed!();
    }
  }

  @override
  Widget build(BuildContext context) {
    final buttonContent = Row(
      mainAxisSize: widget.block ? MainAxisSize.max : MainAxisSize.min,
      mainAxisAlignment: MainAxisAlignment.center,
      children: [
        if (widget.loading)
          SizedBox(
            width: _iconSize,
            height: _iconSize,
            child: CircularProgressIndicator(
              strokeWidth: 2,
              valueColor: AlwaysStoppedAnimation<Color>(_textColor),
            ),
          )
        else if (widget.icon != null) ...[
          Icon(
            widget.icon,
            size: _iconSize,
            color: _textColor,
          ),
          SizedBox(width: AppSpacing.xs),
        ],
        Flexible(
          child: Text(
            widget.text,
            style: TextStyle(
              fontFamily: AppTypography.fontFamily,
              fontSize: _fontSize,
              fontWeight: AppTypography.fontWeightMedium,
              color: _textColor,
            ),
            overflow: TextOverflow.ellipsis,
          ),
        ),
        if (widget.iconAfter != null && !widget.loading) ...[
          SizedBox(width: AppSpacing.xs),
          Icon(
            widget.iconAfter,
            size: _iconSize,
            color: _textColor,
          ),
        ],
      ],
    );

    return MouseRegion(
      cursor: _isDisabled ? SystemMouseCursors.basic : SystemMouseCursors.click,
      onEnter: (_) {
        if (mounted) {
          setState(() => _isHovered = true);
        }
      },
      onExit: (_) {
        if (mounted) {
          setState(() {
            _isHovered = false;
            _isPressed = false;
          });
        }
      },
      child: GestureDetector(
        onTapDown: _isDisabled ? null : (_) {
          if (mounted) {
            setState(() => _isPressed = true);
          }
        },
        onTapUp: _isDisabled ? null : (_) {
          if (mounted) {
            setState(() => _isPressed = false);
          }
        },
        onTapCancel: _isDisabled ? null : () {
          if (mounted) {
            setState(() => _isPressed = false);
          }
        },
        onTap: _isDisabled ? null : _handleTap,
        child: AnimatedContainer(
          duration: const Duration(milliseconds: 200),
          curve: Curves.easeInOut,
          padding: EdgeInsets.symmetric(
            horizontal: _paddingHorizontal,
            vertical: _paddingVertical,
          ),
          decoration: BoxDecoration(
            color: _backgroundColor,
            borderRadius: AppRadius.buttonRadius,
            border: Border.all(
              color: _borderColor,
              width: 1,
            ),
            boxShadow: _shadows,
          ),
          transform: Matrix4.identity()
            ..translate(0.0, _isPressed ? 1.0 : 0.0),
          child: buttonContent,
        ),
      ),
    );
  }
}
