import 'package:get/get.dart';
import '../manager/setting_manager.dart';
import '../model/setting_item.dart';

class SettingController extends GetxController {
  final SettingManager _settingManager = SettingManager();
  
  // 当前选中的设置分区
  final selectedSection = Rx<String>('general');
  
  // 所有设置分区
  final sections = RxList<SettingSection>([]);
  
  @override
  void onInit() {
    super.onInit();
    _initializeSettings();
  }
  
  /// 初始化设置
  void _initializeSettings() {
    // 初始化通用设置
    _settingManager.initializeGeneralSettings();
    
    // 获取所有设置分区
    sections.value = _settingManager.getSections();
    
    // 默认选中第一个分区
    if (sections.isNotEmpty) {
      selectedSection.value = sections.first.id;
    }
  }
  
  /// 切换设置分区
  void selectSection(String sectionId) {
    selectedSection.value = sectionId;
  }
  
  /// 获取当前选中的分区
  SettingSection? getCurrentSection() {
    return sections.firstWhere(
      (section) => section.id == selectedSection.value,
      orElse: () => sections.first,
    );
  }
  
  /// 更新设置项值
  void updateSettingValue(String sectionId, String itemId, dynamic value) {
    // 这里应该实现设置值的持久化存储
    // 暂时只更新内存中的值
    // final section = sections.firstWhere(
    //   (s) => s.id == sectionId,
    //   orElse: () => sections.first,
    // );
    
    // 在实际实现中，这里应该更新存储的设置值
    // 目前只是演示逻辑
    // print('设置项更新: $sectionId/$itemId = $value');
  }
  
  /// 注册业务模块设置
  void registerModuleSettings(String moduleId, String moduleName, List<SettingItem> settings) {
    _settingManager.registerBusinessModuleSettings(moduleId, moduleName, settings);
    
    // 刷新设置分区列表
    sections.value = _settingManager.getSections();
  }
}