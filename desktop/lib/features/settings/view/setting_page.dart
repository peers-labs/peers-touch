import 'package:flutter/material.dart';
import 'package:get/get.dart';
import 'package:peers_touch_desktop/app/i18n/generated/app_localizations.dart';
import 'package:peers_touch_desktop/app/theme/app_theme.dart';
import 'package:peers_touch_desktop/app/theme/lobe_tokens.dart';
import 'package:peers_touch_desktop/features/settings/controller/setting_controller.dart';
import 'package:peers_touch_desktop/features/settings/model/setting_item.dart';
import 'package:peers_touch_desktop/features/settings/model/setting_search_result.dart';

class SettingPage extends StatelessWidget {
  final SettingController controller;

  const SettingPage({super.key, required this.controller});

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final tokens = theme.extension<LobeTokens>()!;

    return Container(
      color: tokens.bgLevel1,
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
    final tokens = theme.extension<LobeTokens>()!;
    final l = AppLocalizations.of(context);
    return Container(
      width: 240,
      color: tokens.bgLevel2,
      child: Column(
        children: [
          // 标题
          Container(
            height: 64,
            padding: const EdgeInsets.symmetric(horizontal: 16),
            alignment: Alignment.centerLeft,
            child: Text(
              l.settingsTitle,
              style: theme.textTheme.headlineSmall?.copyWith(color: tokens.textPrimary),
            ),
          ),
          // 左侧搜索框（模块内搜索，位于二级菜单顶部）
          Padding(
            padding: EdgeInsets.symmetric(horizontal: tokens.spaceSm),
            child: _buildLeftSearchBar(context, theme),
          ),
          
          // 分区列表
          Expanded(
            child: Obx(() {
              final query = controller.searchQuery.value.trim();
              if (query.isNotEmpty) {
                final results = controller.getSearchResults();
                if (results.isEmpty) {
                  return Center(
                    child: Text('未找到相关设置', style: TextStyle(color: tokens.textSecondary)),
                  );
                }
                return ListView.builder(
                  itemCount: results.length,
                  itemBuilder: (context, index) {
                    final r = results[index];
                    return _buildSearchResultTile(context, r, theme);
                  },
                );
              }
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
    final tokens = theme.extension<LobeTokens>()!;
    final l = AppLocalizations.of(context);
    return Container(
      margin: EdgeInsets.symmetric(vertical: tokens.spaceXs, horizontal: tokens.spaceSm),
      decoration: BoxDecoration(
        color: isSelected ? tokens.menuSelected : Colors.transparent,
        borderRadius: BorderRadius.circular(tokens.radiusSm),
      ),
      child: ListTile(
        leading: Icon(section.icon ?? Icons.settings, color: tokens.textPrimary),
        title: Text(
          _sectionTitle(l, section),
          style: TextStyle(color: tokens.textPrimary),
        ),
        onTap: () => controller.selectSection(section.id),
      ),
    );
  }

  Widget _buildSettingContent(BuildContext context, ThemeData theme) {
    final tokens = theme.extension<LobeTokens>()!;
    final l = AppLocalizations.of(context);
    return Container(
      color: tokens.bgLevel1,
      child: Obx(() {
        final currentSection = controller.getCurrentSection();
        if (currentSection == null) {
          return Center(
            child: Text(l.chooseSettingsSection, style: TextStyle(color: tokens.textSecondary)),
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
                _sectionTitle(l, currentSection),
                style: theme.textTheme.titleLarge?.copyWith(color: tokens.textPrimary),
              ),
            ),
            
            // 设置项列表（避免在此处使用嵌套Obx，直接由外层Obx驱动）
            Expanded(
              child: ListView.builder(
                padding: const EdgeInsets.symmetric(horizontal: 24),
                itemCount: currentSection.items.length,
                itemBuilder: (context, index) {
                  final item = currentSection.items[index];
                  return _buildSettingItem(context, currentSection.id, item, theme);
                },
              ),
            ),
          ],
        );
      }),
    );
  }

  Widget _buildLeftSearchBar(BuildContext context, ThemeData theme) {
    final tokens = theme.extension<LobeTokens>()!;
    return TextField(
      decoration: InputDecoration(
        hintText: '搜索设置',
        hintStyle: TextStyle(color: tokens.textSecondary.withOpacity(0.7)),
        filled: true,
        fillColor: tokens.bgLevel3,
        border: OutlineInputBorder(
          borderRadius: BorderRadius.circular(tokens.radiusSm),
          borderSide: BorderSide(color: tokens.divider),
        ),
        contentPadding: EdgeInsets.symmetric(horizontal: tokens.spaceSm, vertical: tokens.spaceSm),
        prefixIcon: Icon(Icons.search, color: tokens.textSecondary),
        isDense: true,
      ),
      style: TextStyle(color: tokens.textPrimary),
      onChanged: controller.setSearchQuery,
    );
  }

  Widget _buildSearchResultTile(BuildContext context, SettingSearchResult r, ThemeData theme) {
    final tokens = theme.extension<LobeTokens>()!;
    final l = AppLocalizations.of(context);
    final section = controller.sections.firstWhere((s) => s.id == r.sectionId);
    return Container(
      margin: EdgeInsets.symmetric(vertical: tokens.spaceXs, horizontal: tokens.spaceSm),
      decoration: BoxDecoration(
        color: Colors.transparent,
        borderRadius: BorderRadius.circular(tokens.radiusSm),
      ),
      child: ListTile(
        dense: true,
        title: Text(
          '${_sectionTitle(l, section)} · ${_itemTitle(l, r.item)}',
          style: TextStyle(color: tokens.textPrimary),
          overflow: TextOverflow.ellipsis,
        ),
        onTap: () {
          controller.selectSection(r.sectionId);
          controller.setSearchQuery('');
        },
      ),
    );
  }

  Widget _buildSettingItem(BuildContext context, String sectionId, SettingItem item, ThemeData theme) {
    switch (item.type) {
      case SettingItemType.sectionHeader:
        return _buildSectionHeader(context, item, theme);
      case SettingItemType.toggle:
        return _buildToggleItem(context, sectionId, item, theme);
      case SettingItemType.select:
        return _buildSelectItem(context, sectionId, item, theme);
      case SettingItemType.textInput:
        return _buildTextInputItem(context, sectionId, item, theme);
      case SettingItemType.button:
        return _buildButtonItem(context, sectionId, item, theme);
      case SettingItemType.divider:
        return Divider(color: theme.colorScheme.outlineVariant);
    }
  }

  Widget _buildSectionHeader(BuildContext context, SettingItem item, ThemeData theme) {
    final tokens = theme.extension<LobeTokens>()!;
    final l = AppLocalizations.of(context);
    return Container(
      margin: EdgeInsets.only(top: tokens.spaceLg, bottom: tokens.spaceSm),
      child: Text(
        _itemTitle(l, item),
        style: theme.textTheme.titleMedium?.copyWith(color: tokens.textPrimary),
      ),
    );
  }

  Widget _buildToggleItem(BuildContext context, String sectionId, SettingItem item, ThemeData theme) {
    final tokens = theme.extension<LobeTokens>()!;
    final l = AppLocalizations.of(context);
    return Container(
      margin: EdgeInsets.symmetric(vertical: tokens.spaceSm),
      padding: EdgeInsets.all(tokens.spaceSm),
      decoration: BoxDecoration(
        color: tokens.bgLevel2,
        borderRadius: BorderRadius.circular(tokens.radiusMd),
        border: Border.all(color: tokens.divider),
      ),
      child: Row(
        children: [
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  _itemTitle(l, item),
                  style: theme.textTheme.bodyLarge?.copyWith(color: tokens.textPrimary),
                ),
                if (item.description != null)
                  Padding(
                    padding: EdgeInsets.only(top: tokens.spaceXs),
                    child: Text(
                      _itemDescription(l, item),
                      style: theme.textTheme.bodySmall?.copyWith(color: tokens.textSecondary),
                    ),
                  ),
              ],
            ),
          ),
          Switch(
            value: item.value ?? false,
            onChanged: (value) {
              controller.updateSettingValue(sectionId, item.id, value);
              item.onChanged?.call(value);
            },
          ),
        ],
      ),
    );
  }

