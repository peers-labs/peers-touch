import 'package:flutter/material.dart';

class SearchInput extends StatelessWidget {
  final String? hintText;
  final ValueChanged<String>? onChanged;
  final TextEditingController? controller;
  final VoidCallback? onSubmitted;
  final Color? fillColor;
  final BorderRadius? borderRadius;

  const SearchInput({
    super.key,
    this.hintText,
    this.onChanged,
    this.controller,
    this.onSubmitted,
    this.fillColor,
    this.borderRadius,
  });

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return Container(
      height: 40,
      decoration: BoxDecoration(
        color: fillColor ?? theme.colorScheme.surface,
        borderRadius: borderRadius ?? BorderRadius.circular(8),
        border: Border.all(
          color: theme.colorScheme.outline.withOpacity(0.2),
          width: 1,
        ),
      ),
      child: TextField(
        controller: controller,
        onChanged: onChanged,
        onSubmitted: (_) => onSubmitted?.call(),
        textAlignVertical: TextAlignVertical.center,
        decoration: InputDecoration(
          hintText: hintText ?? 'Search',
          prefixIcon: Icon(
            Icons.search,
            size: 20,
            color: theme.colorScheme.onSurfaceVariant,
          ),
          border: InputBorder.none,
          contentPadding: const EdgeInsets.symmetric(horizontal: 8, vertical: 0), // Center vertically
          isDense: true,
          hintStyle: TextStyle(
            color: theme.colorScheme.onSurfaceVariant.withOpacity(0.6),
            fontSize: 14,
          ),
        ),
        style: const TextStyle(fontSize: 14),
      ),
    );
  }
}
