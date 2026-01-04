import 'dart:async';
import 'package:get/get.dart';
import 'package:peers_touch_desktop/features/launch/model/content_source.dart';
import 'package:peers_touch_desktop/features/launch/model/search_query.dart';
import 'package:peers_touch_desktop/features/launch/model/search_result.dart';
import 'package:peers_touch_desktop/features/launch/service/search/search_provider_interface.dart';

class SearchAggregatorService extends GetxService {
  final List<SearchProvider> _providers = [];

  void registerProvider(SearchProvider provider) {
    _providers.add(provider);
    _providers.sort((a, b) => a.priority.compareTo(b.priority));
  }

  Stream<Map<SearchScope, List<SearchResult>>> searchAll(
      SearchQuery query) async* {
    final activeProviders = _getActiveProviders(query.scopes);

    if (activeProviders.isEmpty) {
      yield {};
      return;
    }

    final results = <SearchScope, List<SearchResult>>{};

    for (final provider in activeProviders) {
      await for (final providerResults in provider.search(query)) {
        results[provider.scope] = providerResults;
        yield Map.from(results);
      }
    }
  }

  List<SearchProvider> _getActiveProviders(List<SearchScope> scopes) {
    if (scopes.contains(SearchScope.all)) {
      return _providers;
    }

    return _providers
        .where((provider) => scopes.contains(provider.scope))
        .toList();
  }

  void cancelAll() {
    for (final provider in _providers) {
      provider.cancelSearch();
    }
  }
}
