import 'package:flutter/material.dart';

class PasswordBox extends StatefulWidget {
  final String label;
  final String value;
  final String? description;
  final String? placeholder;
  final bool showLabel;
  final ValueChanged<String> onChanged;
  const PasswordBox({
    super.key, 
    required this.label, 
    required this.value, 
    this.description, 
    this.placeholder, 
    this.showLabel = true,
    required this.onChanged
  });

  @override
  State<PasswordBox> createState() => _PasswordBoxState();
}

class _PasswordBoxState extends State<PasswordBox> {
  late TextEditingController _controller;
  bool _obscure = true;

  @override
  void initState() {
    super.initState();
    _controller = TextEditingController(text: widget.value);
  }

  @override
  void didUpdateWidget(covariant PasswordBox oldWidget) {
    super.didUpdateWidget(oldWidget);
    final composing = _controller.value.composing;
    if (!composing.isValid && _controller.text != widget.value) {
      _controller.value = TextEditingValue(
        text: widget.value,
        selection: TextSelection.collapsed(offset: widget.value.length),
      );
    }
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        if (widget.showLabel)
          Row(
            children: [
              Text(widget.label, style: theme.textTheme.bodyLarge?.copyWith(fontWeight: FontWeight.w500)),
              const Spacer(),
              // Move visibility toggle to inside field if label is hidden? 
              // Actually keeping it here might be weird if label is hidden.
              // But let's follow showLabel logic.
              if (widget.showLabel)
                IconButton(
                  icon: Icon(_obscure ? Icons.visibility_off : Icons.visibility, size: 18),
                  onPressed: () => setState(() => _obscure = !_obscure),
                  tooltip: _obscure ? 'Show' : 'Hide',
                )
            ],
          ),
        if (widget.description != null) ...[
          const SizedBox(height: 4),
          Text(widget.description!, style: theme.textTheme.bodySmall?.copyWith(color: theme.colorScheme.onSurface.withOpacity(0.6))),
        ],
        const SizedBox(height: 8),
        TextField(
          controller: _controller,
          obscureText: _obscure,
          enableSuggestions: false,
          autocorrect: false,
          textInputAction: TextInputAction.done,
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
            suffixIcon: !widget.showLabel ? IconButton(
               icon: Icon(_obscure ? Icons.visibility_off : Icons.visibility, size: 20),
               onPressed: () => setState(() => _obscure = !_obscure),
            ) : null,
          ),
        ),
      ],
    );
  }
}
