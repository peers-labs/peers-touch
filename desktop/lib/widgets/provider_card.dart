import 'package:desktop/models/ai_provider.dart';
import 'package:flutter/material.dart';

class ProviderCard extends StatelessWidget {
  final AIProvider provider;
  final ValueChanged<bool> onEnabledChanged;

  const ProviderCard({
    super.key,
    required this.provider,
    required this.onEnabledChanged,
  });

  @override
  Widget build(BuildContext context) {
    return Card(
      elevation: 1,
      shape: RoundedRectangleBorder(
        borderRadius: BorderRadius.circular(12.0),
        side: BorderSide(
          color: Colors.grey.shade300,
          width: 1,
        ),
      ),
      child: Padding(
        padding: const EdgeInsets.all(16.0),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              mainAxisAlignment: MainAxisAlignment.spaceBetween,
              children: [
                Row(
                  children: [
                    Icon(provider.icon, size: 24, color: Theme.of(context).primaryColor),
                    const SizedBox(width: 12),
                    Text(
                      provider.name,
                      style: const TextStyle(
                        fontSize: 16,
                        fontWeight: FontWeight.bold,
                      ),
                    ),
                  ],
                ),
                Switch(
                  value: provider.isEnabled,
                  onChanged: onEnabledChanged,
                ),
              ],
            ),
            const SizedBox(height: 12),
            Expanded(
              child: Text(
                provider.description,
                style: TextStyle(
                  fontSize: 14,
                  color: Colors.grey.shade600,
                ),
                overflow: TextOverflow.ellipsis,
                maxLines: 3,
              ),
            ),
          ],
        ),
      ),
    );
  }
}