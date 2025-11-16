import 'package:flutter/material.dart';
import 'package:get/get.dart';
import 'package:peers_touch_desktop/app/theme/lobe_tokens.dart';
import 'package:peers_touch_desktop/features/ai_chat/controller/ai_chat_input_controller.dart';

/// AI聊天输入框组件
/// 专门为AI聊天场景设计的复杂输入框，包含模型选择、格式化、参数设置等功能
class AIChatInputBox extends StatelessWidget {
  final TextEditingController textController;
  final VoidCallback onSend;
  final bool isLoading;
  final VoidCallback? onShowModelSelector;
  final String? currentModelName;

  const AIChatInputBox({
    super.key,
    required this.textController,
    required this.onSend,
    this.isLoading = false,
    this.onShowModelSelector,
    this.currentModelName,
  });

  @override
  Widget build(BuildContext context) {
    final tokens = Theme.of(context).extension<LobeTokens>()!;

    return Container(
      margin: EdgeInsets.all(tokens.spaceMd),
      padding: EdgeInsets.all(tokens.spaceMd),
      decoration: BoxDecoration(
        color: tokens.bgLevel2,
        borderRadius: BorderRadius.circular(tokens.radiusLg),
        border: Border.all(color: tokens.divider, width: 1),
      ),
      child: GetBuilder<AIChatInputController>(
        builder: (inputController) {
          return Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              // 格式化工具栏（根据UI状态显示）
              if (inputController.isFormattingToolbarVisible.value)
                Container(
                  padding: EdgeInsets.symmetric(vertical: tokens.spaceXs),
                  decoration: BoxDecoration(
                    color: tokens.bgLevel3,
                    borderRadius: BorderRadius.circular(tokens.radiusMd),
                  ),
                  child: Row(
                    mainAxisAlignment: MainAxisAlignment.center,
                    children: [
                      TextButton.icon(
                        onPressed: isLoading ? null : () {},
                        style: TextButton.styleFrom(
                          foregroundColor: tokens.textSecondary,
                          padding: EdgeInsets.symmetric(horizontal: tokens.spaceSm, vertical: tokens.spaceXs),
                        ),
                        icon: Icon(Icons.format_bold, size: 16),
                        label: Text('B', style: TextStyle(fontSize: 12)),
                      ),
                      TextButton.icon(
                        onPressed: isLoading ? null : () {},
                        style: TextButton.styleFrom(
                          foregroundColor: tokens.textSecondary,
                          padding: EdgeInsets.symmetric(horizontal: tokens.spaceSm, vertical: tokens.spaceXs),
                        ),
                        icon: Icon(Icons.format_italic, size: 16),
                        label: Text('I', style: TextStyle(fontSize: 12)),
                      ),
                    ],
                  ),
                ),
              
              // 主输入区域
              Column(
                children: [
                  // 文本输入框
                  TextField(
                    controller: textController,
                    maxLines: 5,
                    minLines: 1,
                    style: TextStyle(color: tokens.textPrimary, fontSize: 14),
                    decoration: InputDecoration(
                      hintText: 'Type your message here, Press ⌘ to insert a line break...',
                      hintStyle: TextStyle(color: tokens.textTertiary),
                      border: InputBorder.none,
                      contentPadding: EdgeInsets.symmetric(horizontal: tokens.spaceSm, vertical: tokens.spaceMd),
                    ),
                    enabled: !isLoading,
                  ),
                  
                  SizedBox(height: tokens.spaceSm),
                  
                  // 底部工具栏
                  Row(
                    children: [
                      // 左侧功能按钮
                      Row(
                        children: [
                          // 模型选择按钮
                          IconButton(
                            icon: Icon(Icons.smart_toy, size: 20, color: tokens.textSecondary),
                            tooltip: currentModelName ?? 'Select Model',
                            onPressed: isLoading ? null : onShowModelSelector,
                            style: IconButton.styleFrom(padding: EdgeInsets.all(tokens.spaceXs)),
                          ),
                          
                          SizedBox(width: tokens.spaceXs),
                          
                          // 格式化按钮
                          IconButton(
                            icon: Icon(
                              Icons.text_format,
                              size: 20,
                              color: inputController.isFormattingToolbarVisible.value 
                                  ? tokens.brandAccent 
                                  : tokens.textSecondary,
                            ),
                            tooltip: 'Formatting',
                            onPressed: isLoading ? null : inputController.toggleFormattingToolbar,
                            style: IconButton.styleFrom(padding: EdgeInsets.all(tokens.spaceXs)),
                          ),
                        ],
                      ),
                      
                      const Spacer(),
                      
                      // 右侧操作按钮
                      Row(
                        children: [
                          // 发送按钮
                          ElevatedButton(
                            onPressed: isLoading ? null : onSend,
                            style: ElevatedButton.styleFrom(
                              backgroundColor: tokens.brandAccent,
                              foregroundColor: tokens.textPrimary,
                              shape: RoundedRectangleBorder(
                                borderRadius: BorderRadius.circular(tokens.radiusMd),
                              ),
                              padding: EdgeInsets.symmetric(horizontal: tokens.spaceMd, vertical: tokens.spaceSm),
                            ),
                            child: isLoading
                                ? SizedBox(
                                    width: 16,
                                    height: 16,
                                    child: CircularProgressIndicator(
                                      strokeWidth: 2,
                                      valueColor: AlwaysStoppedAnimation<Color>(tokens.textPrimary),
                                    ),
                                  )
                                : Icon(Icons.send, size: 18),
                          ),
                        ],
                      ),
                    ],
                  ),
                ],
              ),
            ],
          );
        },
      ),
    );
  }
}