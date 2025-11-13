import 'dart:convert';
import 'dart:async';
import 'package:flutter/material.dart';
import 'package:peers_touch_desktop/app/theme/ui_kit.dart';
import 'package:peers_touch_desktop/app/theme/lobe_tokens.dart';
import 'package:peers_touch_desktop/app/i18n/generated/app_localizations.dart';
import 'package:peers_touch_desktop/core/components/frame_action_combo.dart';
import 'package:peers_touch_desktop/features/ai_chat/model/chat_session.dart';
import 'package:peers_touch_desktop/app/theme/theme_tokens.dart';
import 'package:intl/intl.dart';

class AssistantSidebar extends StatelessWidget {
  final VoidCallback onNewChat;
  final List<ChatSession> sessions;
  final String? selectedId;
  final ValueChanged<String> onSelectSession;
  final ValueChanged<ChatSession> onRenameSession;
  final ValueChanged<ChatSession> onDeleteSession;
  final void Function(int oldIndex, int newIndex)? onReorder;
  final ValueChanged<ChatSession>? onChangeAvatar;
  final String Function(String id)? lastMessageGetter;
  const AssistantSidebar({
    super.key,
    required this.onNewChat,
    required this.sessions,
    required this.selectedId,
    required this.onSelectSession,
    required this.onRenameSession,
    required this.onDeleteSession,
    this.onReorder,
    this.onChangeAvatar,
    this.lastMessageGetter,
  });

