import 'package:flutter/material.dart';
import 'package:peers_touch_ui/tokens/tokens.dart';

class DesktopAppBar extends StatelessWidget implements PreferredSizeWidget {
  final String title;
  final Widget? leading;
  final List<Widget>? actions;
  final bool showBackButton;
  final VoidCallback? onBack;
  final Color? backgroundColor;
  final Color? titleColor;
  final double height;
  final Widget? bottom;

  const DesktopAppBar({
    super.key,
    required this.title,
    this.leading,
    this.actions,
    this.showBackButton = false,
    this.onBack,
    this.backgroundColor,
    this.titleColor,
    this.height = 60,
    this.bottom,
  });

  @override
  Size get preferredSize => Size.fromHeight(height + (bottom != null ? 48 : 0));

  @override
  Widget build(BuildContext context) {
    return Container(
      constraints: BoxConstraints(minHeight: preferredSize.height),
      decoration: BoxDecoration(
        color: backgroundColor ?? AppColors.background,
        border: Border(
          bottom: BorderSide(
            color: AppColors.border,
            width: 0.5,
          ),
        ),
      ),
      child: Column(
        mainAxisSize: MainAxisSize.max,
        mainAxisAlignment: MainAxisAlignment.start,
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Container(
            constraints: BoxConstraints(minHeight: height),
            padding: EdgeInsets.symmetric(horizontal: AppSpacing.lg),
            child: Row(
              crossAxisAlignment: CrossAxisAlignment.center,
              children: [
                if (showBackButton && Navigator.of(context).canPop()) ...[
                  MouseRegion(
                    cursor: SystemMouseCursors.click,
                    child: GestureDetector(
                      onTap: onBack ?? () => Navigator.of(context).pop(),
                      child: Container(
                        padding: const EdgeInsets.all(AppSpacing.xs),
                        child: Icon(
                          Icons.arrow_back_ios_new,
                          size: 18,
                          color: titleColor ?? AppColors.textSecondary,
                        ),
                      ),
                    ),
                  ),
                  const SizedBox(width: AppSpacing.sm),
                ] else if (leading != null) ...[
                  leading!,
                  const SizedBox(width: AppSpacing.sm),
                ],
                Expanded(
                  child: Align(
                    alignment: Alignment.centerLeft,
                    child: Text(
                      title,
                      style: TextStyle(
                        fontFamily: AppTypography.fontFamily,
                        fontSize: AppTypography.fontSizeLg,
                        fontWeight: AppTypography.fontWeightSemibold,
                        color: titleColor ?? AppColors.textPrimary,
                      ),
                    ),
                  ),
                ),
                if (actions != null) ...actions!,
              ],
            ),
          ),
          if (bottom != null) bottom!,
        ],
      ),
    );
  }
}
