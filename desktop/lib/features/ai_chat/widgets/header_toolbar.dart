import 'package:flutter/material.dart';
import 'package:peers_touch_desktop/app/theme/ui_kit.dart';
import 'package:peers_touch_desktop/app/i18n/generated/app_localizations.dart';

class AIChatHeaderBar extends StatelessWidget {
  final String title;
  final List<String> models;
  final String currentModel;
  final ValueChanged<String> onModelChanged;
  final VoidCallback onToggleTopicPanel;
  final bool isSending;
  final VoidCallback onNewChat;
  const AIChatHeaderBar({
    super.key,
    required this.title,
    required this.models,
    required this.currentModel,
    required this.onModelChanged,
    required this.onToggleTopicPanel,
    required this.isSending,
    required this.onNewChat,
  });

  @override
  Widget build(BuildContext context) {
    return Container(
      height: UIKit.topBarHeight,
      padding: EdgeInsets.symmetric(horizontal: UIKit.spaceMd(context)),
      alignment: Alignment.center,
      child: Row(
        children: [
          Text(title,
              style: Theme.of(context)
                  .textTheme
                  .titleMedium
                  ?.copyWith(fontWeight: FontWeight.w600)),
          SizedBox(width: UIKit.spaceMd(context)),
          const Spacer(),
          // 模型选择
          Text(AppLocalizations.of(context).aiModelLabel,
              style: Theme.of(context)
                  .textTheme
                  .bodyMedium
                  ?.copyWith(color: UIKit.textSecondary(context))),
          SizedBox(width: UIKit.spaceSm(context)),
          // 为避免 Windows/Web 上 AXTree 语义更新报错，暂时屏蔽此控件语义
          ExcludeSemantics(
            child: DropdownButton<String>(
              value: models.contains(currentModel) ? currentModel : null,
              hint: Text(currentModel.isEmpty
                  ? AppLocalizations.of(context).defaultModel
                  : currentModel),
              items: models
                  .map((m) => DropdownMenuItem(value: m, child: Text(m)))
                  .toList(),
              onChanged: (v) {
                if (v != null) onModelChanged(v);
              },
            ),
          ),
          SizedBox(width: UIKit.spaceMd(context)),
          // 主题面板显隐
          Tooltip(
            message: AppLocalizations.of(context).toggleTopicPanel,
            child: IconButton(
              icon: const Icon(Icons.view_sidebar),
              onPressed: onToggleTopicPanel,
            ),
          ),
          Tooltip(
            message: AppLocalizations.of(context).sharePlaceholder,
            child: IconButton(
              icon: const Icon(Icons.share),
              onPressed: () {},
            ),
          ),
          Tooltip(
            message: AppLocalizations.of(context).layoutTogglePlaceholder,
            child: IconButton(
              icon: const Icon(Icons.dashboard_customize),
              onPressed: () {},
            ),
          ),
          Tooltip(
            message: AppLocalizations.of(context).moreMenuPlaceholder,
            child: IconButton(
              icon: const Icon(Icons.more_vert),
              onPressed: () {},
            ),
          ),
          SizedBox(width: UIKit.spaceMd(context)),
          if (isSending)
            Text(AppLocalizations.of(context).sendingIndicator,
                style: Theme.of(context)
                    .textTheme
                    .bodySmall
                    ?.copyWith(color: UIKit.textSecondary(context))),
        ],
      ),
    );
  }
}