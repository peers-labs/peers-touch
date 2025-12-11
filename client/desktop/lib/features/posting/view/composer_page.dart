import 'package:flutter/material.dart';
import 'package:get/get.dart';
import 'package:peers_touch_desktop/features/posting/controller/posting_controller.dart';
import 'package:peers_touch_base/model/domain/post/post.pb.dart' as pb;

class ComposerPage extends GetView<PostingController> {
  const ComposerPage({super.key});

  @override
  Widget build(BuildContext context) {
    final textCtrl = TextEditingController();
    final cwCtrl = TextEditingController();
    final vis = 'public'.obs;

    return Scaffold(
      backgroundColor: Theme.of(context).colorScheme.surface,
      body: Padding(
        padding: const EdgeInsets.all(24),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              children: [
                const Text('发帖', style: TextStyle(fontSize: 20, fontWeight: FontWeight.bold)),
                const Spacer(),
                Obx(() => DropdownButton<String>(
                      value: vis.value,
                      items: const [
                        DropdownMenuItem(value: 'public', child: Text('公开')),
                        DropdownMenuItem(value: 'followers', child: Text('仅关注者')),
                        DropdownMenuItem(value: 'direct', child: Text('私密/直发')),
                      ],
                      onChanged: (v) => vis.value = v ?? 'public',
                    )),
              ],
            ),
            const SizedBox(height: 16),
            TextField(
              controller: textCtrl,
              maxLines: 8,
              decoration: const InputDecoration(
                hintText: '写点什么...',
                border: OutlineInputBorder(),
              ),
            ),
            const SizedBox(height: 12),
            TextField(
              controller: cwCtrl,
              decoration: const InputDecoration(
                hintText: '内容预警（可选）',
                border: OutlineInputBorder(),
              ),
            ),
            const SizedBox(height: 12),
            Obx(() => ElevatedButton(
                  onPressed: controller.submitting.value
                      ? null
                      : () async {
                          final input = pb.PostInput(
                            text: textCtrl.text.trim(),
                            cw: cwCtrl.text.trim(),
                            visibility: vis.value,
                          );
                          final res = await controller.submit(input);
                          if (res != null) {
                            Get.snackbar('发帖成功', 'activityId: ${res.activityId}');
                          }
                        },
                  child: controller.submitting.value ? const CircularProgressIndicator() : const Text('发布'),
                )),
            Obx(() => controller.errorText.value == null
                ? const SizedBox.shrink()
                : Padding(
                    padding: const EdgeInsets.only(top: 8),
                    child: Text(controller.errorText.value!, style: const TextStyle(color: Colors.red)),
                  )),
          ],
        ),
      ),
    );
  }
}

