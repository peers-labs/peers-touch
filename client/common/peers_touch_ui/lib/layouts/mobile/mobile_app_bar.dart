import 'package:flutter/material.dart';
import 'package:peers_touch_ui/theme/theme.dart';

class MobileAppBar extends StatelessWidget implements PreferredSizeWidget {
  final String title;
  final Widget? leading;
  final List<Widget>? actions;
  final bool showBackButton;
  final VoidCallback? onBack;
  final bool centerTitle;
  final Color? backgroundColor;
  final Color? titleColor;
  final double elevation;
  final Widget? bottom;

  const MobileAppBar({
    super.key,
    required this.title,
    this.leading,
    this.actions,
    this.showBackButton = true,
    this.onBack,
    this.centerTitle = true,
    this.backgroundColor,
    this.titleColor,
    this.elevation = 0,
    this.bottom,
  });

  @override
  Size get preferredSize => Size.fromHeight(kToolbarHeight + (bottom != null ? 48 : 0));

  @override
  Widget build(BuildContext context) {
    return Container(
      height: preferredSize.height,
      decoration: BoxDecoration(
        color: backgroundColor ?? AppColors.background,
        border: Border(
          bottom: BorderSide(
            color: AppColors.border,
            width: 0.5,
          ),
        ),
        boxShadow: elevation > 0 ? AppShadows.sm : [],
      ),
      child: Column(
        children: [
          Container(
            height: kToolbarHeight,
            padding: EdgeInsets.symmetric(horizontal: AppSpacing.appBarPadding),
            child: Row(
              children: [
                if (showBackButton && Navigator.of(context).canPop()) ...[
                  GestureDetector(
                    onTap: onBack ?? () => Navigator.of(context).pop(),
                    child: Container(
                      padding: const EdgeInsets.all(AppSpacing.xs),
                      child: Icon(
                        Icons.arrow_back_ios_new,
                        size: 20,
                        color: titleColor ?? AppColors.textPrimary,
                      ),
                    ),
                  ),
                ] else if (leading != null) ...[
                  leading!,
                ],
                Expanded(
                  child: centerTitle
                      ? Center(
                          child: Text(
                            title,
                            style: TextStyle(
                              fontFamily: AppTypography.fontFamily,
                              fontSize: AppTypography.fontSizeLg,
                              fontWeight: AppTypography.fontWeightSemibold,
                              color: titleColor ?? AppColors.textPrimary,
                            ),
                          ),
                        )
                      : Text(
                          title,
                          style: TextStyle(
                            fontFamily: AppTypography.fontFamily,
                            fontSize: AppTypography.fontSizeLg,
                            fontWeight: AppTypography.fontWeightSemibold,
                            color: titleColor ?? AppColors.textPrimary,
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
