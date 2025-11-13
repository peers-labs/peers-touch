import 'package:flutter/material.dart';
import 'package:get/get.dart';
import 'package:peers_touch_desktop/features/chat/controller/friend_search_controller.dart';

class FriendSearchPanel extends StatelessWidget {
  const FriendSearchPanel({super.key});

  @override
  Widget build(BuildContext context) {
    final ctrl = Get.find<FriendSearchController>();
    return Column(children: [
      TextField(
        decoration: const InputDecoration(prefixIcon: Icon(Icons.search), hintText: '输入用户名搜索'),
        onChanged: ctrl.search,
      ),
      const SizedBox(height: 12),
      Expanded(
        child: Obx(() {
          final items = ctrl.results;
          if (ctrl.isLoading.value) {
            return const Center(child: CircularProgressIndicator());
          }
          if (items.isEmpty) {
            return const Center(child: Text('暂无结果'));
          }
          return ListView.builder(
            itemCount: items.length,
            itemBuilder: (ctx, i) {
              final u = items[i];
              return ListTile(
                leading: const CircleAvatar(radius: 14),
                title: Text(u.displayName.isNotEmpty ? u.displayName : u.handle),
                subtitle: Text(u.handle),
                trailing: IconButton(onPressed: () {}, icon: const Icon(Icons.chat_bubble)),
              );
            },
          );
        }),
      ),
    ]);
  }
}