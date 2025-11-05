import 'package:peers_touch_desktop/widget/ai/chat_toolbar.dart';
import 'package:flutter/material.dart';
import 'package:peers_touch_desktop/provider/model_provider.dart';

class ChatInput extends StatelessWidget {
  const ChatInput({super.key});

  @override
  Widget build(BuildContext context) {
    final modelProvider = Get.find<AIModelProvider>();
    final currentModel = modelProvider.selectedModel;
    
    return Column(
      children: [
        TextField(
            decoration: InputDecoration(
              hintText: currentModel?.visionSupported == true 
                  ? 'Type your message here, attach images, or use voice input...' 
                  : 'Type your message here or use voice input...',
              border: InputBorder.none,
              contentPadding: const EdgeInsets.symmetric(vertical: 8.0), // Adjust padding
            ),
            maxLines: 5,
            minLines: 1,
          ),
          const ChatToolbar(),
      ],
    );
  }
}