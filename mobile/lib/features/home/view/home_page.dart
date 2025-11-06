import 'package:flutter/material.dart';
import 'package:get/get.dart';
import 'package:peers_touch_mobile/features/home/controller/home_controller.dart';

class HomePage extends StatelessWidget {
  const HomePage({super.key});

  @override
  Widget build(BuildContext context) {
    final HomeController controller = Get.find<HomeController>();
    return Scaffold(
      appBar: AppBar(
        title: const Text('Home'),
      ),
      body: Center(
        child: Obx(() => Text(
              'Counter: ${controller.counter}',
              style: Theme.of(context).textTheme.titleLarge,
            )),
      ),
      floatingActionButton: FloatingActionButton(
        onPressed: controller.increment,
        child: const Icon(Icons.add),
      ),
    );
  }
}