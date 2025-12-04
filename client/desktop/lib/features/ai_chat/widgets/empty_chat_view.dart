import 'package:flutter/material.dart';
import 'package:get/get.dart';
import 'package:peers_touch_base/i18n/generated/app_localizations.dart';
import 'package:peers_touch_desktop/app/theme/ui_kit.dart';
import 'package:peers_touch_desktop/features/shell/controller/shell_controller.dart';

class EmptyChatView extends StatelessWidget {
  const EmptyChatView({super.key});

  @override
  Widget build(BuildContext context) {
    final l = AppLocalizations.of(context)!;
    return Center(
      child: Column(
        mainAxisAlignment: MainAxisAlignment.center,
        children: [
          Text(
            l.emptyChatNoModels,
            style: Theme.of(context).textTheme.titleMedium,
          ),
          SizedBox(height: UIKit.spaceLg(context)),
          ElevatedButton.icon(
            onPressed: () {
              final shell = Get.find<ShellController>();
              shell.selectMenuItemById('settings');
            },
            icon: const Icon(Icons.settings),
            label: Text(l.goToSettings),
          ),
        ],
      ),
    );
  }
}