  Widget _buildSelectItem(BuildContext context, String sectionId, SettingItem item, ThemeData theme) {
    final tokens = theme.extension<LobeTokens>()!;
    final l = AppLocalizations.of(context);
    return Container(
      margin: EdgeInsets.symmetric(vertical: tokens.spaceSm),
      padding: EdgeInsets.all(tokens.spaceSm),
      decoration: BoxDecoration(
        color: tokens.bgLevel2,
        borderRadius: BorderRadius.circular(tokens.radiusMd),
        border: Border.all(color: tokens.divider),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(
            _itemTitle(l, item),
            style: theme.textTheme.bodyLarge?.copyWith(color: tokens.textPrimary),
          ),
          if (item.description != null)
              Padding(
                padding: EdgeInsets.only(top: tokens.spaceXs, bottom: tokens.spaceSm),
                child: Text(
                  _itemDescription(l, item),
                  style: theme.textTheme.bodySmall?.copyWith(color: tokens.textSecondary),
                ),
              ),
          Container(
            width: double.infinity,
            padding: EdgeInsets.symmetric(horizontal: tokens.spaceSm),
            decoration: BoxDecoration(
              color: tokens.bgLevel3,
              borderRadius: BorderRadius.circular(tokens.radiusSm),
            ),
            child: DropdownButton<String>(
              value: item.value?.toString(),
              items: item.options?.map((option) {
                return DropdownMenuItem<String>(
                  value: option,
                  child: Text(option, style: TextStyle(color: tokens.textPrimary)),
                );
              }).toList(),
              onChanged: (value) {
                if (value != null) {
                  controller.updateSettingValue(sectionId, item.id, value);
                  item.onChanged?.call(value);
                }
              },
              dropdownColor: tokens.bgLevel3,
              style: TextStyle(color: tokens.textPrimary),
              isExpanded: true,
              underline: const SizedBox(),
            ),
          ),
        ],
      ),
    );
  }

  Widget _buildTextInputItem(BuildContext context, String sectionId, SettingItem item, ThemeData theme) {
    final tokens = theme.extension<LobeTokens>()!;
    final l = AppLocalizations.of(context);
    return Container(
      margin: EdgeInsets.symmetric(vertical: tokens.spaceSm),
      padding: EdgeInsets.all(tokens.spaceSm),
      decoration: BoxDecoration(
        color: tokens.bgLevel2,
        borderRadius: BorderRadius.circular(tokens.radiusMd),
        border: Border.all(color: tokens.divider),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(
            _itemTitle(l, item),
            style: theme.textTheme.bodyLarge?.copyWith(color: tokens.textPrimary),
          ),
          if (item.description != null)
              Padding(
                padding: EdgeInsets.only(top: tokens.spaceXs, bottom: tokens.spaceSm),
                child: Text(
                  _itemDescription(l, item),
                  style: theme.textTheme.bodySmall?.copyWith(color: tokens.textSecondary),
                ),
              ),
          TextField(
            controller: TextEditingController(text: item.value?.toString() ?? ''),
            decoration: InputDecoration(
              hintText: _itemPlaceholder(l, item),
              hintStyle: TextStyle(color: tokens.textSecondary.withOpacity(0.7)),
              filled: true,
              fillColor: tokens.bgLevel3,
              border: OutlineInputBorder(
                borderRadius: BorderRadius.circular(tokens.radiusSm),
                borderSide: BorderSide(color: tokens.divider),
              ),
              contentPadding: EdgeInsets.symmetric(horizontal: tokens.spaceSm, vertical: tokens.spaceSm),
            ),
            style: TextStyle(color: tokens.textPrimary),
            onChanged: (value) {
              controller.updateSettingValue(sectionId, item.id, value);
              item.onChanged?.call(value);
            },
          ),
        ],
      ),
    );
  }

  Widget _buildButtonItem(BuildContext context, String sectionId, SettingItem item, ThemeData theme) {
    final tokens = theme.extension<LobeTokens>()!;
    final l = AppLocalizations.of(context);
    return Container(
      margin: EdgeInsets.symmetric(vertical: tokens.spaceSm),
      child: ElevatedButton(
        onPressed: item.onTap,
        style: ElevatedButton.styleFrom(
          backgroundColor: tokens.brandAccent,
          foregroundColor: Colors.white,
        ),
        child: Text(_itemTitle(l, item)),
      ),
    );
  }

  String _sectionTitle(AppLocalizations l, SettingSection section) {
    switch (section.id) {
      case 'general':
        return l.generalSettings;
      case 'global_business':
        return l.globalBusinessSettings;
      default:
        return section.title;
    }
  }

  String _itemTitle(AppLocalizations l, SettingItem item) {
    switch (item.id) {
      case 'language':
        return l.language;
      case 'theme':
        return l.theme;
      case 'color_scheme':
        return l.colorScheme;
      case 'backend_url':
        return l.backendUrl;
      case 'auth_token':
        return l.authToken;
      case 'ai_provider_header':
        return l.aiProviderHeader;
      case 'openai_api_key':
        return l.openaiApiKey;
      case 'openai_base_url':
        return l.openaiBaseUrl;
      case 'model_selection':
        return l.defaultModel;
      default:
        return item.title;
    }
  }

  String _itemDescription(AppLocalizations l, SettingItem item) {
    switch (item.id) {
      case 'language':
        return l.selectAppLanguage;
      case 'theme':
        return l.selectAppTheme;
      case 'color_scheme':
        return l.selectColorScheme;
      case 'backend_url':
        return l.backendUrlDescription;
      case 'auth_token':
        return l.authTokenDescription;
      case 'openai_api_key':
        return l.openaiApiKeyDescription;
      case 'openai_base_url':
        return l.openaiBaseUrlDescription;
      case 'model_selection':
        return l.defaultModelDescription;
      default:
        return item.description ?? '';
    }
  }

  String _itemPlaceholder(AppLocalizations l, SettingItem item) {
    switch (item.id) {
      case 'backend_url':
        return l.backendUrlPlaceholder;
      case 'auth_token':
        return l.authTokenPlaceholder;
      case 'openai_api_key':
        return l.openaiApiKeyPlaceholder;
      case 'openai_base_url':
        return l.openaiBaseUrlPlaceholder;
      default:
        return item.placeholder ?? '';
    }
  }
}