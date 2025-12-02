import 'package:flutter/material.dart';
import 'package:peers_touch_ui/peers_touch_ui.dart';
import 'demo_controller.dart';

void main() {
  runApp(const PeersTouchUIDemo());
}

class PeersTouchUIDemo extends StatelessWidget {
  const PeersTouchUIDemo({super.key});
  @override
  Widget build(BuildContext context) {
    return MaterialApp(
      title: 'PeersTouch UI Demo',
      theme: ThemeData(colorScheme: ColorScheme.fromSeed(seedColor: Colors.deepPurple)),
      home: const DashboardDemoPage(),
    );
  }
}

class DashboardDemoPage extends StatelessWidget {
  const DashboardDemoPage({super.key});
  @override
  Widget build(BuildContext context) {
    final ctrl = DemoController();
    return DemoScope(
      controller: ctrl,
      child: Scaffold(
        body: Column(
          children: [
            Padding(
              padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 12),
              child: Row(
                children: [
                  Row(children: [
                    SizedBox(
                      width: 28,
                      height: 28,
                      child: Column(mainAxisAlignment: MainAxisAlignment.spaceBetween, children: [
                        Row(mainAxisAlignment: MainAxisAlignment.spaceBetween, children: [
                          Container(width: 12, height: 12, decoration: const BoxDecoration(color: Colors.black, borderRadius: BorderRadius.all(Radius.circular(4)))),
                          Container(width: 12, height: 12, decoration: const BoxDecoration(color: Colors.black, borderRadius: BorderRadius.all(Radius.circular(4)))),
                        ]),
                        Row(mainAxisAlignment: MainAxisAlignment.spaceBetween, children: [
                          Container(width: 12, height: 12, decoration: const BoxDecoration(color: Colors.black, borderRadius: BorderRadius.all(Radius.circular(4)))),
                          Container(width: 12, height: 12, decoration: const BoxDecoration(color: Colors.black, borderRadius: BorderRadius.all(Radius.circular(4)))),
                        ]),
                      ]),
                    ),
                    const SizedBox(width: 12),
                    const Text('Wellmetrix', style: TextStyle(fontSize: 18, fontWeight: FontWeight.w700)),
                  ]),
                  const Spacer(),
                  Row(children: [
                    const CircleAvatar(radius: 14),
                    const SizedBox(width: 8),
                    Column(crossAxisAlignment: CrossAxisAlignment.start, children: const [
                      Text('Alex', style: TextStyle(fontWeight: FontWeight.w600)),
                      Text('25 years old', style: TextStyle(color: Colors.black54)),
                    ]),
                    const SizedBox(width: 16),
                    Column(crossAxisAlignment: CrossAxisAlignment.start, children: const [
                      Text('20.2y', style: TextStyle(fontWeight: FontWeight.w700)),
                      Text('Metabolic age', style: TextStyle(color: Colors.black54)),
                    ]),
                  ]),
                  const Spacer(),
                  Container(
                    width: 28,
                    height: 28,
                    alignment: Alignment.center,
                    decoration: BoxDecoration(color: Colors.black.withOpacity(0.07), borderRadius: BorderRadius.circular(14)),
                    child: const Text('11', style: TextStyle(fontWeight: FontWeight.w700)),
                  ),
                  const SizedBox(width: 12),
                  const Text('Nov, Wed', style: TextStyle(fontWeight: FontWeight.w600)),
                  const SizedBox(width: 12),
                  const Icon(Icons.search),
                  const SizedBox(width: 12),
                  const Icon(Icons.notifications_none),
                  const SizedBox(width: 16),
                  SizedBox(width: 180, child: PrimaryButton(text: '+ Add Data Source', onPressed: (){})),
                ],
              ),
            ),
            Expanded(
              child: Row(
                children: [
                  Column(children: [
                    ValueListenableBuilder<int>(
                      valueListenable: ctrl.sidebarIndex,
                      builder: (ctx, idx, _) => IconSidebar(
                        icons: const [Icons.home_outlined, Icons.insights_outlined, Icons.settings_outlined, Icons.add_circle_outline, Icons.favorite_border],
                        index: idx,
                        onChanged: ctrl.selectSidebar,
                      ),
                    ),
                    const Spacer(),
                    const Padding(
                      padding: EdgeInsets.only(left: 12, bottom: 12),
                      child: Icon(Icons.arrow_back_ios_new, size: 18),
                    )
                  ]),
                  Expanded(
                    child: Padding(
                      padding: const EdgeInsets.all(16.0),
                      child: LayoutBuilder(builder: (ctx, c) {
                        final w = c.maxWidth;
                        final col = w > 1200 ? 3 : 2;
                        final itemW = (w - (col - 1) * 16) / col;
                        return SingleChildScrollView(
                          child: Wrap(
                            spacing: 16,
                            runSpacing: 16,
                            children: [
                              SizedBox(
                                width: itemW,
                                child: PTCard(
                                  header: Row(children: const [Icon(Icons.emoji_events_outlined, size: 20), SizedBox(width: 8), Text('Your Wellness Progress'), Spacer(), Text('64%', style: TextStyle(fontWeight: FontWeight.w700))]),
                                  child: Column(children: [
                                    ValueListenableBuilder<int>(
                                      valueListenable: ctrl.progressTab,
                                      builder: (ctx, tab, _) => Tabs(labels: const ['Daily', 'Monthly', 'Weekly', 'Yearly'], index: tab, onChanged: (i){ ctrl.selectProgressTab(i); ctrl.randomizeHeatmap(); }),
                                    ),
                                    const SizedBox(height: 12),
                                    ValueListenableBuilder<List<List<int>>>(
                                      valueListenable: ctrl.heatmap,
                                      builder: (ctx, grid, _) => Heatmap(rows: grid.length, cols: grid.first.length, values: grid),
                                    ),
                                    const SizedBox(height: 12),
                                    Container(
                                      padding: const EdgeInsets.all(10),
                                      decoration: BoxDecoration(color: Colors.black.withOpacity(0.04), borderRadius: BorderRadius.circular(12)),
                                      child: Row(children: [
                                        Container(width: 24, height: 24, decoration: const BoxDecoration(borderRadius: BorderRadius.all(Radius.circular(12)), image: DecorationImage(image: NetworkImage('https://images.unsplash.com/photo-1519681393784-d120267933ba?w=64'), fit: BoxFit.cover))),
                                        const SizedBox(width: 8),
                                        const Expanded(child: Text('If you maintain your habits, HRV may reach 72ms next week')),
                                        const Icon(Icons.north_east, size: 18),
                                      ]),
                                    )
                                  ]),
                                ),
                              ),
                              SizedBox(
                                width: itemW,
                                child: PTCard(
                                  header: Row(children: const [Text('Stress / Recovery Balance'), Spacer(), Text('+0.34', style: TextStyle(fontWeight: FontWeight.w700))]),
                                  child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                                    ValueListenableBuilder<List<double>>(
                                      valueListenable: ctrl.linePoints,
                                      builder: (ctx, pts, _) => LineChart(points: pts, color: Colors.black),
                                    ),
                                    const SizedBox(height: 8),
                                    Row(children: const [
                                      Icon(Icons.circle, size: 8, color: Colors.black54),
                                      SizedBox(width: 6),
                                      Expanded(child: Text("You're recovering faster than average — gentle activity and mindful breathing will keep you in balance", style: TextStyle(color: Colors.black54)))
                                    ]),
                                    const SizedBox(height: 12),
                                    Row(children: [
                                      Expanded(child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                                        const Text('HRV', style: TextStyle(color: Colors.black54)),
                                        const SizedBox(height: 4),
                                        MiniBarChart(values: const [8, 12, 10], labels: const ['Jan','Feb','Mar'], color: Colors.deepPurple),
                                      ])),
                                      Expanded(child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: const [
                                        Text('Glucose', style: TextStyle(color: Colors.black54)),
                                        SizedBox(height: 4),
                                        SizedBox(height: 80, child: SemiDonutGauge(value: 94, max: 160)),
                                        Text('mg/dL', style: TextStyle(color: Colors.black54)),
                                        Text('Avg Glucose'),
                                      ])),
                                    ]),
                                  ]),
                                ),
                              ),
                              SizedBox(
                                width: itemW,
                                child: PTCard(
                                  child: SizedBox(
                                    height: 280,
                                    child: Stack(children: [
                                      Positioned.fill(child: ClipRRect(borderRadius: BorderRadius.circular(12), child: Image.network(
                                        'https://copilot-cn.bytedance.net/api/ide/v1/text_to_image?prompt=soft%20focus%20macro%20flower%20with%20warm%20bokeh%2C%20gentle%20sunset%20tones%2C%20photorealistic%2C%20cinematic%20lighting%2C%20shallow%20depth%20of%20field&image_size=landscape_16_9',
                                        fit: BoxFit.cover,
                                      ))),
                                      Positioned.fill(child: Container(decoration: BoxDecoration(borderRadius: BorderRadius.circular(12), gradient: LinearGradient(colors: [Colors.black.withOpacity(0.05), Colors.black.withOpacity(0.35)], begin: Alignment.topCenter, end: Alignment.bottomCenter)))),
                                      Positioned(
                                        left: 16,
                                        top: 16,
                                        right: 16,
                                        child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: const [
                                          Text('Luma', style: TextStyle(fontSize: 22, fontWeight: FontWeight.w700, color: Colors.white)),
                                          SizedBox(height: 4),
                                          Text('Your personal AI assistant', style: TextStyle(color: Colors.white70)),
                                        ]),
                                      ),
                                      Positioned(
                                        left: 16,
                                        bottom: 72,
                                        child: Wrap(spacing: 8, children: const [
                                          PTChip(text: 'Why is my HRV low?', filled: true),
                                          PTChip(text: 'Am I balanced now?'),
                                          PTChip(text: 'How’s my recovery today?'),
                                        ]),
                                      ),
                                      Positioned(
                                        left: 16,
                                        right: 16,
                                        bottom: 16,
                                        child: PromptBar(),
                                      ),
                                    ]),
                                  ),
                                ),
                              ),
                              SizedBox(
                                width: itemW * (col >= 3 ? 2 : 1),
                                child: PTCard(
                                  child: SizedBox(
                                    height: 260,
                                    child: Stack(children: [
                                      Positioned.fill(child: ClipRRect(borderRadius: BorderRadius.circular(12), child: Image.network(
                                        'https://copilot-cn.bytedance.net/api/ide/v1/text_to_image?prompt=warm%20abstract%20floral%20background%20with%20motion%20blur%2C%20soft%20peach%20and%20gold%20tones%2C%20modern%20dashboard%20aesthetic&image_size=landscape_16_9',
                                        fit: BoxFit.cover,
                                      ))),
                                      Positioned.fill(child: Container(decoration: BoxDecoration(borderRadius: BorderRadius.circular(12), color: Colors.black.withOpacity(0.20)))),
                                      Positioned(
                                        left: 16,
                                        top: 16,
                                        child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: const [
                                          Text('Integrations & Sources Panel', style: TextStyle(fontSize: 18, fontWeight: FontWeight.w700, color: Colors.white)),
                                          SizedBox(height: 2),
                                          Text('Bring all your wellness signals together', style: TextStyle(color: Colors.white70)),
                                          SizedBox(height: 8),
                                          Text('low  •  normal  •  high', style: TextStyle(color: Colors.white54)),
                                        ]),
                                      ),
                                      Positioned(
                                        left: 16,
                                        right: 200,
                                        bottom: 56,
                                        child: LineChart(points: const [1.1,1.8,1.2,1.6,1.3,1.5,1.1,1.7,1.4,1.6], color: Colors.white),
                                      ),
                                      Positioned(
                                        right: 16,
                                        top: 24,
                                        width: 180,
                                        child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: const [
                                          _IntegrationRow(text: 'Connected via Apple Health', time: '2 h ago'),
                                          SizedBox(height: 12),
                                          _IntegrationRow(text: 'Real-time Glucose tracking', time: '5 h ago'),
                                          SizedBox(height: 12),
                                          _IntegrationRow(text: 'Body metrics made simple.', time: 'today 08:24'),
                                        ]),
                                      ),
                                      Positioned(
                                        right: 16,
                                        bottom: 16,
                                        width: 160,
                                        child: SecondaryButton(text: '+ Add app', onPressed: (){}),
                                      )
                                    ]),
                                  ),
                                ),
                              ),
                              SizedBox(
                                width: itemW,
                                child: PTCard(
                                  header: Row(children: const [Text('Sleep (Quality & Recovery)'), Spacer(), Text('+6%', style: TextStyle(fontWeight: FontWeight.w700))]),
                                  child: Column(children: const [
                                    DonutChart(value: 7.7, max: 10, color: Colors.deepPurple, center: Column(mainAxisSize: MainAxisSize.min, children: [Text('7h 42m', style: TextStyle(fontWeight: FontWeight.w700)), Text('Duration', style: TextStyle(color: Colors.black54))])),
                                    SizedBox(height: 8),
                                    Text('21% Deep Sleep • 85/100 Recovery Index'),
                                  ]),
                                ),
                              ),
                            ],
                          ),
                        );
                      }),
                    ),
                  ),
                ],
              ),
            ),
          ],
        ),
      ),
    );
  }
}

