import 'package:flutter/material.dart';
import 'package:get/get.dart';
import 'package:peers_touch_desktop/app/theme/ui_kit.dart';

class LoadingDialog {
  static void show([String message = 'Loading...']) {
    if (Get.isDialogOpen == true) return;
    Get.dialog(
      Center(
        child: Card(
          child: Padding(
            padding: EdgeInsets.all(UIKit.spaceLg(Get.context!)),
            child: Row(
              mainAxisSize: MainAxisSize.min,
              children: [
                SizedBox(
                  width: UIKit.indicatorSizeSm,
                  height: UIKit.indicatorSizeSm,
                  child: const CircularProgressIndicator(),
                ),
                SizedBox(width: UIKit.spaceMd(Get.context!)),
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