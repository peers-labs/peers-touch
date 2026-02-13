import 'package:flutter/material.dart';
import 'package:peers_touch_ui/tokens/tokens.dart';

class Scaffold extends StatelessWidget {
  final Widget? sidebar;
  final Widget body;
  final Widget? appBar;
  final Color? backgroundColor;
  final double? sidebarWidth;

  const Scaffold({
    super.key,
    this.sidebar,
    required this.body,
    this.appBar,
    this.backgroundColor,
    this.sidebarWidth = 240,
  });

  @override
  Widget build(BuildContext context) {
    return Material(
      color: backgroundColor ?? AppColors.background,
      child: Row(
        children: [
          if (sidebar != null)
            Container(
              width: sidebarWidth,
              decoration: BoxDecoration(
                color: AppColors.background,
                border: Border(
                  right: BorderSide(
                    color: AppColors.border,
                    width: 0.5,
                  ),
                ),
              ),
              child: sidebar,
            ),
          Expanded(
            child: Column(
              children: [
                if (appBar != null) appBar!,
                Expanded(child: body),
              ],
            ),
          ),
        ],
      ),
    );
  }
}