class PromptBar extends StatelessWidget {
  const PromptBar({super.key});
  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
      decoration: BoxDecoration(color: Colors.black.withOpacity(0.05), borderRadius: BorderRadius.circular(12)),
      child: Row(children: [const Expanded(child: Text('Ask something...', style: TextStyle(color: Colors.black54))), Container(width: 36, height: 36, decoration: BoxDecoration(color: Colors.black87, borderRadius: BorderRadius.circular(8)), child: const Icon(Icons.send, color: Colors.white))]),
    );
  }
}

class MiniBarChart extends StatelessWidget {
  final List<int> values;
  final List<String> labels;
  final Color color;
  const MiniBarChart({super.key, required this.values, required this.labels, required this.color});
  @override
  Widget build(BuildContext context) {
    return Column(children: [
      Row(children: values.map((v) => Expanded(child: Container(height: 40 + v.toDouble(), margin: const EdgeInsets.symmetric(horizontal: 4), decoration: BoxDecoration(color: color.withOpacity(0.2), borderRadius: BorderRadius.circular(6))))).toList()),
      const SizedBox(height: 4),
      Row(children: labels.map((t) => Expanded(child: Text(t, textAlign: TextAlign.center, style: const TextStyle(color: Colors.black45, fontSize: 12)))).toList()),
    ]);
  }
}

