import 'package:flutter/material.dart';
import 'package:peers_touch_ui/peers_touch_ui.dart';

void main() {
  runApp(const PeersTouchUIShowcase());
}

class PeersTouchUIShowcase extends StatelessWidget {
  const PeersTouchUIShowcase({super.key});

  @override
  Widget build(BuildContext context) {
    return DesktopShowcasePage();
  }
}
