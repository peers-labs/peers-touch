import 'package:flutter/material.dart';
import 'package:peers_touch_ui/tokens/tokens.dart';

class DesktopTabBar extends StatelessWidget implements PreferredSizeWidget {
  final List<String> tabs;
  final int currentIndex;
  final ValueChanged<int>? onTap;
  final Color? backgroundColor;
  final Color? indicatorColor;
  final Color? selectedLabelColor;
  final Color? unselectedLabelColor;
  final bool isScrollable;

  const DesktopTabBar({
    super.key,
    required this.tabs,
    this.currentIndex = 0,
    this.onTap,
    this.backgroundColor,
    this.indicatorColor,
    this.selectedLabelColor,
    this.unselectedLabelColor,
    this.isScrollable = false,
  });

  @override
  Size get preferredSize => const Size.fromHeight(40);

  @override
  Widget build(BuildContext context) {
    Widget tabsWidget = Row(
      children: List.generate(tabs.length, (index) {
        final isSelected = index == currentIndex;

        return _TabItem(
          key: ValueKey('tab_$index'),
          label: tabs[index],
          isSelected: isSelected,
          indicatorColor: indicatorColor ?? AppColors.primary,
          selectedColor: selectedLabelColor ?? AppColors.textPrimary,
          unselectedColor: unselectedLabelColor ?? AppColors.textSecondary,
          onTap: () => onTap?.call(index),
        );
      }),
    );

    if (isScrollable) {
      tabsWidget = SingleChildScrollView(
        scrollDirection: Axis.horizontal,
        child: tabsWidget,
      );
    }

    return Container(
      height: preferredSize.height,
      color: backgroundColor ?? AppColors.background,
      child: tabsWidget,
    );
  }
}

class _TabItem extends StatefulWidget {
  final String label;
  final bool isSelected;
  final Color indicatorColor;
  final Color selectedColor;
  final Color unselectedColor;
  final VoidCallback onTap;

  const _TabItem({
    super.key,
    required this.label,
    required this.isSelected,
    required this.indicatorColor,
    required this.selectedColor,
    required this.unselectedColor,
    required this.onTap,
  });

  @override
  State<_TabItem> createState() => _TabItemState();
}

class _TabItemState extends State<_TabItem> {
  bool _isHovered = false;

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
          setState(() => _isHovered = false);
        }
      },
      child: GestureDetector(
        onTap: widget.onTap,
        child: AnimatedContainer(
          duration: const Duration(milliseconds: 200),
          curve: Curves.easeInOut,
          padding: const EdgeInsets.symmetric(horizontal: AppSpacing.lg),
          constraints: const BoxConstraints(minWidth: 80),
          decoration: BoxDecoration(
            border: Border(
              bottom: BorderSide(
                color: widget.isSelected
                    ? widget.indicatorColor
                    : Colors.transparent,
                width: 2,
              ),
            ),
            color: _isHovered && !widget.isSelected
                ? AppColors.backgroundHover
                : Colors.transparent,
          ),
          child: Center(
            child: AnimatedDefaultTextStyle(
              duration: const Duration(milliseconds: 200),
              curve: Curves.easeInOut,
              style: TextStyle(
                fontFamily: AppTypography.fontFamily,
                fontSize: AppTypography.fontSizeSm,
                fontWeight: widget.isSelected
                    ? AppTypography.fontWeightSemibold
                    : AppTypography.fontWeightNormal,
                color: widget.isSelected
                    ? widget.selectedColor
                    : widget.unselectedColor,
              ),
              child: Text(widget.label),
            ),
          ),
        ),
      ),
    );
  }
}
