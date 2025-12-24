import 'package:flutter/material.dart';

class CommonButton extends StatelessWidget {

  const CommonButton({
    super.key,
    required this.text,
    this.onPressed,
    this.style,
  });
  final String text;
  final VoidCallback? onPressed;
  final ButtonStyle? style;

  @override
  Widget build(BuildContext context) {
    return ElevatedButton(
      onPressed: onPressed,
      style: style,
      child: Text(text),
    );
  }
}