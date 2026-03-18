import 'dart:math' as math;
import 'package:flutter/material.dart';

class DonutChart extends StatelessWidget {
  const DonutChart({super.key, required this.value, required this.max, required this.color, required this.center});
  final double value;
  final double max;
  final Color color;
  final Widget center;

  @override
  Widget build(BuildContext context) {
    return CustomPaint(
      painter: _DonutPainter(value / max, color),
      child: SizedBox(width: 160, height: 160, child: Center(child: center)),
    );
  }
}

class _DonutPainter extends CustomPainter {
  _DonutPainter(this.ratio, this.color);
  final double ratio;
  final Color color;

  @override
  void paint(Canvas canvas, Size size) {
    final c = Offset(size.width / 2, size.height / 2);
    final r = math.min(size.width, size.height) / 2 - 6;
    final basePaint = Paint()
      ..color = Colors.black12
      ..style = PaintingStyle.stroke
      ..strokeWidth = 12
      ..strokeCap = StrokeCap.round;
    final valPaint = Paint()
      ..color = color
      ..style = PaintingStyle.stroke
      ..strokeWidth = 12
      ..strokeCap = StrokeCap.round;
    canvas.drawArc(Rect.fromCircle(center: c, radius: r), -math.pi / 2, 2 * math.pi, false, basePaint);
    canvas.drawArc(Rect.fromCircle(center: c, radius: r), -math.pi / 2, 2 * math.pi * ratio, false, valPaint);
  }

  @override
  bool shouldRepaint(covariant _DonutPainter oldDelegate) => oldDelegate.ratio != ratio || oldDelegate.color != color;
}

