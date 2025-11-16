import 'package:flutter/material.dart';
import 'package:get/get.dart';
import 'package:peers_touch_mobile/controller/controller.dart';

class ScrollToTopButton extends StatelessWidget {
  final String pageKey;
  
  const ScrollToTopButton({
    super.key,
    required this.pageKey,
  });

  @override
  Widget build(BuildContext context) {
    final scrollController = ControllerManager.scrollController;
    
    return Obx(() {
      final canScrollToTop = scrollController.canScrollToTopForPage(pageKey);
      
      return AnimatedOpacity(
        opacity: canScrollToTop ? 1.0 : 0.0,
        duration: const Duration(milliseconds: 300),
        child: canScrollToTop
            ? FloatingActionButton(
                mini: true,
                backgroundColor: Colors.grey[600],
                foregroundColor: Colors.white,
                onPressed: () => scrollController.scrollToTop(pageKey),
                child: const Icon(Icons.keyboard_arrow_up),
              )
            : const SizedBox.shrink(),
      );
    });
  }
}