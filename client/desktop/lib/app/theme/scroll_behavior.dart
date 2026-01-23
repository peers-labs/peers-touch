import 'dart:ui';

import 'package:flutter/material.dart';

class DesktopScrollBehavior extends MaterialScrollBehavior {
  const DesktopScrollBehavior();

  @override
  Set<PointerDeviceKind> get dragDevices => {
        PointerDeviceKind.touch,
        PointerDeviceKind.mouse,
        PointerDeviceKind.stylus,
        PointerDeviceKind.trackpad,
      };
}
