import 'package:flutter/material.dart';
import 'package:peers_touch_ui/src/widgets/peers_image.dart';

class Gallery extends StatelessWidget {
  const Gallery({super.key, required this.urls, this.crossAxisCount = 3, this.spacing = 8});
  final List<String> urls;
  final int crossAxisCount;
  final double spacing;

  @override
  Widget build(BuildContext context) {
    return GridView.builder(
      gridDelegate: SliverGridDelegateWithFixedCrossAxisCount(crossAxisCount: crossAxisCount, crossAxisSpacing: spacing, mainAxisSpacing: spacing),
      itemCount: urls.length,
      itemBuilder: (ctx, i) => PeersImage(src: urls[i], fit: BoxFit.cover),
    );
  }
}
