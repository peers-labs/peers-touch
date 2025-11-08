import 'package:flutter/material.dart';
import 'package:get/get.dart';
import 'package:peers_touch_desktop/features/ai_chat/controller/ai_chat_controller.dart';

class AIChatPage extends GetView<AIChatController> {
  const AIChatPage({super.key});

  @override
  Widget build(BuildContext context) {
    return Row(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        // 左栏：会话列表（占位）
        SizedBox(
          width: 240,
          child: Column(
            children: [
              const SizedBox(height: 12),
              Row(
                children: [
                  const SizedBox(width: 12),
                  Expanded(
                    child: TextField(
                      decoration: const InputDecoration(
                        hintText: '搜索会话',
                        isDense: true,
                        border: OutlineInputBorder(),
                      ),
                    ),
                  ),
                  const SizedBox(width: 12),
                ],
              ),
              const SizedBox(height: 8),
              Padding(
                padding: const EdgeInsets.symmetric(horizontal: 12),
                child: ElevatedButton(
                  onPressed: controller.newChat,
                  child: const Text('新建对话'),
                ),
              ),
              const Divider(height: 24),
              const Expanded(
                child: Center(child: Text('会话列表（占位）')),
              ),
            ],
          ),
        ),
        // 中栏：消息与输入
        Expanded(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              // 顶部：模型选择与状态
              Padding(
                padding: const EdgeInsets.all(12),
                child: Obx(() {
                  final models = controller.models;
                  final current = controller.currentModel.value;
                  return Row(
                    children: [
                      const Text('模型：'),
                      const SizedBox(width: 8),
                      DropdownButton<String>(
                        value: models.contains(current) ? current : null,
                        hint: Text(current.isEmpty ? '默认' : current),
                        items: models
                            .map((m) => DropdownMenuItem(value: m, child: Text(m)))
                            .toList(),
                        onChanged: (v) {
                          if (v != null) controller.setModel(v);
                        },
                      ),
                      const Spacer(),
                      Obx(() => controller.isSending.value
                          ? const Text('发送中...')
                          : const SizedBox.shrink()),
                    ],
                  );
                }),
              ),
              const Divider(height: 1),
              // 消息列表
              Expanded(
                child: Obx(() {
                  final msgs = controller.messages;
                  return ListView.builder(
                    padding: const EdgeInsets.all(12),
                    itemCount: msgs.length,
                    itemBuilder: (_, i) {
                      final m = msgs[i];
                      final isUser = m.role == 'user';
                      return Align(
                        alignment:
                            isUser ? Alignment.centerRight : Alignment.centerLeft,
                        child: Container(
                          margin: const EdgeInsets.symmetric(vertical: 6),
                          padding: const EdgeInsets.all(12),
                          decoration: BoxDecoration(
                            color: isUser
                                ? Colors.blue.withOpacity(0.12)
                                : Colors.grey.withOpacity(0.12),
                            borderRadius: BorderRadius.circular(8),
                          ),
                          child: Text(m.content),
                        ),
                      );
                    },
                  );
                }),
              ),
              // 错误提示
              Obx(() {
                final err = controller.error.value;
                if (err == null) return const SizedBox.shrink();
                return Padding(
                  padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 4),
                  child: Text(err, style: const TextStyle(color: Colors.red)),
                );
              }),
              // 输入框
              Padding(
                padding: const EdgeInsets.all(12),
                child: Row(
                  children: [
                    Expanded(
                      child: TextField(
                        minLines: 1,
                        maxLines: 5,
                        onChanged: controller.setInput,
                        controller: controller.inputController,
                        decoration: const InputDecoration(
                          hintText: '输入消息...',
                          border: OutlineInputBorder(),
                        ),
                      ),
                    ),
                    const SizedBox(width: 12),
                    Obx(() => ElevatedButton(
                          onPressed: controller.isSending.value ? null : controller.send,
                          child: const Text('发送'),
                        )),
                  ],
                ),
              ),
            ],
          ),
        ),
        // 右栏：占位设置/信息
        SizedBox(
          width: 280,
          child: Column(
            children: const [
              SizedBox(height: 12),
              Text('辅助面板（占位）'),
            ],
          ),
        ),
      ],
    );
  }
}