import 'package:flutter/material.dart';

class Tabs extends StatelessWidget {
  final List<String> labels;
  final int index;
  final ValueChanged<int> onChanged;
  const Tabs({super.key, required this.labels, required this.index, required this.onChanged});

  @override
  Widget build(BuildContext context) {
    return Row(children: [
      for (int i = 0; i < labels.length; i++)
        Padding(
          padding: const EdgeInsets.only(right: 8.0),
          child: ChoiceChip(
            label: Text(labels[i]),
            selected: index == i,
            onSelected: (_) => onChanged(i),
          ),
        )
    ]);
  }
}

