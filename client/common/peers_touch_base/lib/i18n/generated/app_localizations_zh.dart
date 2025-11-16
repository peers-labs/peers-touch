// ignore: unused_import
import 'package:intl/intl.dart' as intl;
import 'app_localizations.dart';

// ignore_for_file: type=lint

/// The translations for Chinese (`zh`).
class AppLocalizationsZh extends AppLocalizations {
  AppLocalizationsZh([String locale = 'zh']) : super(locale);

  @override
  String get language => '语言';

  @override
  String get general => '通用';

  @override
  String get selectFunction => '请选择功能';

  @override
  String get settingsTitle => '设置';

  @override
  String get chooseSettingsSection => '请选择设置分区';

  @override
  String get generalSettings => '通用设置';

  @override
  String get globalBusinessSettings => '全局业务设置';

  @override
  String get theme => '主题';

  @override
  String get colorScheme => '色彩方案';

  @override
  String get selectAppLanguage => '选择应用语言';

  @override
  String get selectAppTheme => '选择应用主题';

  @override
  String get selectColorScheme => '选择应用色彩方案';

  @override
  String get backendUrl => '后端地址';

  @override
  String get backendUrlDescription => '设置后端服务地址';

  @override
  String get backendUrlPlaceholder => '请输入后端服务地址';

  @override
  String get authToken => '认证令牌';

  @override
  String get authTokenDescription => '设置API认证令牌';

  @override
  String get authTokenPlaceholder => '请输入认证令牌';

  @override
  String get aiProviderHeader => 'AI服务提供商';

  @override
  String get openaiApiKey => 'OpenAI API密钥';

  @override
  String get openaiApiKeyDescription => '设置OpenAI API访问密钥';

  @override
  String get openaiApiKeyPlaceholder => '请输入OpenAI API密钥';

  @override
  String get openaiBaseUrl => 'OpenAI基础URL';

  @override
  String get openaiBaseUrlDescription => '设置OpenAI API基础URL（可选）';

  @override
  String get openaiBaseUrlPlaceholder => '请输入OpenAI基础URL';

  @override
  String get defaultModel => '默认模型';

  @override
  String get defaultModelDescription => '选择默认使用的AI模型';

  @override
  String get chatSearchSessionsPlaceholder => '搜索助手';

  @override
  String get chatNewConversation => '新建对话';

  @override
  String get chatSessionActions => '助手操作';

  @override
  String get rename => '重命名';

  @override
  String get delete => '删除';

  @override
  String get chatTopicHistory => '历史主题';

  @override
  String get chatAddTopic => '新增主题';

  @override
  String get chatTopicActions => '主题操作';

  @override
  String get aiModelLabel => '模型：';

  @override
  String get toggleTopicPanel => '显示/隐藏主题面板（Ctrl+Shift+T）';

  @override
  String get sharePlaceholder => '分享（占位）';

  @override
  String get layoutTogglePlaceholder => '布局切换（占位）';

  @override
  String get moreMenuPlaceholder => '更多菜单（占位）';

  @override
  String get sendingIndicator => '发送中...';

  @override
  String get chatDefaultTitle => 'Just Chat';

  @override
  String get renameSessionTitle => '重命名助手';

  @override
  String get renameTopicTitle => '重命名主题';

  @override
  String get inputNewNamePlaceholder => '输入新名称';

  @override
  String get cancel => '取消';

  @override
  String get confirm => '确定';

  @override
  String get deleteSessionTitle => '删除助手';

  @override
  String deleteSessionConfirm(String sessionTitle) {
    return '确认删除助手 $sessionTitle 及其消息？';
  }

  @override
  String get saveAsTopic => '保存为主题';

  @override
  String get topicSaved => '已保存为主题';

  @override
  String get topicAlreadySaved => '本会话已保存该主题';
}
