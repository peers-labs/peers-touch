import 'package:flutter/material.dart';

class IconSidebar extends StatelessWidget {
  final List<IconData> icons;
  final int index;
  final ValueChanged<int> onChanged;
  const IconSidebar({super.key, required this.icons, required this.index, required this.onChanged});

  @override
  Widget build(BuildContext context) {
    return Container(
      width: 64,
      color: Colors.white,
      child: Column(
        children: [
          const SizedBox(height: 12),
          for (int i = 0; i < icons.length; i++)
            Padding(
              padding: const EdgeInsets.symmetric(vertical: 8.0),
              child: InkResponse(
                onTap: () => onChanged(i),
                child: Icon(icons[i], color: index == i ? Colors.black : Colors.black38),
              ),
            ),
          const Spacer(),
          const Icon(Icons.chevron_right, color: Colors.black38),
          const SizedBox(height: 12),
        ],
      ),
    );
  }
}

