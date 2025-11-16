import 'package:flutter/material.dart';
import 'package:get/get.dart';
import 'package:peers_touch_desktop/app/theme/ui_kit.dart';
import 'package:peers_touch_desktop/app/theme/theme_tokens.dart';
import 'package:peers_touch_desktop/features/peers_admin/peers_admin_controller.dart';
import 'package:peers_touch_desktop/features/shell/widgets/three_pane_scaffold.dart';

class PeersAdminPage extends StatelessWidget {
  const PeersAdminPage({super.key});

  @override
  Widget build(BuildContext context) {
    final controller = Get.find<PeersAdminController>();
    final theme = Theme.of(context);
    final tokens = theme.extension<WeChatTokens>()!;

    return ShellThreePane(
      leftBuilder: (ctx) => _buildLeftMenu(ctx, controller, tokens),
      centerBuilder: (ctx) => _buildCenter(ctx, controller, tokens),
      leftProps: const PaneProps(
        width: 280,
        minWidth: 220,
        maxWidth: 360,
        scrollPolicy: ScrollPolicy.always, // 垂直滚动始终可用
        horizontalPolicy: ScrollPolicy.none, // 左侧不需要横向滚动
      ),
      centerProps: const PaneProps(
        padding: EdgeInsets.all(16),
        scrollPolicy: ScrollPolicy.auto, // 纵向按需滚动
        horizontalPolicy: ScrollPolicy.auto, // 横向按需滚动
      ),
    );
  }

  Widget _buildLeftMenu(BuildContext context, PeersAdminController controller, WeChatTokens tokens) {
    final items = [
      ('management', '管理', Icons.admin_panel_settings),
      ('peer', 'Peer', Icons.hub),
      ('activitypub', 'ActivityPub', Icons.public),
      ('wellknown', 'Well-Known', Icons.info_outline),
      ('actor', 'Actor', Icons.person_outline),
    ];
    return Obx(() {
      final current = controller.currentSection.value;
      return ListView.separated(
        padding: EdgeInsets.all(UIKit.spaceSm(context)),
        itemBuilder: (ctx, index) {
          final (id, label, icon) = items[index];
          final selected = id == current;
          return InkWell(
            onTap: () => controller.setSection(id),
            child: Container(
              padding: EdgeInsets.symmetric(vertical: 10, horizontal: UIKit.spaceSm(context)),
              decoration: BoxDecoration(
                color: selected ? tokens.bgLevel1 : Colors.transparent,
                borderRadius: BorderRadius.circular(tokens.radiusSm),
              ),
              child: Row(children: [
                Icon(icon, size: 18, color: tokens.textPrimary),
                SizedBox(width: UIKit.spaceSm(context)),
                Expanded(child: Text(label, style: TextStyle(color: tokens.textPrimary))),
                if (selected)
                  Icon(Icons.chevron_right, size: 18, color: tokens.textSecondary),
              ]),
            ),
          );
        },
        separatorBuilder: (ctx, _) => SizedBox(height: UIKit.spaceXs(ctx)),
        itemCount: items.length,
      );
    });
  }

  Widget _buildCenter(BuildContext context, PeersAdminController controller, WeChatTokens tokens) {
    return Obx(() {
      final id = controller.currentSection.value;
      switch (id) {
        case 'management':
          return _centerManagement(context, controller, tokens);
        case 'peer':
          return _centerPeer(context, controller, tokens);
        case 'activitypub':
          return _centerActivityPub(context, controller, tokens);
        case 'wellknown':
          return _centerWellKnown(context, controller, tokens);
        case 'actor':
          return _centerActor(context, controller, tokens);
        default:
          return _centerPlaceholder(context, controller, tokens, title: 'overview');
      }
    });
  }

