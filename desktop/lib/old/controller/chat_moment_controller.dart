import 'package:flutter/material.dart';
import 'package:get/get.dart';

class ChatMomentController extends GetxController {
  late final ScrollController scrollController;

  @override
  void onInit() {
    super.onInit();
    scrollController = ScrollController();
  }

  @override
  void onClose() {
    scrollController.dispose();
    super.onClose();
  }
}