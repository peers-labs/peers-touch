import 'package:flutter/material.dart';
import 'package:get/get.dart';
import 'package:peers_touch_desktop/app/theme/lobe_tokens.dart';
import 'package:peers_touch_desktop/app/theme/ui_kit.dart';
import 'package:peers_touch_desktop/features/ai_chat/controller/provider_controller.dart';
import 'package:peers_touch_desktop/features/ai_chat/model/provider.dart';

class AddModelDialog extends StatefulWidget {
  final Provider provider;

  const AddModelDialog({super.key, required this.provider});

  @override
  State<AddModelDialog> createState() => _AddModelDialogState();
}

class _AddModelDialogState extends State<AddModelDialog> {
  final _formKey = GlobalKey<FormState>();
  final _modelIdController = TextEditingController();
  final _displayNameController = TextEditingController();
  final _contextSizeController = TextEditingController(text: '4096');
  bool _supportTool = false;
  bool _supportVision = false;
  bool _supportDeepThinking = false;
  bool _supportWebSearch = false;
  bool _supportImageGeneration = false;
  bool _supportVideoRecognition = false;
  String? _modelType;

  @override
  void dispose() {
    _modelIdController.dispose();
    _displayNameController.dispose();
    _contextSizeController.dispose();
    super.dispose();
  }

  void _submitForm() {
    if (_formKey.currentState!.validate()) {
      final newModel = {
        'id': _modelIdController.text.trim(),
        'name': _displayNameController.text.trim(),
        'contextSize': int.tryParse(_contextSizeController.text) ?? 4096,
        'capabilities': {
          'tool': _supportTool,
          'vision': _supportVision,
          'deepThinking': _supportDeepThinking,
          'webSearch': _supportWebSearch,
          'imageGeneration': _supportImageGeneration,
          'videoRecognition': _supportVideoRecognition,
        },
        'type': _modelType,
      };

      Get.find<ProviderController>().addModelToProvider(
        widget.provider.id,
        newModel,
      );

      Get.back();
    }
  }

  @override
  Widget build(BuildContext context) {
    final tokens = Theme.of(context).extension<LobeTokens>()!;

    return Dialog(
      backgroundColor: tokens.bgLevel2,
      shape: RoundedRectangleBorder(
        borderRadius: BorderRadius.circular(UIKit.radiusLg(context)),
      ),
      child: Container(
        width: 500,
        padding: EdgeInsets.all(UIKit.spaceLg(context)),
        child: Form(
          key: _formKey,
          child: SingleChildScrollView(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text('创建自定义AI模型', style: Theme.of(context).textTheme.headlineSmall),
                const SizedBox(height: 20),
                TextFormField(
                  controller: _modelIdController,
                  decoration: UIKit.inputDecoration(context).copyWith(
                    labelText: '模型ID *',
                    hintText: '例如：gpt-4o 或 claude-3-5-sonnet',
                    border: OutlineInputBorder(),
                  ),
                  validator: (value) => value?.isEmpty ?? true ? '模型ID不能为空' : null,
                ),
                const SizedBox(height: 16),
                TextFormField(
                  controller: _displayNameController,
                  decoration: UIKit.inputDecoration(context).copyWith(
                    labelText: '模型显示名称',
                    hintText: '例如：ChatGPT、GPT-4等',
                    border: OutlineInputBorder(),
                  ),
                ),
                const SizedBox(height: 16),
                Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text('最大上下文长度'),
                    const SizedBox(height: 8),
                    Row(
                      children: [
                        _buildContextButton('4K', '4096'),
                        _buildContextButton('8K', '8192'),
                        _buildContextButton('16K', '16384'),
                        _buildContextButton('32K', '32768'),
                        _buildContextButton('64K', '65536'),
                        _buildContextButton('200K', '200000'),
                        _buildContextButton('1M', '1000000'),
                        _buildContextButton('2M', '2000000'),
                        const SizedBox(width: 10),
                        Expanded(
                          child: TextFormField(
                    controller: _contextSizeController,
                    keyboardType: TextInputType.number,
                    decoration: UIKit.inputDecoration(context).copyWith(
                      border: OutlineInputBorder(),
                    ),
                          ),
                        ),
                      ],
                    ),
                  ],
                ),
                const SizedBox(height: 24),
                Text('工具支持', style: Theme.of(context).textTheme.titleMedium),
                CheckboxListTile(
                  title: Text('启用工具使用能力'),
                  subtitle: Text('允许模型使用插件和工具'),
                  value: _supportTool,
                  onChanged: (value) => setState(() => _supportTool = value ?? false),
                ),
                CheckboxListTile(
                  title: Text('支持视觉能力'),
                  subtitle: Text('启用图片上传功能'),
                  value: _supportVision,
                  onChanged: (value) => setState(() => _supportVision = value ?? false),
                ),
                CheckboxListTile(
                  title: Text('支持深度思考'),
                  subtitle: Text('启用高级推理能力'),
                  value: _supportDeepThinking,
                  onChanged: (value) => setState(() => _supportDeepThinking = value ?? false),
                ),
                CheckboxListTile(
                  title: Text('支持网络搜索'),
                  subtitle: Text('启用内置网络搜索功能'),
                  value: _supportWebSearch,
                  onChanged: (value) => setState(() => _supportWebSearch = value ?? false),
                ),
                CheckboxListTile(
                  title: Text('支持图片生成'),
                  subtitle: Text('启用文本转图片功能'),
                  value: _supportImageGeneration,
                  onChanged: (value) => setState(() => _supportImageGeneration = value ?? false),
                ),
                CheckboxListTile(
                  title: Text('支持视频识别'),
                  subtitle: Text('启用视频内容分析功能'),
                  value: _supportVideoRecognition,
                  onChanged: (value) => setState(() => _supportVideoRecognition = value ?? false),
                ),
                const SizedBox(height: 16),
                DropdownButtonFormField<String>(
                  decoration: UIKit.inputDecoration(context).copyWith(
                    labelText: '模型类型',
                    border: OutlineInputBorder(),
                  ),
                  items: ['聊天', '补全', '嵌入', '图像', '音频']
                      .map((type) => DropdownMenuItem(value: type, child: Text(type)))
                      .toList(),
                  onChanged: (value) => setState(() => _modelType = value),
                ),
                const SizedBox(height: 24),
                Row(
                  mainAxisAlignment: MainAxisAlignment.end,
                  children: [
                    TextButton(
                      onPressed: () => Get.back(),
                      child: const Text('取消'),
                    ),
                    const SizedBox(width: 8),
                    ElevatedButton(
                      onPressed: _submitForm,
                      style: UIKit.primaryButtonStyle(context),
                      child: const Text('确定'),
                    ),
                  ],
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }

  Widget _buildContextButton(String label, String value) {
    return Padding(
      padding: const EdgeInsets.symmetric(horizontal: 4),
      child: ElevatedButton(
        onPressed: () => setState(() => _contextSizeController.text = value),
        style: ElevatedButton.styleFrom(
          backgroundColor: _contextSizeController.text == value
              ? Theme.of(context).colorScheme.primary
              : Theme.of(context).colorScheme.surface,
        ),
        child: Text(label),
      ),
    );
  }
}