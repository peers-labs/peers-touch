import 'dart:async';
import 'dart:convert';
import 'package:flutter/material.dart';
import 'package:get/get.dart';
import 'package:peers_touch_desktop/core/constants/ai_constants.dart';
import 'package:peers_touch_desktop/features/ai_chat/service/ai_service.dart';
import 'package:peers_touch_desktop/features/ai_chat/model/chat_session.dart';
import 'package:peers_touch_desktop/features/ai_chat/domain/models/ai_composer_draft.dart';
import 'package:peers_touch_desktop/features/ai_chat/domain/models/ai_attachment.dart';
import 'package:peers_touch_desktop/features/shell/controller/shell_controller.dart';
import 'package:peers_touch_desktop/features/ai_chat/controller/provider_controller.dart';

// 保存主题操作的结果状态
enum SaveTopicStatus {
  createdNew,
  alreadySaved,
}

class ChatMessage {
  final String role; // 'user' | 'assistant'
  String content;
  ChatMessage({required this.role, required this.content});

  Map<String, dynamic> toJson() => {
        'role': role,
        'content': content,
      };

  factory ChatMessage.fromJson(Map<String, dynamic> json) => ChatMessage(
        role: json['role'] as String,
        content: json['content'] as String,
      );
}

class AIChatController extends GetxController {
  final AIService service;
  final StorageService storage;

  AIChatController({required this.service, required this.storage});

  // 状态
  final messages = <ChatMessage>[].obs;
  final models = <String>[].obs;
  final currentModel = ''.obs;
  final inputText = ''.obs;
  final isSending = false.obs;
  final error = Rx<String?>(null);
  final showTopicPanel = false.obs; // 右侧主题面板显隐
  final sessions = <ChatSession>[].obs; // 会话列表
  final selectedSessionId = Rx<String?>(null); // 当前会话ID
  final topics = <String>[].obs; // 主题列表（简版）
  final currentTopic = Rx<String?>(null);
  // 当前需要闪动提示的 Topic 索引（-1 表示不闪动）
  final flashTopicIndex = (-1).obs;
  late final TextEditingController inputController;
  final Map<String, List<ChatMessage>> _sessionStore = {}; // 每会话的消息存储
  // 会话到已保存主题的映射
  Map<String, String> _sessionTopicMap = {};

  @override
  void onInit() {
    super.onInit();
    inputController = TextEditingController();
    // 保持输入框与响应式文本同步（避免重建导致光标跳动）
    inputController.addListener(() {
      inputText.value = inputController.text;
    });
    // 先加载持久化状态，确保 selectedSessionId / session.modelId 就绪
    _loadPersistedState();
    // 再异步拉取模型；加载完成后不盲目覆盖已有的 currentModel
    _initModels();
  }

  @override
  void onClose() {
    inputController.dispose();
    super.onClose();
  }

  void clearError() => error.value = null;

  void toggleTopicPanel() {
    final v = !showTopicPanel.value;
    showTopicPanel.value = v;
    storage.set(AIConstants.chatShowTopicPanel, v);
  }

  String _genId() => DateTime.now().millisecondsSinceEpoch.toString();

  void createSession({String title = 'Just Chat'}) {
    final id = _genId();
    // 新建会话默认绑定当前模型（若可用），否则绑定默认模型
    final defaultModel = (currentModel.value.isNotEmpty
            ? currentModel.value
            : (models.isNotEmpty ? models.first : AIConstants.defaultOpenAIModel));
    final session = ChatSession(
      id: id,
      title: title,
      createdAt: DateTime.now(),
      lastActiveAt: DateTime.now(),
      modelId: defaultModel,
      avatarBase64: null,
    );
    sessions.add(session);
    _sessionStore[id] = <ChatMessage>[];
    selectSession(id);
    _persistSessions();
  }

  void selectSession(String id) {
    selectedSessionId.value = id;
    // 懒加载消息
    var list = _sessionStore[id];
    if (list == null) {
      list = _loadMessagesForSession(id);
      _sessionStore[id] = list;
    }
    messages.assignAll(list);
    storage.set(AIConstants.chatSelectedSessionId, id);
    // 切换当前模型到该会话绑定的模型（不依赖 models 是否已加载）
    final s = sessions.firstWhereOrNull((e) => e.id == id);
    if (s != null) {
      final candidate = s.modelId ?? '';
      if (candidate.isNotEmpty) {
        currentModel.value = candidate;
      } else {
        // 不存在或未设置，降级为全局首选或默认（不依赖 models）
        final preferred = storage.get<String>(AIConstants.selectedModel) ?? AIConstants.defaultOpenAIModel;
        currentModel.value = preferred.isNotEmpty ? preferred : AIConstants.defaultOpenAIModel;
      }
    }
  }

