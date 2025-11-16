import 'package:flutter/material.dart';

import 'package:peers_touch_mobile/components/common/floating_action_ball.dart';
import 'package:peers_touch_mobile/pages/chat/chat_list_page.dart';
import 'package:peers_touch_mobile/pages/chat/chat_friends_list_page.dart';
import 'package:peers_touch_mobile/utils/app_localizations_helper.dart';
import 'package:peers_touch_mobile/common/logger/logger.dart';
import 'package:peers_touch_mobile/l10n/app_localizations.dart';

class ChatPage extends StatefulWidget {
  const ChatPage({super.key});

  static final List<FloatingActionOption> actionOptions = [
    FloatingActionOption(
      icon: Icons.group_add,
      tooltip: AppLocalizationsHelper.getLocalizedString((l10n) => l10n.newGroup, 'New Group'),
      onPressed: () => appLogger.info('New Group pressed'),
    ),
    FloatingActionOption(
      icon: Icons.person_add,
      tooltip: AppLocalizationsHelper.getLocalizedString((l10n) => l10n.addContact, 'Add Contact'),
      onPressed: () => appLogger.info('Add Contact pressed'),
    ),
  ];

  @override
  State<ChatPage> createState() => _ChatPageState();
}

class _ChatPageState extends State<ChatPage> with SingleTickerProviderStateMixin {
  late TabController _tabController;

  @override
  void initState() {
    super.initState();
    _tabController = TabController(length: 2, vsync: this);
  }

  @override
  void dispose() {
    _tabController.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context)!;
    
    return Scaffold(
      appBar: AppBar(
        title: Text(l10n.navChat),
        centerTitle: true,
        bottom: TabBar(
          controller: _tabController,
          tabs: [
          Tab(text: l10n.conversations),
          Tab(text: l10n.friends),
        ],
        ),
        actions: [
          IconButton(
            icon: const Icon(Icons.add),
            onPressed: () {
              appLogger.info('Add button pressed');
            },
          ),
        ],
      ),
      body: TabBarView(
        controller: _tabController,
        children: const [
          ChatListPage(),
          FriendsListPage(),
        ],
      ),
      floatingActionButton: FloatingActionBall(options: ChatPage.actionOptions),
    );
  }
}