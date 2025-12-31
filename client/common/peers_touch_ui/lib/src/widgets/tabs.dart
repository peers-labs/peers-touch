import 'package:flutter/material.dart';
import 'package:peers_touch_ui/src/widgets/chip.dart';

class Tabs extends StatelessWidget {
  const Tabs({super.key, required this.labels, required this.index, required this.onChanged});
  final List<String> labels;
  final int index;
  final ValueChanged<int> onChanged;

  @override
  Widget build(BuildContext context) {
    return SingleChildScrollView(
      scrollDirection: Axis.horizontal,
      child: Row(children: [
        for (int i = 0; i < labels.length; i++)
          Padding(
            padding: const EdgeInsets.only(right: 8.0),
            child: PTChip(
              text: labels[i],
              filled: index == i,
              onTap: () => onChanged(i),
            ),
          )
      ]),
    );
  }
}

