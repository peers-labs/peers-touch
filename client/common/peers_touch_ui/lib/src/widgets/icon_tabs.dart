import 'package:flutter/material.dart';

class IconTabItem {
  final IconData icon;
  final String? tooltip;
  final bool hasBadge;

  const IconTabItem({
    required this.icon,
    this.tooltip,
    this.hasBadge = false,
  });
}

class IconTabs extends StatelessWidget {
  final List<IconTabItem> items;
  final int selectedIndex;
  final ValueChanged<int> onChanged;
  
  // 容器样式
  final BoxDecoration? decoration;
  final EdgeInsetsGeometry? padding;
  
  // 图标颜色
  final Color? selectedIconColor;
  final Color? unselectedIconColor;

  // 选项样式（支持选中和未选中的自定义）
  final BoxDecoration? selectedItemDecoration;
  final BoxDecoration? unselectedItemDecoration;

  const IconTabs({
    super.key,
    required this.items,
    required this.selectedIndex,
    required this.onChanged,
    this.decoration,
    this.padding,
    this.selectedIconColor,
    this.unselectedIconColor,
    this.selectedItemDecoration,
    this.unselectedItemDecoration,
  });

  @override
  Widget build(BuildContext context) {
    final selIcon = selectedIconColor ?? const Color(0xFF333333);
    final unselIcon = unselectedIconColor ?? const Color(0xFF999999);

    // 默认容器样式：如果没有提供 decoration，则使用一个简单的默认样式
    final containerDecoration = decoration ?? BoxDecoration(
      color: Colors.white,
      borderRadius: BorderRadius.circular(16),
    );

    return Container(
      padding: padding ?? const EdgeInsets.all(2),
      decoration: containerDecoration,
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: List.generate(items.length, (index) {
          final item = items[index];
          final isSelected = selectedIndex == index;

          return GestureDetector(
            onTap: () => onChanged(index),
            behavior: HitTestBehavior.opaque,
            child: AnimatedContainer(
              duration: const Duration(milliseconds: 200),
              curve: Curves.easeInOut,
              margin: EdgeInsets.only(right: index < items.length - 1 ? 4 : 0),
              width: 40,
              height: 40,
              decoration: isSelected 
                  ? (selectedItemDecoration ?? BoxDecoration(
                      color: const Color(0xFF003087),
                      borderRadius: BorderRadius.circular(12),
                    ))
                  : (unselectedItemDecoration ?? const BoxDecoration(
                      color: Colors.transparent,
                    )),
              child: Stack(
                alignment: Alignment.center,
                children: [
                  Icon(
                    item.icon,
                    color: isSelected ? selIcon : unselIcon,
                    size: 20,
                  ),
                  if (item.hasBadge)
                    Positioned(
                      top: 10,
                      right: 10,
                      child: Container(
                        width: 6,
                        height: 6,
                        decoration: const BoxDecoration(
                          color: Colors.red,
                          shape: BoxShape.circle,
                        ),
                      ),
                    ),
                ],
              ),
            ),
          );
        }),
      ),
    );
  }
}
