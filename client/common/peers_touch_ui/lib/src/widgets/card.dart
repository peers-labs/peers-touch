import 'package:flutter/material.dart';

class PTCard extends StatelessWidget {
  final Widget? header;
  final Widget child;
  final EdgeInsetsGeometry padding;
  final Color? background;
  const PTCard({super.key, this.header, required this.child, this.padding = const EdgeInsets.all(16), this.background});

  @override
  Widget build(BuildContext context) {
    final bg = background ?? Theme.of(context).colorScheme.surface;
    return Container(
      decoration: BoxDecoration(color: bg, borderRadius: BorderRadius.circular(16), boxShadow: [BoxShadow(color: Colors.black.withOpacity(0.05), blurRadius: 12, offset: const Offset(0, 6))]),
      child: Padding(
        padding: padding,
        child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [if (header != null) header!, child]),
      ),
    );
  }
}

