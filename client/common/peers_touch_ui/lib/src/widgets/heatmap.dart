import 'package:flutter/material.dart';

class Heatmap extends StatelessWidget {
  final int rows;
  final int cols;
  final List<List<int>> values;
  final List<Color> palette;
  const Heatmap({super.key, required this.rows, required this.cols, required this.values, this.palette = const [Color(0xFFE8E8F6), Color(0xFFCECFF2), Color(0xFFB3B5ED), Color(0xFF999BE8)]});
  @override
  Widget build(BuildContext context) {
    return CustomPaint(
      painter: _HeatmapPainter(rows, cols, values, palette),
      child: const SizedBox(height: 120),
    );
  }
}

class _HeatmapPainter extends CustomPainter {
  final int rows;
  final int cols;
  final List<List<int>> values;
  final List<Color> palette;
  _HeatmapPainter(this.rows, this.cols, this.values, this.palette);
  @override
  void paint(Canvas canvas, Size size) {
    final gap = 4.0;
    final cellW = (size.width - gap * (cols - 1)) / cols;
    final cellH = (size.height - gap * (rows - 1)) / rows;
    final r = Radius.circular(6);
    for (int rix = 0; rix < rows; rix++) {
      for (int cix = 0; cix < cols; cix++) {
        final v = values[rix][cix].clamp(0, palette.length - 1);
        final color = palette[v];
        final x = cix * (cellW + gap);
        final y = rix * (cellH + gap);
        final rect = RRect.fromRectAndCorners(Rect.fromLTWH(x, y, cellW, cellH), topLeft: r, topRight: r, bottomLeft: r, bottomRight: r);
        final paint = Paint()..color = color;
        canvas.drawRRect(rect, paint);
      }
    }
  }
  @override
  bool shouldRepaint(covariant _HeatmapPainter oldDelegate) => oldDelegate.values != values;
}

