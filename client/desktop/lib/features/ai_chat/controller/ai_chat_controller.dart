import 'dart:async';
import 'dart:convert';
import 'package:fixnum/fixnum.dart' as $fixnum;
import 'package:flutter/material.dart';
import 'package:get/get.dart';
import 'package:peers_touch_desktop/core/constants/ai_constants.dart';
import 'package:peers_touch_desktop/core/storage/local_storage.dart';
import 'package:peers_touch_desktop/features/ai_chat/service/ai_service.dart';
import 'package:peers_touch_base/ai_proxy/service/ai_box_service_factory.dart';
import 'package:peers_touch_base/ai_proxy/adapter/ai_proxy_adapter.dart';
import 'package:peers_touch_base/model/domain/ai_box/chat.pb.dart';
import 'package:peers_touch_base/model/domain/ai_box/chat.pbenum.dart';
import 'package:peers_touch_desktop/features/ai_chat/widgets/input_box/models/ai_composer_draft.dart';
import 'package:peers_touch_desktop/features/ai_chat/widgets/input_box/models/ai_attachment.dart';
import 'package:peers_touch_desktop/features/shell/controller/shell_controller.dart';

// 保存主题操作的结果状态
enum SaveTopicStatus {
  createdNew,
  alreadySaved,
}

class AIChatController extends GetxController {
  final AIService service;
  final LocalStorage storage;

  AIChatController({required this.service, required this.storage,});

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
  // 输入控制器，在声明时初始化，避免 late 变量重复初始化的问题
  late final TextEditingController inputController = TextEditingController()..addListener(() {
    inputText.value = inputController.text;
  });
  final Map<String, List<ChatMessage>> _sessionStore = {}; // 每会话的消息存储
  // 会话到已保存主题的映射
  Map<String, String> _sessionTopicMap = {};

  @override
  void onInit() {
    super.onInit();
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
    final session = ChatSession(id: id, title: title, createdAt: $fixnum.Int64(DateTime.now().millisecondsSinceEpoch), 
    updatedAt: $fixnum.Int64(DateTime.now().millisecondsSinceEpoch));
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
       updatedAt: s.createdAt,
      );
      sessions.refresh();
      _persistSessions();
         _persistMessagesForSession(s.id);
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
    final userMsg = ChatMessage(role: ChatRole.CHAT_ROLE_USER, content: text, createdAt: $fixnum.Int64(DateTime.now().millisecondsSinceEpoch));
    messages.add(userMsg);
    list.add(userMsg);
    inputController.clear();
    inputText.value = '';
    isSending.value = true;
    clearError();

    // 获取 AI 服务实例（工厂内部管理adapter，外部无需关心）
    final aiService = AiBoxServiceFactory.getService();

    // 构建聊天历史记录
    final chatHistory = messages.map((msg) {
      return ChatMessage(
        role: msg.role == ChatRole.CHAT_ROLE_USER  ? ChatRole.CHAT_ROLE_USER : ChatRole.CHAT_ROLE_ASSISTANT,
        content: msg.content,
        createdAt: $fixnum.Int64(DateTime.now().millisecondsSinceEpoch),
      );
    }).toList();

    // 构建请求
    final request = ChatCompletionRequest(
      messages: chatHistory,
      model: currentModel.value.isNotEmpty ? currentModel.value : AIConstants.defaultOpenAIModel,
      temperature: temperature,
      stream: enableStreaming,
    );

