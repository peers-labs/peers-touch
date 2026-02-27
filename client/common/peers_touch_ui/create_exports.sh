#!/bin/bash

# components/display/display.dart
cat > lib/components/display/display.dart << 'EOF'
library display;

export 'card.dart';
export 'notice.dart';
export 'chip.dart';
export 'tabs.dart';
export 'tab_bar.dart';
EOF

# components/media/media.dart
cat > lib/components/media/media.dart << 'EOF'
library media;

export 'image.dart';
export 'image_viewer.dart';
export 'gallery.dart';
EOF

# components/data/data.dart
cat > lib/components/data/data.dart << 'EOF'
library data;

export 'list.dart';
export 'chart/heatmap.dart';
export 'chart/line_chart.dart';
export 'chart/donut_chart.dart';
EOF

# components/navigation/navigation.dart
cat > lib/components/navigation/navigation.dart << 'EOF'
library navigation;

export 'menu/menu.dart';
export 'menu/menu_item.dart';
export 'menu/menu_trigger.dart';
EOF

# patterns/chat/chat.dart
cat > lib/patterns/chat/chat.dart << 'EOF'
library chat;

export 'mention_input.dart';
export 'reply_preview.dart';
export 'thread_panel.dart';
export 'message_bubble.dart';
export 'conversation_list.dart';
export 'chat_input.dart';
EOF

# patterns/settings/settings.dart
cat > lib/patterns/settings/settings.dart << 'EOF'
library settings;

export 'setting_group.dart';
export 'setting_item.dart';
EOF

# layouts/desktop/desktop.dart
cat > lib/layouts/desktop/desktop.dart << 'EOF'
library desktop;

export 'scaffold.dart';
export 'app_bar.dart';
export 'sidebar.dart';
export 'tab_bar.dart';
export 'brand_bar.dart';
export 'icon_sidebar.dart';
EOF

# layouts/mobile/mobile.dart
cat > lib/layouts/mobile/mobile.dart << 'EOF'
library mobile;

export 'scaffold.dart';
export 'app_bar.dart';
export 'bottom_nav.dart';
export 'tab_bar.dart';
EOF

# layouts/layouts.dart
cat > lib/layouts/layouts.dart << 'EOF'
library layouts;

export 'desktop/desktop.dart';
export 'mobile/mobile.dart';
EOF

# patterns/patterns.dart
cat > lib/patterns/patterns.dart << 'EOF'
library patterns;

export 'chat/chat.dart';
export 'settings/settings.dart';
EOF

echo "导出文件创建完成"
