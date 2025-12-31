import 'package:flutter/material.dart';
import 'package:flutter/services.dart';

class TextBox extends StatefulWidget {

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
    this.controller,
    this.focusNode,
  });
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
  final TextEditingController? controller;
  final FocusNode? focusNode;

  @override
  State<TextBox> createState() => _TextBoxState();
}

class _TextBoxState extends State<TextBox> {
  TextEditingController? _internalController;

  TextEditingController get _controller => widget.controller ?? _internalController!;

  @override
  void initState() {
    super.initState();
    if (widget.controller == null) {
      _internalController = TextEditingController(text: widget.value);
    }
  }

  @override
  void didUpdateWidget(covariant TextBox oldWidget) {
    super.didUpdateWidget(oldWidget);
    
    // Handle controller ownership changes
    if (widget.controller != null && _internalController != null) {
      _internalController!.dispose();
      _internalController = null;
    } else if (widget.controller == null && _internalController == null) {
      _internalController = TextEditingController(text: widget.value);
    }

    // Sync value to internal controller if needed
    if (_internalController != null && _internalController!.text != widget.value) {
      // Only update if the value is different.
      // Note: This resets selection to the end. 
      // This is acceptable for programmatic updates but can be jarring if
      // the parent updates 'value' asynchronously while typing.
      _internalController!.value = TextEditingValue(
        text: widget.value,
        selection: TextSelection.collapsed(offset: widget.value.length),
      );
    }
  }

  @override
  void dispose() {
    _internalController?.dispose();
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
          Text(widget.description!, style: theme.textTheme.bodySmall?.copyWith(color: theme.colorScheme.onSurface.withValues(alpha: 0.6))),
        ],
        if (widget.showLabel || widget.description != null)
          const SizedBox(height: 8),
        TextField(
          controller: _controller,
          focusNode: widget.focusNode,
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
            contentPadding: const EdgeInsets.symmetric(horizontal: 12, vertical: 12),
            border: OutlineInputBorder(
              borderRadius: BorderRadius.circular(8),
              borderSide: BorderSide(color: theme.colorScheme.outline.withValues(alpha: 0.3)),
            ),
            enabledBorder: OutlineInputBorder(
              borderRadius: BorderRadius.circular(8),
              borderSide: BorderSide(color: theme.colorScheme.outline.withValues(alpha: 0.3)),
            ),
            focusedBorder: OutlineInputBorder(
              borderRadius: BorderRadius.circular(8),
              borderSide: BorderSide(color: theme.colorScheme.primary, width: 2),
            ),
          ),
        ),
      ],
    );
  }
}
