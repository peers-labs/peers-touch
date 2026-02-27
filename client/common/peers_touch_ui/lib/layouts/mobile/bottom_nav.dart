import 'package:flutter/material.dart' hide Badge;
import 'package:peers_touch_ui/primitives/badge.dart';
import 'package:peers_touch_ui/theme/theme.dart';

class BottomNavItem {
  final IconData icon;
  final IconData? activeIcon;
  final String label;
  final Badge? badge;

  const BottomNavItem({
    required this.icon,
    this.activeIcon,
    required this.label,
    this.badge,
  });
}

class BottomNav extends StatelessWidget {
  final int currentIndex;
  final List<BottomNavItem> items;
  final ValueChanged<int>? onTap;
  final Color? backgroundColor;
  final Color? selectedItemColor;
  final Color? unselectedItemColor;

  const BottomNav({
    super.key,
    required this.currentIndex,
    required this.items,
    this.onTap,
    this.backgroundColor,
    this.selectedItemColor,
    this.unselectedItemColor,
  });

  @override
  Widget build(BuildContext context) {
    return Container(
      height: 60 + MediaQuery.of(context).padding.bottom,
      padding: EdgeInsets.only(bottom: MediaQuery.of(context).padding.bottom),
      decoration: BoxDecoration(
        color: backgroundColor ?? AppColors.background,
        border: Border(
          top: BorderSide(
            color: AppColors.border,
            width: 0.5,
          ),
        ),
      ),
      child: Row(
        mainAxisAlignment: MainAxisAlignment.spaceAround,
        children: List.generate(items.length, (index) {
          final item = items[index];
          final isSelected = index == currentIndex;

          return _BottomNavItemWidget(
            item: item,
            isSelected: isSelected,
            selectedColor: selectedItemColor ?? AppColors.primary,
            unselectedColor: unselectedItemColor ?? AppColors.textTertiary,
            onTap: () => onTap?.call(index),
          );
        }),
      ),
    );
  }
}

class _BottomNavItemWidget extends StatelessWidget {
  final BottomNavItem item;
  final bool isSelected;
  final Color selectedColor;
  final Color unselectedColor;
  final VoidCallback onTap;

  const _BottomNavItemWidget({
    required this.item,
    required this.isSelected,
    required this.selectedColor,
    required this.unselectedColor,
    required this.onTap,
  });

  @override
  Widget build(BuildContext context) {
    Widget iconWidget = Icon(
      isSelected ? (item.activeIcon ?? item.icon) : item.icon,
      size: 24,
      color: isSelected ? selectedColor : unselectedColor,
    );

    if (item.badge != null) {
      iconWidget = Badge(
        variant: item.badge!.variant,
        count: item.badge!.count,
        text: item.badge!.text,
        child: iconWidget,
      );
    }

    return GestureDetector(
      onTap: onTap,
      behavior: HitTestBehavior.opaque,
      child: Container(
        padding: const EdgeInsets.symmetric(vertical: AppSpacing.xs),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            const SizedBox(height: 4),
            iconWidget,
            const SizedBox(height: 4),
            Text(
              item.label,
              style: TextStyle(
                fontFamily: AppTypography.fontFamily,
                fontSize: AppTypography.fontSizeXs,
                fontWeight: isSelected
                    ? AppTypography.fontWeightMedium
                    : AppTypography.fontWeightNormal,
                color: isSelected ? selectedColor : unselectedColor,
              ),
            ),
          ],
        ),
      ),
    );
  }
}
