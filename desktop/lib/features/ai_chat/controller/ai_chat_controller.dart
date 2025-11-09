import 'dart:async';
import 'dart:convert';
import 'package:flutter/material.dart';
import 'package:get/get.dart';
import 'package:peers_touch_desktop/core/constants/ai_constants.dart';
import 'package:peers_touch_desktop/core/storage/local_storage.dart';
import 'package:peers_touch_desktop/features/ai_chat/service/ai_service.dart';
import 'package:peers_touch_desktop/features/ai_chat/model/chat_session.dart';
import 'package:peers_touch_desktop/features/ai_chat/widgets/input_box/models/ai_composer_draft.dart';
import 'package:peers_touch_desktop/features/ai_chat/widgets/input_box/models/ai_attachment.dart';

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
  final LocalStorage storage;

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
  late final TextEditingController inputController;
  final Map<String, List<ChatMessage>> _sessionStore = {}; // 每会话的消息存储

  @override
  void onInit() {
    super.onInit();
    inputController = TextEditingController();
    // 保持输入框与响应式文本同步（避免重建导致光标跳动）
    inputController.addListener(() {
      inputText.value = inputController.text;
    });
    _initModels();
    _loadPersistedState();
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
    final session = ChatSession(id: id, title: title, createdAt: DateTime.now(), lastActiveAt: DateTime.now());
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

  Future<void> _initModels() async {
    clearError();
    try {
      final fetched = await service.fetchModels();
      models.assignAll(fetched);
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
    currentModel.value = model;
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
}