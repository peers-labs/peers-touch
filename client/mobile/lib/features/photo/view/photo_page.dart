import 'package:flutter/widgets.dart';
import 'package:peers_touch_mobile/pages/photo/photo_page.dart' as legacy_photo;

class PhotoPage extends StatelessWidget {
  const PhotoPage({super.key});

  static List<dynamic> get actionOptions => legacy_photo.PhotoPage.actionOptions;

  @override
  Widget build(BuildContext context) {
    return legacy_photo.PhotoPage();
  }
}