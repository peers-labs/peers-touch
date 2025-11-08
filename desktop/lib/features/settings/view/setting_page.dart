import 'package:flutter/material.dart';
import 'package:get/get.dart';
import 'package:peers_touch_desktop/app/i18n/generated/app_localizations.dart';
import 'package:peers_touch_desktop/app/theme/app_theme.dart';
import 'package:peers_touch_desktop/app/theme/lobe_tokens.dart';
import 'package:peers_touch_desktop/features/settings/controller/setting_controller.dart';
import 'package:peers_touch_desktop/features/settings/model/setting_item.dart';
import 'package:peers_touch_desktop/features/settings/model/setting_search_result.dart';
import 'package:peers_touch_desktop/core/constants/ai_constants.dart';
import 'package:peers_touch_desktop/core/storage/local_storage.dart';
import 'package:peers_touch_desktop/features/ai_chat/service/ai_service_factory.dart';

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
              child: Builder(builder: (context) {
                // 根据 provider_type 过滤可见项
                final providerItem = currentSection.items.firstWhere(
                  (i) => i.id == 'provider_type',
                  orElse: () => const SettingItem(id: 'provider_type', title: '', type: SettingItemType.select, value: 'OpenAI'),
                );
                final providerName = providerItem.value?.toString() ?? 'OpenAI';
                bool isVisible(SettingItem i) {
                  if (i.id == 'provider_type' || i.id == 'ai_provider_header') return true;
                  // 迁移：将“连接测试”“拉取模型”改为内联按钮，这里隐藏其独立项
                  if (i.id == 'fetch_models' || i.id == 'test_connection') return false;
                  final id = i.id.toLowerCase();
                  if (id.startsWith('openai_')) return providerName == 'OpenAI';
                  if (id.startsWith('ollama_')) return providerName == 'Ollama';
                  return true; // 其他通用项始终可见
                }
                final visibleItems = currentSection.items.where(isVisible).toList();
                return ListView.builder(
                  padding: const EdgeInsets.symmetric(horizontal: 24),
                  itemCount: visibleItems.length,
                  itemBuilder: (context, index) {
                    final item = visibleItems[index];
                    return _buildSettingItem(context, currentSection.id, item, theme);
                  },
                );
              }),
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
    final options = item.options ?? [];
    final current = item.value?.toString();
    final isValid = current != null && options.contains(current);
    final error = controller.getItemError(sectionId, item.id);
    final borderColor = error != null ? Colors.red : tokens.divider;
    return Container(
      margin: EdgeInsets.symmetric(vertical: tokens.spaceSm),
      padding: EdgeInsets.all(tokens.spaceSm),
      decoration: BoxDecoration(
        color: tokens.bgLevel2,
        borderRadius: BorderRadius.circular(tokens.radiusMd),
        border: Border.all(color: borderColor),
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
          Row(
            children: [
              Expanded(
                child: Container(
                  padding: EdgeInsets.symmetric(horizontal: tokens.spaceSm),
                  decoration: BoxDecoration(
                    color: tokens.bgLevel3,
                    borderRadius: BorderRadius.circular(tokens.radiusSm),
                  ),
                  child: DropdownButton<String>(
                    value: isValid ? current : null,
                    items: options.map((option) {
                      return DropdownMenuItem<String>(
                        value: option,
                        child: Text(option, style: TextStyle(color: tokens.textPrimary)),
                      );
                    }).toList(),
                    onChanged: (value) {
                      if (value != null) {
                        controller.updateSettingValue(sectionId, item.id, value);
                        controller.setItemError(sectionId, item.id, null); // 选择有效项时清除错误
                        item.onChanged?.call(value);
                      }
                    },
                    dropdownColor: tokens.bgLevel3,
                    style: TextStyle(color: tokens.textPrimary),
                    isExpanded: true,
                    underline: const SizedBox(),
                  ),
                ),
              ),
              SizedBox(width: tokens.spaceSm),
              if (item.id == 'model_selection') SizedBox(
                height: 40,
                child: ElevatedButton(
                  onPressed: () async {
                    final storage = Get.find<LocalStorage>();
                    final provider = storage.get<String>(AIConstants.providerType) ?? 'OpenAI';
                    final service = AIServiceFactory.fromName(provider);
                    try {
                      final models = await service.fetchModels();
                      controller.updateSettingOptions(sectionId, item.id, models);
                      final currentVal = current;
                      if (currentVal != null && !models.contains(currentVal)) {
                        controller.setItemError(sectionId, item.id, '当前选择的模型不在最新列表中');
                      } else {
                        controller.setItemError(sectionId, item.id, null);
                      }
                      if ((controller.getCurrentSection()?.items.firstWhere((i) => i.id == item.id).value) == null && models.isNotEmpty) {
                        controller.updateSettingValue(sectionId, item.id, models.first);
                      }
                      Get.snackbar('拉取模型', '成功获取 ${models.length} 个模型');
                    } catch (e) {
                      Get.snackbar('拉取失败', '模型列表拉取失败：$e');
                    }
                  },
                  style: ElevatedButton.styleFrom(
                    backgroundColor: tokens.brandAccent,
                    foregroundColor: Colors.white,
                    minimumSize: const Size(92, 40),
                  ),
                  child: const Text('拉取模型'),
                ),
              ),
            ],
          ),
          if (error != null)
            Padding(
              padding: EdgeInsets.only(top: tokens.spaceXs),
              child: Text(error, style: TextStyle(color: Colors.red, fontSize: 12)),
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
          Row(
            children: [
              Expanded(
                child: TextField(
                  controller: controller.getTextController(sectionId, item.id, item.value?.toString()),
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
              ),
              SizedBox(width: tokens.spaceSm),
              if (item.id == 'ollama_base_url' || item.id == 'openai_base_url')
                SizedBox(
                  height: 40,
                  child: OutlinedButton(
                    onPressed: () async {
                      final storage = Get.find<LocalStorage>();
                      final provider = storage.get<String>(AIConstants.providerType) ?? 'OpenAI';
                      final service = AIServiceFactory.fromName(provider);
                      try {
                        final ok = await service.testConnection();
                        Get.snackbar('连接测试', ok ? '$provider 连接正常' : '$provider 连接失败');
                      } catch (e) {
                        Get.snackbar('连接失败', '连接测试异常：$e');
                      }
                    },
                    style: OutlinedButton.styleFrom(
                      minimumSize: const Size(92, 40),
                    ),
                    child: const Text('连接测试'),
                  ),
                ),
            ],
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