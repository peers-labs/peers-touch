import 'package:flutter/material.dart';
import 'package:peers_touch_desktop/app/theme/ui_kit.dart';
import 'package:peers_touch_desktop/app/i18n/generated/app_localizations.dart';

class AIChatHeaderBar extends StatelessWidget {
  final String title;
  final bool isSending;
  final VoidCallback onNewChat;
  const AIChatHeaderBar({
    super.key,
    required this.title,
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