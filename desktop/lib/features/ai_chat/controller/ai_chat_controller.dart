import 'dart:async';
import 'package:flutter/material.dart';
import 'package:get/get.dart';
import 'package:peers_touch_desktop/core/constants/ai_constants.dart';
import 'package:peers_touch_desktop/core/storage/local_storage.dart';
import 'package:peers_touch_desktop/features/ai_chat/service/ai_service.dart';

class ChatMessage {
  final String role; // 'user' | 'assistant'
  String content;
  ChatMessage({required this.role, required this.content});
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
  late final TextEditingController inputController;

  @override
  void onInit() {
    super.onInit();
    inputController = TextEditingController();
    // 保持输入框与响应式文本同步（避免重建导致光标跳动）
    inputController.addListener(() {
      inputText.value = inputController.text;
    });
    _initModels();
  }

  @override
  void onClose() {
    inputController.dispose();
    super.onClose();
  }

  void clearError() => error.value = null;

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
    messages.clear();
    clearError();
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

    messages.add(ChatMessage(role: 'user', content: text));
    inputController.clear();
    inputText.value = '';
    isSending.value = true;
    clearError();

    if (enableStreaming) {
      // 预先放入一条空助手消息，随后增量填充
      final assistant = ChatMessage(role: 'assistant', content: '');
      messages.add(assistant);
      try {
        await for (final chunk in service.sendMessageStream(
          message: text,
          model: currentModel.value.isNotEmpty ? currentModel.value : null,
          temperature: temperature,
        )) {
          assistant.content += chunk;
          messages.refresh();
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
        messages.add(ChatMessage(role: 'assistant', content: reply));
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
}