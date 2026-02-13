import 'package:flutter/material.dart';
import 'package:peers_touch_ui/tokens/tokens.dart';

class SettingItem extends StatefulWidget {
  final IconData? icon;
  final String title;
  final String? subtitle;
  final Widget? trailing;
  final VoidCallback? onTap;
  final bool showArrow;
  final Color? iconBackgroundColor;
  final Color? iconColor;

  const SettingItem({
    super.key,
    this.icon,
    required this.title,
    this.subtitle,
    this.trailing,
    this.onTap,
    this.showArrow = true,
    this.iconBackgroundColor,
    this.iconColor,
  });

  @override
  State<SettingItem> createState() => _SettingItemState();
}

class _SettingItemState extends State<SettingItem> {
  bool _isHovered = false;

  @override
  Widget build(BuildContext context) {
    final bgColor = _isHovered ? AppColors.backgroundHover : Colors.transparent;

    return MouseRegion(
      cursor: widget.onTap != null ? SystemMouseCursors.click : MouseCursor.defer,
      onEnter: (_) {
        if (mounted) {
          setState(() => _isHovered = true);
        }
      },
      onExit: (_) {
        if (mounted) {
          setState(() => _isHovered = false);
        }
      },
      child: GestureDetector(
        onTap: widget.onTap,
        child: AnimatedContainer(
          duration: const Duration(milliseconds: 200),
          curve: Curves.easeInOut,
          padding: const EdgeInsets.symmetric(
            horizontal: AppSpacing.md,
            vertical: AppSpacing.sm,
          ),
          decoration: BoxDecoration(
            color: bgColor,
            borderRadius: AppRadius.mdBorder,
          ),
          child: Row(
            children: [
              if (widget.icon != null) ...[
                Container(
                  width: 36,
                  height: 36,
                  decoration: BoxDecoration(
                    color: widget.iconBackgroundColor ?? AppColors.backgroundSecondary,
                    borderRadius: AppRadius.mdBorder,
                  ),
                  child: Icon(
                    widget.icon,
                    size: 20,
                    color: widget.iconColor ?? AppColors.textPrimary,
                  ),
                ),
                const SizedBox(width: AppSpacing.sm),
              ],
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      widget.title,
                      style: TextStyle(
                        fontFamily: AppTypography.fontFamily,
                        fontSize: AppTypography.fontSizeMd,
                        fontWeight: AppTypography.fontWeightNormal,
                        color: AppColors.textPrimary,
                      ),
                    ),
                    if (widget.subtitle != null) ...[
                      const SizedBox(height: 2),
                      Text(
                        widget.subtitle!,
                        style: TextStyle(
                          fontFamily: AppTypography.fontFamily,
                          fontSize: AppTypography.fontSizeSm,
                          fontWeight: AppTypography.fontWeightNormal,
                          color: AppColors.textTertiary,
                        ),
                      ),
                    ],
                  ],
                ),
              ),
              if (widget.trailing != null) ...[
                const SizedBox(width: AppSpacing.sm),
                widget.trailing!,
              ] else if (widget.showArrow && widget.onTap != null) ...[
                const SizedBox(width: AppSpacing.sm),
                Icon(
                  Icons.chevron_right,
                  size: 18,
                  color: AppColors.textTertiary,
                ),
              ],
            ],
          ),
        ),
      ),
    );
  }
}
