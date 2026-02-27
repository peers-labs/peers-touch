import 'package:flutter/material.dart';
import 'package:peers_touch_ui/peers_touch_ui.dart';

void main() {
  runApp(const PeersTouchUIShowcase());
}

class PeersTouchUIShowcase extends StatelessWidget {
  const PeersTouchUIShowcase({super.key});

  @override
  Widget build(BuildContext context) {
    return MaterialApp(
      title: 'Peers Touch UI Demo',
      theme: ThemeData(
        colorScheme: ColorScheme.fromSeed(seedColor: AppColors.primary),
        useMaterial3: true,
      ),
      home: const EmojiPickerDemo(),
    );
  }
}

class EmojiPickerDemo extends StatefulWidget {
  const EmojiPickerDemo({super.key});

  @override
  State<EmojiPickerDemo> createState() => _EmojiPickerDemoState();
}

class _EmojiPickerDemoState extends State<EmojiPickerDemo> {
  final TextEditingController _textController = TextEditingController();
  final List<String> _recentEmojis = ['😀', '😂', '❤️', '👍', '🎉'];
  bool _showEmojiPicker = false;

  @override
  void dispose() {
    _textController.dispose();
    super.dispose();
  }

  void _toggleEmojiPicker() {
    setState(() {
      _showEmojiPicker = !_showEmojiPicker;
    });
  }

  void _insertEmoji(String emoji) {
    final text = _textController.text;
    final selection = _textController.selection;
    final newText = text.replaceRange(
      selection.start,
      selection.end,
      emoji,
    );
    _textController.value = _textController.value.copyWith(
      text: newText,
      selection: TextSelection.collapsed(
        offset: selection.start + emoji.length,
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: const Text('Emoji Picker Demo'),
      ),
      body: Column(
        children: [
          Expanded(
            child: Center(
              child: Padding(
                padding: const EdgeInsets.all(16.0),
                child: TextField(
                  controller: _textController,
                  decoration: const InputDecoration(
                    border: OutlineInputBorder(),
                    labelText: '输入内容...',
                  ),
                  maxLines: null,
                ),
              ),
            ),
          ),
          Container(
            padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 8),
            child: Row(
              children: [
                IconButton(
                  icon: const Icon(Icons.emoji_emotions),
                  onPressed: _toggleEmojiPicker,
                ),
                const SizedBox(width: 8),
                Expanded(
                  child: FilledButton(
                    onPressed: () {
                      ScaffoldMessenger.of(context).showSnackBar(
                        SnackBar(content: Text('发送: ${_textController.text}')),
                      );
                    },
                    child: const Text('发送'),
                  ),
                ),
              ],
            ),
          ),
          AnimatedSize(
            duration: const Duration(milliseconds: 200),
            curve: Curves.easeInOut,
            child: _showEmojiPicker
                ? EmojiPickerPanel(
                    onEmojiSelected: _insertEmoji,
                    textController: _textController,
                    recentEmojis: _recentEmojis,
                  )
                : const SizedBox.shrink(),
          ),
        ],
      ),
    );
  }
}
