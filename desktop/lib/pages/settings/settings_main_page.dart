import 'package:flutter/material.dart';
import 'general_settings_page.dart';
import 'ai_chat_settings_page.dart';
import 'about_settings_page.dart';

class SettingsMainPage extends StatefulWidget {
  const SettingsMainPage({super.key});

  @override
  State<SettingsMainPage> createState() => _SettingsMainPageState();
}

class _SettingsMainPageState extends State<SettingsMainPage> {
  int selectedSubIndex = 0; // 0: General, 1: AI Chat, 2: About

  @override
  Widget build(BuildContext context) {
    return Row(
      children: [
        // Left Sub-navigation
        Container(
          width: 200,
          decoration: BoxDecoration(
            color: Colors.grey[50],
            border: Border(
              right: BorderSide(color: Colors.grey[300]!),
            ),
          ),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              const Padding(
                padding: EdgeInsets.all(16.0),
                child: Text(
                  'Settings',
                  style: TextStyle(
                    fontSize: 18,
                    fontWeight: FontWeight.bold,
                  ),
                ),
              ),
              Expanded(
                child: ListView(
                  children: [
                    _buildSubNavItem(
                      icon: Icons.tune,
                      label: 'General',
                      isSelected: selectedSubIndex == 0,
                      onTap: () => setState(() => selectedSubIndex = 0),
                    ),
                    _buildSubNavItem(
                      icon: Icons.smart_toy,
                      label: 'AI Chat',
                      isSelected: selectedSubIndex == 1,
                      onTap: () => setState(() => selectedSubIndex = 1),
                    ),
                    _buildSubNavItem(
                      icon: Icons.info_outline,
                      label: 'About',
                      isSelected: selectedSubIndex == 2,
                      onTap: () => setState(() => selectedSubIndex = 2),
                    ),
                  ],
                ),
              ),
            ],
          ),
        ),
        // Right Content Area
        Expanded(
          child: _buildSubContent(),
        ),
      ],
    );
  }

  Widget _buildSubNavItem({
    required IconData icon,
    required String label,
    required bool isSelected,
    required VoidCallback onTap,
  }) {
    return Container(
      margin: const EdgeInsets.symmetric(horizontal: 8, vertical: 2),
      decoration: BoxDecoration(
        color: isSelected ? Colors.blue.withOpacity(0.1) : Colors.transparent,
        borderRadius: BorderRadius.circular(8),
      ),
      child: ListTile(
        leading: Icon(
          icon,
          color: isSelected ? Colors.blue : Colors.grey[600],
          size: 20,
        ),
        title: Text(
          label,
          style: TextStyle(
            color: isSelected ? Colors.blue : Colors.grey[800],
            fontWeight: isSelected ? FontWeight.w600 : FontWeight.normal,
          ),
        ),
        onTap: onTap,
        dense: true,
      ),
    );
  }

  Widget _buildSubContent() {
    switch (selectedSubIndex) {
      case 0:
        return const GeneralSettingsPage();
      case 1:
        return const AIChatSettingsPage();
      case 2:
        return const AboutSettingsPage();
      default:
        return const GeneralSettingsPage();
    }
  }
}