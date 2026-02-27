import 'package:flutter/material.dart';
import 'package:peers_touch_ui/peers_touch_ui.dart';
import 'demo_controller.dart';

void main() {
  runApp(const PeersTouchUIShowcase());
}

class PeersTouchUIShowcase extends StatelessWidget {
  const PeersTouchUIShowcase({super.key});

  @override
  Widget build(BuildContext context) {
    return DemoScope(
      controller: DemoController(),
      child: MaterialApp(
        title: 'Peers Touch UI',
        debugShowCheckedModeBanner: false,
        theme: ThemeData(
          colorScheme: ColorScheme.fromSeed(seedColor: AppColors.primary),
          useMaterial3: true,
        ),
        home: const Scaffold(
          body: DesktopShowcase(),
        ),
      ),
    );
  }
}

class DesktopShowcase extends StatelessWidget {
  const DesktopShowcase({super.key});

  @override
  Widget build(BuildContext context) {
    final controller = DemoScope.of(context);
    return Row(
      children: [
        const BrandBar(),
        IconSidebar(
          selectedIndex: controller.sidebarIndex,
          onSelected: controller.selectSidebar,
          items: const [
            IconSidebarItem(icon: Icons.home_outlined, tooltip: 'Home'),
            IconSidebarItem(icon: Icons.calendar_today_outlined, tooltip: 'Calendar'),
            IconSidebarItem(icon: Icons.settings_outlined, tooltip: 'Settings'),
            IconSidebarItem(icon: Icons.favorite_outline, tooltip: 'Favorites'),
          ],
        ),
        Expanded(
          child: Column(
            children: [
              AppBar(
                title: const Text('Wellness Dashboard'),
                actions: [
                  IconButton(icon: const Icon(Icons.search), onPressed: () {}),
                  IconButton(icon: const Icon(Icons.notifications_outlined), onPressed: () {}),
                  IconButton(icon: const Icon(Icons.help_outline), onPressed: () {}),
                ],
              ),
              const Expanded(child: DashboardGrid()),
            ],
          ),
        ),
      ],
    );
  }
}

class DashboardGrid extends StatelessWidget {
  const DashboardGrid({super.key});

  @override
  Widget build(BuildContext context) {
    return SingleChildScrollView(
      padding: const EdgeInsets.all(24),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          GridView.extent(
            shrinkWrap: true,
            physics: const NeverScrollableScrollPhysics(),
            maxCrossAxisExtent: 400,
            mainAxisSpacing: 16,
            crossAxisSpacing: 16,
            children: const [
              ProgressCard(),
              StressRecoveryCard(),
              AssistantCard(),
              IntegrationsCard(),
              SleepCard(),
              EmojiPickerCard(),
            ],
          ),
        ],
      ),
    );
  }
}

class ProgressCard extends StatelessWidget {
  const ProgressCard({super.key});

  @override
  Widget build(BuildContext context) {
    final controller = DemoScope.of(context);
    return Card(
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            const Text('Wellness Progress', style: TextStyle(fontSize: 18, fontWeight: FontWeight.bold)),
            const SizedBox(height: 16),
            ListenableBuilder(
              listenable: controller.progressTab,
              builder: (context, child) => TabBar(
                tabs: const [Tab(text: 'Daily'), Tab(text: 'Weekly'), Tab(text: 'Monthly'), Tab(text: 'Yearly')],
                isScrollable: true,
                tabAlignment: TabAlignment.start,
                onTap: controller.selectProgressTab,
              ),
            ),
            const SizedBox(height: 16),
            ListenableBuilder(
              listenable: controller.heatmap,
              builder: (context, child) => Heatmap(data: controller.heatmap.value),
            ),
          ],
        ),
      ),
    );
  }
}

class StressRecoveryCard extends StatelessWidget {
  const StressRecoveryCard({super.key});

