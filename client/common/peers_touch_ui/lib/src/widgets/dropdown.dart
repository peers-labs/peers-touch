import 'package:flutter/material.dart';

class Dropdown extends StatelessWidget {
  final String? label;
  final List<String> items;
  final String? value;
  final bool showLabel;
  final ValueChanged<String?> onChanged;
  const Dropdown({super.key, this.label, required this.items, required this.value, this.showLabel = true, required this.onChanged});

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        if (showLabel && label != null) ...[
          Text(label!, style: theme.textTheme.bodyLarge?.copyWith(fontWeight: FontWeight.w500)),
          const SizedBox(height: 8),
        ],
        Container(
          height: 48, // Fixed height to match standard input
          decoration: BoxDecoration(
            color: theme.colorScheme.surface,
            borderRadius: BorderRadius.circular(4),
            // border: Border.all(color: theme.colorScheme.outline), // User requested to remove border
          ),
          padding: const EdgeInsets.symmetric(horizontal: 12),
          child: DropdownButtonHideUnderline(
            child: DropdownButton<String>(
              isExpanded: true,
              value: value,
              items: items.map((e) => DropdownMenuItem(
                value: e, 
                child: Text(e, style: theme.textTheme.bodyMedium, overflow: TextOverflow.ellipsis)
              )).toList(),
              onChanged: onChanged,
              icon: Icon(Icons.arrow_drop_down, color: theme.colorScheme.onSurface),
              style: theme.textTheme.bodyMedium,
              isDense: true,
              dropdownColor: theme.colorScheme.surface,
              elevation: 2,
            ),
          ),
        ),
      ],
    );
  }
}