  // 管理中心页
  Widget _centerManagement(BuildContext context, PeersAdminController controller, WeChatTokens tokens) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Row(children: [
          Text('管理', style: TextStyle(fontSize: 16, fontWeight: FontWeight.w600, color: tokens.textPrimary)),
          const Spacer(),
          TextButton.icon(onPressed: controller.openBlankExtension, icon: const Icon(Icons.open_in_new), label: const Text('打开扩展页')),
        ]),
        SizedBox(height: UIKit.spaceSm(context)),
        Wrap(spacing: UIKit.spaceSm(context), runSpacing: UIKit.spaceSm(context), children: [
          ElevatedButton.icon(onPressed: controller.healthCheck, icon: const Icon(Icons.health_and_safety), label: const Text('Health')),
          ElevatedButton.icon(onPressed: controller.ping, icon: const Icon(Icons.wifi_tethering), label: const Text('Ping')),
        ]),
        SizedBox(height: UIKit.spaceSm(context)),
        _backendHint(context, controller, tokens),
        SizedBox(height: UIKit.spaceMd(context)),
        _resultArea(context, controller, tokens),
      ],
    );
  }

  // Peer 中心页
  Widget _centerPeer(BuildContext context, PeersAdminController controller, WeChatTokens tokens) {
    final peerIdCtrl = TextEditingController();
    final addrCtrl = TextEditingController();
    final peerAddrCtrl = TextEditingController();
    final typ = RxString('http');

    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Row(children: [
          Text('Peer', style: TextStyle(fontSize: 16, fontWeight: FontWeight.w600, color: tokens.textPrimary)),
          const Spacer(),
          TextButton.icon(onPressed: controller.openBlankExtension, icon: const Icon(Icons.open_in_new), label: const Text('打开扩展页')),
        ]),
        SizedBox(height: UIKit.spaceSm(context)),
        Row(children: [
          Expanded(child: TextField(controller: peerIdCtrl, decoration: const InputDecoration(labelText: 'peer_id'))),
          SizedBox(width: UIKit.spaceSm(context)),
          Expanded(child: TextField(controller: addrCtrl, decoration: const InputDecoration(labelText: 'addr'))),
          SizedBox(width: UIKit.spaceSm(context)),
          Obx(() => DropdownButton<String>(
            value: typ.value,
            items: const [
              DropdownMenuItem(value: 'http', child: Text('http')),
              DropdownMenuItem(value: 'stun', child: Text('stun')),
              DropdownMenuItem(value: 'turn', child: Text('turn')),
            ],
            onChanged: (v) { if (v != null) typ.value = v; },
          )),
          SizedBox(width: UIKit.spaceSm(context)),
          ElevatedButton(
            onPressed: () => controller.setPeerAddr(peerId: peerIdCtrl.text.trim(), addr: addrCtrl.text.trim(), typ: typ.value),
            child: const Text('Set Addr'),
          ),
        ]),
        SizedBox(height: UIKit.spaceSm(context)),
        Wrap(spacing: UIKit.spaceSm(context), runSpacing: UIKit.spaceSm(context), children: [
          ElevatedButton.icon(onPressed: controller.getMyPeerInfo, icon: const Icon(Icons.info), label: const Text('Get My Peer Info')),
        ]),
        SizedBox(height: UIKit.spaceSm(context)),
        Row(children: [
          Expanded(child: TextField(controller: peerAddrCtrl, decoration: const InputDecoration(labelText: 'peer_address'))),
          SizedBox(width: UIKit.spaceSm(context)),
          ElevatedButton(
            onPressed: () => controller.touchHiTo(peerAddress: peerAddrCtrl.text.trim()),
            child: const Text('Touch Hi To'),
          ),
        ]),
        SizedBox(height: UIKit.spaceMd(context)),
        _resultArea(context, controller, tokens),
      ],
    );
  }

  // ActivityPub 中心页
  Widget _centerActivityPub(BuildContext context, PeersAdminController controller, WeChatTokens tokens) {
    final usernameCtrl = TextEditingController();
    final targetCtrl = TextEditingController();
    final objectCtrl = TextEditingController();
    final activityCtrl = TextEditingController();

    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Row(children: [
          Text('ActivityPub', style: TextStyle(fontSize: 16, fontWeight: FontWeight.w600, color: tokens.textPrimary)),
          const Spacer(),
          TextButton.icon(onPressed: controller.openBlankExtension, icon: const Icon(Icons.open_in_new), label: const Text('打开扩展页')),
        ]),
        SizedBox(height: UIKit.spaceSm(context)),
        Row(children: [
          Expanded(child: TextField(controller: usernameCtrl, decoration: const InputDecoration(labelText: 'username'))),
          SizedBox(width: UIKit.spaceSm(context)),
          ElevatedButton(onPressed: () => controller.getApActor(username: usernameCtrl.text.trim()), child: const Text('Actor')),
          SizedBox(width: UIKit.spaceSm(context)),
          ElevatedButton(onPressed: () => controller.getApInbox(username: usernameCtrl.text.trim()), child: const Text('Inbox GET')),
          SizedBox(width: UIKit.spaceSm(context)),
          ElevatedButton(onPressed: () => controller.getApOutbox(username: usernameCtrl.text.trim()), child: const Text('Outbox GET')),
        ]),
        SizedBox(height: UIKit.spaceSm(context)),
        Row(children: [
          Expanded(child: TextField(controller: activityCtrl, decoration: const InputDecoration(labelText: 'activity (for Inbox/Outbox POST)'))),
          SizedBox(width: UIKit.spaceSm(context)),
          ElevatedButton(onPressed: () => controller.postApInbox(username: usernameCtrl.text.trim(), activity: activityCtrl.text.trim()), child: const Text('Inbox POST')),
          SizedBox(width: UIKit.spaceSm(context)),
          ElevatedButton(onPressed: () => controller.postApOutbox(username: usernameCtrl.text.trim(), activity: activityCtrl.text.trim()), child: const Text('Outbox POST')),
        ]),
        SizedBox(height: UIKit.spaceSm(context)),
        Wrap(spacing: UIKit.spaceSm(context), runSpacing: UIKit.spaceSm(context), children: [
          ElevatedButton(onPressed: () => controller.getApFollowers(username: usernameCtrl.text.trim()), child: const Text('Followers')),
          ElevatedButton(onPressed: () => controller.getApFollowing(username: usernameCtrl.text.trim()), child: const Text('Following')),
          ElevatedButton(onPressed: () => controller.getApLiked(username: usernameCtrl.text.trim()), child: const Text('Liked')),
        ]),
        SizedBox(height: UIKit.spaceSm(context)),
        Row(children: [
          Expanded(child: TextField(controller: targetCtrl, decoration: const InputDecoration(labelText: 'target (for Follow/Unfollow)'))),
          SizedBox(width: UIKit.spaceSm(context)),
          ElevatedButton(onPressed: () => controller.postApFollow(username: usernameCtrl.text.trim(), target: targetCtrl.text.trim()), child: const Text('Follow')),
          SizedBox(width: UIKit.spaceSm(context)),
          ElevatedButton(onPressed: () => controller.postApUnfollow(username: usernameCtrl.text.trim(), target: targetCtrl.text.trim()), child: const Text('Unfollow')),
        ]),
        SizedBox(height: UIKit.spaceSm(context)),
        Row(children: [
          Expanded(child: TextField(controller: objectCtrl, decoration: const InputDecoration(labelText: 'object (for Like/Undo)'))),
          SizedBox(width: UIKit.spaceSm(context)),
          ElevatedButton(onPressed: () => controller.postApLike(username: usernameCtrl.text.trim(), objectId: objectCtrl.text.trim()), child: const Text('Like')),
          SizedBox(width: UIKit.spaceSm(context)),
          ElevatedButton(onPressed: () => controller.postApUndo(username: usernameCtrl.text.trim(), activityId: objectCtrl.text.trim()), child: const Text('Undo')),
        ]),
        SizedBox(height: UIKit.spaceSm(context)),
        Row(children: [
          Expanded(child: TextField(controller: activityCtrl, decoration: const InputDecoration(labelText: 'message (for Chat)'))),
          SizedBox(width: UIKit.spaceSm(context)),
          ElevatedButton(onPressed: () => controller.postApChat(username: usernameCtrl.text.trim(), message: activityCtrl.text.trim()), child: const Text('Chat')),
        ]),
        SizedBox(height: UIKit.spaceMd(context)),
        _resultArea(context, controller, tokens),
      ],
    );
  }

  // Well-Known / WebFinger 中心页
  Widget _centerWellKnown(BuildContext context, PeersAdminController controller, WeChatTokens tokens) {
    final resourceCtrl = TextEditingController();
    final relCtrl = TextEditingController();
    final versionCtrl = TextEditingController(text: '1.0');

    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Row(children: [
          Text('Well-Known', style: TextStyle(fontSize: 16, fontWeight: FontWeight.w600, color: tokens.textPrimary)),
          const Spacer(),
          TextButton.icon(onPressed: controller.openBlankExtension, icon: const Icon(Icons.open_in_new), label: const Text('打开扩展页')),
        ]),
        SizedBox(height: UIKit.spaceSm(context)),
        Wrap(spacing: UIKit.spaceSm(context), runSpacing: UIKit.spaceSm(context), children: [
          ElevatedButton(onPressed: controller.callWellKnownHello, child: const Text('POST /.well-known')),
        ]),
        SizedBox(height: UIKit.spaceSm(context)),
        Row(children: [
          Expanded(child: TextField(controller: resourceCtrl, decoration: const InputDecoration(labelText: 'resource (e.g. acct:user@domain)'))),
          SizedBox(width: UIKit.spaceSm(context)),
          Expanded(child: TextField(controller: versionCtrl, decoration: const InputDecoration(labelText: 'activity_pub_version'))),
        ]),
        SizedBox(height: UIKit.spaceSm(context)),
        Row(children: [
          Expanded(child: TextField(controller: relCtrl, decoration: const InputDecoration(labelText: 'rel (comma-separated)'))),
          SizedBox(width: UIKit.spaceSm(context)),
          ElevatedButton(
            onPressed: () {
              final rels = relCtrl.text.trim().isEmpty
                  ? <String>[]
                  : relCtrl.text.trim().split(',').map((e) => e.trim()).where((e) => e.isNotEmpty).toList();
              controller.webfinger(resource: resourceCtrl.text.trim(), activityPubVersion: versionCtrl.text.trim(), rels: rels);
            },
            child: const Text('GET /webfinger'),
          ),
        ]),
        SizedBox(height: UIKit.spaceMd(context)),
        _resultArea(context, controller, tokens),
      ],
    );
  }

  // Actor 中心页
  Widget _centerActor(BuildContext context, PeersAdminController controller, WeChatTokens tokens) {
    final nameCtrl = TextEditingController();
    final signEmailCtrl = TextEditingController();
    final signPasswordCtrl = TextEditingController();
    final loginEmailCtrl = TextEditingController();
    final loginPasswordCtrl = TextEditingController();
    final profilePhotoCtrl = TextEditingController();
    final regionCtrl = TextEditingController();
    final emailCtrl = TextEditingController();
    final whatsUpCtrl = TextEditingController();
    final gender = RxString('other');

    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Row(children: [
          Text('Actor', style: TextStyle(fontSize: 16, fontWeight: FontWeight.w600, color: tokens.textPrimary)),
          const Spacer(),
          TextButton.icon(onPressed: controller.openBlankExtension, icon: const Icon(Icons.open_in_new), label: const Text('打开扩展页')),
        ]),
        SizedBox(height: UIKit.spaceSm(context)),
        // Sign Up
        Text('注册', style: TextStyle(color: tokens.textSecondary)),
        SizedBox(height: UIKit.spaceXs(context)),
        Row(children: [
          Expanded(child: TextField(controller: nameCtrl, decoration: const InputDecoration(labelText: 'name'))),
          SizedBox(width: UIKit.spaceSm(context)),
          Expanded(child: TextField(controller: signEmailCtrl, decoration: const InputDecoration(labelText: 'email'))),
          SizedBox(width: UIKit.spaceSm(context)),
          Expanded(child: TextField(controller: signPasswordCtrl, decoration: const InputDecoration(labelText: 'password'), obscureText: true)),
          SizedBox(width: UIKit.spaceSm(context)),
          ElevatedButton(
            onPressed: () => controller.actorSignUp(name: nameCtrl.text.trim(), email: signEmailCtrl.text.trim(), password: signPasswordCtrl.text.trim()),
            child: const Text('Sign Up'),
          ),
        ]),
        SizedBox(height: UIKit.spaceSm(context)),
        // Login
        Text('登录', style: TextStyle(color: tokens.textSecondary)),
        SizedBox(height: UIKit.spaceXs(context)),
        Row(children: [
          Expanded(child: TextField(controller: loginEmailCtrl, decoration: const InputDecoration(labelText: 'email'))),
          SizedBox(width: UIKit.spaceSm(context)),
          Expanded(child: TextField(controller: loginPasswordCtrl, decoration: const InputDecoration(labelText: 'password'), obscureText: true)),
          SizedBox(width: UIKit.spaceSm(context)),
          ElevatedButton(onPressed: () => controller.actorLogin(email: loginEmailCtrl.text.trim(), password: loginPasswordCtrl.text.trim()), child: const Text('Login')),
        ]),
        SizedBox(height: UIKit.spaceSm(context)),
        // Profile
        Text('资料', style: TextStyle(color: tokens.textSecondary)),
        SizedBox(height: UIKit.spaceXs(context)),
        Wrap(spacing: UIKit.spaceSm(context), runSpacing: UIKit.spaceSm(context), children: [
          ElevatedButton(onPressed: controller.getActorProfile, child: const Text('Get Profile')),
        ]),
        SizedBox(height: UIKit.spaceXs(context)),
        Row(children: [
          Expanded(child: TextField(controller: profilePhotoCtrl, decoration: const InputDecoration(labelText: 'profile_photo'))),
          SizedBox(width: UIKit.spaceSm(context)),
          Expanded(child: TextField(controller: regionCtrl, decoration: const InputDecoration(labelText: 'region'))),
          SizedBox(width: UIKit.spaceSm(context)),
          Expanded(child: TextField(controller: emailCtrl, decoration: const InputDecoration(labelText: 'email'))),
        ]),
        SizedBox(height: UIKit.spaceSm(context)),
        Row(children: [
          Expanded(child: TextField(controller: whatsUpCtrl, decoration: const InputDecoration(labelText: 'whats_up'))),
          SizedBox(width: UIKit.spaceSm(context)),
          Obx(() => DropdownButton<String>(
                value: gender.value,
                items: const [
                  DropdownMenuItem(value: 'male', child: Text('male')),
                  DropdownMenuItem(value: 'female', child: Text('female')),
                  DropdownMenuItem(value: 'other', child: Text('other')),
                ],
                onChanged: (v) {
                  if (v != null) gender.value = v;
                },
              )),
          SizedBox(width: UIKit.spaceSm(context)),
          ElevatedButton(
            onPressed: () => controller.updateActorProfile(
              profilePhoto: profilePhotoCtrl.text.trim(),
              region: regionCtrl.text.trim(),
              email: emailCtrl.text.trim(),
              whatsUp: whatsUpCtrl.text.trim(),
              gender: gender.value,
            ),
            child: const Text('Update Profile'),
          ),
        ]),
        SizedBox(height: UIKit.spaceMd(context)),
        _resultArea(context, controller, tokens),
      ],
    );
  }

  Widget _centerPlaceholder(BuildContext context, PeersAdminController controller, WeChatTokens tokens, {required String title}) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Row(children: [
          Text(title, style: TextStyle(fontSize: 16, fontWeight: FontWeight.w600, color: tokens.textPrimary)),
          const Spacer(),
          TextButton.icon(onPressed: controller.openBlankExtension, icon: const Icon(Icons.open_in_new), label: const Text('打开扩展页')),
        ]),
        SizedBox(height: UIKit.spaceSm(context)),
        Text('该分区暂未实现，敬请期待～', style: TextStyle(color: tokens.textSecondary)),
      ],
    );
  }

  Widget _backendHint(BuildContext context, PeersAdminController controller, WeChatTokens tokens) {
    final url = controller.backendUrl.value;
    final color = url.isEmpty ? Colors.orange : tokens.textSecondary;
    final text = url.isEmpty ? '后端地址未配置，请先在设置填写 backend_url' : '后端地址：$url';
    return Text(text, style: TextStyle(color: color));
  }

  Widget _resultArea(BuildContext context, PeersAdminController controller, WeChatTokens tokens) {
    return Container(
      padding: EdgeInsets.all(UIKit.spaceSm(context)),
      decoration: BoxDecoration(
        color: tokens.bgLevel2,
        borderRadius: BorderRadius.circular(tokens.radiusSm),
        border: Border.all(color: tokens.divider, width: 1),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text('结果', style: TextStyle(color: tokens.textPrimary, fontSize: 14, fontWeight: FontWeight.w600)),
          SizedBox(height: UIKit.spaceSm(context)),
          Obx(() => Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              if (controller.isLoading.value) const LinearProgressIndicator(),
              if (controller.lastError.value != null)
                Text(controller.lastError.value!, style: const TextStyle(color: Colors.red)),
              if (controller.lastResponse.value != null)
                Container(
                  width: double.infinity,
                  padding: EdgeInsets.all(UIKit.spaceSm(context)),
                  decoration: BoxDecoration(
                    color: tokens.bgLevel1,
                    borderRadius: BorderRadius.circular(tokens.radiusSm),
                    border: Border.all(color: tokens.divider, width: 1),
                  ),
                  child: Text(controller.lastResponse.value.toString(), style: TextStyle(color: tokens.textSecondary)),
                ),
            ],
          )),
        ],
      ),
    );
  }
}