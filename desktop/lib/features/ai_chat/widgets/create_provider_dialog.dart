import 'package:flutter/material.dart';
import 'package:get/get.dart';
import 'package:peers_touch_desktop/app/theme/lobe_tokens.dart';
import 'package:peers_touch_desktop/app/theme/ui_kit.dart';
import 'package:peers_touch_desktop/features/ai_chat/model/request_format.dart';
import 'package:peers_touch_desktop/features/ai_chat/controller/provider_controller.dart';

class CreateProviderForm extends StatefulWidget {
  const CreateProviderForm({super.key});

  @override
  State<CreateProviderForm> createState() => _CreateProviderFormState();
}

class _CreateProviderFormState extends State<CreateProviderForm> {
  final _formKey = GlobalKey<FormState>();
  // 文本控制器
  final _idController = TextEditingController();
  final _nameController = TextEditingController();
  final _descController = TextEditingController();
  final _logoController = TextEditingController();
  final _proxyController = TextEditingController();
  final _apiKeyController = TextEditingController();

  // 请求格式选择（枚举映射到 sourceType）
  RequestFormatType? _selectedFormat;

  @override
  void dispose() {
    _idController.dispose();
    _nameController.dispose();
    _descController.dispose();
    _logoController.dispose();
    _proxyController.dispose();
    _apiKeyController.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final tokens = Theme.of(context).extension<LobeTokens>()!;

    return Container(
      width: 600, // Set a fixed width for the dialog content
      padding: EdgeInsets.all(UIKit.spaceLg(context)),
      child: Form(
        key: _formKey,
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            // Header
            Row(
              mainAxisAlignment: MainAxisAlignment.spaceBetween,
              children: [
                Row(
                  children: [
                    Icon(Icons.auto_awesome, color: tokens.textSecondary),
                    const SizedBox(width: 8),
                    Text('Create Custom AI Provider', style: Theme.of(context).textTheme.titleLarge?.copyWith(color: tokens.textPrimary)),
                  ],
                ),
                IconButton(
                  icon: Icon(Icons.close, color: tokens.textSecondary),
                  onPressed: () => Get.back(),
                ),
              ],
            ),
            const SizedBox(height: 24),

            // Use Flexible and SingleChildScrollView for scrollable content
            Flexible(
              child: SingleChildScrollView(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    // Basic Information
                    Text('Basic Information', style: Theme.of(context).textTheme.titleMedium?.copyWith(fontWeight: FontWeight.bold, color: tokens.textPrimary)),
                    const SizedBox(height: 16),
                    _buildTextField(context, controller: _idController, label: 'Provider ID', hint: 'Suggested all lowercase, e.g., openai, cann...', isRequired: true),
                    _buildTextField(context, controller: _nameController, label: 'Provider Name', hint: 'Please enter the display name of the provider', isRequired: true),
                    _buildTextField(context, controller: _descController, label: 'Provider Description', hint: 'Provider description (optional)'),
                    _buildTextField(context, controller: _logoController, label: 'Provider Logo', hint: 'https://logo-url'),
                    const SizedBox(height: 24),

                    // Configuration Information
                    Text('Configuration Information', style: Theme.of(context).textTheme.titleMedium?.copyWith(fontWeight: FontWeight.bold, color: tokens.textPrimary)),
                    const SizedBox(height: 16),
                    _buildDropdownField(context, label: 'Request Format', hint: 'openai/anthropic/azureai/ollama/...', isRequired: true),
                    _buildTextField(context, controller: _proxyController, label: 'Proxy URL', hint: 'https://xxxx-proxy.com/v1', isRequired: true),
                    _buildTextField(context, controller: _apiKeyController, label: 'API Key', hint: 'Please enter your API Key', obscureText: true),
                  ],
                ),
              ),
            ),
            const SizedBox(height: 24),

            // Create Button
            SizedBox(
              width: double.infinity,
              child: ElevatedButton(
                onPressed: () async {
                  if (_formKey.currentState!.validate()) {
                    final name = _nameController.text.trim();
                    final baseUrl = _proxyController.text.trim();
                    final apiKey = _apiKeyController.text.trim();

                    // sourceType 优先使用枚举选择，否则回退到 ID 文本
                    final sourceType = (_selectedFormat != null)
                        ? _selectedFormat!.name
                        : _idController.text.trim().toLowerCase();

                    if (sourceType.isEmpty) {
                      Get.snackbar('提示', '请选择 Request Format 或填写 Provider ID');
                      return;
                    }

                    try {
                      final controller = Get.find<ProviderController>();
                      await controller.addProvider(
                        name: name,
                        sourceType: sourceType,
                        baseUrl: baseUrl.isNotEmpty ? baseUrl : null,
                        apiKey: apiKey.isNotEmpty ? apiKey : null,
                      );
                      Get.back();
                    } catch (e) {
                      Get.snackbar('错误', '创建 Provider 失败：$e');
                    }
                  }
                },
                style: UIKit.primaryButtonStyle(context)?.copyWith(
                  padding: MaterialStateProperty.all(const EdgeInsets.symmetric(vertical: 20)),
                ),
                child: const Text('Create', style: TextStyle(fontWeight: FontWeight.bold)),
              ),
            ),
          ],
        ),
      ),
    );
  }

  Widget _buildTextField(BuildContext context, {required TextEditingController controller, required String label, required String hint, bool isRequired = false, bool obscureText = false}) {
    final tokens = Theme.of(context).extension<LobeTokens>()!;
    return Padding(
      padding: const EdgeInsets.only(bottom: 16.0),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text.rich(
            TextSpan(
              text: label,
              children: [if (isRequired) TextSpan(text: ' *', style: TextStyle(color: tokens.brandAccent))],
            ),
            style: TextStyle(fontWeight: FontWeight.w500, color: tokens.textPrimary),
          ),
          const SizedBox(height: 8),
          TextFormField(
            controller: controller,
            obscureText: obscureText,
            style: TextStyle(color: tokens.textPrimary),
            decoration: UIKit.inputDecoration(context).copyWith(
              hintText: hint,
            ),
            validator: (value) {
              if (isRequired && (value == null || value.isEmpty)) {
                return 'This field is required';
              }
              return null;
            },
          ),
        ],
      ),
    );
  }

  Widget _buildDropdownField(BuildContext context, {required String label, required String hint, bool isRequired = false}) {
    final tokens = Theme.of(context).extension<LobeTokens>()!;
    final formats = RequestFormat.supportedFormats;

    return Padding(
      padding: const EdgeInsets.only(bottom: 16.0),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text.rich(
            TextSpan(
              text: label,
              children: [if (isRequired) TextSpan(text: ' *', style: TextStyle(color: tokens.brandAccent))],
            ),
            style: TextStyle(fontWeight: FontWeight.w500, color: tokens.textPrimary),
          ),
          const SizedBox(height: 8),
          DropdownButtonFormField<RequestFormatType>(
            decoration: UIKit.inputDecoration(context).copyWith(
              hintText: hint,
            ),
            dropdownColor: tokens.bgLevel3,
            items: formats.map((format) {
              return DropdownMenuItem(
                value: format.type,
                child: Row(
                  children: [
                    format.icon,
                    const SizedBox(width: 8),
                    Text(format.name, style: TextStyle(color: tokens.textPrimary)),
                  ],
                ),
              );
            }).toList(),
            onChanged: (value) {
              setState(() {
                _selectedFormat = value;
              });
            },
            icon: Icon(Icons.arrow_drop_down, color: tokens.textSecondary),
            validator: (value) {
              if (isRequired && value == null) {
                return 'This field is required';
              }
              return null;
            },
          ),
        ],
      ),
    );
  }
}