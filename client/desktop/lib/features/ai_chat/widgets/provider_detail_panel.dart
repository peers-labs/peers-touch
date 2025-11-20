import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:get/get.dart';
import 'package:peers_touch_base/model/domain/ai_box/provider.pb.dart' as base;
import 'package:peers_touch_desktop/app/theme/lobe_tokens.dart';
import 'package:peers_touch_desktop/app/theme/ui_kit.dart';
import 'package:peers_touch_desktop/features/ai_chat/controller/provider_controller.dart';

class ProviderDetailPanel extends StatelessWidget {
  final base.Provider provider;

  const ProviderDetailPanel({super.key, required this.provider});

  @override
  Widget build(BuildContext context) {
    final controller = Get.find<ProviderController>();
    final tokens = Theme.of(context).extension<LobeTokens>()!;
    
    // 解析settingsJson和configJson
    final settings = provider.settingsJson.isNotEmpty 
        ? jsonDecode(provider.settingsJson) as Map<String, dynamic>
        : {};
    final config = provider.configJson.isNotEmpty 
        ? jsonDecode(provider.configJson) as Map<String, dynamic>
        : {};

    return Scaffold(
      backgroundColor: tokens.bgLevel2,
      appBar: AppBar(
        backgroundColor: tokens.bgLevel2,
        elevation: 0,
        title: Text(provider.name, style: TextStyle(color: tokens.textPrimary)),
        automaticallyImplyLeading: false,
      ),
      body: Padding(
        padding: EdgeInsets.all(UIKit.spaceLg(context)),
        child: ListView(
          children: [
            _buildSection(
              context,
              'Basic Configuration',
              [
                _buildTextField(context, 'Provider Name', provider.name, (value) {}, tokens),
                const SizedBox(height: 16),
                _buildTextField(context, 'Base URL', settings['baseUrl'] ?? '', (value) {}, tokens),
                const SizedBox(height: 16),
                _buildTextField(context, 'API Key', '••••••••', (value) {}, tokens, obscureText: true),
              ],
              tokens,
            ),
            const SizedBox(height: 24),
            _buildSection(
              context,
              'Advanced Configuration',
              [
                _buildSlider(context, 'Temperature', (config['temperature'] ?? 0.7).toDouble(), 0.0, 2.0, (value) {}, tokens),
                const SizedBox(height: 16),
                _buildSlider(context, 'Max Tokens', (config['maxTokens'] ?? 2048).toDouble(), 100, 8192, (value) {}, tokens),
              ],
              tokens,
            ),
            const SizedBox(height: 24),
            _buildSection(
              context,
              'Model Management',
              [
                Row(
                  children: [
                    Expanded(
                      child: Text(
                        'Available Models',
                        style: Theme.of(context).textTheme.titleMedium?.copyWith(color: tokens.textPrimary),
                      ),
                    ),
                    ElevatedButton.icon(
                      onPressed: () async {
                        try {
                          await controller.fetchProviderModels(provider.id);
                          Get.snackbar('Success', 'Models fetched successfully');
                        } catch (e) {
                          Get.snackbar('Error', 'Failed to fetch models: $e');
                        }
                      },
                      icon: const Icon(Icons.refresh),
                      label: const Text('Fetch Models'),
                    ),
                  ],
                ),
                const SizedBox(height: 16),
                // TODO: Display model list here
              ],
              tokens,
            ),
          ],
        ),
      ),
    );
  }

  Widget _buildSection(BuildContext context, String title, List<Widget> children, LobeTokens tokens) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text(title, style: Theme.of(context).textTheme.titleMedium?.copyWith(color: tokens.textPrimary, fontWeight: FontWeight.bold)),
        const SizedBox(height: 16),
        ...children,
      ],
    );
  }

  Widget _buildTextField(BuildContext context, String label, String initialValue, ValueChanged<String> onChanged, LobeTokens tokens, {bool obscureText = false}) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text(label, style: Theme.of(context).textTheme.bodyMedium?.copyWith(color: tokens.textSecondary)),
        const SizedBox(height: 8),
        TextFormField(
          initialValue: initialValue,
          obscureText: obscureText,
          style: TextStyle(color: tokens.textPrimary),
          decoration: InputDecoration(
            filled: true,
            fillColor: tokens.bgLevel3,
            border: OutlineInputBorder(
              borderRadius: BorderRadius.circular(UIKit.radiusSm(context)),
              borderSide: BorderSide.none,
            ),
          ),
          onChanged: onChanged,
        ),
      ],
    );
  }

  Widget _buildSlider(BuildContext context, String label, double value, double min, double max, ValueChanged<double> onChanged, LobeTokens tokens) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text(label, style: Theme.of(context).textTheme.bodyMedium?.copyWith(color: tokens.textSecondary)),
        Slider(
          value: value,
          min: min,
          max: max,
          divisions: (max - min).toInt(),
          label: value.toStringAsFixed(2),
          onChanged: onChanged,
        ),
      ],
    );
  }
}