  @override
  Widget build(BuildContext context) {
    final controller = DemoScope.of(context);
    return Card(
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            const Text('Stress & Recovery', style: TextStyle(fontSize: 18, fontWeight: FontWeight.bold)),
            const SizedBox(height: 16),
            ListenableBuilder(
              listenable: controller.linePoints,
              builder: (context, child) => SizedBox(
                height: 150,
                child: LineChart(data: controller.linePoints.value),
              ),
            ),
            const SizedBox(height: 16),
            const Row(
              mainAxisAlignment: MainAxisAlignment.spaceEvenly,
              children: [
                MetricChip(label: 'HRV', value: '62 ms'),
                MetricChip(label: 'Glucose', value: '92 mg/dL'),
              ],
            ),
          ],
        ),
      ),
    );
  }
}

class AssistantCard extends StatefulWidget {
  const AssistantCard({super.key});

  @override
  State<AssistantCard> createState() => _AssistantCardState();
}

class _AssistantCardState extends State<AssistantCard> {
  final TextEditingController _textController = TextEditingController();
  final List<String> _recentEmojis = ['😀', '😂', '❤️', '👍', '🎉'];
  bool _showEmojiPicker = false;

  @override
  void dispose() {
    _textController.dispose();
    super.dispose();
  }

  void _toggleEmojiPicker() {
    setState(() {
      _showEmojiPicker = !_showEmojiPicker;
    });
  }

  void _insertEmoji(String emoji) {
    final text = _textController.text;
    final selection = _textController.selection;
    final newText = text.replaceRange(
      selection.start,
      selection.end,
      emoji,
    );
    _textController.value = _textController.value.copyWith(
      text: newText,
      selection: TextSelection.collapsed(
        offset: selection.start + emoji.length,
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    return Card(
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            const Text('Assistant', style: TextStyle(fontSize: 18, fontWeight: FontWeight.bold)),
            const SizedBox(height: 16),
            Wrap(
              spacing: 8,
              children: [
                Chip(label: const Text('How to reduce stress?')),
                Chip(label: const Text('Sleep tips')),
                Chip(label: const Text('Workout plan')),
              ],
            ),
            const SizedBox(height: 16),
            Row(
              children: [
                Expanded(
                  child: TextField(
                    controller: _textController,
                    decoration: const InputDecoration(
                      hintText: 'Ask anything...',
                      border: OutlineInputBorder(),
                    ),
                  ),
                ),
                const SizedBox(width: 8),
                IconButton(
                  icon: const Icon(Icons.emoji_emotions),
                  onPressed: _toggleEmojiPicker,
                ),
                IconButton(
                  icon: const Icon(Icons.send),
                  onPressed: () {},
                ),
              ],
            ),
            AnimatedSize(
              duration: const Duration(milliseconds: 200),
              curve: Curves.easeInOut,
              child: _showEmojiPicker
                  ? SizedBox(
                      height: 320,
                      child: EmojiPickerPanel(
                        onEmojiSelected: _insertEmoji,
                        textController: _textController,
                        recentEmojis: _recentEmojis,
                      ),
                    )
                  : const SizedBox.shrink(),
            ),
          ],
        ),
      ),
    );
  }
}

class IntegrationsCard extends StatelessWidget {
  const IntegrationsCard({super.key});

  @override
  Widget build(BuildContext context) {
    return Card(
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            const Text('Integrations', style: TextStyle(fontSize: 18, fontWeight: FontWeight.bold)),
            const SizedBox(height: 16),
            ListTile(
              leading: const Icon(Icons.watch),
              title: const Text('Apple Watch'),
              subtitle: const Text('Connected'),
              trailing: const Icon(Icons.check_circle, color: Colors.green),
            ),
            ListTile(
              leading: const Icon(Icons.fitness_center),
              title: const Text('Strava'),
              subtitle: const Text('Syncing'),
              trailing: const SizedBox(
                width: 16,
                height: 16,
                child: CircularProgressIndicator(strokeWidth: 2),
              ),
            ),
            ListTile(
              leading: const Icon(Icons.nightlight),
              title: const Text('Oura Ring'),
              subtitle: const Text('Offline'),
              trailing: const Icon(Icons.error_outline, color: Colors.grey),
            ),
          ],
        ),
      ),
    );
  }
}

