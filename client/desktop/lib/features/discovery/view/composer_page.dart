import 'dart:io';

import 'package:file_picker/file_picker.dart';
import 'package:flutter/material.dart';
import 'package:get/get.dart';
import 'package:peers_touch_desktop/features/discovery/controller/posting_controller.dart';

class ComposerPage extends GetView<PostingController> {
  const ComposerPage({super.key});

  @override
  Widget build(BuildContext context) {
    // Adaptive sizing based on screen size
    final size = MediaQuery.of(context).size;
    final width = size.width > 800 ? 600.0 : size.width * 0.9;
    final height = size.height * 0.8;

    return Container(
      width: width,
      height: height,
      padding: const EdgeInsets.all(16),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          // Header
          Row(
            mainAxisAlignment: MainAxisAlignment.spaceBetween,
            children: [
              TextButton(
                onPressed: () => Get.back(),
                child: const Text('Cancel'),
              ),
              const Text('New Post', style: TextStyle(fontWeight: FontWeight.bold, fontSize: 16)),
              Obx(() => ElevatedButton(
                onPressed: controller.submitting.value ? null : controller.submit,
                style: ElevatedButton.styleFrom(
                  shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(20)),
                ),
                child: controller.submitting.value 
                  ? const SizedBox(width: 20, height: 20, child: CircularProgressIndicator(strokeWidth: 2)) 
                  : const Text('Post'),
              )),
            ],
          ),
          const SizedBox(height: 16),
          
          // CW Input (if enabled)
          Obx(() {
            if (controller.cwEnabled.value) {
              return Padding(
                padding: const EdgeInsets.only(bottom: 8.0),
                child: TextField(
                  onChanged: (v) => controller.cw.value = v,
                  decoration: const InputDecoration(
                    labelText: 'Content Warning',
                    border: OutlineInputBorder(),
                    isDense: true,
                  ),
                ),
              );
            }
            return const SizedBox.shrink();
          }),

          // Scrollable Body
          Expanded(
            child: SingleChildScrollView(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: [
                  // Main Text Input
                  TextField(
                    onChanged: (v) => controller.text.value = v,
                    maxLines: null,
                    keyboardType: TextInputType.multiline,
                    textAlignVertical: TextAlignVertical.top,
                    decoration: const InputDecoration(
                      hintText: "What's on your mind?",
                      border: InputBorder.none,
                      contentPadding: EdgeInsets.all(8),
                    ),
                  ),
                  const SizedBox(height: 16),

                  // Attachments
                  Obx(() {
                    if (controller.attachments.isEmpty) return const SizedBox.shrink();
                    return SizedBox(
                      height: 100,
                      child: ListView.separated(
                        scrollDirection: Axis.horizontal,
                        itemCount: controller.attachments.length,
                        separatorBuilder: (_, __) => const SizedBox(width: 8),
                        itemBuilder: (context, index) {
                          final file = controller.attachments[index];
                          return Stack(
                            children: [
                              Container(
                                width: 100,
                                height: 100,
                                decoration: BoxDecoration(
                                  borderRadius: BorderRadius.circular(8),
                                  image: DecorationImage(
                                    image: FileImage(file),
                                    fit: BoxFit.cover,
                                  ),
                                ),
                              ),
                              Positioned(
                                right: 4,
                                top: 4,
                                child: GestureDetector(
                                  onTap: () => controller.removeAttachment(file),
                                  child: Container(
                                    padding: const EdgeInsets.all(2),
                                    decoration: const BoxDecoration(
                                      color: Colors.black54,
                                      shape: BoxShape.circle,
                                    ),
                                    child: const Icon(Icons.close, size: 16, color: Colors.white),
                                  ),
                                ),
                              ),
                            ],
                          );
                        },
                      ),
                    );
                  }),
                ],
              ),
            ),
          ),
          
          const Divider(),
          
          // Toolbar
          Row(
            children: [
              IconButton(
                icon: const Icon(Icons.image),
                onPressed: () async {
                  final result = await FilePicker.platform.pickFiles(
                    type: FileType.image,
                    allowMultiple: true,
                  );
                  if (result != null) {
                    for (var path in result.paths) {
                      if (path != null) controller.addAttachment(File(path));
                    }
                  }
                },
                tooltip: 'Add Image',
              ),
              IconButton(
                icon: const Icon(Icons.poll),
                onPressed: () {
                   Get.snackbar('Coming Soon', 'Polls are not yet supported');
                },
                tooltip: 'Add Poll',
              ),
              Obx(() => IconButton(
                icon: Icon(Icons.warning_amber_rounded, 
                  color: controller.cwEnabled.value ? Theme.of(context).primaryColor : null
                ),
                onPressed: controller.toggleCW,
                tooltip: 'Content Warning',
              )),
              const Spacer(),
              // Visibility Selector
              Obx(() => DropdownButton<String>(
                value: controller.visibility.value,
                underline: const SizedBox.shrink(),
                items: const [
                  DropdownMenuItem(value: 'public', child: Row(children: [Icon(Icons.public, size: 18), SizedBox(width: 8), Text('Public')])),
                  DropdownMenuItem(value: 'unlisted', child: Row(children: [Icon(Icons.lock_open, size: 18), SizedBox(width: 8), Text('Unlisted')])),
                  DropdownMenuItem(value: 'followers', child: Row(children: [Icon(Icons.people, size: 18), SizedBox(width: 8), Text('Followers')])),
                  DropdownMenuItem(value: 'direct', child: Row(children: [Icon(Icons.email, size: 18), SizedBox(width: 8), Text('Direct')])),
                ],
                onChanged: (v) => controller.setVisibility(v ?? 'public'),
              )),
            ],
          ),
          
          // Error Message
          Obx(() => controller.errorText.value != null
            ? Padding(
                padding: const EdgeInsets.only(top: 8.0),
                child: Text(controller.errorText.value!, style: const TextStyle(color: Colors.red)),
              )
            : const SizedBox.shrink()
          ),
        ],
      ),
    );
  }
}
