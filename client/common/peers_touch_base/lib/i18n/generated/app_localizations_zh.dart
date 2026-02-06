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
  String get saveAsTopic => '保存为话题';

  @override
  String get topicSaved => '已保存为主题';

  @override
  String get topicAlreadySaved => '本会话已保存该主题';

  @override
  String get signupValidationErrorMessage => '请填写完整信息，且密码需一致并至少8位';

  @override
  String get error => '错误';

  @override
  String get yourPrivacy => '隐私';

  @override
  String get next => '下一步';

  @override
  String get createAccount => '创建账户';

  @override
  String get serverUrl => '服务器地址';

  @override
  String get displayName => '显示名称';

  @override
  String get username => '用户名';

  @override
  String get email => '电子邮箱';

  @override
  String get password => '密码';

  @override
  String get confirmPassword => '确认密码';

  @override
  String get passwordMinLengthHint => '密码至少需要8个字符';

  @override
  String get success => '成功';

  @override
  String providerLoadError(Object error) {
    return '加载提供商失败: $error';
  }

  @override
  String get providerUpdateSuccess => '提供商更新成功';

  @override
  String providerUpdateError(Object error) {
    return '更新提供商失败: $error';
  }

  @override
  String get providerDeleteSuccess => '提供商删除成功';

  @override
  String providerDeleteError(Object error) {
    return '删除提供商失败: $error';
  }

  @override
  String get nameUpdated => '名称已更新';

  @override
  String nameUpdateError(Object error) {
    return '更新名称失败: $error';
  }

  @override
  String get providerSwitched => '当前提供商已切换';

  @override
  String providerSwitchError(Object error) {
    return '切换提供商失败: $error';
  }

  @override
  String get languageDescription => '选择应用语言';

  @override
  String get themeDescription => '选择应用主题';

  @override
  String get colorSchemeDescription => '选择应用色彩方案';

  @override
  String get backendNodeAddress => '后端节点地址';

  @override
  String get backendNodeAddressDescription => '设置后端服务地址';

  @override
  String get enterBackendAddress => '请输入后端服务地址';

  @override
  String get securityAuth => '安全认证';

  @override
  String get securityAuthDescription => '设置API认证令牌';

  @override
  String get enterAuthToken => '请输入认证令牌';

  @override
  String get advancedSettings => '高级设置';

  @override
  String get storageDirectory => '存储目录';

  @override
  String get storageDirectoryDescription => '应用数据存储位置';

  @override
  String get openDirectory => '打开目录';

  @override
  String get clearData => '清空数据';

  @override
  String get clearDataDescription => '清除所有本地存储数据';

  @override
  String get clearDataConfirmation => '您确定要清空所有本地数据吗？此操作不可逆。';

  @override
  String get dataClearedSuccess => '所有本地数据已清空。';

  @override
  String get searchSettings => '搜索设置';

  @override
  String get noSettingsFound => '未找到相关设置';

  @override
  String get test => '测试';

  @override
  String get addressTest => '地址测试';

  @override
  String successWithData(Object data) {
    return '成功：$data';
  }

  @override
  String failedWithData(Object error) {
    return '失败：$error';
  }

  @override
  String get loginTab => '登录';

  @override
  String get registerTab => '注册';

  @override
  String get yourGroup => '您的群组';

  @override
  String get friends => '好友';

  @override
  String get noItemsFound => '未找到项目';

  @override
  String get signIn => '登录';

  @override
  String get signUp => '注册';

  @override
  String get forgotPassword => '忘记密码？';

  @override
  String get required => '必填';

  @override
  String get requiredMinChars => '必填（至少6位）';

  @override
  String get emailOrUsername => '邮箱或用户名';

  @override
  String get serverUrlExample => '例如: http://localhost:18080';

  @override
  String get aiChat => 'AI对话';

  @override
  String get chatRtc => 'RTC聊天';

  @override
  String get discovery => '发现';

  @override
  String get expand => '展开';

  @override
  String get collapse => '折叠';

  @override
  String get createCustomAIProvider => '创建自定义 AI 提供商';

  @override
  String get basicInformation => '基本信息';

  @override
  String get providerId => '提供商 ID';

  @override
  String get providerIdPlaceholder => '建议全小写，例如：openai, cann...';

  @override
  String get providerName => '提供商名称';

  @override
  String get providerNamePlaceholder => '请输入提供商显示名称';

  @override
  String get providerDescription => '提供商描述';

  @override
  String get providerDescriptionPlaceholder => '提供商描述（可选）';

  @override
  String get providerLogo => '提供商 Logo (URL 或 SVG)';

  @override
  String get providerLogoPlaceholder => '输入 logo URL 或选择预制 SVG';

  @override
  String get presetSvg => '预制 SVG';

  @override
  String get configurationInformation => '配置信息';

  @override
  String get requestFormat => '请求格式';

  @override
  String get requestFormatPlaceholder => 'OpenAI / Ollama';

  @override
  String get proxyUrl => '代理 URL';

  @override
  String get proxyUrlPlaceholder => 'https://xxxx-proxy.com/v1';

  @override
  String get apiKey => 'API 密钥';

  @override
  String get apiKeyPlaceholder => '请输入您的 API 密钥';

  @override
  String get create => '创建';

  @override
  String get fieldRequired => '此字段必填';

  @override
  String get addModel => '添加模型';

  @override
  String get modelId => '模型 ID';

  @override
  String get modelIdPlaceholder => '例如：gpt-4o-mini 或 llama3.1:8b';

  @override
  String get modelNamePlaceholder => '例如：GPT-4o Mini';

  @override
  String get description => '描述';

  @override
  String get descriptionPlaceholder => '可选描述';

  @override
  String get organization => '组织';

  @override
  String get organizationPlaceholder => '例如：OpenAI / Ollama';

  @override
  String get contextWindow => '上下文窗口';

  @override
  String get contextWindowPlaceholder => '例如：128000';

  @override
  String get maxOutputTokens => '最大输出 Token';

  @override
  String get maxOutputTokensPlaceholder => '例如：4096';

  @override
  String get inputPrice => '输入 \$ /1k tokens';

  @override
  String get inputPricePlaceholder => '例如：0.03';

  @override
  String get outputPrice => '输出 \$ /1k tokens';

  @override
  String get outputPricePlaceholder => '例如：0.06';

  @override
  String get aliases => '别名';

  @override
  String get aliasesPlaceholder => '逗号分隔，例如：gpt-4o-mini-2024-07-18';

  @override
  String get type => '类型';

  @override
  String get enabled => '启用';

  @override
  String get capabilities => '能力';

  @override
  String get capText => '文本';

  @override
  String get capImage => '图片';

  @override
  String get capAudio => '音频';

  @override
  String get capFile => '文件';

  @override
  String get add => '添加';

  @override
  String get notice => '提示';

  @override
  String get modelIdAndNameRequired => '模型 ID 和显示名称必填';

  @override
  String get modelIdInvalid => 'ID 仅允许字母、数字、点、冒号、下划线与破折号';

  @override
  String get modelAdded => '模型已添加';

  @override
  String get selectProviderToConfigure => '选择一个提供商进行配置';

  @override
  String get providerSettings => '提供商设置';

  @override
  String get providerSettingsSubtitle => '配置 API 密钥、代理 URL 和模型';

  @override
  String get refresh => '刷新';

  @override
  String get searchProviders => '搜索提供商...';

  @override
  String get addProvider => '添加提供商';

  @override
  String get enabledGroup => '已启用';

  @override
  String get disabledGroup => '已禁用';

  @override
  String get noProvidersConfigured => '未配置 AI 提供商';

  @override
  String get addFirstProvider => '添加您的第一个 AI 服务提供商以开始使用';

  @override
  String get save => '保存';

  @override
  String get renameProvider => '重命名提供商';

  @override
  String get deleteProvider => '删除提供商';

  @override
  String enterProviderApiKey(String provider) {
    return '请输入您的 $provider API Key';
  }

  @override
  String get apiProxyUrl => 'API 代理地址';

  @override
  String get mustIncludeHttp => '必须包含 http(s)://';

  @override
  String get connectivityCheck => '连接性检查';

  @override
  String get connectivityCheckSubtitle => '测试 API Key 和代理地址是否填写正确';

  @override
  String get check => '检查';

  @override
  String get encryptionNotice => '您的密钥和代理地址将使用 AES-GCM 加密算法进行加密';

  @override
  String get networkTypeTooltip => '指示当前服务器属于哪个网络。';

  @override
  String get unknownNetwork => '未知网络';

  @override
  String get networkCheckingLabel => '检测中';

  @override
  String get networkUnreachableLabel => '连接失败';

  @override
  String get networkNotFoundLabel => '接口未发现';

  @override
  String get networkCheckingTooltip => '正在检测服务器网络类型';

  @override
  String get networkUnreachableTooltip => '网络连接失败，请检查地址或网络';

  @override
  String get networkNotFoundTooltip => '未发现节点接口（404），请确认服务器地址';

  @override
  String get networkUnknownTooltip => '无法识别网络类型';

  @override
  String get clientRequestMode => '使用客户端请求模式';

  @override
  String get clientRequestModeSubtitle => '客户端将直接从浏览器发起会话请求，这可以提高响应速度';

  @override
  String get modelList => '模型列表';

  @override
  String get searchModels => '搜索模型...';

  @override
  String get fetchModels => '获取模型';

  @override
  String allModelsCount(int count) {
    return '全部 ($count)';
  }

  @override
  String enabledModelsCount(int count) {
    return '已启用 ($count)';
  }

  @override
  String get moreModelsComing => '更多模型计划添加中，敬请期待';

  @override
  String get yesterday => '昨天';

  @override
  String get emptyChatNoModels => '暂无可用模型，请配置 AI 提供商';

  @override
  String get goToSettings => '前往设置';

  @override
  String get inputHintEnterToSend => '按 Enter 发送，按 Ctrl+Enter 换行';

  @override
  String get inputHintCtrlEnterToSend => '按 Ctrl+Enter 发送，按 Enter 换行';

  @override
  String get selectModel => '选择模型';

  @override
  String get addImage => '添加图片';

  @override
  String get modelDoesNotSupportImage => '当前模型不支持图片输入';

  @override
  String get addFile => '添加文件';

  @override
  String get modelDoesNotSupportFile => '当前模型不支持文件输入';

  @override
  String get addAudio => '添加音频';

  @override
  String get modelDoesNotSupportAudio => '当前模型不支持音频输入';

  @override
  String get clearInput => '清空输入';

  @override
  String get sendSettings => '发送设置';

  @override
  String get pressEnterToSend => '按 Enter 发送';

  @override
  String get pressCtrlEnterToSend => '按 Ctrl+Enter 发送';

  @override
  String get connectionStatusOnlineP2P => '在线 (P2P)';

  @override
  String get connectionStatusOnlineRelay => '在线 (中继)';

  @override
  String get connectionStatusOffline => '离线';

  @override
  String get connectionStatusConnecting => '连接中...';

  @override
  String get scrollToLatest => '回到最新消息';
}
