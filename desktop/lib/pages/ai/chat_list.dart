import 'package:desktop/providers/model_provider.dart';
import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import 'package:desktop/models/ai_model_simple.dart';

class ChatListPage extends StatefulWidget {
  const ChatListPage({super.key});

  @override
  State<ChatListPage> createState() => _ChatListPageState();
}

class _ChatListPageState extends State<ChatListPage> {
  int? _selectedIndex;

  @override
  Widget build(BuildContext context) {
    final modelProvider = Provider.of<AIModelProvider>(context);
    final currentModel = modelProvider.selectedModel;
    
    return Scaffold(
      backgroundColor: const Color(0xFFF9F9F9),
      body: Column(
        children: [
          // Model Info Card
          if (currentModel != null) ...[
            Container(
              margin: const EdgeInsets.all(12.0),
              padding: const EdgeInsets.all(16.0),
              decoration: BoxDecoration(
                color: Colors.white,
                borderRadius: BorderRadius.circular(12.0),
                boxShadow: [
                  BoxShadow(
                    color: Colors.grey.withOpacity(0.1),
                    spreadRadius: 1,
                    blurRadius: 5,
                    offset: const Offset(0, 2),
                  ),
                ],
              ),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    currentModel.displayName,
                    style: const TextStyle(
                      fontSize: 16,
                      fontWeight: FontWeight.bold,
                    ),
                  ),
                  const SizedBox(height: 4),
                  Text(
                    _getProviderName(currentModel.provider),
                    style: TextStyle(
                      fontSize: 13,
                      color: Colors.grey.shade600,
                    ),
                  ),
                  if (currentModel.visionSupported) ...[
                    const SizedBox(height: 10),
                    Container(
                      padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 4),
                      decoration: BoxDecoration(
                        color: Colors.blue.withOpacity(0.1),
                        borderRadius: BorderRadius.circular(12),
                      ),
                      child: const Text(
                        '支持图像',
                        style: TextStyle(fontSize: 11, color: Colors.blue, fontWeight: FontWeight.w500),
                      ),
                    ),
                  ],
                ],
              ),
            ),
          ],
          // Search Bar
          Padding(
            padding: const EdgeInsets.fromLTRB(12, 0, 12, 8),
            child: TextField(
              decoration: InputDecoration(
                hintText: 'Search chats...',
                prefixIcon: const Icon(Icons.search, size: 20),
                filled: true,
                fillColor: Colors.white,
                contentPadding: EdgeInsets.zero,
                border: OutlineInputBorder(
                  borderRadius: BorderRadius.circular(8.0),
                  borderSide: BorderSide.none,
                ),
              ),
            ),
          ),
          // Chat List
          Expanded(
            child: ListView.builder(
              itemCount: 10, // Placeholder
              itemBuilder: (context, index) {
                return Padding(
                  padding: const EdgeInsets.symmetric(horizontal: 8.0, vertical: 2.0),
                  child: ListTile(
                    leading: CircleAvatar(
                      backgroundColor: Colors.purple.shade100,
                      child: const Text('A', style: TextStyle(color: Colors.purple)),
                    ),
                    title: Text('Chat Session ${index + 1}'),
                    subtitle: const Text('Last message...', overflow: TextOverflow.ellipsis),
                    selected: _selectedIndex == index,
                    onTap: () {
                      setState(() {
                        _selectedIndex = index;
                      });
                    },
                    shape: RoundedRectangleBorder(
                      borderRadius: BorderRadius.circular(8.0),
                    ),
                    selectedTileColor: Colors.white,
                  ),
                );
              },
            ),
          ),
        ],
      ),
    );
  }

  String _getProviderName(ModelProvider provider) {
    switch (provider) {
      case ModelProvider.openai:
        return 'OpenAI';
      case ModelProvider.google:
        return 'Google';
      case ModelProvider.anthropic:
        return 'Anthropic';
      case ModelProvider.moonshot:
        return 'Moonshot AI';
      case ModelProvider.ollama:
        return 'Ollama';
      case ModelProvider.custom:
        return 'Custom';
      default:
        return 'Unknown';
    }
  }
}