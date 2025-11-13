import 'package:flutter/material.dart';
import 'package:get/get.dart';
import 'package:peers_touch_desktop/app/theme/lobe_tokens.dart';
import 'package:peers_touch_desktop/app/theme/ui_kit.dart';
import 'package:peers_touch_desktop/features/ai_chat/controller/provider_controller.dart';
import 'package:peers_touch_desktop/features/ai_chat/model/provider.dart';

class AddModelDialog extends StatefulWidget {
  final Provider provider;

  const AddModelDialog({super.key, required this.provider});

  @override
  State<AddModelDialog> createState() => _AddModelDialogState();
}

class _AddModelDialogState extends State<AddModelDialog> {
  final _formKey = GlobalKey<FormState>();
  final _modelIdController = TextEditingController();
  final _displayNameController = TextEditingController();
  final _contextSizeController = TextEditingController(text: '4096');
  bool _supportTool = false;
  bool _supportVision = false;
  bool _supportDeepThinking = false;
  bool _supportWebSearch = false;
  bool _supportImageGeneration = false;
  bool _supportVideoRecognition = false;
  String? _modelType;

  @override
  void dispose() {
    _modelIdController.dispose();
    _displayNameController.dispose();
    _contextSizeController.dispose();
    super.dispose();
  }

  void _submitForm() {
    if (_formKey.currentState!.validate()) {
      final newModel = {
        'id': _modelIdController.text.trim(),
        'name': _displayNameController.text.trim(),
        'contextSize': int.tryParse(_contextSizeController.text) ?? 4096,
        'capabilities': {
          'tool': _supportTool,
          'vision': _supportVision,
          'deepThinking': _supportDeepThinking,
          'webSearch': _supportWebSearch,
          'imageGeneration': _supportImageGeneration,
          'videoRecognition': _supportVideoRecognition,
        },
        'type': _modelType,
      };

      Get.find<ProviderController>().addModelToProvider(
        widget.provider.id,
        newModel,
      );

      Get.back();
    }
  }

  @override
  Widget build(BuildContext context) {
    final tokens = Theme.of(context).extension<LobeTokens>()!;

    return Dialog(
      backgroundColor: tokens.bgLevel2,
      shape: RoundedRectangleBorder(
        borderRadius: BorderRadius.circular(UIKit.radiusLg(context)),
      ),
      child: Container(
        width: 500,
        padding: EdgeInsets.all(UIKit.spaceLg(context)),
        child: Form(
          key: _formKey,
          child: SingleChildScrollView(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text('Create Custom AI Model', style: Theme.of(context).textTheme.headlineSmall),
                const SizedBox(height: 20),
                TextFormField(
                  controller: _modelIdController,
                  decoration: InputDecoration(
                    labelText: 'Model ID *',
                    hintText: 'e.g., gpt-4o or claude-3-5-sonnet',
                    border: OutlineInputBorder(),
                  ),
                  validator: (value) => value?.isEmpty ?? true ? 'Model ID is required' : null,
                ),
                const SizedBox(height: 16),
                TextFormField(
                  controller: _displayNameController,
                  decoration: InputDecoration(
                    labelText: 'Model Display Name',
                    hintText: 'e.g., ChatGPT, GPT-4, etc.',
                    border: OutlineInputBorder(),
                  ),
                ),
                const SizedBox(height: 16),
                Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text('Maximum Context'),
                    const SizedBox(height: 8),
                    Row(
                      children: [
                        _buildContextButton('4K', '4096'),
                        _buildContextButton('8K', '8192'),
                        _buildContextButton('16K', '16384'),
                        _buildContextButton('32K', '32768'),
                        _buildContextButton('64K', '65536'),
                        _buildContextButton('200K', '200000'),
                        _buildContextButton('1M', '1000000'),
                        _buildContextButton('2M', '2000000'),
                        const SizedBox(width: 10),
                        Expanded(
                          child: TextFormField(
                            controller: _contextSizeController,
                            keyboardType: TextInputType.number,
                            decoration: InputDecoration(
                              border: OutlineInputBorder(),
                            ),
                          ),
                        ),
                      ],
                    ),
                  ],
                ),
                const SizedBox(height: 24),
                Text('Support for Tools', style: Theme.of(context).textTheme.titleMedium),
                CheckboxListTile(
                  title: Text('Enable tool usage capabilities'),
                  subtitle: Text('Allows the model to use plugins and tools'),
                  value: _supportTool,
                  onChanged: (value) => setState(() => _supportTool = value ?? false),
                ),
                CheckboxListTile(
                  title: Text('Support Vision'),
                  subtitle: Text('Enables image upload capabilities'),
                  value: _supportVision,
                  onChanged: (value) => setState(() => _supportVision = value ?? false),
                ),
                CheckboxListTile(
                  title: Text('Support Deep Thinking'),
                  subtitle: Text('Enables advanced reasoning capabilities'),
                  value: _supportDeepThinking,
                  onChanged: (value) => setState(() => _supportDeepThinking = value ?? false),
                ),
                CheckboxListTile(
                  title: Text('Supports Web Search'),
                  subtitle: Text('Enables built-in web search functionality'),
                  value: _supportWebSearch,
                  onChanged: (value) => setState(() => _supportWebSearch = value ?? false),
                ),
                CheckboxListTile(
                  title: Text('Supports Image Generation'),
                  subtitle: Text('Enables text-to-image capabilities'),
                  value: _supportImageGeneration,
                  onChanged: (value) => setState(() => _supportImageGeneration = value ?? false),
                ),
                CheckboxListTile(
                  title: Text('Supports Video Recognition'),
                  subtitle: Text('Enables video content analysis'),
                  value: _supportVideoRecognition,
                  onChanged: (value) => setState(() => _supportVideoRecognition = value ?? false),
                ),
                const SizedBox(height: 16),
                DropdownButtonFormField<String>(
                  decoration: InputDecoration(
                    labelText: 'Model Type',
                    border: OutlineInputBorder(),
                  ),
                  items: ['Chat', 'Completion', 'Embedding', 'Image', 'Audio']
                      .map((type) => DropdownMenuItem(value: type, child: Text(type)))
                      .toList(),
                  onChanged: (value) => setState(() => _modelType = value),
                ),
                const SizedBox(height: 24),
                Row(
                  mainAxisAlignment: MainAxisAlignment.end,
                  children: [
                    TextButton(
                      onPressed: () => Get.back(),
                      child: const Text('Cancel'),
                    ),
                    const SizedBox(width: 8),
                    ElevatedButton(
                      onPressed: _submitForm,
                      style: UIKit.primaryButtonStyle(context),
                      child: const Text('OK'),
                    ),
                  ],
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }

  Widget _buildContextButton(String label, String value) {
    return Padding(
      padding: const EdgeInsets.symmetric(horizontal: 4),
      child: ElevatedButton(
        onPressed: () => setState(() => _contextSizeController.text = value),
        style: ElevatedButton.styleFrom(
          backgroundColor: _contextSizeController.text == value
              ? Theme.of(context).colorScheme.primary
              : Theme.of(context).colorScheme.surface,
        ),
        child: Text(label),
      ),
    );
  }
}