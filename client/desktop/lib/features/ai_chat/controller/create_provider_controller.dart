import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:get/get.dart';
import 'package:peers_touch_base/model/domain/ai_box/provider.pb.dart';
import 'package:peers_touch_base/ai_proxy/provider/template/template_factory.dart';
import 'package:peers_touch_base/model/google/protobuf/timestamp.pb.dart' as $pb_timestamp;
import 'package:peers_touch_desktop/features/ai_chat/model/request_format.dart';
import 'package:peers_touch_desktop/features/ai_chat/controller/provider_controller.dart';
import 'package:peers_touch_desktop/features/ai_chat/service/provider_service.dart';

class CreateProviderController extends GetxController {
  final ProviderService _providerService = Get.find();

  final formKey = GlobalKey<FormState>();

  final idController = TextEditingController();
  final nameController = TextEditingController();
  final descriptionController = TextEditingController();
  final logoController = TextEditingController();
  final proxyUrlController = TextEditingController();
  final apiKeyController = TextEditingController();

  var requestFormat = Rx<RequestFormatType?>(null);

  @override
  void onClose() {
    idController.dispose();
    nameController.dispose();
    descriptionController.dispose();
    logoController.dispose();
    proxyUrlController.dispose();
    apiKeyController.dispose();
    super.onClose();
  }

  Future<void> createProvider() async {
    if (formKey.currentState!.validate()) {
      final now = DateTime.now();
      final provider = Provider(
        id: idController.text,
        name: nameController.text,
        description: descriptionController.text,
        logo: logoController.text,
        sourceType: requestFormat.value!.name,
        settingsJson: jsonEncode({
          'requestFormat': requestFormat.value!.name,
          'proxyUrl': proxyUrlController.text,
          'defaultProxyUrl': proxyUrlController.text,
          'apiKey': apiKeyController.text,
          'models': <String>[],
        }),
        configJson: jsonEncode({
          'temperature': 0.7,
          'maxTokens': 2048,
          'topP': 1.0,
          'frequencyPenalty': 0.0,
          'presencePenalty': 0.0,
        }),
        enabled: true,
        accessedAt: $pb_timestamp.Timestamp.fromDateTime(now.toUtc()),
        createdAt: $pb_timestamp.Timestamp.fromDateTime(now.toUtc()),
        updatedAt: $pb_timestamp.Timestamp.fromDateTime(now.toUtc()),
      );
      // 应用模板默认值与校验
      final template = AIProviderTemplateFactory.fromProvider(provider);
      final withDefaults = template.applyDefaults(provider);
      final errs = template.validate(withDefaults);
      if (errs.isNotEmpty) {
        Get.snackbar('错误', errs.join('\n'));
        return;
      }
      await _providerService.createProvider(withDefaults);
      Get.find<ProviderController>().loadProviders();
      Get.back();
    }
  }
}
