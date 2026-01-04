import 'package:flutter/material.dart';

class QuickAction {
  const QuickAction({
    required this.id,
    required this.label,
    required this.icon,
    required this.onTap,
    this.route,
    this.color,
    this.isPinned = false,
  });

  final String id;
  final String label;
  final IconData icon;
  final VoidCallback onTap;
  final String? route;
  final Color? color;
  final bool isPinned;
}
