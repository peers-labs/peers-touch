import 'package:flutter/material.dart';

class FloatingActionOption {
  final IconData icon;
  final String label;
  final VoidCallback? onTap;

  const FloatingActionOption({
    required this.icon,
    required this.label,
    this.onTap,
  });
}

class FloatingActionBall extends StatefulWidget {
  final List<FloatingActionOption> options;
  final Color backgroundColor;
  final Color iconColor;
  final double size;
  final double expandedSize;
  final double spacing;

  const FloatingActionBall({
    Key? key,
    required this.options,
    this.backgroundColor = Colors.blue,
    this.iconColor = Colors.white,
    this.size = 56.0,
    this.expandedSize = 48.0,
    this.spacing = 10.0,
  }) : super(key: key);

  @override
  State<FloatingActionBall> createState() => _FloatingActionBallState();
}

class _FloatingActionBallState extends State<FloatingActionBall>
    with SingleTickerProviderStateMixin {
  bool _isExpanded = false;
  late AnimationController _animationController;
  late Animation<double> _expandAnimation;

  @override
  void initState() {
    super.initState();
    _animationController = AnimationController(
      vsync: this,
      duration: const Duration(milliseconds: 250),
    );
    _expandAnimation = CurvedAnimation(
      parent: _animationController,
      curve: Curves.easeInOut,
    );
  }

  @override
  void dispose() {
    _animationController.dispose();
    super.dispose();
  }

  void _toggleExpanded() {
    setState(() {
      _isExpanded = !_isExpanded;
      if (_isExpanded) {
        _animationController.forward();
      } else {
        _animationController.reverse();
      }
    });
  }

  @override
  Widget build(BuildContext context) {
    return Column(
      mainAxisSize: MainAxisSize.min,
      children: [
        // 选项列表
        AnimatedSwitcher(
          duration: const Duration(milliseconds: 200),
          transitionBuilder: (Widget child, Animation<double> animation) {
            return ScaleTransition(
              scale: animation,
              child: FadeTransition(opacity: animation, child: child),
            );
          },
          child: _isExpanded
              ? Column(
                  key: const ValueKey('options'),
                  mainAxisSize: MainAxisSize.min,
                  children: widget.options.map((option) {
                    return Padding(
                      padding: EdgeInsets.only(bottom: widget.spacing),
                      child: FloatingActionButton.small(
                        heroTag: option.label,
                        backgroundColor: widget.backgroundColor,
                        foregroundColor: widget.iconColor,
                        onPressed: () {
                          _toggleExpanded();
                          option.onTap?.call();
                        },
                        child: Column(
                          mainAxisAlignment: MainAxisAlignment.center,
                          children: [
                            Icon(option.icon, size: 20),
                            const SizedBox(height: 2),
                            Text(
                              option.label,
                              style: const TextStyle(fontSize: 8),
                              textAlign: TextAlign.center,
                            ),
                          ],
                        ),
                      ),
                    );
                  }).toList(),
                )
              : const SizedBox.shrink(),
        ),
        // 主按钮
        FloatingActionButton(
          backgroundColor: widget.backgroundColor,
          foregroundColor: widget.iconColor,
          onPressed: _toggleExpanded,
          child: AnimatedIcon(
            icon: AnimatedIcons.menu_close,
            progress: _expandAnimation,
          ),
        ),
      ],
    );
  }
}