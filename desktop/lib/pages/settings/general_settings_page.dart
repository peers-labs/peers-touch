import 'package:flutter/material.dart';

class GeneralSettingsPage extends StatefulWidget {
  const GeneralSettingsPage({super.key});

  @override
  State<GeneralSettingsPage> createState() => _GeneralSettingsPageState();
}

class _GeneralSettingsPageState extends State<GeneralSettingsPage> {
  String selectedLanguage = 'English';
  String selectedTheme = 'System default';

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.all(24.0),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          const Text(
            'General Settings',
            style: TextStyle(
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
            child: ListView(
              children: [
                _buildSettingsSection(
                  'Appearance',
                  [
                    _buildDropdownSetting(
                      icon: Icons.language,
                      title: 'Language',
                      subtitle: 'Choose your preferred language',
                      value: selectedLanguage,
                      options: ['English', '中文', 'Español', 'Français'],
                      onChanged: (value) {
                        setState(() {
                          selectedLanguage = value!;
                        });
                      },
                    ),
                    _buildDropdownSetting(
                      icon: Icons.dark_mode,
                      title: 'Theme',
                      subtitle: 'Choose your preferred theme',
                      value: selectedTheme,
                      options: ['Light', 'Dark', 'System default'],
                      onChanged: (value) {
                        setState(() {
                          selectedTheme = value!;
                        });
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
                      value: true,
                      onChanged: (value) {
                        // TODO: Implement notification settings
                      },
                    ),
                    _buildSwitchSetting(
                      icon: Icons.launch,
                      title: 'Start on system startup',
                      subtitle: 'Automatically start the application when system boots',
                      value: false,
                      onChanged: (value) {
                        // TODO: Implement startup settings
                      },
                    ),
                  ],
                ),
              ],
            ),
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

  Widget _buildDropdownSetting({
    required IconData icon,
    required String title,
    required String subtitle,
    required String value,
    required List<String> options,
    required ValueChanged<String?> onChanged,
  }) {
    return ListTile(
      leading: Icon(icon, color: Colors.blue),
      title: Text(title),
      subtitle: Text(subtitle),
      trailing: DropdownButton<String>(
        value: value,
        underline: const SizedBox(),
        items: options.map((String option) {
          return DropdownMenuItem<String>(
            value: option,
            child: Text(option),
          );
        }).toList(),
        onChanged: onChanged,
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
    return ListTile(
      leading: Icon(icon, color: Colors.blue),
      title: Text(title),
      subtitle: Text(subtitle),
      trailing: Switch(
        value: value,
        onChanged: onChanged,
      ),
    );
  }
}