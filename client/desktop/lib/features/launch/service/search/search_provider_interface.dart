import 'package:peers_touch_desktop/features/launch/model/content_source.dart';
import 'package:peers_touch_desktop/features/launch/model/search_query.dart';
import 'package:peers_touch_desktop/features/launch/model/search_result.dart';

abstract class SearchProvider {
  String get name;

  SearchScope get scope;

  int get priority;

  bool get supportsRealtimeSearch;

  Stream<List<SearchResult>> search(SearchQuery query);

  void cancelSearch();
}
