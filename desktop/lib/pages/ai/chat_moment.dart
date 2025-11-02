import 'package:desktop/pages/ai/chat_box.dart';
import 'package:desktop/providers/right_sidebar_provider.dart';
import 'package:desktop/widgets/ai/chat_anchor_bar.dart';
import 'package:desktop/widgets/ai/message_bubble.dart';
import 'package:desktop/widgets/right_sidebar.dart';
import 'package:desktop/providers/sidebar_state_provider.dart';
import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

class ChatMomentPage extends StatefulWidget {
  final int chatId;

  const ChatMomentPage({super.key, required this.chatId});

  @override
  State<ChatMomentPage> createState() => _ChatMomentPageState();
}


class _ChatMomentPageState extends State<ChatMomentPage> {
  late final ScrollController _scrollController;

  @override
  void initState() {
    super.initState();
    _scrollController = ScrollController();
  }

  @override
  void dispose() {
    _scrollController.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final sidebarState = Provider.of<SidebarStateProvider>(context);

    return Scaffold(
      appBar: AppBar(
        leading: sidebarState.isMiddleColumnOpen
            ? null
            : IconButton(
                icon: const Icon(Icons.menu),
                onPressed: () => sidebarState.toggleMiddleColumn(),
                tooltip: 'Show Chat List',
              ),
        title: const Text('Chat Session 1'),
        actions: [
          IconButton(
            icon: const Icon(Icons.menu),
            onPressed: () {
              Provider.of<RightSidebarProvider>(context, listen: false).toggle();
            },
          ),
        ],
      ),
      body: Consumer<RightSidebarProvider>(
        builder: (context, provider, child) {
          return Row(
            children: [
              Expanded(
                child: Column(
                  children: [
                    Expanded(
                      child: Row(
                        children: [
                          Expanded(
                            child: ListView.builder(
                              controller: _scrollController,
                              itemCount: 20, // Placeholder
                              itemBuilder: (context, index) {
                                return MessageBubble(
                                  message: 'Message $index',
                                  isMe: index % 2 == 0,
                                );
                              },
                            ),
                          ),
                          // 历史消息锚点，添加右边距避免顶格
                          Container(
                            margin: const EdgeInsets.only(right: 8.0),
                            child: ChatAnchorBar(controller: _scrollController, itemCount: 20),
                          ),
                        ],
                      ),
                    ),
                  ],
                ),
              ),
              if (provider.isOpen) const RightSidebar(),
            ],
          );
        },
      ),
      bottomNavigationBar: Padding(
        padding: const EdgeInsets.all(8.0),
        child: ChatBox(),
      ),
    );
  }
}