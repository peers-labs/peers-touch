import 'package:flutter/material.dart';
import 'package:peers_touch_ui/tokens/tokens.dart';

class TabBar extends StatelessWidget implements PreferredSizeWidget {
  final List<String> tabs;
  final int currentIndex;
  final ValueChanged<int>? onTap;
  final Color? backgroundColor;
  final Color? indicatorColor;
  final Color? selectedLabelColor;
  final Color? unselectedLabelColor;

  const TabBar({
    super.key,
    required this.tabs,
    this.currentIndex = 0,
    this.onTap,
    this.backgroundColor,
    this.indicatorColor,
    this.selectedLabelColor,
    this.unselectedLabelColor,
  });

  @override
  Size get preferredSize => const Size.fromHeight(48);

  @override
  Widget build(BuildContext context) {
    return Container(
      height: preferredSize.height,
      color: backgroundColor ?? AppColors.background,
      child: Row(
        children: List.generate(tabs.length, (index) {
          final isSelected = index == currentIndex;

          return Expanded(
            child: GestureDetector(
              onTap: () => onTap?.call(index),
              behavior: HitTestBehavior.opaque,
              child: Container(
                alignment: Alignment.center,
                decoration: BoxDecoration(
                  border: Border(
                    bottom: BorderSide(
                      color: isSelected
                          ? (indicatorColor ?? AppColors.primary)
                          : Colors.transparent,
                      width: 2,
                    ),
                  ),
                ),
                child: Text(
                  tabs[index],
                  style: TextStyle(
                    fontFamily: AppTypography.fontFamily,
                    fontSize: AppTypography.fontSizeMd,
                    fontWeight: isSelected
                        ? AppTypography.fontWeightSemibold
                        : AppTypography.fontWeightNormal,
                    color: isSelected
                        ? (selectedLabelColor ?? AppColors.textPrimary)
                        : (unselectedLabelColor ?? AppColors.textSecondary),
                  ),
                ),
              ),
            ),
          );
        }),
      ),
    );
  }
}