    if (enableStreaming) {
      // 预先放入一条空助手消息，随后增量填充
      final assistant = ChatMessage(role: ChatRole.CHAT_ROLE_ASSISTANT, content: '', createdAt: $fixnum.Int64(DateTime.now().millisecondsSinceEpoch));
      messages.add(assistant);
      list.add(assistant);
      try {
        await for (final response in aiService.chat(request)) {
          if (response.choices.isNotEmpty) {
            final message = response.choices.first.message?.content ?? '';
            if (message.isNotEmpty) {
              assistant.content += message;
              messages.refresh();
              // 同步存储列表刷新
              _sessionStore[sid] = List<ChatMessage>.from(messages);
              _persistMessagesForSession(sid);
            }
          }
        }
      } catch (e) {
        error.value = '发送失败：$e';
      } finally {
        isSending.value = false;
      }
    } else {
      try {
        final response = await aiService.chatSync(request);
        final reply = response.choices.first.message?.content ?? '';
        final assistant = ChatMessage(role: ChatRole.CHAT_ROLE_ASSISTANT, content: reply, createdAt: $fixnum.Int64(DateTime.now().millisecondsSinceEpoch));
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
    final userMsg = ChatMessage(role: ChatRole.CHAT_ROLE_USER, content: text, createdAt: $fixnum.Int64(DateTime.now().millisecondsSinceEpoch));
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
      final assistant = ChatMessage(role: ChatRole.CHAT_ROLE_ASSISTANT, content: '', createdAt: $fixnum.Int64(DateTime.now().millisecondsSinceEpoch));
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
        final assistant = ChatMessage(role: ChatRole.CHAT_ROLE_ASSISTANT, content: reply, createdAt: $fixnum.Int64(DateTime.now().millisecondsSinceEpoch));
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
      // 使用 microtask 避免在 onInit 中直接修改 RxList 触发构建错误
      Future.microtask(() => topics.assignAll(rawTopics.map((e) => e.toString())));
    } else {
      Future.microtask(() => topics.assignAll(['默认主题']));
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
          .map((m) => ChatSession.create()..mergeFromProto3Json(m))
          .toList();
      // 使用 microtask 避免在 onInit 中直接修改 RxList 触发构建错误
      Future.microtask(() {
        sessions.assignAll(parsed);
        // 选择
        final sid = storage.get<String>(AIConstants.chatSelectedSessionId);
        if (sid != null && parsed.any((s) => s.id == sid)) {
          selectSession(sid);
        } else {
          selectSession(parsed.first.id);
        }
      });
    } else {
      // 使用 microtask 避免在 onInit 中直接修改 RxList 触发构建错误
      Future.microtask(() => createSession());
    }
  }

  void _persistSessions() {
    final data = sessions.map((s) => s.toProto3Json()).toList();
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
    final data = msgs.map((m) => m.toProto3Json()).toList();
    storage.set('${AIConstants.chatMessagesPrefix}$id', data);
    // 更新最后活跃时间
    final idx = sessions.indexWhere((s) => s.id == id);
    if (idx != -1) {
      final s = sessions[idx];
      final newMeta = Map<String, String>.from(s.meta);
      if (msgs.isNotEmpty) {
        newMeta['lastMessage'] = jsonEncode(msgs.last.toProto3Json());
      }
      sessions[idx] = s.rebuild((s) => s
        ..updatedAt = $fixnum.Int64(DateTime.now().millisecondsSinceEpoch)
        ..meta.clear()
        ..meta.addAll(newMeta));
      sessions.refresh();
      _persistSessions();
    }
  }

  List<ChatMessage> _loadMessagesForSession(String id) {
    final raw = storage.get<List<dynamic>>('${AIConstants.chatMessagesPrefix}$id');
    if (raw == null) return <ChatMessage>[];
    return raw.whereType<Map<String, dynamic>>().map((m) {
      final role = m['role'] as String?;
      final content = m['content'] as String?;
      final createdAt = m['createdAt'] as String?;
      return ChatMessage(
        role: role == 'user' ? ChatRole.CHAT_ROLE_USER : ChatRole.CHAT_ROLE_ASSISTANT,
        content: content ?? '',
        createdAt: createdAt != null
            ? $fixnum.Int64.parseInt(createdAt)
            : $fixnum.Int64(DateTime.now().millisecondsSinceEpoch),
      );
    }).toList();
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
}