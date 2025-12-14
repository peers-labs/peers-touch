import 'package:flutter/material.dart';
import 'dart:ui';

class RefreshableList extends StatelessWidget {
  final Future<void> Function() onRefresh;
  final Widget child;

  const RefreshableList({
    Key? key,
    required this.onRefresh,
    required this.child,
  }) : super(key: key);

  @override
  Widget build(BuildContext context) {
    return RefreshIndicator(
      onRefresh: onRefresh,
      child: ScrollConfiguration(
        behavior: ScrollConfiguration.of(context).copyWith(
          dragDevices: {
            PointerDeviceKind.touch,
            PointerDeviceKind.mouse,
          },
        ),
        child: child,
      ),
    );
  }
}
