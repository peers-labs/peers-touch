import 'package:flutter/material.dart';

class ImageView extends StatelessWidget {
  const ImageView({super.key, this.url, this.width, this.height});
  final String? url;
  final double? width;
  final double? height;

  @override
  Widget build(BuildContext context) {
    if (url == null || url!.isEmpty) {
      return const SizedBox.shrink();
    }
    return Image.network(url!, width: width, height: height, fit: BoxFit.cover);
  }
}

