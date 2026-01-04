import 'package:flutter/material.dart';

enum SearchResultType {
  friend,
  post,
  chat,
  applet,
  stationContent,
}

class SearchResult {
  const SearchResult({
    required this.id,
    required this.type,
    required this.title,
    this.subtitle,
    this.iconUrl,
    this.iconData,
    this.url,
    this.metadata,
  });

  factory SearchResult.fromJson(Map<String, dynamic> json) {
    return SearchResult(
      id: json['id'] as String,
      type: SearchResultType.values.firstWhere(
        (e) => e.name == json['type'],
        orElse: () => SearchResultType.stationContent,
      ),
      title: json['title'] as String,
      subtitle: json['subtitle'] as String?,
      iconUrl: json['icon_url'] as String?,
      url: json['url'] as String?,
      metadata: json['metadata'] as Map<String, dynamic>?,
    );
  }

  final String id;
  final SearchResultType type;
  final String title;
  final String? subtitle;
  final String? iconUrl;
  final IconData? iconData;
  final String? url;
  final Map<String, dynamic>? metadata;

  Map<String, dynamic> toJson() {
    return {
      'id': id,
      'type': type.name,
      'title': title,
      'subtitle': subtitle,
      'icon_url': iconUrl,
      'url': url,
      'metadata': metadata,
    };
  }
}
