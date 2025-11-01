import 'package:flutter/material.dart';

class MessageBubble extends StatelessWidget {
  final String message;
  final bool isMe;

  const MessageBubble({super.key, required this.message, required this.isMe});

  @override
  Widget build(BuildContext context) {
    final messageAlignment = isMe ? MainAxisAlignment.end : MainAxisAlignment.start;

    return Row(
      mainAxisAlignment: messageAlignment,
      children: [
        Container(
          constraints: BoxConstraints(
            maxWidth: MediaQuery.of(context).size.width * 0.7, // Max width is 70% of screen
          ),
          decoration: BoxDecoration(
            color: isMe ? Colors.grey[300] : Colors.blue[200],
            borderRadius: BorderRadius.circular(12),
          ),
          padding: const EdgeInsets.symmetric(vertical: 10, horizontal: 16),
          margin: const EdgeInsets.symmetric(vertical: 4, horizontal: 8),
          child: Text(message, softWrap: true), // softWrap ensures text wraps
        ),
      ],
    );
  }
}