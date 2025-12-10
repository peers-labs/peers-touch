import 'package:flutter/material.dart';
import 'package:flutter/services.dart';

class TextBox extends StatefulWidget {
  final String label;
  final String value;
  final int? maxLines;
  final int? minLines;
  final bool showCopyButton;
  final TextInputType? keyboardType;
  final String? description;
  final String? placeholder;
  final bool showLabel;
  final ValueChanged<String> onChanged;

  const TextBox({
    super.key,
    required this.label,
    required this.value,
    this.maxLines = 1,
    this.minLines,
    this.showCopyButton = true,
    this.keyboardType,
    this.description,
    this.placeholder,
    this.showLabel = true,
    required this.onChanged,
  });

  @override
  State<TextBox> createState() => _TextBoxState();
}

class _TextBoxState extends State<TextBox> {
  late final TextEditingController _controller;

  @override
  void initState() {
    super.initState();
    _controller = TextEditingController(text: widget.value);
  }

  @override
  void didUpdateWidget(covariant TextBox oldWidget) {
    super.didUpdateWidget(oldWidget);
    final composing = _controller.value.composing;
    if (!composing.isValid && _controller.text != widget.value) {
      final selectionEnd = widget.value.length;
      _controller.value = TextEditingValue(
        text: widget.value,
        selection: TextSelection.collapsed(offset: selectionEnd),
      );
    }
  }

  @override
  void dispose() {
    _controller.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        if (widget.showLabel)
        Row(
          mainAxisAlignment: MainAxisAlignment.spaceBetween,
          children: [
            Text(widget.label, style: theme.textTheme.bodyLarge?.copyWith(fontWeight: FontWeight.w500)),
            if (widget.showCopyButton)
              IconButton(
                icon: const Icon(Icons.content_copy, size: 16),
                onPressed: () {
                  Clipboard.setData(ClipboardData(text: _controller.text));
                  ScaffoldMessenger.of(context).showSnackBar(const SnackBar(content: Text('Copied to clipboard')));
                },
              ),
          ],
        ),
        if (widget.description != null) ...[
          const SizedBox(height: 4),
          Text(widget.description!, style: theme.textTheme.bodySmall?.copyWith(color: theme.colorScheme.onSurface.withOpacity(0.6))),
        ],
        if (widget.showLabel || widget.description != null)
          const SizedBox(height: 8),
        TextField(
          controller: _controller,
          maxLines: widget.maxLines,
          minLines: widget.minLines,
          keyboardType: widget.keyboardType,
          enableSuggestions: true,
          autocorrect: true,
          onChanged: widget.onChanged,
          decoration: InputDecoration(
            hintText: widget.placeholder,
            filled: true,
            fillColor: theme.colorScheme.surface,
            isDense: true,
            contentPadding: const EdgeInsets.symmetric(horizontal: 12, vertical: 14),
            border: OutlineInputBorder(
              borderRadius: BorderRadius.circular(8),
              borderSide: BorderSide(color: theme.colorScheme.outline.withOpacity(0.3)),
            ),
            enabledBorder: OutlineInputBorder(
              borderRadius: BorderRadius.circular(8),
              borderSide: BorderSide(color: theme.colorScheme.outline.withOpacity(0.3)),
            ),
            focusedBorder: OutlineInputBorder(
              borderRadius: BorderRadius.circular(8),
              borderSide: BorderSide(color: theme.colorScheme.primary, width: 2),
            ),
          ),
          style: theme.textTheme.bodyMedium,
        ),
      ],
    );
  }
}
