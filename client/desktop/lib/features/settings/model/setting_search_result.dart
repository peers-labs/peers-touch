import 'package:peers_touch_desktop/features/settings/model/setting_item.dart';

/// 设置搜索结果
class SettingSearchResult {

  SettingSearchResult({required this.sectionId, required this.item});
  final String sectionId;
  final SettingItem item;
}