  void addTopic([String? title]) {
    final t = title ?? '主题 ${topics.length + 1}';
    topics.add(t);
    _persistTopics();
  }

  void removeTopicAt(int index) {
    if (index >= 0 && index < topics.length) {
      topics.removeAt(index);
      _persistTopics();
    }
  }

  void renameTopic(int index, String newTitle) {
    if (index >= 0 && index < topics.length) {
      topics[index] = newTitle;
      topics.refresh();
      _persistTopics();
    }
  }

  void renameSession(String id, String newTitle) {
    final idx = sessions.indexWhere((s) => s.id == id);
    if (idx != -1) {
      final s = sessions[idx];
      sessions[idx] = ChatSession(
        id: s.id,
        title: newTitle,
        createdAt: s.createdAt,
        lastActiveAt: s.lastActiveAt,
        modelId: s.modelId,
        avatarBase64: s.avatarBase64,
      );
      sessions.refresh();
      _persistSessions();
    }
  }

  void deleteSession(String id) {
    final idx = sessions.indexWhere((s) => s.id == id);
    if (idx != -1) {
      sessions.removeAt(idx);
      _sessionStore.remove(id);
      storage.remove('${AIConstants.chatMessagesPrefix}$id');
      // 更新选择
      if (selectedSessionId.value == id) {
        selectedSessionId.value = null;
        messages.clear();
        if (sessions.isNotEmpty) {
          selectSession(sessions.last.id);
        }
      }
      _persistSessions();
    }
  }

  /// 拖拽重排会话列表，并持久化顺序
  void reorderSessions(int oldIndex, int newIndex) {
    if (oldIndex < 0 || oldIndex >= sessions.length) return;
    if (newIndex < 0 || newIndex > sessions.length) return;
    // 向后拖拽时，newIndex 指向目标后的位置
    if (newIndex > oldIndex) newIndex -= 1;
    final item = sessions.removeAt(oldIndex);
    sessions.insert(newIndex, item);
    sessions.refresh();
    _persistSessions();
  }

  Future<void> _initModels() async {
    clearError();
    try {
      // 1) 优先使用 ProviderController 中已保存的模型，避免每次进入都要点击 Fetch
      List<String> initial = const [];
      if (Get.isRegistered<ProviderController>()) {
        try {
          final pc = Get.find<ProviderController>();
          final prov = pc.currentProvider.value ?? (pc.providers.isNotEmpty ? pc.providers.first : null);
          if (prov != null && prov.models.isNotEmpty) {
            initial = prov.models;
          }
        } catch (_) {}
      }

      if (initial.isNotEmpty) {
        models.assignAll(initial);
      } else {
        // 2) 若没有已保存模型，则拉取一次并持久化到 Provider
        final fetched = await service.fetchModels();
        models.assignAll(fetched);
        if (Get.isRegistered<ProviderController>()) {
          try {
            final pc = Get.find<ProviderController>();
            final prov = pc.currentProvider.value ?? (pc.providers.isNotEmpty ? pc.providers.first : null);
            if (prov != null) {
              final settings = Map<String, dynamic>.from(prov.settings ?? {});
              settings['models'] = fetched;
              settings['modelsUpdatedAt'] = DateTime.now().toIso8601String();
              await pc.updateProvider(prov.copyWith(
                settings: settings,
                updatedAt: DateTime.now().toUtc(),
              ));
            }
          } catch (_) {}
        }
      }

      // 3) 选择当前模型：优先最近选择，其次首选项或首个
      final preferred = storage.get<String>(AIConstants.selectedModel) ?? AIConstants.defaultOpenAIModel;
      currentModel.value = models.contains(preferred) && preferred.isNotEmpty
          ? preferred
          : (models.isNotEmpty ? models.first : AIConstants.defaultOpenAIModel);
    } catch (e) {
      // 模型拉取失败也允许继续使用默认值
      currentModel.value = AIConstants.defaultOpenAIModel;
      error.value = '模型列表拉取失败：$e';
    }
  }