  @override
  Widget build(BuildContext context) {
    final tokens = Theme.of(context).extension<LobeTokens>();
    final wx = Theme.of(context).extension<WeChatTokens>();
    return Container(
      color: UIKit.assistantSidebarBg(context),
      child: Column(
        children: [
          Container(
            height: UIKit.topBarHeight,
            padding: EdgeInsets.symmetric(horizontal: UIKit.spaceMd(context)),
            alignment: Alignment.center,
            child: FrameActionCombo(
              hintText: AppLocalizations.of(context).chatSearchSessionsPlaceholder,
              prefixIcon: Icons.search,
              onAction: onNewChat,
              actionIcon: Icons.add,
            ),
          ),
          Divider(
            height: UIKit.spaceLg(context),
            thickness: UIKit.dividerThickness,
            color: UIKit.dividerColor(context),
          ),
          Expanded(
            child: ReorderableListView.builder(
              itemCount: sessions.length,
              buildDefaultDragHandles: false,
              proxyDecorator: (child, index, animation) {
                return ScaleTransition(
                  scale: Tween<double>(begin: 1.0, end: 1.03).animate(animation),
                  child: Material(
                    color: Colors.transparent,
                    child: Container(
                      decoration: BoxDecoration(
                        color: Theme.of(context).colorScheme.surface.withOpacity(0.95),
                        borderRadius: BorderRadius.circular(UIKit.radiusLg(context)),
                        boxShadow: [
                          BoxShadow(
                            color: Colors.black.withOpacity(0.12),
                            blurRadius: 14,
                            offset: const Offset(0, 6),
                          )
                        ],
                      ),
                      child: child,
                    ),
                  ),
                );
              },
              onReorder: (oldIndex, newIndex) => onReorder?.call(oldIndex, newIndex),
              itemBuilder: (context, index) {
                final s = sessions[index];
                final selected = s.id == selectedId;
                final double barWidth = wx?.menuBarWidth ?? 64;
                final double boxRatio = wx?.menuItemBoxRatio ?? 0.618;
                final double itemHeight = barWidth * boxRatio * 1.35;
                final double avatarSize = barWidth * boxRatio * 0.68;
                final preview = lastMessageGetter?.call(s.id) ?? '';
                final timeText = _formatTime(s.lastActiveAt);
                return ReorderableDelayedDragStartListener(
                  key: ValueKey(s.id),
                  index: index,
                  child: GestureDetector(
                    onSecondaryTapDown: (details) async {
                      final action = await _showContextMenu(
                        context,
                        details.globalPosition,
                        items: const [
                          _MenuItem(key: 'change_avatar', label: '更换头像', icon: Icons.image),
                          _MenuItem(key: 'delete', label: '删除会话', icon: Icons.delete_outline),
                        ],
                      );
                      if (action == 'delete') {
                        onDeleteSession(s);
                      } else if (action == 'change_avatar') {
                        onChangeAvatar?.call(s);
                      }
                    },
                    child: InkWell(
                      onTap: () => onSelectSession(s.id),
                      onLongPress: () => onRenameSession(s),
                      child: Container(
                        height: itemHeight,
                        color: selected
                            ? (tokens?.menuSelected ?? Theme.of(context).colorScheme.primary.withOpacity(0.08))
                            : Colors.transparent,
                        padding: EdgeInsets.symmetric(
                          horizontal: UIKit.spaceMd(context),
                          vertical: UIKit.spaceXs(context),
                        ),
                        child: Row(
                          children: [
                            SizedBox(
                              width: avatarSize,
                              height: avatarSize,
                              child: ClipRRect(
                                borderRadius: BorderRadius.circular(avatarSize / 2),
                                child: _buildAvatar(s, avatarSize, context),
                              ),
                            ),
                            SizedBox(width: UIKit.spaceSm(context)),
                            Expanded(
                              child: Column(
                                mainAxisAlignment: MainAxisAlignment.center,
                                crossAxisAlignment: CrossAxisAlignment.start,
                                children: [
                                  Row(
                                    children: [
                                      Expanded(
                                        child: Text(
                                          s.title,
                                          maxLines: 1,
                                          overflow: TextOverflow.ellipsis,
                                          style: Theme.of(context).textTheme.bodyMedium,
                                        ),
                                      ),
                                      if (timeText.isNotEmpty)
                                        Text(
                                          timeText,
                                          style: Theme.of(context).textTheme.bodySmall?.copyWith(
                                                color: UIKit.textSecondary(context),
                                              ),
                                        ),
                                    ],
                                  ),
                                  const SizedBox(height: 4),
                                  if (preview.isNotEmpty)
                                    Text(
                                      preview,
                                      maxLines: 1,
                                      overflow: TextOverflow.ellipsis,
                                      style: Theme.of(context).textTheme.bodySmall?.copyWith(
                                            color: UIKit.textSecondary(context),
                                          ),
                                    ),
                                ],
                              ),
                            ),
                          ],
                        ),
                      ),
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

  Widget _buildAvatar(ChatSession s, double size, BuildContext context) {
    if (s.avatarBase64 != null && s.avatarBase64!.isNotEmpty) {
      try {
        final bytes = base64Decode(s.avatarBase64!);
        return Image.memory(bytes, fit: BoxFit.cover);
      } catch (_) {}
    }
    return Container(
      color: UIKit.dividerColor(context).withOpacity(0.2),
      child: Center(child: Icon(Icons.person, size: size * 0.6, color: UIKit.textSecondary(context))),
    );
  }

  String _formatTime(DateTime? dt) {
    if (dt == null) return '';
    final now = DateTime.now();
    if (dt.year == now.year && dt.month == now.month && dt.day == now.day) {
      return DateFormat('HH:mm').format(dt);
    }
    final yesterday = now.subtract(const Duration(days: 1));
    if (dt.year == yesterday.year && dt.month == yesterday.month && dt.day == yesterday.day) {
      return 'Yesterday ${DateFormat('HH:mm').format(dt)}';
    }
    return DateFormat('MM/dd HH:mm').format(dt);
  }

  Future<String?> _showContextMenu(BuildContext context, Offset anchor,
      {required List<_MenuItem> items}) async {
    final overlay = Overlay.of(context);
    if (overlay == null) return null;
    final completer = Completer<String?>();
    late OverlayEntry entry;
    final bg = Theme.of(context).extension<WeChatTokens>()?.bgLevel3 ?? Theme.of(context).colorScheme.surfaceVariant;
    final textColor = UIKit.textPrimary(context);
    final radius = UIKit.radiusLg(context);
    entry = OverlayEntry(builder: (_) {
      return Stack(children: [
        Positioned.fill(
          child: GestureDetector(onTap: () { entry.remove(); completer.complete(null); }),
        ),
        Positioned(
          left: anchor.dx,
          top: anchor.dy,
          child: Material(
            color: Colors.transparent,
            child: Container(
              width: 180,
              decoration: BoxDecoration(
                color: bg,
                borderRadius: BorderRadius.circular(radius),
                boxShadow: [
                  BoxShadow(color: Colors.black.withOpacity(0.12), blurRadius: 12, offset: const Offset(0, 6)),
                ],
              ),
              child: Column(
                mainAxisSize: MainAxisSize.min,
                children: items.map((it) {
                  return InkWell(
                    onTap: () { entry.remove(); completer.complete(it.key); },
                    child: Padding(
                      padding: EdgeInsets.symmetric(
                        horizontal: UIKit.spaceMd(context),
                        vertical: UIKit.spaceSm(context),
                      ),
                      child: Row(children: [
                        Icon(it.icon, size: 18, color: textColor),
                        SizedBox(width: UIKit.spaceSm(context)),
                        Expanded(child: Text(it.label, style: Theme.of(context).textTheme.bodyMedium?.copyWith(color: textColor))),
                      ]),
                    ),
                  );
                }).toList(),
              ),
            ),
          ),
        ),
      ]);
    });
    overlay.insert(entry);
    return completer.future;
  }
}

class _MenuItem {
  final String key;
  final String label;
  final IconData icon;
  const _MenuItem({required this.key, required this.label, required this.icon});
}