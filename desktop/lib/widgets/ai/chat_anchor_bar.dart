import 'package:flutter/material.dart';

class ChatAnchorBar extends StatefulWidget {
  final ScrollController controller;
  final int itemCount;

  const ChatAnchorBar({
    super.key,
    required this.controller,
    required this.itemCount,
  });

  @override
  State<ChatAnchorBar> createState() => _ChatAnchorBarState();
}

class _ChatAnchorBarState extends State<ChatAnchorBar> {
  // This is a simplified implementation. A more robust solution would involve
  // tracking the position of each item, especially with variable heights.

  void _scrollTo(int index) {
    if (widget.controller.hasClients) {
      final maxScroll = widget.controller.position.maxScrollExtent;
      final targetScroll = (index / widget.itemCount) * maxScroll;
      widget.controller.animateTo(
        targetScroll,
        duration: const Duration(milliseconds: 300),
        curve: Curves.easeInOut,
      );
    }
  }

  @override
  Widget build(BuildContext context) {
    if (widget.itemCount == 0) {
      return const SizedBox.shrink();
    }

    return Container(
      width: 20,
      padding: const EdgeInsets.symmetric(vertical: 16.0),
      child: Column(
        mainAxisAlignment: MainAxisAlignment.spaceEvenly,
        children: List.generate(widget.itemCount, (index) {
          return Expanded(
            child: GestureDetector(
              onTap: () => _scrollTo(index),
              child: Container(
                alignment: Alignment.center,
                child: Container(
                  height: 2,
                  width: 10,
                  color: Colors.grey.shade300,
                ),
              ),
            ),
          );
        }),
      ),
    );
  }
}