import 'package:flutter/material.dart';

class CheckBox extends StatelessWidget {
  const CheckBox({super.key, required this.label, required this.value, required this.onChanged});
  final String label;
  final bool value;
  final ValueChanged<bool?> onChanged;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return Row(
      children: [
        Expanded(child: Text(label, style: theme.textTheme.bodyMedium)),
        Checkbox(value: value, onChanged: onChanged),
      ],
    );
  }
}

