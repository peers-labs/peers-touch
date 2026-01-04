import 'package:peers_touch_desktop/features/launch/model/content_source.dart';

class SearchQuery {
  const SearchQuery({
    required this.query,
    this.scopes = const [SearchScope.all],
    this.limit = 20,
  });

  final String query;
  final List<SearchScope> scopes;
  final int limit;

  Map<String, dynamic> toJson() {
    return {
      'query': query,
      'scopes': scopes.map((e) => e.name).toList(),
      'limit': limit,
    };
  }
}