class SleepCard extends StatelessWidget {
  const SleepCard({super.key});

  @override
  Widget build(BuildContext context) {
    return Card(
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            const Text('Sleep', style: TextStyle(fontSize: 18, fontWeight: FontWeight.bold)),
            const SizedBox(height: 16),
            const SizedBox(
              height: 150,
              child: DonutChart(
                data: [0.65, 0.25, 0.1],
                colors: [Colors.blue, Colors.purple, Colors.grey],
              ),
            ),
            const SizedBox(height: 16),
            const Row(
              mainAxisAlignment: MainAxisAlignment.spaceEvenly,
              children: [
                MetricChip(label: 'Duration', value: '7h 42m'),
                MetricChip(label: 'Deep Sleep', value: '25%'),
                MetricChip(label: 'Recovery', value: '85'),
              ],
            ),
          ],
        ),
      ),
    );
  }
}

class EmojiPickerCard extends StatefulWidget {
  const EmojiPickerCard({super.key});

  @override
  State<EmojiPickerCard> createState() => _EmojiPickerCardState();
}

class _EmojiPickerCardState extends State<EmojiPickerCard> {
  final TextEditingController _textController = TextEditingController();
  final List<String> _recentEmojis = ['😀', '😂', '❤️', '👍', '🎉', '😊', '🔥', '✨'];
  final List<String> _favoriteEmojis = ['❤️', '👍', '🎉'];
  bool _showEmojiPicker = false;
  String _selectedEmoji = '';

  @override
  void dispose() {
    _textController.dispose();
    super.dispose();
  }

  void _toggleEmojiPicker() {
    setState(() {
      _showEmojiPicker = !_showEmojiPicker;
    });
  }

  void _insertEmoji(String emoji) {
    setState(() {
      _selectedEmoji = emoji;
    });
    final text = _textController.text;
    final selection = _textController.selection;
    final newText = text.replaceRange(
      selection.start,
      selection.end,
      emoji,
    );
    _textController.value = _textController.value.copyWith(
      text: newText,
      selection: TextSelection.collapsed(
        offset: selection.start + emoji.length,
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    return Card(
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            const Text('Emoji Picker Demo', style: TextStyle(fontSize: 18, fontWeight: FontWeight.bold)),
            const SizedBox(height: 16),
            if (_selectedEmoji.isNotEmpty)
              Center(
                child: Text(
                  _selectedEmoji,
                  style: const TextStyle(fontSize: 64),
                ),
              ),
            const SizedBox(height: 16),
            TextField(
              controller: _textController,
              decoration: const InputDecoration(
                hintText: 'Try typing or selecting an emoji...',
                border: OutlineInputBorder(),
              ),
            ),
            const SizedBox(height: 16),
            FilledButton.icon(
              onPressed: _toggleEmojiPicker,
              icon: const Icon(Icons.emoji_emotions),
              label: Text(_showEmojiPicker ? 'Hide Emoji Picker' : 'Show Emoji Picker'),
            ),
            AnimatedSize(
              duration: const Duration(milliseconds: 200),
              curve: Curves.easeInOut,
              child: _showEmojiPicker
                  ? SizedBox(
                      height: 376,
                      child: EmojiAndStickerPicker(
                        onEmojiSelected: _insertEmoji,
                        textController: _textController,
                        recentEmojis: _recentEmojis,
                        favoriteEmojis: _favoriteEmojis,
                      ),
                    )
                  : const SizedBox.shrink(),
            ),
          ],
        ),
      ),
    );
  }
}

class MetricChip extends StatelessWidget {
  final String label;
  final String value;
  const MetricChip({super.key, required this.label, required this.value});

  @override
  Widget build(BuildContext context) {
    return Chip(
      label: Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          Text(value, style: const TextStyle(fontWeight: FontWeight.bold)),
          Text(label, style: const TextStyle(fontSize: 10)),
        ],
      ),
    );
  }
}
