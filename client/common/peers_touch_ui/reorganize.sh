#!/bin/bash

# 阶段3: 迁移 components/form
cp lib/widgets/textbox.dart lib/components/form/text_field.dart
cp lib/widgets/password_box.dart lib/components/form/password_field.dart
cp lib/widgets/search_input.dart lib/components/form/search_field.dart
cp lib/widgets/checkbox.dart lib/components/form/
cp lib/widgets/dropdown.dart lib/components/form/select.dart
cp lib/widgets/slider.dart lib/components/form/
cp lib/widgets/number.dart lib/components/form/number_input.dart

# 阶段4: 迁移 components/display
cp lib/widgets/card.dart lib/components/display/ 2>/dev/null || true
cp lib/widgets/notice.dart lib/components/display/
cp lib/widgets/chip.dart lib/components/display/
cp lib/widgets/tabs.dart lib/components/display/
cp lib/widgets/icon_tabs.dart lib/components/display/tab_bar.dart

# 阶段5: 迁移 components/media
cp lib/widgets/image.dart lib/components/media/
cp lib/widgets/peers_image.dart lib/components/media/image_viewer.dart
cp lib/widgets/gallery.dart lib/components/media/

# 阶段6: 迁移 components/data
cp lib/widgets/heatmap.dart lib/components/data/chart/
cp lib/widgets/line_chart.dart lib/components/data/chart/
cp lib/widgets/donut_chart.dart lib/components/data/chart/
cp lib/widgets/refreshable_list.dart lib/components/data/list.dart

# 阶段7: 迁移 components/navigation (context_menu)
cp lib/context_menu/context_menu.dart lib/components/navigation/menu/menu.dart
cp lib/context_menu/context_menu_action.dart lib/components/navigation/menu/menu_item.dart
cp lib/context_menu/context_menu_trigger.dart lib/components/navigation/menu/menu_trigger.dart

# 阶段8: 迁移 patterns/chat
cp lib/chat/mention_input.dart lib/patterns/chat/
cp lib/chat/reply_preview.dart lib/patterns/chat/
cp lib/chat/thread_panel.dart lib/patterns/chat/
cp lib/desktop/chat/message_bubble.dart lib/patterns/chat/ 2>/dev/null || true
cp lib/desktop/chat/conversation_item.dart lib/patterns/chat/conversation_list.dart 2>/dev/null || true
cp lib/desktop/chat/chat_input.dart lib/patterns/chat/ 2>/dev/null || true

# 阶段9: 迁移 patterns/settings
cp -r lib/desktop/settings/* lib/patterns/settings/ 2>/dev/null || true

# 阶段10: 迁移 layouts
cp lib/desktop/layout/scaffold.dart lib/layouts/desktop/
cp lib/desktop/layout/app_bar.dart lib/layouts/desktop/
cp lib/desktop/layout/sidebar.dart lib/layouts/desktop/
cp lib/desktop/layout/tab_bar.dart lib/layouts/desktop/
cp lib/desktop/layout/brand_bar.dart lib/layouts/desktop/ 2>/dev/null || true
cp lib/desktop/layout/icon_sidebar.dart lib/layouts/desktop/ 2>/dev/null || true

cp lib/mobile/layout/scaffold.dart lib/layouts/mobile/
cp lib/mobile/layout/app_bar.dart lib/layouts/mobile/
cp lib/mobile/layout/bottom_nav.dart lib/layouts/mobile/
cp lib/mobile/layout/tab_bar.dart lib/layouts/mobile/

echo "文件迁移完成"