class SemiDonutGauge extends StatelessWidget {
  final double value;
  final double max;
  const SemiDonutGauge({super.key, required this.value, required this.max});
  @override
  Widget build(BuildContext context) {
    return CustomPaint(painter: _SemiDonutPainter(value: value, max: max));
  }
}

class _SemiDonutPainter extends CustomPainter {
  final double value;
  final double max;
  _SemiDonutPainter({required this.value, required this.max});
  @override
  void paint(Canvas canvas, Size size) {
    final rect = Offset.zero & Size(size.width, size.height);
    final center = rect.center;
    final radius = size.height * 0.9;
    final base = Paint()..style = PaintingStyle.stroke..strokeWidth = 12..color = Colors.black12;
    final fg = Paint()..style = PaintingStyle.stroke..strokeWidth = 12..strokeCap = StrokeCap.round..shader = const LinearGradient(colors: [Colors.deepPurple, Colors.blue]).createShader(Rect.fromCircle(center: center, radius: radius));
    final start = -3.14;
    final sweep = 3.14;
    canvas.translate(size.width/2, size.height);
    canvas.drawArc(Rect.fromCircle(center: Offset.zero, radius: radius/2), start, sweep, false, base);
    final ratio = (value/max).clamp(0.0, 1.0);
    canvas.drawArc(Rect.fromCircle(center: Offset.zero, radius: radius/2), start, sweep*ratio, false, fg);
    final tp = TextPainter(text: TextSpan(text: value.toStringAsFixed(0), style: const TextStyle(color: Colors.black, fontSize: 18, fontWeight: FontWeight.w700)), textDirection: TextDirection.ltr)..layout();
    tp.paint(canvas, Offset(-tp.width/2, -radius/2 - 8));
  }
  @override
  bool shouldRepaint(covariant _SemiDonutPainter oldDelegate) => oldDelegate.value != value || oldDelegate.max != max;
}

class _IntegrationRow extends StatelessWidget {
  final String text;
  final String time;
  const _IntegrationRow({required this.text, required this.time});
  @override
  Widget build(BuildContext context) {
    return Row(children: [
      Container(width: 28, height: 28, decoration: const BoxDecoration(color: Colors.white24, shape: BoxShape.circle)),
      const SizedBox(width: 8),
      Expanded(child: Text(text, style: const TextStyle(color: Colors.white))),
      const SizedBox(width: 8),
      Text(time, style: const TextStyle(color: Colors.white70)),
    ]);
  }
}
