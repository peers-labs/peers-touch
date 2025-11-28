import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:get/get.dart';
import 'package:peers_touch_base/model/domain/ai_box/ai_models.pb.dart';
import 'package:peers_touch_base/model/domain/ai_box/provider.pb.dart' as base;
import 'package:peers_touch_desktop/app/theme/lobe_tokens.dart';
import 'package:peers_touch_desktop/app/theme/ui_kit.dart';
import 'package:peers_touch_desktop/features/ai_chat/controller/provider_controller.dart';

class AddModelDialog extends StatelessWidget {
  final base.Provider provider;

  AddModelDialog({super.key, required this.provider});

  // Text controllers
  final _idCtrl = TextEditingController();
  final _nameCtrl = TextEditingController();
  final _descCtrl = TextEditingController();
  final _orgCtrl = TextEditingController();
  final _ctxWindowCtrl = TextEditingController();
  final _maxOutputCtrl = TextEditingController();
  final _aliasesCtrl = TextEditingController();
  final _priceInCtrl = TextEditingController();
  final _priceOutCtrl = TextEditingController();

  // Reactive fields
  final RxString _type = 'chat'.obs;
  final RxBool _capText = true.obs;
  final RxBool _capImage = false.obs;
  final RxBool _capAudio = false.obs;
  final RxBool _capFile = false.obs;
  final RxBool _enabled = true.obs;

