import 'package:flutter/material.dart';
import 'package:peers_touch_ui/primitives/avatar/avatar.dart';
import 'package:peers_touch_ui/theme/theme.dart';

class SidebarItem {
  final IconData icon;
  final IconData? activeIcon;
  final String label;
  final VoidCallback? onTap;
  final int? badgeCount;
  final Key? key;

  const SidebarItem({
    this.key,
    required this.icon,
    this.activeIcon,
    required this.label,
    this.onTap,
    this.badgeCount,
  });
}

class Sidebar extends StatelessWidget {
  final int currentIndex;
  final List<SidebarItem> items;
  final Widget? header;
  final Widget? footer;
  final Color? backgroundColor;
  final Color? selectedItemColor;
  final Color? unselectedItemColor;

  const Sidebar({
    super.key,
    required this.currentIndex,
    required this.items,
    this.header,
    this.footer,
    this.backgroundColor,
    this.selectedItemColor,
    this.unselectedItemColor,
  });

  @override
  Widget build(BuildContext context) {
    return Container(
      color: backgroundColor ?? AppColors.background,
      child: Column(
        children: [
          if (header != null) header!,
          Expanded(
            child: SingleChildScrollView(
              padding: const EdgeInsets.symmetric(vertical: AppSpacing.sm),
              child: Column(
                children: List.generate(items.length, (index) {
                  final item = items[index];
                  final isSelected = index == currentIndex;

                  return _SidebarItemWidget(
                    key: item.key ?? ValueKey('sidebar_item_$index'),
                    item: item,
                    isSelected: isSelected,
                    selectedColor: selectedItemColor ?? AppColors.primary,
                    unselectedColor: unselectedItemColor ?? AppColors.textSecondary,
                  );
                }),
              ),
            ),
          ),
          if (footer != null) footer!,
        ],
      ),
    );
  }
}

class _SidebarItemWidget extends StatefulWidget {
  final SidebarItem item;
  final bool isSelected;
  final Color selectedColor;
  final Color unselectedColor;

  const _SidebarItemWidget({
    super.key,
    required this.item,
    required this.isSelected,
    required this.selectedColor,
    required this.unselectedColor,
  });

  @override
  State<_SidebarItemWidget> createState() => _SidebarItemWidgetState();
}

class _SidebarItemWidgetState extends State<_SidebarItemWidget> {
  bool _isHovered = false;

  @override
  Widget build(BuildContext context) {
    final bgColor = widget.isSelected
        ? widget.selectedColor.withValues(alpha: 0.08)
        : _isHovered
            ? AppColors.backgroundHover
            : Colors.transparent;

    return MouseRegion(
      cursor: SystemMouseCursors.click,
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
        onTap: widget.item.onTap,
        child: AnimatedContainer(
          duration: const Duration(milliseconds: 200),
          curve: Curves.easeInOut,
          margin: const EdgeInsets.symmetric(
            horizontal: AppSpacing.sm,
            vertical: AppSpacing.xxs,
          ),
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
              AnimatedDefaultTextStyle(
                duration: const Duration(milliseconds: 200),
                curve: Curves.easeInOut,
                style: TextStyle(
                  fontFamily: AppTypography.fontFamily,
                  fontSize: AppTypography.fontSizeSm,
                  fontWeight: widget.isSelected
                      ? AppTypography.fontWeightMedium
                      : AppTypography.fontWeightNormal,
                  color: widget.isSelected
                      ? widget.selectedColor
                      : widget.unselectedColor,
                ),
                child: Icon(
                  widget.isSelected
                      ? (widget.item.activeIcon ?? widget.item.icon)
                      : widget.item.icon,
                  size: 20,
                  color: widget.isSelected
                      ? widget.selectedColor
                      : widget.unselectedColor,
                ),
              ),
              const SizedBox(width: AppSpacing.sm),
              Expanded(
                child: AnimatedDefaultTextStyle(
                  duration: const Duration(milliseconds: 200),
                  curve: Curves.easeInOut,
                  style: TextStyle(
                    fontFamily: AppTypography.fontFamily,
                    fontSize: AppTypography.fontSizeSm,
                    fontWeight: widget.isSelected
                        ? AppTypography.fontWeightMedium
                        : AppTypography.fontWeightNormal,
                    color: widget.isSelected
                        ? widget.selectedColor
                        : widget.unselectedColor,
                  ),
                  child: Text(widget.item.label),
                ),
              ),
              if (widget.item.badgeCount != null && widget.item.badgeCount! > 0)
                Container(
                  padding: const EdgeInsets.symmetric(
                    horizontal: AppSpacing.xs,
                    vertical: AppSpacing.xxs,
                  ),
                  decoration: BoxDecoration(
                    color: AppColors.error,
                    borderRadius: AppRadius.fullBorder,
                  ),
                  child: Text(
                    widget.item.badgeCount! > 99
                        ? '99+'
                        : widget.item.badgeCount.toString(),
                    style: TextStyle(
                      fontFamily: AppTypography.fontFamily,
                      fontSize: AppTypography.fontSizeXs,
                      fontWeight: AppTypography.fontWeightMedium,
                      color: AppColors.white,
                    ),
                  ),
                ),
            ],
          ),
        ),
      ),
    );
  }
}

class SidebarHeader extends StatelessWidget {
  final String? title;
  final String? subtitle;
  final String? avatarUrl;
  final String? avatarName;

  const SidebarHeader({
    super.key,
    this.title,
    this.subtitle,
    this.avatarUrl,
    this.avatarName,
  });

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.all(AppSpacing.md),
      decoration: BoxDecoration(
        border: Border(
          bottom: BorderSide(
            color: AppColors.border,
            width: 0.5,
          ),
        ),
      ),
      child: Row(
        children: [
          Avatar(
            imageUrl: avatarUrl,
            name: avatarName,
            size: AvatarSize.md,
          ),
          const SizedBox(width: AppSpacing.sm),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                if (title != null)
                  Text(
                    title!,
                    style: TextStyle(
                      fontFamily: AppTypography.fontFamily,
                      fontSize: AppTypography.fontSizeMd,
                      fontWeight: AppTypography.fontWeightSemibold,
                      color: AppColors.textPrimary,
                    ),
                  ),
                if (subtitle != null)
                  Text(
                    subtitle!,
                    style: TextStyle(
                      fontFamily: AppTypography.fontFamily,
                      fontSize: AppTypography.fontSizeXs,
                      color: AppColors.textTertiary,
                    ),
                  ),
              ],
            ),
          ),
        ],
      ),
    );
  }
}