  void setInput(String text) => inputText.value = text;

  void newChat() {
    clearError();
    createSession();
  }

  Future<void> send() async {
    final text = inputText.value.trim();
    if (text.isEmpty) return;
    if (!service.isConfigured) {
      error.value = 'AI提供商未配置';
      return;
    }

    final enableStreaming = storage.get<bool>(AIConstants.enableStreaming) ?? true;
    final tempStr = storage.get<String>(AIConstants.temperature) ?? AIConstants.defaultTemperature.toString();
    final temperature = double.tryParse(tempStr) ?? AIConstants.defaultTemperature;

    // 确保存在会话
    var sid = selectedSessionId.value;
    if (sid == null) {
      createSession();
      sid = selectedSessionId.value;
    }
    final list = _sessionStore[sid!]!;
    final userMsg = ChatMessage(role: 'user', content: text);
    messages.add(userMsg);
    list.add(userMsg);
    inputController.clear();
    inputText.value = '';
    isSending.value = true;
    clearError();

    if (enableStreaming) {
      // 预先放入一条空助手消息，随后增量填充
      final assistant = ChatMessage(role: 'assistant', content: '');
      messages.add(assistant);
      list.add(assistant);
      try {
        await for (final chunk in service.sendMessageStream(
          message: text,
          model: currentModel.value.isNotEmpty ? currentModel.value : null,
          temperature: temperature,
        )) {
          assistant.content += chunk;
          messages.refresh();
          // 同步存储列表刷新
          _sessionStore[sid] = List<ChatMessage>.from(messages);
          _persistMessagesForSession(sid);
        }
      } catch (e) {
        error.value = '发送失败：$e';
      } finally {
        isSending.value = false;
      }
    } else {
      try {
        final reply = await service.sendMessage(
          message: text,
          model: currentModel.value.isNotEmpty ? currentModel.value : null,
          temperature: temperature,
        );
        final assistant = ChatMessage(role: 'assistant', content: reply);
        messages.add(assistant);
        list.add(assistant);
        _persistMessagesForSession(sid);
      } catch (e) {
        error.value = '发送失败：$e';
      } finally {
        isSending.value = false;
      }
    }
  }

  /// 发送富内容草稿（文本 + 附件），支持 OpenAI 与 Ollama
  Future<void> sendDraft(AiComposerDraft draft) async {
    final text = draft.text.trim();
    if (text.isEmpty && draft.attachments.isEmpty) return;
    if (!service.isConfigured) {
      error.value = 'AI提供商未配置';
      return;
    }

    final enableStreaming = storage.get<bool>(AIConstants.enableStreaming) ?? true;
    final tempStr = storage.get<String>(AIConstants.temperature) ?? AIConstants.defaultTemperature.toString();
    final temperature = double.tryParse(tempStr) ?? AIConstants.defaultTemperature;

    // 确保存在会话
    var sid = selectedSessionId.value;
    if (sid == null) {
      createSession();
      sid = selectedSessionId.value;
    }
    final list = _sessionStore[sid!]!;

    // 添加用户消息（仅展示文本，附件不在消息列表中显示）
    final userMsg = ChatMessage(role: 'user', content: text);
    messages.add(userMsg);
    list.add(userMsg);
    inputController.clear();
    inputText.value = '';
    isSending.value = true;
    clearError();

    // 根据提供商拼装富内容参数
    final provider = storage.get<String>(AIConstants.providerType) ?? 'OpenAI';
    List<Map<String, dynamic>>? openAIContent;
    List<String>? imagesBase64;
    if (provider.toLowerCase() == 'openai') {
      // 过滤掉暂不支持的 file 类型
      openAIContent = draft
          .toOpenAIContent()
          .where((m) => m['type'] != 'file')
          .toList();
    } else if (provider.toLowerCase() == 'ollama') {
      final imgs = draft.attachments.where((a) => a.type == AiAttachmentType.image);
      imagesBase64 = imgs.map((a) => base64Encode(a.bytes)).toList();
    }

    if (enableStreaming) {
      final assistant = ChatMessage(role: 'assistant', content: '');
      messages.add(assistant);
      list.add(assistant);
      try {
        await for (final chunk in service.sendMessageStream(
          message: text,
          model: currentModel.value.isNotEmpty ? currentModel.value : null,
          temperature: temperature,
          openAIContent: openAIContent,
          imagesBase64: imagesBase64,
        )) {
          assistant.content += chunk;
          messages.refresh();
          _sessionStore[sid] = List<ChatMessage>.from(messages);
          _persistMessagesForSession(sid);
        }
      } catch (e) {
        error.value = '发送失败：$e';
      } finally {
        isSending.value = false;
      }
    } else {
      try {
        final reply = await service.sendMessage(
          message: text,
          model: currentModel.value.isNotEmpty ? currentModel.value : null,
          temperature: temperature,
          openAIContent: openAIContent,
          imagesBase64: imagesBase64,
        );
        final assistant = ChatMessage(role: 'assistant', content: reply);
        messages.add(assistant);
        list.add(assistant);
        _persistMessagesForSession(sid);
      } catch (e) {
        error.value = '发送失败：$e';
      } finally {
        isSending.value = false;
      }
    }
  }

