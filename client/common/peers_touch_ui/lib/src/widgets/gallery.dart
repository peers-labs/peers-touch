import 'package:flutter/material.dart';

class Gallery extends StatelessWidget {
  final List<String> urls;
  final int crossAxisCount;
  final double spacing;
  const Gallery({super.key, required this.urls, this.crossAxisCount = 3, this.spacing = 8});

  @override
  Widget build(BuildContext context) {
    return GridView.builder(
      gridDelegate: SliverGridDelegateWithFixedCrossAxisCount(crossAxisCount: crossAxisCount, crossAxisSpacing: spacing, mainAxisSpacing: spacing),
      itemCount: urls.length,
      itemBuilder: (ctx, i) => Image.network(urls[i], fit: BoxFit.cover),
    );
  }
}

