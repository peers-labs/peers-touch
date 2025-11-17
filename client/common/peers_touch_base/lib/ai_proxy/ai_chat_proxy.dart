import 'dart:async';
import 'package:flutter/foundation.dart';
import 'package:peers_touch_base/storage/local_storage.dart';

import 'package:peers_touch_base/constants.dart';
import 'models/chat_session.dart';
import 'interfaces/ai_service.dart';
import 'package:fixnum/fixnum.dart' as $fixnum;
import 'package:peers_touch_base/model/domain/ai_box/chat_session.pb.dart' as $1;

// 保存主题操作的结果状态
enum SaveTopicStatus {
  createdNew,
  alreadySaved,
}

class ChatMessage {
  final String role; // 'user' | 'assistant'
  String content;
  final DateTime createdAt;
  
  ChatMessage({
    required this.role, 
    required this.content, 
    required this.createdAt
  });

  Map<String, dynamic> toJson() => {
        'role': role,
        'content': content,
        'createdAt': createdAt.toIso8601String(),
      };

  factory ChatMessage.fromJson(Map<String, dynamic> json) => ChatMessage(
        role: json['role'] as String? ?? 'user',
        content: json['content'] as String? ?? '',
        createdAt: DateTime.parse(json['createdAt'] as String? ?? DateTime.now().toIso8601String()),
      );
}

/// AI聊天代理 - 包含所有非视图业务逻辑
class AIChatProxy extends ChangeNotifier {
  final LocalStorage _storage;
  
  // 状态管理
  final ValueNotifier<List<ChatMessage>> messages = ValueNotifier([]);
  final ValueNotifier<List<String>> models = ValueNotifier([]);
  final ValueNotifier<String> currentModel = ValueNotifier('');
  final ValueNotifier<String> inputText = ValueNotifier('');
  final ValueNotifier<bool> isSending = ValueNotifier(false);
  final ValueNotifier<String?> error = ValueNotifier(null);
  final ValueNotifier<bool> showTopicPanel = ValueNotifier(false);
  final ValueNotifier<List<$1.ChatSession>> sessions = ValueNotifier([]);
  final ValueNotifier<String?> selectedSessionId = ValueNotifier(null);
  final ValueNotifier<List<String>> topics = ValueNotifier([]);
  final ValueNotifier<String?> currentTopic = ValueNotifier(null);
  final ValueNotifier<int> flashTopicIndex = ValueNotifier(-1);
  
  final Map<String, List<ChatMessage>> _sessionStore = {}; // 每会话的消息存储
  Map<String, String> _sessionTopicMap = {}; // 会话到已保存主题的映射

  AIChatProxy({
    required LocalStorage storage,
  }) : _storage = storage {
    // Initialize asynchronously
    _init();
  }

  Future<void> _init() async {
    await _loadPersistedState();
  }

  void clearError() => error.value = null;

  Future<void> toggleTopicPanel() async {
    final v = !showTopicPanel.value;
    showTopicPanel.value = v;
    await _storage.set(AIConstants.chatShowTopicPanel, v);
  }

  String _genId() => DateTime.now().millisecondsSinceEpoch.toString();

  Future<void> createSession({String title = 'Just Chat'}) async {
    final id = _genId();
    final now = DateTime.now();
    final session = $1.ChatSession(
      id: id, 
      title: title, 
      description: '',
      createdAt: $fixnum.Int64(now.millisecondsSinceEpoch),
      updatedAt: $fixnum.Int64(now.millisecondsSinceEpoch),
    );
    sessions.value = [...sessions.value, session];
    _sessionStore[id] = <ChatMessage>[];
    await selectSession(id);
    await _persistSessions();
  }

  Future<void> selectSession(String id) async {
    selectedSessionId.value = id;
    // 懒加载消息
    var list = _sessionStore[id];
    if (list == null) {
      list = await _loadMessagesForSession(id);
      _sessionStore[id] = list;
    }
    messages.value = List.from(list);
    await _storage.set(AIConstants.chatSelectedSessionId, id);
  }

  Future<void> addTopic([String? title]) async {
    final t = title ?? '主题 ${topics.value.length + 1}';
    topics.value = [...topics.value, t];
    await _persistTopics();
  }

  Future<void> removeTopicAt(int index) async {
    if (index >= 0 && index < topics.value.length) {
      final newTopics = List<String>.from(topics.value);
      newTopics.removeAt(index);
      topics.value = newTopics;
      await _persistTopics();
    }
  }

  void renameTopic(int index, String newTitle) {
    if (index >= 0 && index < topics.value.length) {
      final newTopics = List<String>.from(topics.value);
      newTopics[index] = newTitle;
      topics.value = newTopics;
    }
  }

