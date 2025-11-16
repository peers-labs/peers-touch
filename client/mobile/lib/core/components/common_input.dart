import 'package:flutter/material.dart';
import 'package:peers_touch_mobile/app/theme/app_styles.dart';

class CommonInput extends StatelessWidget {
  final TextEditingController? controller;
  final String? hintText;
  final bool obscureText;
  final TextInputType keyboardType;
  final ValueChanged<String>? onChanged;

  const CommonInput({
    super.key,
    this.controller,
    this.hintText,
    this.obscureText = false,
    this.keyboardType = TextInputType.text,
    this.onChanged,
  });

  @override
  Widget build(BuildContext context) {
    return TextField(
      controller: controller,
      obscureText: obscureText,
      keyboardType: keyboardType,
      onChanged: onChanged,
      decoration: InputDecoration(
        contentPadding: const EdgeInsets.symmetric(
          horizontal: AppStyles.spaceLg,
          vertical: AppStyles.spaceSm,
        ),
        border: const OutlineInputBorder(borderRadius: AppStyles.radiusMd),
        hintText: hintText,
      ),
    );
  }
}