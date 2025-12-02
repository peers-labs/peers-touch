import 'package:flutter/material.dart';

class LineChart extends StatelessWidget {
  final List<double> points;
  final Color color;
  const LineChart({super.key, required this.points, required this.color});

  @override
  Widget build(BuildContext context) {
    return CustomPaint(
      painter: _LinePainter(points, color),
      child: const SizedBox(height: 120),
    );
  }
}

class _LinePainter extends CustomPainter {
  final List<double> points;
  final Color color;
  _LinePainter(this.points, this.color);
  @override
  void paint(Canvas canvas, Size size) {
    if (points.isEmpty) return;
    final maxV = points.reduce((a, b) => a > b ? a : b);
    final minV = points.reduce((a, b) => a < b ? a : b);
    final dx = size.width / (points.length - 1);
    final path = Path();
    for (int i = 0; i < points.length; i++) {
      final x = i * dx;
      final t = (points[i] - minV) / (maxV - minV == 0 ? 1 : (maxV - minV));
      final y = size.height - t * size.height;
      if (i == 0) {
        path.moveTo(x, y);
      } else {
        path.lineTo(x, y);
      }
    }
    final paint = Paint()
      ..color = color
      ..style = PaintingStyle.stroke
      ..strokeWidth = 2;
    canvas.drawPath(path, paint);
  }
  @override
  bool shouldRepaint(covariant _LinePainter oldDelegate) => oldDelegate.points != points || oldDelegate.color != color;
}

