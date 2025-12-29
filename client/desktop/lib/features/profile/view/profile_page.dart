import 'package:flutter/material.dart';
import 'package:get/get.dart';
import 'package:peers_touch_desktop/app/theme/theme_tokens.dart';
import 'package:peers_touch_desktop/app/theme/ui_kit.dart';
import 'package:peers_touch_desktop/features/profile/controller/profile_controller.dart';
import 'package:peers_touch_desktop/features/profile/view/edit_profile_dialog.dart';
import 'package:peers_touch_desktop/features/profile/view/widgets/user_profile_card.dart';
import 'package:peers_touch_desktop/features/shell/widgets/three_pane_scaffold.dart';

class ProfilePage extends StatelessWidget {
  const ProfilePage({super.key, this.embedded = false});
  final bool embedded;

  @override
  Widget build(BuildContext context) {
    final controller = Get.find<ProfileController>();
    final theme = Theme.of(context);
    final wx = theme.extension<WeChatTokens>();

    final body = Obx(() {
      final d = controller.detail.value;
      if (d == null) {
        return const Center(child: Text('No user'));
      }

      final card = UserProfileCard(
        detail: d,
        embedded: embedded,
        isCurrentUser: true,
        showEditProfile: true,
        showFollow: false,
        showMessages: false,
        onEditProfile: () {
          Get.dialog(const EditProfileDialog());
        },
      );

      if (embedded) {
        return card;
      }

      return Center(
        child: ConstrainedBox(
          constraints: const BoxConstraints(maxWidth: UIKit.contentMaxWidth),
          child: Padding(
            padding: EdgeInsets.all(UIKit.spaceLg(context)),
            child: card,
          ),
        ),
      );
    });

    if (embedded) {
      return body;
    }
    // 非嵌入模式采用统一的三段式骨架（仅使用 center 区域）
    return ShellThreePane(
      centerBuilder: (context) => body,
      centerProps: const PaneProps(
        scrollPolicy: ScrollPolicy.auto,
        horizontalPolicy: ScrollPolicy.none,
      ),
    );
  }
}
