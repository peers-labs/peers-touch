import 'package:flutter/material.dart';

class NumberInput extends StatelessWidget {
  const NumberInput({super.key, required this.label, required this.value, required this.onChanged});
  final String label;
  final num value;
  final ValueChanged<num> onChanged;

  @override
  Widget build(BuildContext context) {
    final controller = TextEditingController(text: value.toString());
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text(label),
        const SizedBox(height: 8),
        TextField(
          controller: controller,
          keyboardType: const TextInputType.numberWithOptions(decimal: true),
          onChanged: (s) {
            final v = num.tryParse(s);
            if (v != null) onChanged(v);
          },
          decoration: const InputDecoration(border: OutlineInputBorder()),
        ),
      ],
    );
  }
}

