import 'package:flutter/material.dart';

class BrandBar extends StatelessWidget {
  const BrandBar({super.key, this.leading, required this.title, this.actions = const []});
  final Widget? leading;
  final List<Widget> actions;
  final String title;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 12),
      color: Colors.white,
      child: Row(children: [if (leading != null) leading!, const SizedBox(width: 12), Text(title, style: const TextStyle(fontSize: 20, fontWeight: FontWeight.w700)), const Spacer(), ...actions]),
    );
  }
}