  void setModel(String model) {
    // 更新当前选择会话的模型绑定
    final sid = selectedSessionId.value;
    if (sid != null) {
      final idx = sessions.indexWhere((s) => s.id == sid);
      if (idx != -1) {
        final s = sessions[idx];
        sessions[idx] = ChatSession(
          id: s.id,
          title: s.title,
          createdAt: s.createdAt,
          lastActiveAt: s.lastActiveAt,
          modelId: model,
          avatarBase64: s.avatarBase64,
        );
        sessions.refresh();
        _persistSessions();
      }
    }
    // 更新当前模型用于即时发送
    currentModel.value = model;
    // 仍然记录为全局最近使用，便于新建会话默认值
    storage.set(AIConstants.selectedModel, model);
  }

  // -------------------- 持久化 --------------------
  void _loadPersistedState() {
    // 右侧面板显隐
    final show = storage.get<bool>(AIConstants.chatShowTopicPanel) ?? false;
    showTopicPanel.value = show;
    // topics
    final rawTopics = storage.get<List<dynamic>>(AIConstants.chatTopics);
    if (rawTopics != null) {
      topics.assignAll(rawTopics.map((e) => e.toString()));
    } else {
      topics.assignAll(['默认主题']);
    }
    // 会话-主题映射
    final mapRaw = storage.get<Map<String, dynamic>>(AIConstants.chatSessionTopicMap);
    if (mapRaw != null) {
      _sessionTopicMap = mapRaw.map((k, v) => MapEntry(k, v.toString()));
    }
    // sessions
    final rawSessions = storage.get<List<dynamic>>(AIConstants.chatSessions);
    if (rawSessions != null && rawSessions.isNotEmpty) {
      final parsed = rawSessions
          .whereType<Map<String, dynamic>>()
          .map((m) => ChatSession.fromJson(m))
          .toList();
      sessions.assignAll(parsed);
      // 选择
      final sid = storage.get<String>(AIConstants.chatSelectedSessionId);
      if (sid != null && parsed.any((s) => s.id == sid)) {
        selectSession(sid);
      } else {
        selectSession(parsed.first.id);
      }
    } else {
      // 初始化默认会话
      createSession();
    }
  }

  void _persistSessions() {
    final data = sessions.map((s) => s.toJson()).toList();
    storage.set(AIConstants.chatSessions, data);
    if (selectedSessionId.value != null) {
      storage.set(AIConstants.chatSelectedSessionId, selectedSessionId.value);
    }
  }

  void _persistTopics() {
    storage.set(AIConstants.chatTopics, topics.toList());
  }

  void _persistSessionTopicMap() {
    storage.set(AIConstants.chatSessionTopicMap, Map<String, String>.from(_sessionTopicMap));
  }

  void _persistMessagesForSession(String id) {
    final msgs = _sessionStore[id] ?? <ChatMessage>[];
    final data = msgs.map((m) => m.toJson()).toList();
    storage.set('${AIConstants.chatMessagesPrefix}$id', data);
    // 更新最后活跃时间
    final idx = sessions.indexWhere((s) => s.id == id);
    if (idx != -1) {
      final s = sessions[idx];
      sessions[idx] = ChatSession(
        id: s.id,
        title: s.title,
        createdAt: s.createdAt,
        lastActiveAt: DateTime.now(),
        modelId: s.modelId,
        avatarBase64: s.avatarBase64,
      );
      sessions.refresh();
      _persistSessions();
    }
  }

