import 'package:flutter/material.dart';

class PTChip extends StatelessWidget {
  final String text;
  final bool filled;
  final VoidCallback? onTap;
  const PTChip({super.key, required this.text, this.filled = false, this.onTap});

  @override
  Widget build(BuildContext context) {
    final bg = filled ? Colors.black : Colors.transparent;
    final fg = filled ? Colors.white : Colors.black;
    return InkWell(
      onTap: onTap,
      borderRadius: BorderRadius.circular(16),
      child: Container(
        padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
        decoration: BoxDecoration(color: bg, borderRadius: BorderRadius.circular(16), border: Border.all(color: Colors.black12)),
        child: Text(text, style: TextStyle(color: fg)),
      ),
    );
  }
}

