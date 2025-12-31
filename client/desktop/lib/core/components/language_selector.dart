import 'package:flutter/material.dart';
import 'package:get/get.dart';
import 'package:peers_touch_desktop/app/theme/ui_kit.dart';

class LanguageSelector extends StatelessWidget {
  const LanguageSelector({super.key});

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final currentLocale = Get.locale ?? const Locale('en', 'US');
    
    // Map of supported locales to display names
    final languages = {
      'zh_CN': '简体中文',
      'en_US': 'English',
    };

    final menuController = MenuController();
    final selectedKey = '${currentLocale.languageCode}_${currentLocale.countryCode}';
    final textStyle = theme.textTheme.bodyMedium?.copyWith(
      fontWeight: FontWeight.w500,
      color: UIKit.textPrimary(context).withValues(alpha: 0.85),
    );
    double measureText(String s) {
      final painter = TextPainter(
        text: TextSpan(text: s, style: textStyle),
        textDirection: TextDirection.ltr,
        maxLines: 1,
      )..layout();
      return painter.width;
    }
    final maxText = languages.values.map(measureText).fold<double>(0, (a, b) => a > b ? a : b);
    final targetWidth = maxText + 14 /*icon*/ + 8 /*gap*/ + UIKit.spaceSm(context) /*right pad*/ + UIKit.spaceSm(context) /*left pad*/;
    return Container(
      decoration: BoxDecoration(
        color: UIKit.inputFillLight(context),
        borderRadius: BorderRadius.circular(UIKit.radiusSm(context)),
        border: Border.all(color: UIKit.dividerColor(context), width: UIKit.dividerThickness),
      ),
      padding: EdgeInsets.zero,
      child: MenuAnchor(
        controller: menuController,
        // 将下拉面板放到触发器下方，间距约等于菜单项间距
        alignmentOffset: Offset(0, UIKit.spaceSm(context)),
        menuChildren: [
          MenuTheme(
            data: MenuThemeData(
              style: MenuStyle(
                backgroundColor: WidgetStatePropertyAll(UIKit.inputFillLight(context)),
                surfaceTintColor: const WidgetStatePropertyAll(Colors.transparent),
                elevation: const WidgetStatePropertyAll(0),
                padding: const WidgetStatePropertyAll(EdgeInsets.zero),
                shape: WidgetStatePropertyAll(RoundedRectangleBorder(
                  borderRadius: BorderRadius.circular(UIKit.radiusSm(context)),
                  side: BorderSide(color: UIKit.dividerColor(context), width: UIKit.dividerThickness),
                )),
              ),
            ),
            child: SizedBox(
              width: targetWidth,
              child: Column(
                mainAxisSize: MainAxisSize.min,
                children: languages.entries.map((e) {
                  final isSelected = e.key == selectedKey;
                  return InkWell(
                    onTap: () {
                      final parts = e.key.split('_');
                      if (parts.length == 2) {
                        Get.updateLocale(Locale(parts[0], parts[1]));
                      }
                      menuController.close();
                    },
                    child: SizedBox(
                      height: UIKit.controlHeightMd,
                      child: Padding(
                        padding: EdgeInsets.symmetric(horizontal: UIKit.spaceSm(context)),
                        child: Row(
                          children: [
                            isSelected
                                ? Icon(Icons.check, size: 14, color: theme.colorScheme.primary)
                                : const SizedBox(width: 14),
                            const SizedBox(width: 8),
                            Expanded(child: Text(e.value, style: textStyle)),
                          ],
                        ),
                      ),
                    ),
                  );
                }).toList(),
              ),
            ),
          ),
        ],
        child: InkWell(
          borderRadius: BorderRadius.circular(UIKit.radiusSm(context)),
          onTap: () => menuController.open(),
          child: SizedBox(
            width: targetWidth,
            height: UIKit.controlHeightMd,
            child: Padding(
              padding: EdgeInsets.symmetric(horizontal: UIKit.spaceSm(context)),
              child: Row(
                mainAxisSize: MainAxisSize.min,
                children: [
                  Icon(
                    Icons.translate,
                    size: 14,
                    color: UIKit.textSecondary(context).withValues(alpha: 0.6),
                  ),
                  const SizedBox(width: 8),
                  Text(languages[selectedKey] ?? 'English', style: textStyle),
                ],
              ),
          ),
        ),
      ),
    ),
    );
  }
}
