import 'package:intl/intl.dart';

class DateUtilsX {
  static String formatYmdHm(DateTime dt) => DateFormat('yyyy-MM-dd HH:mm').format(dt);
}