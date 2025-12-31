import 'package:flutter/material.dart';

class PrimaryButton extends StatelessWidget {
  const PrimaryButton({super.key, required this.text, required this.onPressed, this.loading = false, this.fullWidth = false, this.padding = const EdgeInsets.symmetric(vertical: 12)});
  final String text;
  final VoidCallback onPressed;
  final bool loading;
  final bool fullWidth;
  final EdgeInsetsGeometry padding;

  @override
  Widget build(BuildContext context) {
    final btn = ElevatedButton(
      style: ElevatedButton.styleFrom(
        minimumSize: fullWidth ? const Size.fromHeight(44) : null,
        padding: padding,
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(10)),
      ),
      onPressed: loading ? null : onPressed,
      child: loading
          ? const SizedBox(width: 16, height: 16, child: CircularProgressIndicator(strokeWidth: 2))
          : Text(text, style: const TextStyle(fontWeight: FontWeight.w600)),
    );
    return fullWidth ? SizedBox(width: double.infinity, child: btn) : btn;
  }
}

class SecondaryButton extends StatelessWidget {
  const SecondaryButton({super.key, required this.text, required this.onPressed, this.fullWidth = false, this.padding = const EdgeInsets.symmetric(vertical: 12)});
  final String text;
  final VoidCallback onPressed;
  final bool fullWidth;
  final EdgeInsetsGeometry padding;

  @override
  Widget build(BuildContext context) {
    final btn = OutlinedButton(
      style: OutlinedButton.styleFrom(
        minimumSize: fullWidth ? const Size.fromHeight(44) : null,
        padding: padding,
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(10)),
      ),
      onPressed: onPressed,
      child: Text(text, style: const TextStyle(fontWeight: FontWeight.w600)),
    );
    return fullWidth ? SizedBox(width: double.infinity, child: btn) : btn;
  }
}