  /// 更新会话头像（base64），并持久化
  void setSessionAvatar(String id, String? avatarBase64) {
    final idx = sessions.indexWhere((s) => s.id == id);
    if (idx != -1) {
      final s = sessions[idx];
      sessions[idx] = ChatSession(
        id: s.id,
        title: s.title,
        createdAt: s.createdAt,
        lastActiveAt: s.lastActiveAt,
        modelId: s.modelId,
        avatarBase64: avatarBase64,
      );
      sessions.refresh();
      _persistSessions();
    }
  }

  List<ChatMessage> _loadMessagesForSession(String id) {
    final raw = storage.get<List<dynamic>>('${AIConstants.chatMessagesPrefix}$id');
    if (raw == null) return <ChatMessage>[];
    return raw
        .whereType<Map<String, dynamic>>()
        .map((m) => ChatMessage.fromJson(m))
        .toList();
  }

  // 选择 Topic（仅更新当前选择，暂不影响消息）
  void selectTopicAt(int index) {
    if (index >= 0 && index < topics.length) {
      currentTopic.value = topics[index];
    }
  }

  // 从当前聊天派生一个合适的主题标题
  String _deriveTopicTitle() {
    // 取最近一条用户消息作为标题摘要
    ChatMessage? lastUser;
    for (var i = messages.length - 1; i >= 0; i--) {
      if (messages[i].role == 'user') {
        lastUser = messages[i];
        break;
      }
    }
    final text = lastUser?.content.trim() ?? '';
    if (text.isNotEmpty) {
      final t = text.replaceAll('\n', ' ');
      return t.length > 24 ? t.substring(0, 24) : t;
    }
    // 兜底使用当前会话标题或时间戳
    final sid = selectedSessionId.value;
    if (sid != null) {
      final s = sessions.firstWhereOrNull((e) => e.id == sid);
      if (s != null && s.title.isNotEmpty) return s.title;
    }
    final now = DateTime.now();
    return '主题 ${now.hour}:${now.minute.toString().padLeft(2, '0')}';
  }

  /// 保存当前聊天为新 Topic；如该会话已保存过，则闪动对应 Topic。
  SaveTopicStatus saveCurrentChatAsTopic() {
    // 确保存在会话
    var sid = selectedSessionId.value;
    if (sid == null) {
      createSession();
      sid = selectedSessionId.value;
    }
    if (sid == null) return SaveTopicStatus.createdNew;

    // 如果该会话已保存过，闪动当前 Topic
    final existingTitle = _sessionTopicMap[sid];
    if (existingTitle != null) {
      final idx = topics.indexOf(existingTitle);
      if (idx >= 0) {
        flashTopicIndex.value = idx;
        _scheduleFlashReset();
        _ensureRightPanelExpanded();
        return SaveTopicStatus.alreadySaved;
      }
    }

    // 派生标题；若已存在相同标题则不重复添加，仅建立映射
    final title = _deriveTopicTitle();
    int idx = topics.indexOf(title);
    if (idx == -1) {
      topics.add(title);
      _persistTopics();
      idx = topics.length - 1;
    }
    currentTopic.value = title;
    _sessionTopicMap[sid] = title;
    _persistSessionTopicMap();
    flashTopicIndex.value = idx;
    _scheduleFlashReset();
    _ensureRightPanelExpanded();
    return SaveTopicStatus.createdNew;
  }

  void _scheduleFlashReset() {
    Future.delayed(const Duration(milliseconds: 900), () {
      flashTopicIndex.value = -1;
    });
  }

  void _ensureRightPanelExpanded() {
    try {
      final shell = Get.find<ShellController>();
      // 若右侧面板已注入但处于折叠态，则展开以便用户看到闪动提示
      shell.expandRightPanel();
    } catch (_) {}
  }

  /// 获取某会话的最后一条消息文本（懒加载，不会触发界面跳转）
  String getLastMessagePreview(String id) {
    var list = _sessionStore[id];
    if (list == null) {
      list = _loadMessagesForSession(id);
      _sessionStore[id] = list;
    }
    if (list.isEmpty) return '';
    final last = list.last;
    final text = last.content.trim();
    if (text.isEmpty) return '';
    return text.length > 32 ? '${text.substring(0, 32)}…' : text;
  }
}