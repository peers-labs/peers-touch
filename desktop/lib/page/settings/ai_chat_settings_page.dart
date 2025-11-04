import 'package:desktop/controller/ai_chat_settings_controller.dart';
import 'package:flutter/material.dart';
import 'package:get/get.dart';
import 'ai_service_provider_page.dart';

class AIChatSettingsPage extends StatelessWidget {
  const AIChatSettingsPage({super.key});

  @override
  Widget build(BuildContext context) {
    final controller = Get.put(AIChatSettingsController());

    return Padding(
      padding: const EdgeInsets.all(24.0),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          const Text(
            'AI Chat Settings',
            style: TextStyle(
              fontSize: 24,
              fontWeight: FontWeight.bold,
            ),
          ),
          const SizedBox(height: 8),
          Text(
            'Configure AI chat services and behavior',
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
                  'AI Services',
                  [
                    _buildSettingsTile(
                      icon: Icons.smart_toy,
                      title: 'AI Service Provider',
                      subtitle: 'Configure AI service providers and API settings',
                      onTap: () {
                        Navigator.push(
                          context,
                          MaterialPageRoute(
                            builder: (context) => const AiServiceProviderPage(),
                          ),
                        );
                      },
                    ),
                    _buildSwitchSetting(
                      icon: Icons.auto_awesome,
                      title: 'Auto-complete suggestions',
                      subtitle: 'Show AI-powered suggestions while typing',
                      value: controller.autoComplete,
                      onChanged: (value) => controller.autoComplete = value,
                    ),
                  ],
                ),
                const SizedBox(height: 24),
                _buildSettingsSection(
                  'Chat Behavior',
                  [
                    _buildSwitchSetting(
                      icon: Icons.history,
                      title: 'Save chat history',
                      subtitle: 'Automatically save conversation history',
                      value: controller.saveHistory,
                      onChanged: (value) => controller.saveHistory = value,
                    ),
                    _buildSwitchSetting(
                      icon: Icons.send,
                      title: 'Send on Enter',
                      subtitle: 'Send message when pressing Enter key',
                      value: controller.sendOnEnter,
                      onChanged: (value) => controller.sendOnEnter = value,
                    ),
                    _buildDropdownSetting(
                      icon: Icons.speed,
                      title: 'Response speed',
                      subtitle: 'Balance between speed and quality',
                      value: controller.responseSpeed,
                      options: ['Fast', 'Balanced', 'Quality'],
                      onChanged: (value) {
                        if (value != null) {
                          controller.responseSpeed = value;
                        }
                      },
                    ),
                  ],
                ),
                const SizedBox(height: 24),
                _buildSettingsSection(
                  'Privacy',
                  [
                    _buildSwitchSetting(
                      icon: Icons.privacy_tip,
                      title: 'Anonymous mode',
                      subtitle: 'Don\'t send personal information to AI services',
                      value: controller.anonymousMode,
                      onChanged: (value) => controller.anonymousMode = value,
                    ),
                    _buildSwitchSetting(
                      icon: Icons.delete_sweep,
                      title: 'Auto-delete old chats',
                      subtitle: 'Automatically delete chats older than 30 days',
                      value: controller.autoDelete,
                      onChanged: (value) => controller.autoDelete = value,
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

  Widget _buildSettingsTile({
    required IconData icon,
    required String title,
    required String subtitle,
    required VoidCallback onTap,
  }) {
    return ListTile(
      leading: Icon(icon, color: Colors.blue),
      title: Text(title),
      subtitle: Text(subtitle),
      trailing: const Icon(Icons.chevron_right),
      onTap: onTap,
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
}