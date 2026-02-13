import 'package:flutter/material.dart';
import 'package:peers_touch_ui/tokens/tokens.dart';

class Card extends StatelessWidget {
  final Widget child;
  final EdgeInsetsGeometry? padding;
  final EdgeInsetsGeometry? margin;
  final Color? backgroundColor;
  final VoidCallback? onTap;
  final VoidCallback? onLongPress;
  final bool hoverable;
  final double? width;
  final double? height;

  const Card({
    super.key,
    required this.child,
    this.padding,
    this.margin,
    this.backgroundColor,
    this.onTap,
    this.onLongPress,
    this.hoverable = false,
    this.width,
    this.height,
  });

  @override
  Widget build(BuildContext context) {
    Widget cardContent = Container(
      width: width,
      height: height,
      padding: padding ?? const EdgeInsets.all(AppSpacing.cardPadding),
      decoration: BoxDecoration(
        color: backgroundColor ?? AppColors.background,
        borderRadius: AppRadius.cardRadius,
        boxShadow: AppShadows.card,
      ),
      child: child,
    );

    if (hoverable) {
      cardContent = _HoverableCard(
        onTap: onTap,
        onLongPress: onLongPress,
        child: cardContent,
      );
    } else if (onTap != null || onLongPress != null) {
      cardContent = GestureDetector(
        onTap: onTap,
        onLongPress: onLongPress,
        child: cardContent,
      );
    }

    if (margin != null) {
      cardContent = Padding(
        padding: margin!,
        child: cardContent,
      );
    }

    return cardContent;
  }
}

class _HoverableCard extends StatefulWidget {
  final Widget child;
  final VoidCallback? onTap;
  final VoidCallback? onLongPress;

  const _HoverableCard({
    required this.child,
    this.onTap,
    this.onLongPress,
  });

  @override
  State<_HoverableCard> createState() => _HoverableCardState();
}

class _HoverableCardState extends State<_HoverableCard> {
  bool _isHovered = false;
  bool _isPressed = false;

  @override
  Widget build(BuildContext context) {
    return MouseRegion(
      cursor: SystemMouseCursors.click,
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
        onTapDown: (_) {
          if (mounted) {
            setState(() => _isPressed = true);
          }
        },
        onTapUp: (_) {
          if (mounted) {
            setState(() => _isPressed = false);
          }
        },
        onTapCancel: () {
          if (mounted) {
            setState(() => _isPressed = false);
          }
        },
        onTap: widget.onTap,
        onLongPress: widget.onLongPress,
        child: AnimatedContainer(
          duration: const Duration(milliseconds: 200),
          curve: Curves.easeInOut,
          transform: Matrix4.identity()
            ..translate(0.0, _isPressed ? 0.5 : (_isHovered ? -2.0 : 0.0)),
          decoration: BoxDecoration(
            borderRadius: AppRadius.cardRadius,
            boxShadow: _isHovered ? AppShadows.cardHover : AppShadows.card,
          ),
          child: widget.child,
        ),
      ),
    );
  }
}
