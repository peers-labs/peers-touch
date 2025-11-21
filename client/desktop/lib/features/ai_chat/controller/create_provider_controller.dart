import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:get/get.dart';
import 'package:peers_touch_base/model/domain/ai_box/provider.pb.dart';
import 'package:peers_touch_base/model/google/protobuf/timestamp.pb.dart';
import 'package:peers_touch_base/ai_proxy/provider/provider_manager.dart';
import 'package:peers_touch_desktop/features/ai_chat/model/request_format.dart';

class CreateProviderController extends GetxController {
  final ProviderManager _providerManager = Get.find();

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
      final baseConfig = {
        'api_key': apiKeyController.text,
        'base_url': proxyUrlController.text,
      };

      final provider = Provider(
        id: idController.text,
        name: nameController.text,
        description: descriptionController.text,
        logo: logoController.text,
        sourceType: requestFormat.value!.name,
        settingsJson: jsonEncode({
          'provider_type': requestFormat.value!.name,
          'api_version': 'v1',
        }),
        configJson: jsonEncode(baseConfig),
        enabled: true,
        accessedAt: Timestamp.fromDateTime(now.toUtc()),
        createdAt: Timestamp.fromDateTime(now.toUtc()),
        updatedAt: Timestamp.fromDateTime(now.toUtc()),
      );
      await _providerManager.createProvider(provider);
      Get.back();
    }
  }
}