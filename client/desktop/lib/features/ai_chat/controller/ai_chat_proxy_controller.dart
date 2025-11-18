import 'dart:convert';
import 'package:flutter/material.dart';
import 'package:get/get.dart';
import 'package:fixnum/fixnum.dart' as $fixnum;
import 'package:peers_touch_base/storage/local_storage.dart';
import 'package:peers_touch_base/storage/service/ai_provider.dart';
import 'package:peers_touch_base/storage/secure_storage.dart';
import 'package:peers_touch_base/ai_proxy/ai_chat_proxy.dart' as base_proxy;
import 'package:peers_touch_base/ai_proxy/ai_provider_proxy.dart';
import 'package:peers_touch_base/ai_proxy/models/provider.dart' as proxy_provider;
import 'package:peers_touch_base/ai_proxy/models/provider_config.dart';
import 'package:peers_touch_base/ai_proxy/providers/openai_client.dart';
import 'package:peers_touch_base/ai_proxy/providers/ollama_client.dart';
import 'package:peers_touch_base/ai_proxy/providers/deepseek_client.dart';
import 'package:peers_touch_base/ai_proxy/interfaces/ai_provider_interface.dart';
import 'package:peers_touch_base/ai_proxy/interfaces/ai_service.dart';
import 'package:peers_touch_base/ai_proxy/interfaces/ai_service_adapter.dart';
import 'package:peers_touch_base/model/domain/ai_box/ai_box.pb.dart' as pb;
import 'package:peers_touch_base/model/domain/ai_box/chat_session.pb.dart';
import 'package:peers_touch_base/model/domain/ai_box/chat_message.pb.dart';
import 'package:peers_touch_base/model/domain/ai_box/message_attachment.pb.dart';
import 'package:peers_touch_desktop/features/ai_chat/widgets/input_box/models/ai_composer_draft.dart';
import 'package:peers_touch_desktop/features/ai_chat/widgets/input_box/models/ai_attachment.dart';
import 'package:peers_touch_desktop/core/constants/ai_constants.dart';

/// AI聊天代理控制器 - 使用peers_touch_base代理
class AIChatProxyController extends GetxController {
  late base_proxy.AIChatProxy _chatProxy;
  late AIProviderProxy _providerProxy;
  
  // 状态观察
  final sessions = <ChatSession>[].obs;
  final messages = <ChatMessage>[].obs;
  final topics = <String>[].obs;
  final models = <String>[].obs;
  final currentModel = ''.obs;
  final selectedSessionId = Rxn<String>();
  final isSending = false.obs;
  final error = Rxn<String>();
  final flashTopicIndex = (-1).obs;
  final showTopicPanel = false.obs;
  final currentTopic = Rxn<String>();
  
  // 输入控制
  final inputController = TextEditingController();
  final inputText = ''.obs;
  
  @override
  void onInit() {
    super.onInit();
    _initializeProxies();
    _setupListeners();
  }
  
  void _initializeProxies() {
    final storage = LocalStorage();
    final providerStorage = AIProviderStorageServiceImpl(localStorage: storage);
    final secureStorage = BasicSecureStorageService();
    
    _chatProxy = base_proxy.AIChatProxy(
      storage: storage,
    );
    
    _providerProxy = AIProviderProxy(
      providerService: providerStorage,
      secureStorage: secureStorage,
    );
  }
  
  void _setupListeners() {
    // 监听代理状态变化并同步到控制器
    _chatProxy.messages.addListener(() {
      messages.value = _chatProxy.messages.value.map((msg) {
        final baseMsg = ChatMessage()
          ..role = msg.role
          ..content = msg.content
          ..createdAt = $fixnum.Int64(msg.createdAt.millisecondsSinceEpoch);
        return baseMsg;
      }).toList();
    });
    
    _chatProxy.sessions.addListener(() {
      sessions.value = _chatProxy.sessions.value.map((session) {
        final baseSession = ChatSession()
          ..id = session.id
          ..title = session.title
          ..description = session.lastMessage ?? ''
          ..createdAt = $fixnum.Int64(session.createdAt.millisecondsSinceEpoch);
        // 使用updatedAt作为最后活跃时间
        baseSession.updatedAt = $fixnum.Int64(DateTime.now().millisecondsSinceEpoch);
        return baseSession;
      }).toList();
    });
    
    _chatProxy.topics.addListener(() {
      topics.value = _chatProxy.topics.value;
    });
    
    _chatProxy.selectedSessionId.addListener(() {
      selectedSessionId.value = _chatProxy.selectedSessionId.value;
    });
    
    _chatProxy.isSending.addListener(() {
      isSending.value = _chatProxy.isSending.value;
    });
    
    _chatProxy.error.addListener(() {
      error.value = _chatProxy.error.value;
    });
    
    _chatProxy.currentModel.addListener(() {
      currentModel.value = _chatProxy.currentModel.value;
    });
    
    _chatProxy.showTopicPanel.addListener(() {
      showTopicPanel.value = _chatProxy.showTopicPanel.value;
    });
    
    _chatProxy.currentTopic.addListener(() {
      currentTopic.value = _chatProxy.currentTopic.value;
    });
    
    _chatProxy.flashTopicIndex.addListener(() {
      flashTopicIndex.value = _chatProxy.flashTopicIndex.value;
    });
  }
  
