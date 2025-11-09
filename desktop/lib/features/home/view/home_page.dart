import 'package:flutter/material.dart';
import 'package:get/get.dart';
import 'package:peers_touch_desktop/app/theme/ui_kit.dart';

import 'package:peers_touch_desktop/app/routes/app_routes.dart';
import 'package:peers_touch_desktop/core/components/common_button.dart';
import 'package:peers_touch_desktop/features/home/controller/home_controller.dart';

class HomePage extends StatelessWidget {
  const HomePage({super.key});

  @override
  Widget build(BuildContext context) {
    final controller = Get.find<HomeController>();
    return Scaffold(
      appBar: AppBar(
        title: Text('home'.tr),
        actions: [
          IconButton(
            tooltip: 'increment',
            icon: const Icon(Icons.add),
            onPressed: controller.increment,
          ),
        ],
      ),
      body: Obx(
        () => Padding(
          padding: EdgeInsets.all(UIKit.spaceLg(context)),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text('${controller.count.value}'),
              SizedBox(height: UIKit.spaceMd(context)),
              ...controller.feed.map((e) => Text(e)),
              SizedBox(height: UIKit.spaceXl(context)),
              CommonButton(
                text: 'Go Profile',
                onPressed: () => Get.toNamed(AppRoutes.profile),
              ),
            ],
          ),
        ),
      ),
      floatingActionButton: null,
      // 桌面/Web 环境下移除 FAB，避免未布局命中测试异常；将操作移至 AppBar actions。
    );
  }
}