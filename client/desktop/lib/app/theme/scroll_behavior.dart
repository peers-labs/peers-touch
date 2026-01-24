import 'dart:ui';

import 'package:flutter/gestures.dart';
import 'package:flutter/material.dart';

class DesktopScrollBehavior extends MaterialScrollBehavior {
  const DesktopScrollBehavior();

  @override
  Set<PointerDeviceKind> get dragDevices => {
        PointerDeviceKind.touch,
        PointerDeviceKind.mouse,
        PointerDeviceKind.stylus,
        PointerDeviceKind.trackpad,
        PointerDeviceKind.invertedStylus,
      };

  @override
  ScrollPhysics getScrollPhysics(BuildContext context) {
    return const BouncingScrollPhysics();
  }

  @override
  Widget buildScrollbar(BuildContext context, Widget child, ScrollableDetails details) {
    return child;
  }

  @override
  MultitouchDragStrategy get multitouchDragStrategy => MultitouchDragStrategy.latestPointer;
}
