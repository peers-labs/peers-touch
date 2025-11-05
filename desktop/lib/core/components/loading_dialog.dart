import 'package:flutter/material.dart';
import 'package:get/get.dart';

class LoadingDialog {
  static void show([String message = 'Loading...']) {
    if (Get.isDialogOpen == true) return;
    Get.dialog(
      Center(
        child: Card(
          child: Padding(
            padding: const EdgeInsets.all(16),
            child: Row(
              mainAxisSize: MainAxisSize.min,
              children: [
                const SizedBox(
                  width: 24,
                  height: 24,
                  child: CircularProgressIndicator(),
                ),
                const SizedBox(width: 12),
                Text(message),
              ],
            ),
          ),
        ),
      ),
      barrierDismissible: false,
    );
  }

  static void hide() {
    if (Get.isDialogOpen == true) Get.back();
  }
}