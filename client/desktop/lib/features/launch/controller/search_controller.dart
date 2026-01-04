import 'dart:async';
import 'package:get/get.dart';
import 'package:peers_touch_base/logger/logging_service.dart';
import 'package:peers_touch_desktop/features/launch/model/content_source.dart';
import 'package:peers_touch_desktop/features/launch/model/search_query.dart';
import 'package:peers_touch_desktop/features/launch/model/search_result.dart';
import 'package:peers_touch_desktop/features/launch/service/search/search_aggregator_service.dart';

class LaunchSearchController extends GetxController {
  final SearchAggregatorService _searchService = Get.find();

  final searchQuery = ''.obs;
  final selectedScope = SearchScope.all.obs;
  final searchResults = <SearchScope, List<SearchResult>>{}.obs;
  final isSearching = false.obs;
  final selectedIndex = 0.obs;

  Timer? _debounceTimer;

  @override
  void onInit() {
    super.onInit();
    _setupSearchListener();
  }

  void _setupSearchListener() {
    ever(searchQuery, (query) {
      _debounceTimer?.cancel();
      _debounceTimer = Timer(const Duration(milliseconds: 300), () {
        _performSearch(query);
      });
    });
  }

  Future<void> _performSearch(String query) async {
    if (query.isEmpty) {
      searchResults.clear();
      return;
    }

    isSearching.value = true;

    final searchQueryObj = SearchQuery(
      query: query,
      scopes: [selectedScope.value],
      limit: 20,
    );

    try {
      await for (final results in _searchService.searchAll(searchQueryObj)) {
        searchResults.value = results;
      }
    } catch (e) {
      LoggingService.error('Search failed: $e');
    } finally {
      isSearching.value = false;
    }
  }

  void navigateDown() {
    final totalItems = _getTotalResultCount();
    if (totalItems > 0 && selectedIndex.value < totalItems - 1) {
      selectedIndex.value++;
    }
  }

  void navigateUp() {
    if (selectedIndex.value > 0) {
      selectedIndex.value--;
    }
  }

  void executeSelected() {
    final result = _getResultByIndex(selectedIndex.value);
    if (result != null) {
      _executeAction(result);
    }
  }

  void _executeAction(SearchResult result) {
    LoggingService.info('Executing action for: ${result.title}');
    Get.back();
  }

  int _getTotalResultCount() {
    int count = 0;
    for (final results in searchResults.values) {
      count += results.length;
    }
    return count;
  }

  SearchResult? _getResultByIndex(int index) {
    int currentIndex = 0;
    for (final results in searchResults.values) {
      if (index < currentIndex + results.length) {
        return results[index - currentIndex];
      }
      currentIndex += results.length;
    }
    return null;
  }

  @override
  void onClose() {
    _debounceTimer?.cancel();
    _searchService.cancelAll();
    super.onClose();
  }
}
