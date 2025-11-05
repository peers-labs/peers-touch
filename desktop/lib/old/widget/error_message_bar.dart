import 'package:flutter/material.dart';

class ErrorMessageBar extends StatelessWidget {
  final String message;
  final VoidCallback? onRetry;
  final VoidCallback? onClose;
  final bool showRetry;
  final bool showClose;
  final bool isRetryable; // 新增参数：是否可重试

  const ErrorMessageBar({
    super.key,
    required this.message,
    this.onRetry,
    this.onClose,
    this.showRetry = true,
    this.showClose = true,
    this.isRetryable = true, // 默认为可重试
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
            child: SelectableText(
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
              if (showRetry && onRetry != null && isRetryable) ...[
                IconButton(
                  onPressed: onRetry,
                  icon: Icon(
                    Icons.refresh,
                    size: 16,
                    color: Colors.red.shade700,
                  ),
                  padding: const EdgeInsets.all(4),
                  constraints: const BoxConstraints(
                    minWidth: 24,
                    minHeight: 24,
                  ),
                  tooltip: 'Retry',
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