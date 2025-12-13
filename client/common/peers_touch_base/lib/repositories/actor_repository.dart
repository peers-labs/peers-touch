abstract class ActorRepository {
  Future<Map<String, dynamic>?> fetchProfile({required String username});
  Future<List<Map<String, dynamic>>> fetchOutbox({required String username});
  Future<List<Map<String, dynamic>>> fetchInbox({required String username});
}
