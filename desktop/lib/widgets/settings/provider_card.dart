import 'package:flutter/material.dart';

class ProviderCard extends StatelessWidget {
  final String providerName;
  final String providerDescription;
  final bool isEnabled;

  const ProviderCard({
    super.key,
    required this.providerName,
    required this.providerDescription,
    required this.isEnabled,
  });

  @override
  Widget build(BuildContext context) {
    return Card(
      child: Padding(
        padding: const EdgeInsets.all(8.0),
        child: Row(
          children: [
            CircleAvatar(
              child: Text(providerName[0]),
            ),
            SizedBox(width: 16),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(providerName, style: TextStyle(fontWeight: FontWeight.bold)),
                  Text(providerDescription),
                ],
              ),
            ),
            Switch(value: isEnabled, onChanged: (value) {}),
          ],
        ),
      ),
    );
  }
}