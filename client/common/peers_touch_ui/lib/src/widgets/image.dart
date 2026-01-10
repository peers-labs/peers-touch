import 'package:flutter/material.dart';
import 'package:peers_touch_ui/src/widgets/peers_image.dart';

class ImageView extends StatelessWidget {
  const ImageView({super.key, this.url, this.width, this.height});
  final String? url;
  final double? width;
  final double? height;

  @override
  Widget build(BuildContext context) {
    return PeersImage(
      src: url,
      width: width,
      height: height,
      placeholder: const SizedBox.shrink(),
      error: const SizedBox.shrink(),
    );
  }
}
