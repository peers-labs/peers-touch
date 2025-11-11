import 'package:flutter/material.dart';
import 'package:get/get.dart';
import 'package:peers_touch_desktop/app/i18n/generated/app_localizations.dart';
import 'package:peers_touch_desktop/app/theme/app_theme.dart';
import 'package:peers_touch_desktop/app/theme/lobe_tokens.dart';
import 'package:peers_touch_desktop/app/theme/ui_kit.dart';
import 'package:peers_touch_desktop/features/settings/controller/setting_controller.dart';
import 'package:peers_touch_desktop/features/settings/model/setting_item.dart';
import 'package:peers_touch_desktop/features/settings/model/setting_search_result.dart';
import 'package:peers_touch_desktop/core/constants/ai_constants.dart';
import 'package:peers_touch_storage/peers_touch_storage.dart';
import 'package:peers_touch_desktop/features/ai_chat/service/ai_service_factory.dart';
import 'package:peers_touch_desktop/features/shell/controller/shell_controller.dart';
import 'package:peers_touch_desktop/core/components/frame_action_combo.dart';
import 'package:peers_touch_desktop/features/shell/widgets/three_pane_scaffold.dart';

class SettingPage extends StatelessWidget {
  final SettingController controller;

  const SettingPage({super.key, required this.controller});

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final tokens = theme.extension<LobeTokens>()!;

