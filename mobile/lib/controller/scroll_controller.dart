import 'package:flutter/material.dart';
import 'package:get/get.dart';

class AppScrollController extends GetxController {
  final Map<String, ScrollController> _scrollControllers = {};
  final RxMap<String, bool> canScrollToTop = <String, bool>{}.obs;
  
  ScrollController getScrollController(String pageKey) {
    if (!_scrollControllers.containsKey(pageKey)) {
      final controller = ScrollController();
      _scrollControllers[pageKey] = controller;
      
      // Defer reactive state changes to avoid build-time setState errors
      WidgetsBinding.instance.addPostFrameCallback((_) {
        canScrollToTop[pageKey] = false;
      });
      
      // Add scroll listener to track scroll position
      controller.addListener(() {
        final canScroll = controller.hasClients && controller.offset > 100;
        if (canScrollToTop[pageKey] != canScroll) {
          canScrollToTop[pageKey] = canScroll;
        }
      });
    }
    return _scrollControllers[pageKey]!;
  }
  
  void scrollToTop(String pageKey) {
    final controller = _scrollControllers[pageKey];
    if (controller != null && controller.hasClients) {
      controller.animateTo(
        0,
        duration: const Duration(milliseconds: 500),
        curve: Curves.easeInOut,
      );
    }
  }
  
  bool canScrollToTopForPage(String pageKey) {
    return canScrollToTop[pageKey] ?? false;
  }
  
  @override
  void onClose() {
    // Dispose all scroll controllers
    for (final controller in _scrollControllers.values) {
      controller.dispose();
    }
    _scrollControllers.clear();
    super.onClose();
  }
}