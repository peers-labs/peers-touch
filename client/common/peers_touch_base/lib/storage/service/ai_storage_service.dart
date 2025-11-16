abstract class AIStorageService {
  Future<void> saveMessage(String message);
  Future<String?> getMessage();
}