import 'package:peers_touch_desktop/controller/knowledge_base_controller.dart';
import 'package:flutter/material.dart';
import 'package:get/get.dart';

class KnowledgeBasePage extends StatelessWidget {
  const KnowledgeBasePage({super.key});

  @override
  Widget build(BuildContext context) {
    final controller = Get.put(KnowledgeBaseController());

    return Scaffold(
      appBar: AppBar(
        title: Text('Knowledge Base'),
      ),
      body: Obx(() => ListView.builder(
        itemCount: controller.files.length,
        itemBuilder: (context, index) {
          return ListTile(
            title: Text(controller.files[index]),
            leading: Icon(Icons.insert_drive_file),
          );
        },
      )),
    );
  }
}