  Future<void> renameSession(String id, String newTitle) async {
    final idx = sessions.value.indexWhere((s) => s.id == id);
    if (idx != -1) {
      final newSessions = List<$1.ChatSession>.from(sessions.value);
      final s = newSessions[idx];
      newSessions[idx] = $1.ChatSession(
        id: s.id,
        title: newTitle,
        description: s.description,
        createdAt: s.createdAt,
        updatedAt: s.updatedAt,
      );
      sessions.value = newSessions;
      await _persistSessions();
    }
  }

  Future<void> deleteSession(String id) async {
    final idx = sessions.value.indexWhere((s) => s.id == id);
    if (idx != -1) {
      final newSessions = List<ChatSession>.from(sessions.value);
      newSessions.removeAt(idx);
      sessions.value = newSessions;
      _sessionStore.remove(id);
      await _storage.remove('${AIConstants.chatMessagesPrefix}$id');
      
      // 更新选择
      if (selectedSessionId.value == id) {
        selectedSessionId.value = null;
        messages.value = [];
        if (sessions.value.isNotEmpty) {
          await selectSession(sessions.value.last.id);
        }
      }
      await _persistSessions();
    }
  }

  void setInput(String text) => inputText.value = text;

  Future<void> newChat() async {
    clearError();
    await createSession();
  }

  Future<void> setModel(String model) async {
    currentModel.value = model;
    await _storage.set(AIConstants.selectedModel, model);
  }

  // -------------------- 持久化 --------------------
  Future<void> _loadPersistedState() async {
    // 右侧面板显隐
    final show = await _storage.get<bool>(AIConstants.chatShowTopicPanel) ?? false;
    showTopicPanel.value = show;
    
    // topics
    final rawTopics = await _storage.get<List<dynamic>>(AIConstants.chatTopics);
    if (rawTopics != null) {
      topics.value = rawTopics.map((e) => e.toString()).toList();
    } else {
      topics.value = ['默认主题'];
    }
    
    // 会话-主题映射
    final mapRaw = await _storage.get<Map<String, dynamic>>(AIConstants.chatSessionTopicMap);
    if (mapRaw != null) {
      _sessionTopicMap = mapRaw.map((k, v) => MapEntry(k, v.toString()));
    }
    
    // sessions
    final rawSessions = await _storage.get<List<dynamic>>(AIConstants.chatSessions);
    if (rawSessions != null && rawSessions.isNotEmpty) {
      final parsed = rawSessions
          .whereType<String>()
          .map((jsonStr) => $1.ChatSession.fromJson(jsonStr))
          .toList();
      sessions.value = parsed;
      
      // 选择会话
      final sid = await _storage.get<String>(AIConstants.chatSelectedSessionId);
      if (sid != null && parsed.any((s) => s.id == sid)) {
        await selectSession(sid);
      } else if (parsed.isNotEmpty) {
        await selectSession(parsed.first.id);
      }
    } else {
      createSession();
    }
  }

  Future<void> _persistSessions() async {
    final data = sessions.value.map((s) => s.writeToJson()).toList();
    await _storage.set(AIConstants.chatSessions, data);
    if (selectedSessionId.value != null) {
      await _storage.set(AIConstants.chatSelectedSessionId, selectedSessionId.value);
    }
  }

  Future<void> _persistTopics() async {
    await _storage.set(AIConstants.chatTopics, topics.value);
  }

  Future<void> _persistSessionTopicMap() async {
    await _storage.set(AIConstants.chatSessionTopicMap, Map<String, String>.from(_sessionTopicMap));
  }

  Future<void> _persistMessagesForSession(String id) async {
    final msgs = _sessionStore[id] ?? <ChatMessage>[];
    final data = msgs.map((m) => m.toJson()).toList();
    await _storage.set('${AIConstants.chatMessagesPrefix}$id', data);
    
    // 更新最后活跃时间
    final idx = sessions.value.indexWhere((s) => s.id == id);
    if (idx != -1) {
      final newSessions = List<$1.ChatSession>.from(sessions.value);
      final s = newSessions[idx];
      newSessions[idx] = $1.ChatSession(
        id: s.id,
        title: s.title,
        description: msgs.isNotEmpty ? msgs.last.content : s.description,
        createdAt: s.createdAt,
        updatedAt: $fixnum.Int64(DateTime.now().millisecondsSinceEpoch),
      );
      sessions.value = newSessions;
      await _persistSessions();
    }
  }

  Future<List<ChatMessage>> _loadMessagesForSession(String id) async {
    final raw = await _storage.get<List<dynamic>>('${AIConstants.chatMessagesPrefix}$id');
    if (raw == null) return <ChatMessage>[];
    return raw
        .whereType<Map<String, dynamic>>()
        .map((m) => ChatMessage.fromJson(m))
        .toList();
  }

  // 选择 Topic（仅更新当前选择，暂不影响消息）
  void selectTopicAt(int index) {
    if (index >= 0 && index < topics.value.length) {
      currentTopic.value = topics.value[index];
    }
  }

