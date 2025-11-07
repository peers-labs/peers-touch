import 'package:flutter/widgets.dart';
import 'package:peers_touch_mobile/pages/me/me_home.dart' as legacy_me;

class ProfilePage extends StatelessWidget {
  const ProfilePage({super.key});

  static List<dynamic> get actionOptions => legacy_me.MeHomePage.actionOptions;

  @override
  Widget build(BuildContext context) {
    return legacy_me.MeHomePage();
  }
}