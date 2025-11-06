import 'package:flutter/material.dart';
import 'package:get/get.dart';
import 'package:peers_touch_desktop/app/theme/app_theme.dart';
import '../controller/setting_controller.dart';
import '../model/setting_item.dart';

class SettingPage extends StatelessWidget {
  final SettingController controller;

  const SettingPage({super.key, required this.controller});

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);

    return Container(
      color: theme.colorScheme.surface, // 使用surface替代background
      child: Row(
        children: [
          // 左侧设置分区导航
          _buildSettingNavigation(context, theme),
          
          // 右侧设置内容
          Expanded(
            child: _buildSettingContent(context, theme),
          ),
        ],
      ),
    );
  }

  Widget _buildSettingNavigation(BuildContext context, ThemeData theme) {
    return Container(
      width: 240,
      color: theme.colorScheme.surface,
      child: Column(
        children: [
          // 标题
          Container(
            height: 64,
            padding: const EdgeInsets.symmetric(horizontal: 16),
            alignment: Alignment.centerLeft,
            child: Text(
              '设置',
              style: theme.textTheme.headlineSmall?.copyWith(color: theme.colorScheme.onSurface),
            ),
          ),
          
          // 分区列表
          Expanded(
            child: Obx(() {
              final sections = controller.sections;
              return ListView.builder(
                itemCount: sections.length,
                itemBuilder: (context, index) {
                  final section = sections[index];
                  final isSelected = controller.selectedSection.value == section.id;
                  
                  return _buildSectionItem(context, section, isSelected, theme);
                },
              );
            }),
          ),
        ],
      ),
    );
  }

  Widget _buildSectionItem(BuildContext context, SettingSection section, bool isSelected, ThemeData theme) {
    return Container(
      color: isSelected ? theme.colorScheme.menuItemSelected : Colors.transparent,
      child: ListTile(
        leading: Icon(section.icon ?? Icons.settings, color: theme.colorScheme.onSurface),
        title: Text(
          section.title,
          style: TextStyle(color: theme.colorScheme.onSurface),
        ),
        onTap: () => controller.selectSection(section.id),
      ),
    );
  }

  Widget _buildSettingContent(BuildContext context, ThemeData theme) {
    return Container(
      color: theme.colorScheme.surface, // 使用surface替代background
      child: Obx(() {
        final currentSection = controller.getCurrentSection();
        if (currentSection == null) {
          return Center(
            child: Text('请选择设置分区', style: TextStyle(color: theme.colorScheme.onSurface)), // 使用onSurface替代onBackground
          );
        }
        
        return Column(
          children: [
            // 分区标题
            Container(
              height: 64,
              padding: const EdgeInsets.symmetric(horizontal: 24),
              alignment: Alignment.centerLeft,
              child: Text(
                currentSection.title,
                style: theme.textTheme.titleLarge?.copyWith(color: theme.colorScheme.onSurface), // 使用onSurface替代onBackground
              ),
            ),
            
            // 设置项列表
            Expanded(
              child: ListView.builder(
                padding: const EdgeInsets.symmetric(horizontal: 24),
                itemCount: currentSection.items.length,
                itemBuilder: (context, index) {
                  final item = currentSection.items[index];
                  return _buildSettingItem(context, item, theme);
                },
              ),
            ),
          ],
        );
      }),
    );
  }

  Widget _buildSettingItem(BuildContext context, SettingItem item, ThemeData theme) {
    switch (item.type) {
      case SettingItemType.sectionHeader:
        return _buildSectionHeader(item, theme);
      case SettingItemType.toggle:
        return _buildToggleItem(item, theme);
      case SettingItemType.select:
        return _buildSelectItem(item, theme);
      case SettingItemType.textInput:
        return _buildTextInputItem(item, theme);
      case SettingItemType.button:
        return _buildButtonItem(item, theme);
      case SettingItemType.divider:
        return Divider(color: theme.colorScheme.outlineVariant);
    }
  }

  Widget _buildSectionHeader(SettingItem item, ThemeData theme) {
    return Container(
      margin: const EdgeInsets.only(top: 24, bottom: 16),
      child: Text(
        item.title,
        style: theme.textTheme.titleMedium?.copyWith(color: theme.colorScheme.onSurface),
      ),
    );
  }

  Widget _buildToggleItem(SettingItem item, ThemeData theme) {
    return Container(
      margin: const EdgeInsets.symmetric(vertical: 8),
      child: Row(
        children: [
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  item.title,
                  style: theme.textTheme.bodyLarge?.copyWith(color: theme.colorScheme.onSurface),
                ),
                if (item.description != null)
                  Padding(
                    padding: const EdgeInsets.only(top: 4),
                    child: Text(
                      item.description!,
                      style: theme.textTheme.bodySmall?.copyWith(color: Color(theme.colorScheme.onSurface.value).withOpacity(0.7)),
                    ),
                  ),
              ],
            ),
          ),
          Switch(
            value: item.value ?? false,
            onChanged: (value) {
              item.onChanged?.call(value);
            },
          ),
        ],
      ),
    );
  }

  Widget _buildSelectItem(SettingItem item, ThemeData theme) {
    return Container(
      margin: const EdgeInsets.symmetric(vertical: 8),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(
            item.title,
            style: theme.textTheme.bodyLarge?.copyWith(color: theme.colorScheme.onSurface),
          ),
          if (item.description != null)
              Padding(
                padding: const EdgeInsets.only(top: 4, bottom: 8),
                child: Text(
                  item.description!,
                  style: theme.textTheme.bodySmall?.copyWith(color: Color(theme.colorScheme.onSurface.value).withOpacity(0.7)),
                ),
              ),
          Container(
            width: double.infinity,
            padding: const EdgeInsets.symmetric(horizontal: 12),
            decoration: BoxDecoration(
              color: theme.colorScheme.surface,
              borderRadius: BorderRadius.circular(8),
            ),
            child: DropdownButton<String>(
              value: item.value?.toString(),
              items: item.options?.map((option) {
                return DropdownMenuItem<String>(
                  value: option,
                  child: Text(option, style: TextStyle(color: theme.colorScheme.onSurface)),
                );
              }).toList(),
              onChanged: (value) {
                item.onChanged?.call(value);
              },
              dropdownColor: theme.colorScheme.surface,
              style: TextStyle(color: theme.colorScheme.onSurface),
              isExpanded: true,
              underline: const SizedBox(),
            ),
          ),
        ],
      ),
    );
  }

  Widget _buildTextInputItem(SettingItem item, ThemeData theme) {
    return Container(
      margin: const EdgeInsets.symmetric(vertical: 8),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(
            item.title,
            style: theme.textTheme.bodyLarge?.copyWith(color: theme.colorScheme.onSurface),
          ),
          if (item.description != null)
              Padding(
                padding: const EdgeInsets.only(top: 4, bottom: 8),
                child: Text(
                  item.description!,
                  style: theme.textTheme.bodySmall?.copyWith(color: Color(theme.colorScheme.onSurface.value).withOpacity(0.7)),
                ),
              ),
          TextField(
            controller: TextEditingController(text: item.value?.toString() ?? ''),
            decoration: InputDecoration(
              hintText: item.placeholder,
              hintStyle: TextStyle(color: Color(theme.colorScheme.onSurface.value).withOpacity(0.5)),
              filled: true,
              fillColor: theme.colorScheme.surface,
              border: OutlineInputBorder(
                borderRadius: BorderRadius.circular(8),
                borderSide: BorderSide.none,
              ),
              contentPadding: const EdgeInsets.symmetric(horizontal: 12, vertical: 12),
            ),
            style: TextStyle(color: theme.colorScheme.onSurface),
            onChanged: (value) {
              item.onChanged?.call(value);
            },
          ),
        ],
      ),
    );
  }

  Widget _buildButtonItem(SettingItem item, ThemeData theme) {
    return Container(
      margin: const EdgeInsets.symmetric(vertical: 8),
      child: ElevatedButton(
        onPressed: item.onTap,
        style: ElevatedButton.styleFrom(
          backgroundColor: theme.colorScheme.primary,
          foregroundColor: theme.colorScheme.onPrimary,
        ),
        child: Text(item.title),
      ),
    );
  }
}