    // 统一使用三段式骨架：左（设置导航）+ 中（设置内容）；右侧由 ShellPage 控制
    return ShellThreePane(
      leftBuilder: (context) => _buildSettingNavigation(context, theme),
      centerBuilder: (context) => _buildSettingContent(context, theme),
      // 左侧宽度与项目常量保持一致；滚动由内部 ListView 管理，避免嵌套滚动冲突
      leftProps: PaneProps(
        width: UIKit.secondaryNavWidth,
        minWidth: 220,
        maxWidth: 360,
        scrollPolicy: ScrollPolicy.none,
        horizontalPolicy: ScrollPolicy.none,
      ),
      // 中心区同理，内部自管理滚动
      centerProps: const PaneProps(
        scrollPolicy: ScrollPolicy.none,
        horizontalPolicy: ScrollPolicy.none,
      ),
    );
  }

  Widget _buildSettingNavigation(BuildContext context, ThemeData theme) {
    final tokens = theme.extension<LobeTokens>()!;
    final l = AppLocalizations.of(context);
    final shell = Get.find<ShellController>();
    final showTitle = shell.currentMenuItem.value?.toDIsplayPageTitle ?? false;
    return Container(
      color: tokens.bgLevel2,
      child: Column(
        children: [
          if (showTitle)
            Container(
              height: UIKit.topBarHeight,
              padding: EdgeInsets.symmetric(horizontal: UIKit.spaceLg(context)),
              alignment: Alignment.centerLeft,
              child: Text(
                l.settingsTitle,
                style: theme.textTheme.headlineSmall?.copyWith(color: tokens.textPrimary),
              ),
            ),
          // 左侧搜索框（模块内搜索，位于二级菜单顶部）
          Padding(
            padding: EdgeInsets.symmetric(horizontal: UIKit.spaceMd(context)),
            child: FrameActionCombo(
              hintText: '搜索设置',
              prefixIcon: Icons.search,
              onChanged: controller.setSearchQuery,
            ),
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
              height: UIKit.topBarHeight,
              padding: EdgeInsets.symmetric(horizontal: UIKit.spaceXl(context)),
              alignment: Alignment.centerLeft,
              child: Text(
                _sectionTitle(l, currentSection),
                style: theme.textTheme.titleLarge?.copyWith(color: tokens.textPrimary),
              ),
            ),
            
            // 渲染自定义页面或默认设置项列表
            Expanded(
              child: currentSection.page ?? Builder(builder: (context) {
                // 使用 isVisible 回调来过滤可见项，移除硬编码逻辑
                final visibleItems = currentSection.items
                    .where((item) => item.isVisible?.call(currentSection.items) ?? true)
                    .toList();
                return ListView.builder(
                  padding: EdgeInsets.symmetric(horizontal: UIKit.spaceXl(context)),
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

  // 旧搜索框方法已由通用组件替代

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
      case SettingItemType.password:
        return _buildTextInputItem(context, sectionId, item, theme); // Reuse text input for now
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
    final borderColor = error != null ? theme.colorScheme.error : tokens.divider;
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
                  child: ExcludeSemantics(
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
              ),
            ],
          ),
          if (error != null)
            Padding(
              padding: EdgeInsets.only(top: tokens.spaceXs),
              child: Text(
                error,
                style: theme.textTheme.bodySmall?.copyWith(color: theme.colorScheme.error),
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
          Row(
            children: [
              Expanded(
                child: item.id == 'backend_url'
                    ? Obx(() {
                        final verified = controller.backendVerified.value;
                        final outlineBorder = verified ? UIKit.inputOutlineBorder(context) : UIKit.transparentBorder(context);
                        return TextField(
                          controller: controller.getTextController(sectionId, item.id, item.value?.toString()),
                          decoration: InputDecoration(
                            hintText: _itemPlaceholder(l, item),
                            hintStyle: TextStyle(color: tokens.textSecondary.withOpacity(0.7)),
                            filled: true,
                            fillColor: UIKit.inputFillLight(context),
                            border: outlineBorder,
                            enabledBorder: outlineBorder,
                            focusedBorder: UIKit.inputFocusedBorder(context),
                            contentPadding: EdgeInsets.symmetric(
                              horizontal: UIKit.spaceSm(context),
                              vertical: UIKit.spaceSm(context),
                            ),
                          ),
                          style: TextStyle(color: tokens.textPrimary),
                          onChanged: (value) {
                            controller.updateSettingValue(sectionId, item.id, value);
                            item.onChanged?.call(value);
                          },
                        );
                      })
                    : TextField(
                        controller: controller.getTextController(sectionId, item.id, item.value?.toString()),
                        decoration: InputDecoration(
                          hintText: _itemPlaceholder(l, item),
                          hintStyle: TextStyle(color: tokens.textSecondary.withOpacity(0.7)),
                          filled: true,
                          fillColor: UIKit.inputFillLight(context),
                          border: UIKit.inputOutlineBorder(context),
                          enabledBorder: UIKit.inputOutlineBorder(context),
                          focusedBorder: UIKit.inputFocusedBorder(context),
                          contentPadding: EdgeInsets.symmetric(
                            horizontal: UIKit.spaceSm(context),
                            vertical: UIKit.spaceSm(context),
                          ),
                        ),
                        style: TextStyle(color: tokens.textPrimary),
                        onChanged: (value) {
                          controller.updateSettingValue(sectionId, item.id, value);
                          item.onChanged?.call(value);
                        },
                      ),
              ),
              if (item.id == 'backend_url') ...[
                SizedBox(width: UIKit.spaceSm(context)),
                Container(
                  height: UIKit.controlHeightMd,
                  padding: EdgeInsets.symmetric(horizontal: UIKit.spaceSm(context)),
                  decoration: BoxDecoration(
                    color: tokens.bgLevel3,
                    borderRadius: BorderRadius.circular(UIKit.radiusSm(context)),
                  ),
                  child: Obx(() => DropdownButton<String>(
                        value: controller.backendTestPath.value,
                        items: const [
                          DropdownMenuItem<String>(value: 'Ping', child: Text('Ping')),
                          DropdownMenuItem<String>(value: 'Health', child: Text('Health')),
                        ],
                        onChanged: (v) {
                          if (v != null) controller.backendTestPath.value = v;
                        },
                        dropdownColor: tokens.bgLevel3,
                        style: TextStyle(color: tokens.textPrimary),
                        underline: const SizedBox(),
                      )),
                ),
                SizedBox(width: UIKit.spaceSm(context)),
                SizedBox(
                  height: UIKit.controlHeightMd,
                  child: ElevatedButton(
                    onPressed: () async {
                      final input = controller
                          .getTextController(sectionId, item.id, item.value?.toString())
                          .text;
                      await controller.testBackendAddress(input);
                    },
                    style: ElevatedButton.styleFrom(
                      minimumSize: Size(UIKit.buttonMinWidthSm, UIKit.controlHeightMd),
                    ),
                    child: const Text('测试'),
                  ),
                ),
              ],
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
          backgroundColor: theme.colorScheme.primary,
          foregroundColor: theme.colorScheme.onPrimary,
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