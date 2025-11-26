import 'package:flutter/material.dart';
import 'package:get/get.dart';
import '../controller/chat_controller.dart';

class ChatPage extends GetView<ChatController> {
  const ChatPage({Key? key}) : super(key: key);

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('WebRTC Chat')),
      body: Column(
        children: [
          // Config area
          Padding(
            padding: const EdgeInsets.all(8.0),
            child: Card(
              child: Padding(
                padding: const EdgeInsets.all(8.0),
                child: Column(
                  children: [
                    TextField(
                      decoration: const InputDecoration(labelText: 'Signaling URL'),
                      onChanged: (v) => controller.signalingUrl.value = v,
                      controller: TextEditingController(text: controller.signalingUrl.value),
                    ),
                    Row(
                      children: [
                        Expanded(
                          child: TextField(
                            decoration: const InputDecoration(labelText: 'My ID'),
                            onChanged: (v) => controller.selfPeerId.value = v,
                            controller: TextEditingController(text: controller.selfPeerId.value),
                          ),
                        ),
                        const SizedBox(width: 8),
                        Expanded(
                          child: TextField(
                            decoration: const InputDecoration(labelText: 'Target ID'),
                            onChanged: (v) => controller.targetPeerId.value = v,
                            controller: TextEditingController(text: controller.targetPeerId.value),
                          ),
                        ),
                      ],
                    ),
                    const SizedBox(height: 8),
                    Wrap(
                      spacing: 8,
                      children: [
                        ElevatedButton(
                          onPressed: () => controller.initChat(),
                          child: const Text('Init & Register'),
                        ),
                        ElevatedButton(
                          onPressed: () => controller.connect(),
                          child: const Text('Connect (Call)'),
                        ),
                         ElevatedButton(
                          onPressed: () => controller.answer(),
                          child: const Text('Answer'),
                        ),
                      ],
                    ),
                  ],
                ),
              ),
            ),
          ),
          Expanded(
            child: Obx(() => ListView.builder(
              itemCount: controller.messages.length,
              itemBuilder: (context, index) => ListTile(
                title: Text(controller.messages[index]),
              ),
            )),
          ),
          Padding(
            padding: const EdgeInsets.all(8.0),
            child: Row(
              children: [
                Expanded(child: TextField(controller: controller.textController)),
                IconButton(
                  icon: const Icon(Icons.send),
                  onPressed: () => controller.sendMessage(),
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }
}
