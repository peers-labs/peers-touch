import 'package:get/get.dart';

/// AI聊天输入框的UI状态控制器
/// 负责管理输入框内部的UI状态，如工具栏显隐等
class AIChatInputController extends GetxController {
  // 控制富文本格式化工具栏的可见性
  final isFormattingToolbarVisible = false.obs;

  // 切换工具栏可见性的方法
  void toggleFormattingToolbar() {
    isFormattingToolbarVisible.value = !isFormattingToolbarVisible.value;
  }

  @override
  void onClose() {
    // 清理资源
    super.onClose();
  }
}