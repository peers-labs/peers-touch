import 'package:flutter/material.dart';

class SliderField extends StatelessWidget {
  const SliderField({super.key, required this.label, required this.value, required this.min, required this.max, required this.onChanged});
  final String label;
  final double value;
  final double min;
  final double max;
  final ValueChanged<double> onChanged;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text('$label: ${value.toStringAsFixed(2)}', style: theme.textTheme.bodyMedium),
        Slider(value: value, min: min, max: max, onChanged: onChanged),
      ],
    );
  }
}

