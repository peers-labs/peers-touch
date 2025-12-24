
import 'package:flutter/material.dart';
import 'package:get/get.dart';

class AppletDockController extends GetxController with GetSingleTickerProviderStateMixin {
  late AnimationController breathingController;
  late Animation<double> breathingAnimation;
  final RxBool isHovering = false.obs;

  @override
  void onInit() {
    super.onInit();
    breathingController = AnimationController(
      vsync: this,
      duration: const Duration(seconds: 2),
    );
    breathingAnimation = Tween<double>(begin: 0.1, end: 1.0).animate(
      CurvedAnimation(parent: breathingController, curve: Curves.easeInOut),
    );
    breathingController.addStatusListener((status) {
      if (status == AnimationStatus.completed) {
        breathingController.reverse();
      } else if (status == AnimationStatus.dismissed) {
        breathingController.forward();
      }
    });
  }

  @override
  void onClose() {
    breathingController.dispose();
    super.onClose();
  }

  void onHover(bool hovering) {
    isHovering.value = hovering;
    if (hovering) {
      breathingController.forward();
    } else {
      breathingController.stop();
      breathingController.reset();
    }
  }
}
