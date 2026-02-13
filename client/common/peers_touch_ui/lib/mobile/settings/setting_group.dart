import 'package:flutter/material.dart';
import 'package:peers_touch_ui/tokens/tokens.dart';

class SettingGroup extends StatelessWidget {
  final String? title;
  final List<Widget> children;
  final EdgeInsetsGeometry? padding;

  const SettingGroup({
    super.key,
    this.title,
    required this.children,
    this.padding,
  });

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: padding,
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          if (title != null) ...[
            Padding(
              padding: const EdgeInsets.only(
                left: AppSpacing.md,
                bottom: AppSpacing.xs,
              ),
              child: Text(
                title!,
                style: TextStyle(
                  fontFamily: AppTypography.fontFamily,
                  fontSize: AppTypography.fontSizeSm,
                  fontWeight: AppTypography.fontWeightMedium,
                  color: AppColors.textTertiary,
                ),
              ),
            ),
          ],
          Container(
            decoration: BoxDecoration(
              color: AppColors.background,
              borderRadius: AppRadius.lgBorder,
            ),
            child: Column(
              children: _buildChildren(),
            ),
          ),
        ],
      ),
    );
  }

  List<Widget> _buildChildren() {
    final result = <Widget>[];
    for (var i = 0; i < children.length; i++) {
      result.add(children[i]);
      if (i < children.length - 1) {
        result.add(
          Padding(
            padding: const EdgeInsets.only(left: AppSpacing.md + 36 + AppSpacing.sm),
            child: Container(
              height: 0.5,
              color: AppColors.border,
            ),
          ),
        );
      }
    }
    return result;
  }
}
