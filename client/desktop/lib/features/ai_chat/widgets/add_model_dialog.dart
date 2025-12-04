import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:get/get.dart';
import 'package:peers_touch_base/i18n/generated/app_localizations.dart';
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
    final l = AppLocalizations.of(context)!;

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
                Text(l.addModel, style: Theme.of(context).textTheme.titleLarge?.copyWith(color: tokens.textPrimary, fontWeight: FontWeight.bold)),
                IconButton(onPressed: () => Get.back(), icon: const Icon(Icons.close)),
              ],
            ),
            const SizedBox(height: 12),
            _textField(context, l.modelId, _idCtrl, hint: l.modelIdPlaceholder),
            const SizedBox(height: 8),
            _textField(context, l.displayName, _nameCtrl, hint: l.modelNamePlaceholder),
            const SizedBox(height: 8),
            _textField(context, l.description, _descCtrl, hint: l.descriptionPlaceholder),
            const SizedBox(height: 8),
            _textField(context, l.organization, _orgCtrl, hint: l.organizationPlaceholder),
            const SizedBox(height: 8),
            Row(children: [
              Expanded(child: _numberField(context, l.contextWindow, _ctxWindowCtrl, hint: l.contextWindowPlaceholder)),
              const SizedBox(width: 8),
              Expanded(child: _numberField(context, l.maxOutputTokens, _maxOutputCtrl, hint: l.maxOutputTokensPlaceholder)),
            ]),
            const SizedBox(height: 8),
            Row(children: [
              Expanded(child: _numberField(context, l.inputPrice, _priceInCtrl, hint: l.inputPricePlaceholder)),
              const SizedBox(width: 8),
              Expanded(child: _numberField(context, l.outputPrice, _priceOutCtrl, hint: l.outputPricePlaceholder)),
            ]),
            const SizedBox(height: 8),
            _textField(context, l.aliases, _aliasesCtrl, hint: l.aliasesPlaceholder),
            const SizedBox(height: 12),
            Row(children: [
              Expanded(
                child: Obx(() => _dropdown(context, l.type, _type.value, ['chat','completion','embedding','vision'], (v) => _type.value = v)),
              ),
              const SizedBox(width: 8),
              Expanded(
                child: Obx(() => _switchRow(context, l.enabled, _enabled.value, (v) => _enabled.value = v)),
              ),
            ]),
            const SizedBox(height: 12),
            Text(l.capabilities, style: Theme.of(context).textTheme.titleMedium?.copyWith(color: tokens.textPrimary)),
            const SizedBox(height: 8),
            Obx(() => Wrap(spacing: 12, runSpacing: 8, children: [
              _capChip(context, l.capText, _capText.value, (v) => _capText.value = v),
              _capChip(context, l.capImage, _capImage.value, (v) => _capImage.value = v),
              _capChip(context, l.capAudio, _capAudio.value, (v) => _capAudio.value = v),
              _capChip(context, l.capFile, _capFile.value, (v) => _capFile.value = v),
            ])),
            const SizedBox(height: 16),
            Row(mainAxisAlignment: MainAxisAlignment.end, children: [
              TextButton(onPressed: () => Get.back(), child: Text(l.cancel)),
              const SizedBox(width: 8),
              ElevatedButton(
                onPressed: () async {
                  final id = _idCtrl.text.trim();
                  final name = _nameCtrl.text.trim();
                  if (id.isEmpty || name.isEmpty) {
                    Get.snackbar(l.notice, l.modelIdAndNameRequired);
                    return;
                  }
                  // 简单 ID 校验
                  final valid = RegExp(r'^[A-Za-z0-9._:\-]+$').hasMatch(id);
                  if (!valid) {
                    Get.snackbar(l.notice, l.modelIdInvalid);
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
                    Get.snackbar(l.success, l.modelAdded);
                  }
                },
                style: UIKit.primaryButtonStyle(context),
                child: Text(l.add),
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
