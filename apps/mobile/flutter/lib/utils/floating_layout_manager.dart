import 'package:flutter/material.dart';
import 'package:peers_touch_mobile/components/common/floating_action_ball.dart';
import 'package:peers_touch_mobile/components/scroll_to_top_button.dart';

/// Manages the positioning of floating UI elements to ensure proper alignment
/// and spacing regardless of FloatingActionBall state and options count.
class FloatingLayoutManager {
  // Relative positioning constants
  static const double _bottomPercentage = 0.10; // 10% from bottom
  static const double _rightMargin = 20.0;
  static const double _buttonSpacing = 10.0; // Small spacing between buttons
  
  // FloatingActionBall dimensions
  static const double _fabHeight = 56.0;
  
  /// Calculates the bottom position for FloatingActionBall based on screen height
  /// Positions it above the ScrollToTopButton
  static double getFloatingActionBallBottom(BuildContext context) {
    final screenHeight = MediaQuery.of(context).size.height;
    final baseBottom = screenHeight * _bottomPercentage;
    
    // Position floating action ball above the scroll button
    return baseBottom + _fabHeight + _buttonSpacing;
  }
  
  /// Calculates the right position for FloatingActionBall
  static double getFloatingActionBallRight() {
    return _rightMargin;
  }
  
  /// Calculates the bottom position for ScrollToTopButton
  /// Positions it below the FloatingActionBall
  static double getScrollToTopButtonBottom(BuildContext context, {
    required bool hasFloatingOptions,
    required int optionsCount,
  }) {
    final screenHeight = MediaQuery.of(context).size.height;
    final baseBottom = screenHeight * _bottomPercentage;
    
    if (!hasFloatingOptions) {
      // No floating action ball, position at base level
      return baseBottom;
    }
    
    // Position scroll button below the floating action ball
    return baseBottom;
  }
  
  /// Calculates the right position for ScrollToTopButton
  static double getScrollToTopButtonRight() {
    return _rightMargin;
  }
  
  /// Creates a positioned FloatingActionBall widget
  static Widget positionedFloatingActionBall({
    required BuildContext context,
    required Key? key,
    required List<FloatingActionOption> options,
    GlobalKey? globalKey,
  }) {
    return Positioned(
      bottom: getFloatingActionBallBottom(context),
      right: getFloatingActionBallRight(),
      child: GestureDetector(
        onTap: () {}, // Absorb taps to prevent triggering outside tap handler
        child: FloatingActionBall(
          key: globalKey ?? key,
          options: options,
        ),
      ),
    );
  }
  
  /// Creates a positioned ScrollToTopButton widget
  static Widget positionedScrollToTopButton({
    required BuildContext context,
    required String pageKey,
    required bool hasFloatingOptions,
    required int optionsCount,
  }) {
    return Positioned(
      bottom: getScrollToTopButtonBottom(
        context,
        hasFloatingOptions: hasFloatingOptions,
        optionsCount: optionsCount,
      ),
      right: getScrollToTopButtonRight(),
      child: ScrollToTopButton(
        pageKey: pageKey,
      ),
    );
  }
}