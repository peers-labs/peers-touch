class Validator {
  static bool isEmail(String input) {
    final regex = RegExp(r'^[\w\.-]+@[\w\.-]+\.[a-zA-Z]{2,}$');
    return regex.hasMatch(input);
  }

  static bool isPhone(String input) {
    final regex = RegExp(r'^\d{6,15}$');
    return regex.hasMatch(input);
  }
}