import 'dart:typed_data';
import 'package:flutter/material.dart';
import 'package:get/get.dart';
import 'package:peers_touch_desktop/features/ai_chat/widgets/input_box/models/ai_attachment.dart';
import 'package:peers_touch_desktop/features/ai_chat/widgets/input_box/models/model_capability.dart';

class AiInputController extends GetxController {
  final TextEditingController textController = TextEditingController();
  final FocusNode textFocusNode = FocusNode();
  final attachments = <AiAttachment>[].obs;
  final sendMode = 'enter'.obs; // 'enter' or 'ctrlEnter'
  final isExpanded = false.obs; // 是否展开工具栏

  late ModelCapability capability;

  void configure(ModelCapability cap) {
    capability = cap;
    update();
  }

  bool get canAttachImage => capability.supportsImageInput && attachments.where((a) => a.type == AiAttachmentType.image).length < capability.maxImages;
  bool get canAttachFile => capability.supportsFileInput && attachments.where((a) => a.type == AiAttachmentType.file).length < capability.maxFiles;
  bool get canAttachAudio => capability.supportsAudioInput && attachments.where((a) => a.type == AiAttachmentType.audio).length < capability.maxAudio;

  void setSendMode(String mode) {
    if (mode == 'enter' || mode == 'ctrlEnter') sendMode.value = mode;
  }

  void addImage(Uint8List bytes, {String mime = 'image/png', String? name, String source = 'picker'}) {
    if (!canAttachImage) return;
    attachments.add(AiAttachment(
      id: UniqueKey().toString(),
      type: AiAttachmentType.image,
      mime: mime,
      bytes: bytes,
      name: name,
      size: bytes.length,
      source: source,
    ));
  }

  void addFile(Uint8List bytes, {required String mime, String? name, String source = 'picker'}) {
    if (!canAttachFile) return;
    attachments.add(AiAttachment(
      id: UniqueKey().toString(),
      type: AiAttachmentType.file,
      mime: mime,
      bytes: bytes,
      name: name,
      size: bytes.length,
      source: source,
    ));
  }

  void addAudio(Uint8List bytes, {String mime = 'audio/webm', Duration? duration, String source = 'record'}) {
    if (!canAttachAudio) return;
    attachments.add(AiAttachment(
      id: UniqueKey().toString(),
      type: AiAttachmentType.audio,
      mime: mime,
      bytes: bytes,
      name: 'audio',
      size: bytes.length,
      source: source,
      duration: duration,
    ));
  }

  void removeAttachment(String id) {
    attachments.removeWhere((a) => a.id == id);
  }

  void clearAll() {
    textController.clear();
    attachments.clear();
  }
}