import 'package:desktop/controller/general_settings_controller.dart';
import 'package:desktop/provider/locale_provider.dart';
import 'package:flutter/material.dart';
import 'package:get/get.dart';
import 'package:provider/provider.dart';

class GeneralSettingsPage extends StatelessWidget {
  const GeneralSettingsPage({super.key});

  @override
  Widget build(BuildContext context) {
    final controller = Get.put(GeneralSettingsController());
    final localeProvider = Provider.of<LocaleProvider>(context);

    return Padding(
      padding: const EdgeInsets.all(24.0),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(
            localeProvider.translate('general') ?? 'General',
            style: const TextStyle(
              fontSize: 24,
              fontWeight: FontWeight.bold,
            ),
          ),
          const SizedBox(height: 8),
          Text(
            'Configure general application settings',
            style: TextStyle(
              fontSize: 14,
              color: Colors.grey[600],
            ),
          ),
          const SizedBox(height: 32),
          Expanded(
            child: Obx(() => ListView(
                  children: [
                    _buildSettingsSection(
                      'Appearance',
                      [
                        _buildDropdownSetting(
                          context,
                          icon: Icons.language,
                          title: localeProvider.translate('language') ?? 'Language',
                          subtitle: 'Choose your preferred language',
                          value: controller.selectedLanguage,
                          options: ['English', '中文'],
                          onChanged: (value) {
                            if (value != null) {
                              controller.selectedLanguage = value;
                              if (value == 'English') {
                                localeProvider.setLocale(const Locale('en'));
                              } else if (value == '中文') {
                                localeProvider.setLocale(const Locale('zh'));
                              }
                            }
                          },
                        ),
                        _buildDropdownSetting(
                          context,
                          icon: Icons.dark_mode,
                          title: 'Theme',
                          subtitle: 'Choose your preferred theme',
                          value: controller.selectedTheme,
                          options: ['Light', 'Dark', 'System default'],
                          onChanged: (value) {
                            if (value != null) {
                              controller.selectedTheme = value;
                            }
                          },
                        ),
                      ],
                    ),
                    const SizedBox(height: 24),
                    _buildSettingsSection(
                      'Behavior',
                      [
                        _buildSwitchSetting(
                          icon: Icons.notifications,
                          title: 'Notifications',
                          subtitle: 'Enable desktop notifications',
                          value: controller.notifications,
                          onChanged: (value) =>
                              controller.notifications = value,
                        ),
                        _buildSwitchSetting(
                          icon: Icons.launch,
                          title: 'Start on system startup',
                          subtitle:
                              'Automatically start the application when system boots',
                          value: controller.startOnStartup,
                          onChanged: (value) =>
                              controller.startOnStartup = value,
                        ),
                      ],
                    ),
                  ],
                )),
          ),
        ],
      ),
    );
  }

  Widget _buildSettingsSection(String title, List<Widget> children) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text(
          title,
          style: const TextStyle(
            fontSize: 16,
            fontWeight: FontWeight.w600,
            color: Colors.grey,
          ),
        ),
        const SizedBox(height: 12),
        Card(
          elevation: 1,
          child: Column(
            children: children,
          ),
        ),
      ],
    );
  }

  Widget _buildDropdownSetting(
    BuildContext context,
    {
    required IconData icon,
    required String title,
    required String subtitle,
    required String value,
    required List<String> options,
    required ValueChanged<String?> onChanged,
  }) {
    return InkWell(
      onTap: () {
        // Show dropdown menu
        final RenderBox? renderBox = context.findRenderObject() as RenderBox?;
        if (renderBox != null) {
          final position = renderBox.localToGlobal(Offset.zero);
          final size = renderBox.size;

          showMenu<String>(
            context: context,
            position: RelativeRect.fromLTRB(
              position.dx,
              position.dy + size.height,
              position.dx + size.width,
              position.dy + size.height,
            ),
            items: options.map((String option) {
              return PopupMenuItem<String>(
                value: option,
                child: Text(option),
              );
            }).toList(),
          ).then((String? newValue) {
            if (newValue != null) {
              onChanged(newValue);
            }
          });
        }
      },
      child: Padding(
        padding: const EdgeInsets.symmetric(horizontal: 16.0, vertical: 12.0),
        child: Row(
          children: [
            Icon(icon, color: Colors.blue, size: 24),
            const SizedBox(width: 16),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                mainAxisSize: MainAxisSize.min,
                children: [
                  Text(
                    title,
                    style: const TextStyle(
                      fontSize: 16,
                      fontWeight: FontWeight.w500,
                    ),
                  ),
                  const SizedBox(height: 2),
                  Text(
                    subtitle,
                    style: TextStyle(
                      fontSize: 12,
                      color: Colors.grey[600],
                    ),
                  ),
                ],
              ),
            ),
            const SizedBox(width: 16),
            Row(
              mainAxisSize: MainAxisSize.min,
              children: [
                Text(value, style: const TextStyle(fontSize: 14)),
                const SizedBox(width: 8),
                const Icon(Icons.arrow_drop_down, size: 20),
              ],
            ),
          ],
        ),
      ),
    );
  }

  Widget _buildSwitchSetting({
    required IconData icon,
    required String title,
    required String subtitle,
    required bool value,
    required ValueChanged<bool> onChanged,
  }) {
    return InkWell(
      onTap: () => onChanged(!value),
      child: Padding(
        padding: const EdgeInsets.symmetric(horizontal: 16.0, vertical: 12.0),
        child: Row(
          children: [
            Icon(icon, color: Colors.blue, size: 24),
            const SizedBox(width: 16),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                mainAxisSize: MainAxisSize.min,
                children: [
                  Text(
                    title,
                    style: const TextStyle(
                      fontSize: 16,
                      fontWeight: FontWeight.w500,
                    ),
                  ),
                  const SizedBox(height: 2),
                  Text(
                    subtitle,
                    style: TextStyle(
                      fontSize: 12,
                      color: Colors.grey[600],
                    ),
                  ),
                ],
              ),
            ),
            const SizedBox(width: 16),
            Switch(
              value: value,
              onChanged: onChanged,
            ),
          ],
        ),
      ),
    );
  }
}