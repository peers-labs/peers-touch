import 'package:desktop/controller/settings_main_controller.dart';
import 'package:flutter/material.dart';
import 'package:get/get.dart';
import 'general_settings_page.dart';
import 'ai_chat_settings_page.dart';
import 'about_settings_page.dart';
import 'ai_service_provider_page.dart';

class SettingsMainPage extends StatelessWidget {
  const SettingsMainPage({super.key});

  @override
  Widget build(BuildContext context) {
    final controller = Get.put(SettingsMainController());

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
                child: Obx(() => ListView(
                  children: [
                    _buildSubNavItem(
                      icon: Icons.tune,
                      label: 'General',
                      isSelected: controller.selectedSubIndex == 0,
                      onTap: () => controller.selectSubIndex(0),
                    ),
                    _buildSubNavItem(
                      icon: Icons.smart_toy,
                      label: 'AI Chat',
                      isSelected: controller.selectedSubIndex == 1,
                      onTap: () => controller.selectSubIndex(1),
                    ),
                    _buildSubNavItem(
                      icon: Icons.model_training,
                      label: 'AI Provider',
                      isSelected: controller.selectedSubIndex == 2,
                      onTap: () => controller.selectSubIndex(2),
                    ),
                    _buildSubNavItem(
                      icon: Icons.info_outline,
                      label: 'About',
                      isSelected: controller.selectedSubIndex == 3,
                      onTap: () => controller.selectSubIndex(3),
                    ),
                  ],
                )),
              ),
            ],
          ),
        ),
        // Right Content Area
        Expanded(
          child: Obx(() => _buildSubContent(controller.selectedSubIndex)),
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
    return InkWell(
      onTap: onTap,
      borderRadius: BorderRadius.circular(8),
      child: Container(
        margin: const EdgeInsets.symmetric(horizontal: 8, vertical: 2),
        decoration: BoxDecoration(
          color: isSelected ? Colors.blue.withOpacity(0.1) : Colors.transparent,
          borderRadius: BorderRadius.circular(8),
        ),
        child: Padding(
          padding: const EdgeInsets.symmetric(horizontal: 16.0, vertical: 12.0),
          child: Row(
            children: [
              Icon(
                icon,
                color: isSelected ? Colors.blue : Colors.grey[600],
                size: 20,
              ),
              const SizedBox(width: 16),
              Expanded(
                child: Text(
                  label,
                  style: TextStyle(
                    color: isSelected ? Colors.blue : Colors.grey[800],
                    fontWeight: isSelected ? FontWeight.w600 : FontWeight.normal,
                    fontSize: 14,
                  ),
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }

  Widget _buildSubContent(int selectedSubIndex) {
    switch (selectedSubIndex) {
      case 0:
        return const GeneralSettingsPage();
      case 1:
        return const AIChatSettingsPage();
      case 2:
        return const AiServiceProviderPage(); // 使用新的GetX版本
      case 3:
        return const AboutSettingsPage();
      default:
        return const GeneralSettingsPage();
    }
  }
}