  // 从当前聊天派生一个合适的主题标题
  String _deriveTopicTitle() {
    // 取最近一条用户消息作为标题摘要
    ChatMessage? lastUser;
    for (var i = messages.value.length - 1; i >= 0; i--) {
      if (messages.value[i].role == 'user') {
        lastUser = messages.value[i];
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
      final s = sessions.value.firstWhere((e) => e.id == sid, orElse: () => $1.ChatSession(
        id: '', 
        title: '', 
        description: '',
        createdAt: $fixnum.Int64(DateTime.now().millisecondsSinceEpoch),
        updatedAt: $fixnum.Int64(DateTime.now().millisecondsSinceEpoch),
      ));
      if (s.title.isNotEmpty) return s.title;
    }
    final now = DateTime.now();
    return '主题 ${now.hour}:${now.minute.toString().padLeft(2, '0')}';
  }

  /// 保存当前聊天为新 Topic；如该会话已保存过，则闪动对应 Topic。
  Future<SaveTopicStatus> saveCurrentChatAsTopic() async {
    // 确保存在会话
    var sid = selectedSessionId.value;
    if (sid == null) {
      await createSession();
      sid = selectedSessionId.value;
    }
    if (sid == null) return SaveTopicStatus.createdNew;

    // 如果该会话已保存过，闪动当前 Topic
    final existingTitle = _sessionTopicMap[sid];
    if (existingTitle != null) {
      final idx = topics.value.indexOf(existingTitle);
      if (idx >= 0) {
        flashTopicIndex.value = idx;
        _scheduleFlashReset();
        return SaveTopicStatus.alreadySaved;
      }
    }

    // 派生标题；若已存在相同标题则不重复添加，仅建立映射
    final title = _deriveTopicTitle();
    int idx = topics.value.indexOf(title);
    if (idx == -1) {
      topics.value = [...topics.value, title];
      await _persistTopics();
      idx = topics.value.length - 1;
    }
    currentTopic.value = title;
    _sessionTopicMap[sid] = title;
    await _persistSessionTopicMap();
    flashTopicIndex.value = idx;
    _scheduleFlashReset();
    return SaveTopicStatus.createdNew;
  }

  void _scheduleFlashReset() {
    Future.delayed(const Duration(milliseconds: 900), () {
      flashTopicIndex.value = -1;
    });
  }

  // 发送消息的核心逻辑（供外部调用）
  Future<void> sendMessage({
    required String text,
    required AIService aiService,
    String? model,
    double? temperature,
    bool enableStreaming = true,
  }) async {
    if (text.isEmpty) return;
    
    final enableStream = await _storage.get<bool>(AIConstants.enableStreaming) ?? enableStreaming;
    final tempStr = await _storage.get<String>(AIConstants.temperature) ?? (temperature ?? 0.7).toString();
    final temp = double.tryParse(tempStr) ?? (temperature ?? 0.7);

    // 确保存在会话
    var sid = selectedSessionId.value;
    if (sid == null) {
      await createSession();
      sid = selectedSessionId.value;
    }
    final list = _sessionStore[sid!]!;
    final userMsg = ChatMessage(role: 'user', content: text, createdAt: DateTime.now());
    
    // 更新消息列表
    messages.value = [...messages.value, userMsg];
    list.add(userMsg);
    isSending.value = true;
    clearError();

    if (enableStream) {
      // 预先放入一条空助手消息，随后增量填充
      final assistant = ChatMessage(role: 'assistant', content: '', createdAt: DateTime.now());
      messages.value = [...messages.value, assistant];
      list.add(assistant);
      
      try {
        await for (final chunk in aiService.sendMessageStream(
          message: text,
          model: model ?? (currentModel.value.isNotEmpty ? currentModel.value : null),
          temperature: temp,
        )) {
          assistant.content += chunk;
          messages.value = List.from(messages.value); // This will trigger ValueNotifier
          // 同步存储列表刷新
          _sessionStore[sid] = List<ChatMessage>.from(messages.value);
          await _persistMessagesForSession(sid);
        }
      } catch (e) {
        error.value = '发送失败：$e';
      } finally {
        isSending.value = false;
      }
    } else {
      try {
        final reply = await aiService.sendMessage(
          message: text,
          model: model ?? (currentModel.value.isNotEmpty ? currentModel.value : null),
          temperature: temp,
        );
        final assistant = ChatMessage(role: 'assistant', content: reply, createdAt: DateTime.now());
        messages.value = [...messages.value, assistant];
        list.add(assistant);
        await _persistMessagesForSession(sid);
      } catch (e) {
        error.value = '发送失败：$e';
      } finally {
        isSending.value = false;
      }
    }
  }

  // 清理资源
  @override
  void dispose() {
    messages.dispose();
    models.dispose();
    currentModel.dispose();
    inputText.dispose();
    isSending.dispose();
    error.dispose();
    showTopicPanel.dispose();
    sessions.dispose();
    selectedSessionId.dispose();
    topics.dispose();
    currentTopic.dispose();
    flashTopicIndex.dispose();
    super.dispose();
  }
}