  /// 将Provider转换为ProviderConfig
  ProviderConfig _convertToProviderConfig(pb.AiProvider provider, String apiKey) {
    // 从settings中解析配置
    final settings = _parseSettings(provider.settings);
    
    return ProviderConfig(
      id: provider.id,
      type: _parseProviderType(provider.sourceType),
      name: provider.name,
      baseUrl: settings['baseUrl'] ?? '',
      apiKey: apiKey,
      headers: settings['headers'] != null 
          ? Map<String, String>.from(settings['headers'])
          : null,
      parameters: settings['parameters'] != null
          ? Map<String, dynamic>.from(settings['parameters'])
          : null,
      enabled: provider.enabled,
      timeout: settings['timeout'] ?? 30000,
      maxRetries: settings['maxRetries'] ?? 3,
    );
  }
  
  /// 解析提供商类型
  AIProviderType _parseProviderType(String sourceType) {
    switch (sourceType.toLowerCase()) {
      case 'openai':
        return AIProviderType.openai;
      case 'ollama':
        return AIProviderType.ollama;
      case 'deepseek':
        return AIProviderType.deepseek;
      case 'claude':
        return AIProviderType.claude;
      case 'gemini':
        return AIProviderType.gemini;
      default:
        return AIProviderType.openai;
    }
  }
  
  /// 创建AI服务实例
  AIService? _createAIService(pb.AiProvider provider, String apiKey) {
    final config = _convertToProviderConfig(provider, apiKey);
    AIProvider? aiProvider;
    
    switch (config.type) {
      case AIProviderType.openai:
        aiProvider = OpenAIClient(config);
        break;
      case AIProviderType.ollama:
        aiProvider = OllamaClient(config);
        break;
      case AIProviderType.deepseek:
        aiProvider = DeepSeekClient(config);
        break;
      // 可以添加其他提供商类型
      default:
        return null;
    }
    
    return AIServiceAdapter(aiProvider);
  }
  
  /// 新建聊天会话
  Future<void> newChat() async {
    await _chatProxy.newChat();
  }
  
  /// 选择会话
  Future<void> selectSession(String sessionId) async {
    await _chatProxy.selectSession(sessionId);
  }
  
  /// 发送消息
  Future<void> sendMessage() async {
    final text = inputController.text.trim();
    if (text.isEmpty) return;
    
    // 获取当前AI服务
    final currentProvider = _providerProxy.currentProvider.value;
    if (currentProvider == null) {
      error.value = '请先配置AI提供商';
      return;
    }
    
    // 获取API密钥
    final apiKey = await _providerProxy.getApiKey(currentProvider.id);
    if (apiKey == null || apiKey.isEmpty) {
      error.value = 'API密钥未配置';
      return;
    }
    
    // 创建AI服务实例
    final aiService = _createAIService(currentProvider, apiKey);
    if (aiService == null) {
      error.value = '不支持的AI提供商类型';
      return;
    }
    
    // 发送消息
    await _chatProxy.sendMessage(
      text: text,
      aiService: aiService,
      model: currentModel.value.isNotEmpty ? currentModel.value : null,
    );
    
    inputController.clear();
  }

  /// 发送富内容草稿（文本 + 附件）
  Future<void> sendDraft(AiComposerDraft draft) async {
    final text = draft.text.trim();
    if (text.isEmpty && draft.attachments.isEmpty) return;
    
    // 获取当前AI服务
    final currentProvider = _providerProxy.currentProvider.value;
    if (currentProvider == null) {
      error.value = '请先配置AI提供商';
      return;
    }
    
    // 获取API密钥
    final apiKey = await _providerProxy.getApiKey(currentProvider.id);
    if (apiKey == null || apiKey.isEmpty) {
      error.value = 'API密钥未配置';
      return;
    }
    
    // 创建AI服务实例
    final aiService = _createAIService(currentProvider, apiKey);
    if (aiService == null) {
      error.value = '不支持的AI提供商类型';
      return;
    }
    
    // 根据提供商拼装富内容参数
    final provider = currentProvider.sourceType.toLowerCase();
    List<Map<String, dynamic>>? openAIContent;
    List<String>? imagesBase64;
    
    if (provider == 'openai') {
      // 过滤掉暂不支持的 file 类型
      openAIContent = draft.toOpenAIContent()
          .where((m) => m['type'] != 'file')
          .toList();
    } else if (provider == 'ollama') {
      final imgs = draft.attachments.where((a) => a.type == AiAttachmentType.image);
      imagesBase64 = imgs.map((a) => base64Encode(a.bytes)).toList();
    }
    
    // 发送消息（使用扩展的AI服务）
    await _sendRichMessage(
      text: text,
      aiService: aiService,
      model: currentModel.value.isNotEmpty ? currentModel.value : null,
      openAIContent: openAIContent,
      imagesBase64: imagesBase64,
    );
    
    inputController.clear();
  }
  
