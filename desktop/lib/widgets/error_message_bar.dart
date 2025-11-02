import 'package:flutter/material.dart';

class ErrorMessageBar extends StatelessWidget {
  final String message;
  final VoidCallback? onRetry;
  final VoidCallback? onClose;
  final bool showRetry;
  final bool showClose;

  const ErrorMessageBar({
    super.key,
    required this.message,
    this.onRetry,
    this.onClose,
    this.showRetry = true,
    this.showClose = true,
  });

  @override
  Widget build(BuildContext context) {
    return Container(
      width: double.infinity,
      padding: const EdgeInsets.symmetric(horizontal: 16.0, vertical: 12.0),
      decoration: BoxDecoration(
        color: Colors.red.shade50,
        border: Border(
          top: BorderSide(color: Colors.red.shade200, width: 1.0),
        ),
      ),
      child: Row(
        children: [
          Icon(
            Icons.error_outline,
            color: Colors.red.shade600,
            size: 20,
          ),
          const SizedBox(width: 12),
          Expanded(
            child: Text(
              message,
              style: TextStyle(
                color: Colors.red.shade800,
                fontSize: 14,
              ),
            ),
          ),
          const SizedBox(width: 12),
          Row(
            mainAxisSize: MainAxisSize.min,
            children: [
              if (showRetry && onRetry != null) ...[
                TextButton.icon(
                  onPressed: onRetry,
                  icon: Icon(
                    Icons.refresh,
                    size: 16,
                    color: Colors.red.shade700,
                  ),
                  label: Text(
                    'Retry',
                    style: TextStyle(
                      color: Colors.red.shade700,
                      fontSize: 12,
                    ),
                  ),
                  style: TextButton.styleFrom(
                    padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
                    minimumSize: Size.zero,
                    tapTargetSize: MaterialTapTargetSize.shrinkWrap,
                  ),
                ),
                const SizedBox(width: 8),
              ],
              if (showClose && onClose != null)
                IconButton(
                  onPressed: onClose,
                  icon: Icon(
                    Icons.close,
                    size: 16,
                    color: Colors.red.shade700,
                  ),
                  padding: const EdgeInsets.all(4),
                  constraints: const BoxConstraints(
                    minWidth: 24,
                    minHeight: 24,
                  ),
                  tooltip: 'Close',
                ),
            ],
          ),
        ],
      ),
    );
  }
}