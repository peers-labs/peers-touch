import 'package:flutter/material.dart';
import 'package:peers_touch_desktop/app/theme/ui_kit.dart';
import 'package:peers_touch_desktop/app/i18n/generated/app_localizations.dart';
import 'package:peers_touch_desktop/core/components/frame_action_combo.dart';
import 'package:peers_touch_desktop/features/ai_chat/model/chat_session.dart';

class AssistantSidebar extends StatelessWidget {
  final VoidCallback onNewChat;
  final List<ChatSession> sessions;
  final String? selectedId;
  final ValueChanged<String> onSelectSession;
  final ValueChanged<ChatSession> onRenameSession;
  final ValueChanged<ChatSession> onDeleteSession;
  const AssistantSidebar({
    super.key,
    required this.onNewChat,
    required this.sessions,
    required this.selectedId,
    required this.onSelectSession,
    required this.onRenameSession,
    required this.onDeleteSession,
  });

  @override
  Widget build(BuildContext context) {
    return Container(
      width: UIKit.secondaryNavWidth,
      color: UIKit.assistantSidebarBg(context),
      child: Column(
        children: [
          SizedBox(height: UIKit.spaceMd(context)),
          Padding(
            padding: EdgeInsets.symmetric(horizontal: UIKit.spaceMd(context)),
            child: FrameActionCombo(
              hintText: AppLocalizations.of(context).chatSearchSessionsPlaceholder,
              prefixIcon: Icons.search,
              onAction: onNewChat,
              actionIcon: Icons.add,
            ),
          ),
          SizedBox(height: UIKit.spaceSm(context)),
          Divider(height: UIKit.spaceXl(context)),
          Expanded(
            child: ListView.separated(
              itemCount: sessions.length,
              separatorBuilder: (_, __) => Divider(
                height: 1,
                color: UIKit.dividerColor(context),
              ),
              itemBuilder: (context, index) {
                final s = sessions[index];
                final selected = s.id == selectedId;
                return InkWell(
                  onTap: () => onSelectSession(s.id),
                  child: Container(
                    color: selected
                        ? Theme.of(context).colorScheme.primaryContainer
                        : Colors.transparent,
                    padding: EdgeInsets.symmetric(
                      horizontal: UIKit.spaceMd(context),
                      vertical: UIKit.spaceSm(context),
                    ),
                    child: Row(
                      children: [
                        Expanded(
                          child: Text(
                            s.title,
                            maxLines: 1,
                            overflow: TextOverflow.ellipsis,
                            style: Theme.of(context).textTheme.bodyMedium,
                          ),
                        ),
                        // 暂时屏蔽弹出菜单的语义，规避 AXTree 更新报错
                        ExcludeSemantics(
                          child: PopupMenuButton<String>(
                            tooltip: AppLocalizations.of(context).chatSessionActions,
                            onSelected: (value) {
                              switch (value) {
                                case 'rename':
                                  onRenameSession(s);
                                  break;
                                case 'delete':
                                  onDeleteSession(s);
                                  break;
                              }
                            },
                            itemBuilder: (context) => [
                              PopupMenuItem(
                                value: 'rename',
                                child: Text(AppLocalizations.of(context).rename),
                              ),
                              PopupMenuItem(
                                value: 'delete',
                                child: Text(AppLocalizations.of(context).delete),
                              ),
                            ],
                            icon: Icon(
                              selected ? Icons.more_vert : Icons.more_horiz,
                              color: selected
                                  ? Theme.of(context).colorScheme.primary
                                  : UIKit.textSecondary(context),
                            ),
                          ),
                        ),
                      ],
                    ),
                  ),
                );
              },
            ),
          ),
        ],
      ),
    );
  }
}