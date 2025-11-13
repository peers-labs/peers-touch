import 'package:flutter/material.dart';
import 'package:peers_touch_desktop/app/theme/ui_kit.dart';
import 'package:peers_touch_desktop/app/i18n/generated/app_localizations.dart';

class TopicPanel extends StatelessWidget {
  final List<String> topics;
  final VoidCallback onAddTopic;
  final ValueChanged<int> onDeleteTopic;
  final ValueChanged<int>? onSelectTopic;
  final ValueChanged<int>? onRenameTopic;
  final int? flashIndex;
  const TopicPanel({
    super.key,
    required this.topics,
    required this.onAddTopic,
    required this.onDeleteTopic,
    this.onSelectTopic,
    this.onRenameTopic,
    this.flashIndex,
  });

  @override
  Widget build(BuildContext context) {
    return Container(
      width: UIKit.rightPanelWidth,
      color: UIKit.chatRightPanelBg(context),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Padding(
            padding: EdgeInsets.symmetric(
              horizontal: UIKit.spaceMd(context),
              vertical: UIKit.spaceSm(context),
            ),
            child: Row(
              children: [
                Expanded(
                  child: Text(
                    AppLocalizations.of(context).chatTopicHistory,
                    style: Theme.of(context).textTheme.titleSmall,
                  ),
                ),
                IconButton(
                  tooltip: AppLocalizations.of(context).chatAddTopic,
                  onPressed: onAddTopic,
                  icon: const Icon(Icons.add),
                ),
              ],
            ),
          ),
          Expanded(
            child: ListView.separated(
              itemCount: topics.length,
              separatorBuilder: (_, __) => Divider(
                height: 1,
                color: UIKit.dividerColor(context),
              ),
              itemBuilder: (context, index) {
                final t = topics[index];
                final shouldHighlight = flashIndex != null && flashIndex == index;
                final highlightColor = shouldHighlight
                    ? Theme.of(context).colorScheme.primary.withOpacity(0.12)
                    : Colors.transparent;
                return AnimatedContainer(
                  duration: const Duration(milliseconds: 250),
                  color: highlightColor,
                  child: ListTile(
                    title: Text(t),
                    onTap: onSelectTopic != null
                        ? () => onSelectTopic!(index)
                        : null,
                    trailing: ExcludeSemantics(
                      child: PopupMenuButton<String>(
                        tooltip: AppLocalizations.of(context).chatTopicActions,
                        onSelected: (value) {
                          switch (value) {
                            case 'rename':
                              if (onRenameTopic != null) onRenameTopic!(index);
                              break;
                            case 'delete':
                              onDeleteTopic(index);
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
                          Icons.more_horiz,
                          color: UIKit.textSecondary(context),
                        ),
                      ),
                    ),
                    dense: true,
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