  /// 发送富内容消息（内部方法）
  Future<void> _sendRichMessage({
    required String text,
    required AIService aiService,
    String? model,
    List<Map<String, dynamic>>? openAIContent,
    List<String>? imagesBase64,
  }) async {
    if (text.isEmpty) return;
    
    // 获取流式配置
    final storage = LocalStorage();
    final enableStreaming = (storage.get(AIConstants.enableStreaming) as bool?) ?? true;
    final tempStr = (storage.get(AIConstants.temperature) as String?) ?? AIConstants.defaultTemperature.toString();
    final temp = double.tryParse(tempStr) ?? AIConstants.defaultTemperature;
    
    // 确保存在会话
    var sid = _chatProxy.selectedSessionId.value;
    if (sid == null) {
      await _chatProxy.createSession();
      sid = _chatProxy.selectedSessionId.value;
    }
    
    // 这里需要实现具体的富内容发送逻辑
    // 由于基础AI服务接口不支持富内容，我们需要扩展它
    if (enableStreaming) {
      await _sendRichMessageStream(
        text: text,
        aiService: aiService,
        model: model,
        temperature: temp,
        openAIContent: openAIContent,
        imagesBase64: imagesBase64,
      );
    } else {
      await _sendRichMessageNonStream(
        text: text,
        aiService: aiService,
        model: model,
        temperature: temp,
        openAIContent: openAIContent,
        imagesBase64: imagesBase64,
      );
    }
  }
  
  /// 流式发送富内容消息
  Future<void> _sendRichMessageStream({
    required String text,
    required AIService aiService,
    String? model,
    double? temperature,
    List<Map<String, dynamic>>? openAIContent,
    List<String>? imagesBase64,
  }) async {
    // 这里需要根据具体的AI服务提供商来实现
    // 暂时回退到普通文本发送
    await _chatProxy.sendMessage(
      text: text,
      aiService: aiService,
      model: model,
      temperature: temperature,
    );
  }
  
  /// 非流式发送富内容消息
  Future<void> _sendRichMessageNonStream({
    required String text,
    required AIService aiService,
    String? model,
    double? temperature,
    List<Map<String, dynamic>>? openAIContent,
    List<String>? imagesBase64,
  }) async {
    // 这里需要根据具体的AI服务提供商来实现
    // 暂时回退到普通文本发送
    await _chatProxy.sendMessage(
      text: text,
      aiService: aiService,
      model: model,
      temperature: temperature,
    );
  }
  
  /// 设置输入文本
  void setInput(String value) {
    inputText.value = value;
  }
  
  /// 设置模型
  void setModel(String model) {
    currentModel.value = model;
  }
  
  /// 添加主题
  void addTopic() {
    _chatProxy.addTopic();
  }
  
  /// 删除主题
  void removeTopicAt(int index) {
    _chatProxy.removeTopicAt(index);
  }
  
  /// 选择主题
  void selectTopicAt(int index) {
    _chatProxy.selectTopicAt(index);
  }
  
  /// 重命名主题
  void renameTopic(int index, String newTitle) {
    _chatProxy.renameTopic(index, newTitle);
  }
  
  /// 保存当前聊天为主题
  Future<base_proxy.SaveTopicStatus> saveCurrentChatAsTopic() async {
    return await _chatProxy.saveCurrentChatAsTopic();
  }
  
  /// 切换主题面板
  Future<void> toggleTopicPanel() async {
    await _chatProxy.toggleTopicPanel();
  }
  
  /// 创建会话
  Future<void> createSession({String title = 'Just Chat'}) async {
    await _chatProxy.createSession(title: title);
  }
  
  /// 重命名会话
  Future<void> renameSession(String sessionId, String newTitle) async {
    await _chatProxy.renameSession(sessionId, newTitle);
  }
  
  /// 删除会话
  Future<void> deleteSession(String sessionId) async {
    await _chatProxy.deleteSession(sessionId);
  }
  
  /// 发送消息（快捷方法）
  Future<void> send() async {
    await sendMessage();
  }
  
  /// 清除错误
  void clearError() {
    _chatProxy.clearError();
  }
  
  @override
  void onClose() {
    inputController.dispose();
    _chatProxy.dispose();
    _providerProxy.dispose();
    super.onClose();
  }
  
  /// 解析设置字符串
  Map<String, dynamic> _parseSettings(String settings) {
    try {
      if (settings.isEmpty) return {};
      return jsonDecode(settings) as Map<String, dynamic>;
    } catch (e) {
      return {};
    }
  }
}