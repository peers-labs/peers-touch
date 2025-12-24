import 'dart:async';
// 遵循 desktop/PROMPTs 规范：不在控制器层直接依赖 Dio，
// 通过 AIService 抽象的 CancelHandle 进行取消。
import 'dart:convert';

import 'package:fixnum/fixnum.dart' as $fixnum;
import 'package:flutter/material.dart';
import 'package:get/get.dart';
import 'package:peers_touch_base/model/domain/ai_box/chat.pb.dart';
import 'package:peers_touch_base/model/domain/ai_box/provider.pb.dart';
import 'package:peers_touch_base/storage/local_storage.dart';
import 'package:peers_touch_desktop/core/constants/ai_constants.dart';
import 'package:peers_touch_desktop/features/ai_chat/controller/provider_controller.dart';
import 'package:peers_touch_desktop/features/ai_chat/service/ai_service.dart';
import 'package:peers_touch_desktop/features/ai_chat/service/ai_service_factory.dart';
import 'package:peers_touch_desktop/features/ai_chat/widgets/input_box/models/ai_attachment.dart';
import 'package:peers_touch_desktop/features/ai_chat/widgets/input_box/models/ai_composer_draft.dart';
import 'package:peers_touch_desktop/features/shell/controller/shell_controller.dart';

// 保存主题操作的结果状态
enum SaveTopicStatus {
  createdNew,
  alreadySaved,
}

class AIChatController extends GetxController {

  AIChatController({required this.storage});
  final LocalStorage storage;
  late final ProviderController _providerController;
  final activeService = Rx<AIService>(AIServiceFactory.defaultService);
  AIService get service => activeService.value;

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
  // 当前流式订阅（用于中断）
  StreamSubscription<String>? _streamSub;
  // 当前请求的取消令牌（用于真正终止 HTTP 连接）
  CancelHandle? _cancelHandle;
  // 输入历史游标（仅用户消息）
  int _historyCursor = -1;
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
    // Ensure ProviderController is available
    if (Get.isRegistered<ProviderController>()) {
      _providerController = Get.find<ProviderController>();
    } else {
      _providerController = Get.put(ProviderController());
    }

    // Listen to provider changes
    ever(_providerController.currentProvider, (Provider? provider) {
      _updateServiceFromProvider(provider);
    });

    // Initial update if provider is already loaded
    if (_providerController.currentProvider.value != null) {
      _updateServiceFromProvider(_providerController.currentProvider.value);
    }

