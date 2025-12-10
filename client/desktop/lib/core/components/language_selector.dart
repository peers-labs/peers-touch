import 'package:flutter/material.dart';
import 'package:get/get.dart';

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

    return Container(
      decoration: BoxDecoration(
        color: theme.colorScheme.surface,
        borderRadius: BorderRadius.circular(20),
        border: Border.all(color: theme.colorScheme.outline.withOpacity(0.2)),
        boxShadow: [
          BoxShadow(
            color: Colors.black.withOpacity(0.05),
            blurRadius: 4,
            offset: const Offset(0, 2),
          ),
        ],
      ),
      padding: const EdgeInsets.symmetric(horizontal: 4),
      child: DropdownButtonHideUnderline(
        child: ButtonTheme(
          alignedDropdown: true,
          child: DropdownButton<String>(
            value: '${currentLocale.languageCode}_${currentLocale.countryCode}',
            icon: Icon(Icons.keyboard_arrow_down_rounded, 
              size: 16, 
              color: theme.colorScheme.onSurface.withOpacity(0.6)
            ),
            style: theme.textTheme.bodyMedium?.copyWith(
              fontWeight: FontWeight.w500,
              color: theme.colorScheme.onSurface.withOpacity(0.8),
            ),
            dropdownColor: theme.colorScheme.surface,
            elevation: 4,
            borderRadius: BorderRadius.circular(20),
            isDense: false,
            items: languages.entries.map((e) {
              return DropdownMenuItem<String>(
                value: e.key,
                child: Row(
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    if (e.key == '${currentLocale.languageCode}_${currentLocale.countryCode}')
                      Padding(
                        padding: const EdgeInsets.only(right: 8.0),
                        child: Icon(Icons.check, size: 14, color: theme.colorScheme.primary),
                      ),
                    Text(e.value),
                  ],
                ),
              );
            }).toList(),
            onChanged: (String? newValue) {
              if (newValue != null) {
                final parts = newValue.split('_');
                if (parts.length == 2) {
                  Get.updateLocale(Locale(parts[0], parts[1]));
                }
              }
            },
            selectedItemBuilder: (BuildContext context) {
              return languages.entries.map<Widget>((e) {
                return Row(
                  children: [
                    Icon(Icons.translate, 
                      size: 14, 
                      color: theme.colorScheme.onSurface.withOpacity(0.6)
                    ),
                    const SizedBox(width: 8),
                    Text(e.value),
                  ],
                );
              }).toList();
            },
          ),
        ),
      ),
    );
  }
}
