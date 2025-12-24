import 'package:flutter/material.dart';
import 'package:get/get.dart';
import 'package:peers_touch_base/i18n/generated/app_localizations.dart';
import 'package:peers_touch_desktop/app/theme/lobe_tokens.dart';
import 'package:peers_touch_desktop/app/theme/ui_kit.dart';
import 'package:peers_touch_desktop/features/ai_chat/controller/create_provider_controller.dart';
import 'package:peers_touch_desktop/features/ai_chat/model/request_format.dart';

class CreateProviderForm extends StatelessWidget {
  const CreateProviderForm({super.key});

  @override
  Widget build(BuildContext context) {
    final tokens = Theme.of(context).extension<LobeTokens>()!;
    final controller = Get.put(CreateProviderController());
    final l = AppLocalizations.of(context)!;

    return Container(
      width: 600, // Set a fixed width for the dialog content
      padding: EdgeInsets.all(UIKit.spaceLg(context)),
      child: Form(
        key: controller.formKey,
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
                    Text(l.createCustomAIProvider, style: Theme.of(context).textTheme.titleLarge?.copyWith(color: tokens.textPrimary)),
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
                    Text(l.basicInformation, style: Theme.of(context).textTheme.titleMedium?.copyWith(fontWeight: FontWeight.bold, color: tokens.textPrimary)),
                    const SizedBox(height: 16),
                    _buildTextField(context, controller: controller.idController, label: l.providerId, hint: l.providerIdPlaceholder, isRequired: true),
                    _buildTextField(context, controller: controller.nameController, label: l.providerName, hint: l.providerNamePlaceholder, isRequired: true),
                    _buildTextField(context, controller: controller.descriptionController, label: l.providerDescription, hint: l.providerDescriptionPlaceholder),
                    _buildTextField(context, controller: controller.logoController, label: l.providerLogo, hint: l.providerLogoPlaceholder),
                    _buildSvgPicker(context, controller),
                    const SizedBox(height: 24),

                    // Configuration Information
                    Text(l.configurationInformation, style: Theme.of(context).textTheme.titleMedium?.copyWith(fontWeight: FontWeight.bold, color: tokens.textPrimary)),
                    const SizedBox(height: 16),
                    _buildDropdownField(context, controller: controller, label: l.requestFormat, hint: l.requestFormatPlaceholder, isRequired: true),
                    _buildTextField(context, controller: controller.proxyUrlController, label: l.proxyUrl, hint: l.proxyUrlPlaceholder, isRequired: true),
                    _buildTextField(context, controller: controller.apiKeyController, label: l.apiKey, hint: l.apiKeyPlaceholder, obscureText: true),
                  ],
                ),
              ),
            ),
            const SizedBox(height: 24),

            // Create Button
            SizedBox(
              width: double.infinity,
              child: ElevatedButton(
                onPressed: controller.createProvider,
                style: UIKit.primaryButtonStyle(context).copyWith(
                  padding: WidgetStateProperty.all(const EdgeInsets.symmetric(vertical: 20)),
                ),
                child: Text(l.create, style: const TextStyle(fontWeight: FontWeight.bold)),
              ),
            ),
          ],
        ),
      ),
    );
  }

  Widget _buildTextField(BuildContext context, {required TextEditingController controller, required String label, required String hint, bool isRequired = false, bool obscureText = false}) {
    final tokens = Theme.of(context).extension<LobeTokens>()!;
    final l = AppLocalizations.of(context)!;
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
                return l.fieldRequired;
              }
              return null;
            },
          ),
        ],
      ),
    );
  }

  Widget _buildDropdownField(BuildContext context, {required CreateProviderController controller, required String label, required String hint, bool isRequired = false}) {
    final tokens = Theme.of(context).extension<LobeTokens>()!;
    final l = AppLocalizations.of(context)!;
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
          Obx(() => DropdownButtonFormField<RequestFormatType>(
            value: controller.requestFormat.value,
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
              if (value != null) {
                final selectedFormat = formats.firstWhere((format) => format.type == value);
                controller.proxyUrlController.text = selectedFormat.defaultUrl;
              }
              controller.requestFormat.value = value;
            },
            icon: Icon(Icons.arrow_drop_down, color: tokens.textSecondary),
            validator: (value) {
              if (isRequired && value == null) {
                return l.fieldRequired;
              }
              return null;
            },
          )),
        ],
      ),
    );
  }

  Widget _buildSvgPicker(BuildContext context, CreateProviderController controller) {
    final tokens = Theme.of(context).extension<LobeTokens>()!;
    final l = AppLocalizations.of(context)!;
    final options = const [
      'openai.svg',
      'openai-text.svg',
      'ollama.svg',
      'ollama-text.svg',
      'anthropic.svg',
      'azure.svg',
      'cloudflare.svg',
      'google.svg',
      'qwen.svg',
      'volcengine.svg',
    ];
    return Padding(
      padding: const EdgeInsets.only(bottom: 16.0),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text('Preset SVG', style: TextStyle(fontWeight: FontWeight.w500, color: tokens.textPrimary)),
          const SizedBox(height: 8),
          DropdownButtonFormField<String>(
            decoration: UIKit.inputDecoration(context),
            items: options
                .map((e) => DropdownMenuItem<String>(value: e, child: Text(e)))
                .toList(),
            onChanged: (value) {
              if (value != null && value.isNotEmpty) {
                controller.logoController.text = value; // 直接写入可读的文件名
              }
            },
          ),
        ],
      ),
    );
  }
}