  @override
  Widget build(BuildContext context) {
    final tokens = Theme.of(context).extension<LobeTokens>()!;
    return Dialog(
      backgroundColor: tokens.bgLevel2,
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(UIKit.radiusLg(context))),
      child: Container(
        width: 560,
        padding: EdgeInsets.all(UIKit.spaceLg(context)),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              mainAxisAlignment: MainAxisAlignment.spaceBetween,
              children: [
                Text('Add Model', style: Theme.of(context).textTheme.titleLarge?.copyWith(color: tokens.textPrimary, fontWeight: FontWeight.bold)),
                IconButton(onPressed: () => Get.back(), icon: const Icon(Icons.close)),
              ],
            ),
            const SizedBox(height: 12),
            _textField(context, 'Model ID', _idCtrl, hint: 'e.g. gpt-4o-mini or llama3.1:8b'),
            const SizedBox(height: 8),
            _textField(context, 'Display Name', _nameCtrl, hint: 'e.g. GPT-4o Mini'),
            const SizedBox(height: 8),
            _textField(context, 'Description', _descCtrl, hint: 'Optional description'),
            const SizedBox(height: 8),
            _textField(context, 'Organization', _orgCtrl, hint: 'e.g. OpenAI / Ollama'),
            const SizedBox(height: 8),
            Row(children: [
              Expanded(child: _numberField(context, 'Context Window', _ctxWindowCtrl, hint: 'e.g. 128000')),
              const SizedBox(width: 8),
              Expanded(child: _numberField(context, 'Max Output Tokens', _maxOutputCtrl, hint: 'e.g. 4096')),
            ]),
            const SizedBox(height: 8),
            Row(children: [
              Expanded(child: _numberField(context, 'Input \$ /1k tokens', _priceInCtrl, hint: 'e.g. 0.03')),
              const SizedBox(width: 8),
              Expanded(child: _numberField(context, 'Output \$ /1k tokens', _priceOutCtrl, hint: 'e.g. 0.06')),
            ]),
            const SizedBox(height: 8),
            _textField(context, 'Aliases', _aliasesCtrl, hint: 'comma separated e.g. gpt-4o-mini-2024-07-18'),
            const SizedBox(height: 12),
            Row(children: [
              Expanded(
                child: Obx(() => _dropdown(context, 'Type', _type.value, ['chat','completion','embedding','vision'], (v) => _type.value = v)),
              ),
              const SizedBox(width: 8),
              Expanded(
                child: Obx(() => _switchRow(context, 'Enabled', _enabled.value, (v) => _enabled.value = v)),
              ),
            ]),
            const SizedBox(height: 12),
            Text('Capabilities', style: Theme.of(context).textTheme.titleMedium?.copyWith(color: tokens.textPrimary)),
            const SizedBox(height: 8),
            Obx(() => Wrap(spacing: 12, runSpacing: 8, children: [
              _capChip(context, 'Text', _capText.value, (v) => _capText.value = v),
              _capChip(context, 'Image', _capImage.value, (v) => _capImage.value = v),
              _capChip(context, 'Audio', _capAudio.value, (v) => _capAudio.value = v),
              _capChip(context, 'File', _capFile.value, (v) => _capFile.value = v),
            ])),
            const SizedBox(height: 16),
            Row(mainAxisAlignment: MainAxisAlignment.end, children: [
              TextButton(onPressed: () => Get.back(), child: const Text('Cancel')),
              const SizedBox(width: 8),
              ElevatedButton(
                onPressed: () async {
                  final id = _idCtrl.text.trim();
                  final name = _nameCtrl.text.trim();
                  if (id.isEmpty || name.isEmpty) {
                    Get.snackbar('提示', 'Model ID 与 Display Name 为必填');
                    return;
                  }
                  // 简单 ID 校验
                  final valid = RegExp(r'^[A-Za-z0-9._:\-]+$').hasMatch(id);
                  if (!valid) {
                    Get.snackbar('提示', 'ID 仅允许字母、数字、点、冒号、下划线与破折号');
                    return;
                  }

                  final ctx = int.tryParse(_ctxWindowCtrl.text.trim());
                  final maxOut = int.tryParse(_maxOutputCtrl.text.trim());
                  final priceIn = double.tryParse(_priceInCtrl.text.trim());
                  final priceOut = double.tryParse(_priceOutCtrl.text.trim());
                  final aliases = _aliasesCtrl.text
                      .split(',')
                      .map((e) => e.trim())
                      .where((e) => e.isNotEmpty)
                      .toList();

                  final abilities = {
                    'textInput': _capText.value,
                    'imageInput': _capImage.value,
                    'audioInput': _capAudio.value,
                    'fileInput': _capFile.value,
                  };
                  final pricing = {
                    if (priceIn != null) 'inputPer1kTokens': priceIn,
                    if (priceOut != null) 'outputPer1kTokens': priceOut,
                  };
                  final params = {
                    if (maxOut != null) 'maxOutputTokens': maxOut,
                  };
                  final config = {
                    if (aliases.isNotEmpty) 'aliases': aliases,
                  };

                  final model = AiModel(
                    id: id,
                    displayName: name,
                    description: _descCtrl.text.trim(),
                    organization: _orgCtrl.text.trim(),
                    enabled: _enabled.value,
                    providerId: provider.id,
                    type: _type.value,
                    contextWindowTokens: ctx ?? 0,
                    abilitiesJson: jsonEncode(abilities),
                    pricingJson: jsonEncode(pricing),
                    parametersJson: jsonEncode(params),
                    configJson: jsonEncode(config),
                    source: 'manual',
                  );

                  final ok = await Get.find<ProviderController>().addManualModel(model);
                  if (ok) {
                    Get.back();
                    Get.snackbar('成功', '模型已添加');
                  }
                },
                style: UIKit.primaryButtonStyle(context),
                child: const Text('Add'),
              ),
            ]),
          ],
        ),
      ),
    );
  }

  Widget _textField(BuildContext context, String label, TextEditingController c, {String? hint}) {
    final tokens = Theme.of(context).extension<LobeTokens>()!;
    return Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
      Text(label, style: Theme.of(context).textTheme.bodyMedium?.copyWith(color: tokens.textPrimary)),
      const SizedBox(height: 6),
      TextField(
        controller: c,
        decoration: InputDecoration(
          hintText: hint,
          isDense: true,
          filled: true,
          fillColor: tokens.bgLevel3,
          border: OutlineInputBorder(
            borderRadius: BorderRadius.circular(UIKit.radiusSm(context)),
            borderSide: BorderSide.none,
          ),
        ),
      ),
    ]);
  }

  Widget _numberField(BuildContext context, String label, TextEditingController c, {String? hint}) {
    return _textField(context, label, c, hint: hint);
  }

  Widget _dropdown(BuildContext context, String label, String value, List<String> options, ValueChanged<String> onChanged) {
    final tokens = Theme.of(context).extension<LobeTokens>()!;
    return Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
      Text(label, style: Theme.of(context).textTheme.bodyMedium?.copyWith(color: tokens.textPrimary)),
      const SizedBox(height: 6),
      Container(
        padding: const EdgeInsets.symmetric(horizontal: 10),
        decoration: BoxDecoration(color: tokens.bgLevel3, borderRadius: BorderRadius.circular(UIKit.radiusSm(context))),
        child: DropdownButton<String>(
          value: value,
          isExpanded: true,
          items: options.map((e) => DropdownMenuItem<String>(value: e, child: Text(e))).toList(),
          onChanged: (v) { if (v != null) onChanged(v); },
          underline: const SizedBox(),
          dropdownColor: tokens.bgLevel3,
        ),
      ),
    ]);
  }

  Widget _switchRow(BuildContext context, String label, bool value, ValueChanged<bool> onChanged) {
    final tokens = Theme.of(context).extension<LobeTokens>()!;
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
      decoration: BoxDecoration(color: tokens.bgLevel3, borderRadius: BorderRadius.circular(UIKit.radiusSm(context))),
      child: Row(children: [
        Expanded(child: Text(label)),
        Switch(value: value, onChanged: onChanged),
      ]),
    );
  }

  Widget _capChip(BuildContext context, String label, bool selected, ValueChanged<bool> onChanged) {
    final tokens = Theme.of(context).extension<LobeTokens>()!;
    return FilterChip(
      label: Text(label),
      selected: selected,
      onSelected: onChanged,
      selectedColor: tokens.bgLevel1,
    );
  }
}
