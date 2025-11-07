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
}
