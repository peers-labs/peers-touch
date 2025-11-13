import 'dart:typed_data';
import 'package:flutter/material.dart';
import 'package:get/get.dart';
import 'package:peers_touch_desktop/features/ai_chat/domain/models/ai_attachment.dart';
import 'package:peers_touch_desktop/features/ai_chat/domain/models/model_capability.dart';

class AiInputController extends GetxController {
  final TextEditingController textController = TextEditingController();
  final FocusNode textFocusNode = FocusNode();
  final attachments = <AiAttachment>[].obs;
  final sendMode = 'enter'.obs; // 'enter' or 'ctrlEnter'
  final isExpanded = false.obs; // 是否展开工具栏
  final isProviderMenuOpen = false.obs; // Provider/模型选择面板显隐

  // 跟随按钮的锚定弹窗 Overlay 引用
  OverlayEntry? _providerOverlay;

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

  void toggleProviderMenu() {
    isProviderMenuOpen.value = !isProviderMenuOpen.value;
  }

  void closeProviderMenu() {
    isProviderMenuOpen.value = false;
  }

  /// 打开跟随按钮的 Provider/Model 选择弹窗
  /// [anchorKey] 为按钮的 GlobalKey，用于计算弹窗位置
  /// [builder] 为弹窗内容构造器
  void openProviderMenuOverlay(
    BuildContext context,
    GlobalKey anchorKey,
    WidgetBuilder builder, {
    required double menuWidth,
    required double menuMaxHeight,
  }) {
    // 若已打开则先关闭旧的
    closeProviderMenuOverlay();
    final render = anchorKey.currentContext?.findRenderObject() as RenderBox?;
    if (render == null) {
      // 回退为内联状态，至少不阻塞使用
      isProviderMenuOpen.value = true;
      return;
    }
    final origin = render.localToGlobal(Offset.zero);
    final size = render.size;
    final screen = MediaQuery.of(context).size;
    const double kGap = 2;
    final Offset belowTopLeft = origin + Offset(0, size.height + kGap);
    // 自动翻转：如果底部空间不足，则把面板显示到按钮上方
    final bool enoughBottomSpace = belowTopLeft.dy + menuMaxHeight + 8 <= screen.height;
    final double desiredTop = enoughBottomSpace ? belowTopLeft.dy : (origin.dy - menuMaxHeight - kGap);
    double desiredLeft = belowTopLeft.dx;
    // 边界夹紧，避免超出屏幕左右边缘
    final double maxLeft = screen.width - menuWidth - 8;
    if (desiredLeft > maxLeft) desiredLeft = maxLeft;
    if (desiredLeft < 8) desiredLeft = 8;

    _providerOverlay = OverlayEntry(builder: (ctx) {
      return Stack(children: [
        // 点击空白处关闭（排除辅助功能语义，避免加入树导致 AXTree 错误）
        Positioned.fill(
          child: ExcludeSemantics(
            child: GestureDetector(onTap: () => closeProviderMenuOverlay()),
          ),
        ),
        Positioned(
          left: desiredLeft,
          top: desiredTop,
          child: Semantics(
            container: true,
            explicitChildNodes: true,
            label: 'Model selector',
            child: Material(color: Colors.transparent, child: builder(ctx)),
          ),
        ),
      ]);
    });
    Overlay.of(context).insert(_providerOverlay!);
    isProviderMenuOpen.value = true;
  }

  /// 关闭锚定弹窗
  void closeProviderMenuOverlay() {
    _providerOverlay?.remove();
    _providerOverlay = null;
    isProviderMenuOpen.value = false;
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