    _initModels();
    _loadPersistedState();
  }

  void _updateServiceFromProvider(Provider? provider) {
    if (provider == null) return;
    
    final settings = provider.settingsJson.isNotEmpty
        ? (jsonDecode(provider.settingsJson) as Map<String, dynamic>)
        : <String, dynamic>{};
    
    final type = provider.sourceType.isNotEmpty ? provider.sourceType : 'openai';
    
    final newService = AIServiceFactory.fromName(type, config: settings);
    activeService.value = newService;
    
    // Re-fetch models when provider changes
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
    final session = ChatSession(id: id, title: title, createdAt: $fixnum.Int64(DateTime.now().millisecondsSinceEpoch), 
    updatedAt: $fixnum.Int64(DateTime.now().millisecondsSinceEpoch));
    sessions.add(session);
    _sessionStore[id] = <ChatMessage>[];
    selectSession(id);
    _persistSessions();
  }

  Future<void> selectSession(String id) async {
    selectedSessionId.value = id;
    // 懒加载消息
    var list = _sessionStore[id];
    if (list == null) {
      list = await _loadMessagesForSession(id);
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
      // 1) 优先使用 Provider 设置中已拉取或手动新增的模型列表
      List<String> preset = const [];
      if (_providerController.currentProvider.value != null) {
        try {
          final p = _providerController.currentProvider.value!;
          final s = p.settingsJson.isNotEmpty
              ? (jsonDecode(p.settingsJson) as Map<String, dynamic>)
              : <String, dynamic>{};
          final List<String> modelsAll = List<String>.from((s['models'] ?? const <String>[]) as List);
          final List<String> enabled = List<String>.from((s['enabledModels'] ?? const <String>[]) as List);
          preset = enabled.isNotEmpty ? enabled : modelsAll;
        } catch (_) {}
      }

      List<String> fetched = const [];
      // 2) 若预设为空，再尝试远端拉取（允许失败，不抛到 UI）
      if (preset.isEmpty) {
        try {
          fetched = await service.fetchModels();
        } catch (_) {
          fetched = const [];
        }
      }

      final finalList = preset.isNotEmpty ? preset : fetched;
      models.assignAll(finalList);

      final preferred = await storage.get<String>(AIConstants.selectedModel) ?? AIConstants.defaultOpenAIModel;
      currentModel.value = models.contains(preferred) && preferred.isNotEmpty
          ? preferred
          : (models.isNotEmpty ? models.first : AIConstants.defaultOpenAIModel);
    } catch (e) {
      // 若出现不可预料异常，保底为默认模型
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
    if (!await service.checkConfigured()) {
      error.value = 'AI提供商未配置';
      return;
    }

    final enableStreaming = await storage.get<bool>(AIConstants.enableStreaming) ?? true;
    final tempStr = await storage.get<String>(AIConstants.temperature) ?? AIConstants.defaultTemperature.toString();
    final temperature = double.tryParse(tempStr) ?? AIConstants.defaultTemperature;

    // 确保存在会话
    var sid = selectedSessionId.value;
    if (sid == null) {
      createSession();
      sid = selectedSessionId.value;
    }
    final sidStr = sid!;
    final list = _sessionStore[sidStr]!;
    final userMsg = ChatMessage(role: ChatRole.CHAT_ROLE_USER, content: text, createdAt: $fixnum.Int64(DateTime.now().millisecondsSinceEpoch));
    messages.add(userMsg);
    list.add(userMsg);
    inputController.clear();
    inputText.value = '';
    isSending.value = true;
    clearError();

    if (enableStreaming) {
      final assistant = ChatMessage(role: ChatRole.CHAT_ROLE_ASSISTANT, content: '', createdAt: $fixnum.Int64(DateTime.now().millisecondsSinceEpoch));
      messages.add(assistant);
      list.add(assistant);
      try {
        // 使用实际 AIService 的流式接口，并绑定 CancelToken
        _cancelHandle = service.createCancelHandle();
        final stream = service.sendMessageStream(
          message: text,
          model: currentModel.value.isNotEmpty ? currentModel.value : null,
          temperature: temperature,
          cancel: _cancelHandle,
        );
        _streamSub = stream.listen((chunk) {
          if (chunk.isEmpty) return;
          assistant.content += chunk;
          messages.refresh();
          _sessionStore[sidStr] = List<ChatMessage>.from(messages);
          _persistMessagesForSession(sidStr);
        }, onError: (e) {
          error.value = '发送失败：$e';
        }, onDone: () {
          isSending.value = false;
          _cancelHandle = null;
          _streamSub = null;
        });
      } catch (e) {
        error.value = '发送失败：$e';
      } finally {
        // 在 onDone 或 cancel 时置为 false
      }
    } else {
      try {
        _cancelHandle = service.createCancelHandle();
        final response = await service.sendMessage(
          message: text,
          model: currentModel.value.isNotEmpty ? currentModel.value : null,
          temperature: temperature,
          cancel: _cancelHandle,
        );
        final reply = response;
        final assistant = ChatMessage(role: ChatRole.CHAT_ROLE_ASSISTANT, content: reply, createdAt: $fixnum.Int64(DateTime.now().millisecondsSinceEpoch));
        messages.add(assistant);
        list.add(assistant);
        _persistMessagesForSession(sidStr);
      } catch (e) {
        error.value = '发送失败：$e';
      } finally {
        isSending.value = false;
        _cancelHandle = null;
      }
    }
  }

  /// 发送富内容草稿（文本 + 附件），支持 OpenAI 与 Ollama
  Future<void> sendDraft(AiComposerDraft draft) async {
    final text = draft.text.trim();
    if (text.isEmpty && draft.attachments.isEmpty) return;
    if (!await service.checkConfigured()) {
      error.value = 'AI提供商未配置';
      return;
    }

    final enableStreaming = await storage.get<bool>(AIConstants.enableStreaming) ?? true;
    final tempStr = await storage.get<String>(AIConstants.temperature) ?? AIConstants.defaultTemperature.toString();
    final temperature = double.tryParse(tempStr) ?? AIConstants.defaultTemperature;

    // 确保存在会话
    var sid = selectedSessionId.value;
    if (sid == null) {
      createSession();
      sid = selectedSessionId.value;
    }
    final sidStr = sid!;
    final list = _sessionStore[sidStr]!;

    // 添加用户消息（仅展示文本，附件不在消息列表中显示）
    final userMsg = ChatMessage(role: ChatRole.CHAT_ROLE_USER, content: text, createdAt: $fixnum.Int64(DateTime.now().millisecondsSinceEpoch));
    messages.add(userMsg);
    list.add(userMsg);
    inputController.clear();
    inputText.value = '';
    isSending.value = true;
    clearError();

    // 根据提供商拼装富内容参数
    final provider = await storage.get<String>(AIConstants.providerType) ?? 'OpenAI';
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
        _cancelHandle = service.createCancelHandle();
        final stream = service.sendMessageStream(
          message: text,
          model: currentModel.value.isNotEmpty ? currentModel.value : null,
          temperature: temperature,
          openAIContent: openAIContent,
          imagesBase64: imagesBase64,
          cancel: _cancelHandle,
        );
        _streamSub = stream.listen((chunk) {
          assistant.content += chunk;
          messages.refresh();
          _sessionStore[sidStr] = List<ChatMessage>.from(messages);
          _persistMessagesForSession(sidStr);
        }, onError: (e) {
          error.value = '发送失败：$e';
        }, onDone: () {
          isSending.value = false;
          _cancelHandle = null;
          _streamSub = null;
        });
      } catch (e) {
        error.value = '发送失败：$e';
      } finally {
        // 在 onDone 或 cancel 时置为 false
      }
    } else {
      try {
        _cancelHandle = service.createCancelHandle();
        final reply = await service.sendMessage(
          message: text,
          model: currentModel.value.isNotEmpty ? currentModel.value : null,
          temperature: temperature,
          openAIContent: openAIContent,
          imagesBase64: imagesBase64,
          cancel: _cancelHandle,
        );
        final assistant = ChatMessage(role: ChatRole.CHAT_ROLE_ASSISTANT, content: reply, createdAt: $fixnum.Int64(DateTime.now().millisecondsSinceEpoch));
        messages.add(assistant);
        list.add(assistant);
        _persistMessagesForSession(sidStr);
      } catch (e) {
        error.value = '发送失败：$e';
      } finally {
        isSending.value = false;
        _cancelHandle = null;
      }
    }
  }

  // 取消当前发送（流式）
  void cancelSending() {
    try {
      _streamSub?.cancel();
      _cancelHandle?.cancel('User cancelled');
    } catch (_) {}
    _streamSub = null;
    _cancelHandle = null;
    isSending.value = false;
  }

  // 输入历史：将最后或上一个用户消息放入输入框
  void recallPrevInput() {
    final userMsgs = messages.where((m) => m.role == ChatRole.CHAT_ROLE_USER).toList();
    if (userMsgs.isEmpty) return;
    if (_historyCursor <= 0) {
      _historyCursor = userMsgs.length - 1;
    } else {
      _historyCursor -= 1;
    }
    final text = userMsgs[_historyCursor].content;
    inputController.text = text;
    inputController.selection = TextSelection.collapsed(offset: text.length);
  }

  void recallNextInput() {
    final userMsgs = messages.where((m) => m.role == ChatRole.CHAT_ROLE_USER).toList();
    if (userMsgs.isEmpty) return;
    if (_historyCursor < 0 || _historyCursor >= userMsgs.length - 1) {
      // 若超过范围，清空并重置游标
      _historyCursor = -1;
      inputController.text = '';
      return;
    }
    _historyCursor += 1;
    final text = userMsgs[_historyCursor].content;
    inputController.text = text;
    inputController.selection = TextSelection.collapsed(offset: text.length);
  }

  void setModel(String model) {
    currentModel.value = model;
    storage.set(AIConstants.selectedModel, model);
  }

  // -------------------- 持久化 --------------------
  Future<void> _loadPersistedState() async {
    // 右侧面板显隐
    final show = await storage.get<bool>(AIConstants.chatShowTopicPanel) ?? false;
    showTopicPanel.value = show;
    // topics
    final rawTopics = await storage.get<List<dynamic>>(AIConstants.chatTopics);
    if (rawTopics != null) {
      // 使用 microtask 避免在 onInit 中直接修改 RxList 触发构建错误
      Future.microtask(() => topics.assignAll(rawTopics.map((e) => e.toString())));
    } else {
      Future.microtask(() => topics.assignAll(['默认主题']));
    }
    // 会话-主题映射
    final mapRaw = await storage.get<Map<String, dynamic>>(AIConstants.chatSessionTopicMap);
    if (mapRaw != null) {
      _sessionTopicMap = mapRaw.map((k, v) => MapEntry(k, v.toString()));
    }
    // sessions
    final rawSessions = await storage.get<List<dynamic>>(AIConstants.chatSessions);
    if (rawSessions != null && rawSessions.isNotEmpty) {
      final parsed = rawSessions
          .whereType<Map<String, dynamic>>()
          .map((m) => ChatSession.create()..mergeFromProto3Json(m))
          .toList();
      // 使用 microtask 避免在 onInit 中直接修改 RxList 触发构建错误
      Future.microtask(() async {
        sessions.assignAll(parsed);
        // 选择
        final sid = await storage.get<String>(AIConstants.chatSelectedSessionId);
        if (sid != null && parsed.any((s) => s.id == sid)) {
          await selectSession(sid);
        } else {
          await selectSession(parsed.first.id);
        }
      });
    } else {
      // 使用 microtask 避免在 onInit 中直接修改 RxList 触发构建错误
      Future.microtask(() => createSession());
    }
  }

  Future<void> _persistSessions() async {
    final data = sessions.map((s) => s.toProto3Json()).toList();
    storage.set(AIConstants.chatSessions, data);
    if (selectedSessionId.value != null) {
      storage.set(AIConstants.chatSelectedSessionId, selectedSessionId.value);
    }
  }

  Future<void> _persistTopics() async {
    storage.set(AIConstants.chatTopics, topics.toList());
  }

  Future<void> _persistSessionTopicMap() async {
    storage.set(AIConstants.chatSessionTopicMap, Map<String, String>.from(_sessionTopicMap));
  }

  Future<void> _persistMessagesForSession(String id) async {
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
      sessions[idx] = s.deepCopy()
        ..updatedAt = $fixnum.Int64(DateTime.now().millisecondsSinceEpoch)
        ..meta.clear()
        ..meta.addAll(newMeta);
      sessions.refresh();
      await _persistSessions();
    }
  }

  Future<List<ChatMessage>> _loadMessagesForSession(String id) async {
    final raw = await storage.get<List<dynamic>>('${AIConstants.chatMessagesPrefix}$id');
    if (raw == null) return <ChatMessage>[];
    return raw.whereType<Map<String, dynamic>>().map((m) {
      final r = m['role'];
      ChatRole role;
      if (r is String) {
        final v = r.toLowerCase();
        if (v == 'user' || v == 'chat_role_user' || v == '2') {
          role = ChatRole.CHAT_ROLE_USER;
        } else if (v == 'system' || v == 'chat_role_system' || v == '1') {
          role = ChatRole.CHAT_ROLE_SYSTEM;
        } else {
          role = ChatRole.CHAT_ROLE_ASSISTANT;
        }
      } else if (r is num) {
        final v = r.toInt();
        if (v == 2) {
          role = ChatRole.CHAT_ROLE_USER;
        } else if (v == 1) {
          role = ChatRole.CHAT_ROLE_SYSTEM;
        } else {
          role = ChatRole.CHAT_ROLE_ASSISTANT;
        }
      } else {
        role = ChatRole.CHAT_ROLE_ASSISTANT;
      }
      final content = m['content'] as String?;
      final createdAtStr = m['createdAt'] as String?;
      return ChatMessage(
        role: role,
        content: content ?? '',
        createdAt: createdAtStr != null
            ? $fixnum.Int64.parseInt(createdAtStr)
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
      if (messages[i].role == ChatRole.CHAT_ROLE_USER) {
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
