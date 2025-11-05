import 'package:flutter/material.dart';
import 'package:get/get.dart';

import '../../../app/routes/app_routes.dart';
import '../../../core/components/common_button.dart';
import '../controller/home_controller.dart';

class HomePage extends StatelessWidget {
  const HomePage({super.key});

  @override
  Widget build(BuildContext context) {
    final controller = Get.find<HomeController>();
    return Scaffold(
      appBar: AppBar(title: Text('home'.tr)),
      body: Obx(
        () => Padding(
          padding: const EdgeInsets.all(16),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text('${controller.count.value}'),
              const SizedBox(height: 12),
              ...controller.feed.map((e) => Text(e)),
              const SizedBox(height: 24),
              CommonButton(
                text: 'Go Profile',
                onPressed: () => Get.toNamed(AppRoutes.profile),
              ),
            ],
          ),
        ),
      ),
      floatingActionButton: FloatingActionButton(
        onPressed: controller.increment,
        child: const Icon(Icons.add),
      ),
    );
  }
}