import 'package:equatable/equatable.dart';

/// Base class for all API request models
abstract class BaseRequest extends Equatable {
  const BaseRequest();

  /// Convert the request model to a JSON-compatible Map
  Map<String, dynamic> toJson();

  /// Validate the request data before sending
  void validate() {}

  @override
  List<Object?> get props => [];
}

/// Base class for paginated requests
abstract class PaginatedRequest extends BaseRequest {
  final int page;
  final int pageSize;
  final String? sortBy;
  final String? sortOrder;

  const PaginatedRequest({
    this.page = 1,
    this.pageSize = 20,
    this.sortBy,
    this.sortOrder = 'asc',
  });

  @override
  Map<String, dynamic> toJson() {
    return {
      'page': page,
      'pageSize': pageSize,
      if (sortBy != null) 'sortBy': sortBy,
      if (sortOrder != null) 'sortOrder': sortOrder,
    };
  }

  @override
  void validate() {
    if (page < 1) {
      throw ArgumentError('Page must be greater than 0');
    }
    if (pageSize < 1 || pageSize > 100) {
      throw ArgumentError('Page size must be between 1 and 100');
    }
  }

  @override
  List<Object?> get props => [page, pageSize, sortBy, sortOrder];
}

/// Request model for simple GET requests with query parameters
class QueryRequest extends BaseRequest {
  final Map<String, dynamic> parameters;

  const QueryRequest({this.parameters = const {}});

  factory QueryRequest.fromMap(Map<String, dynamic> map) {
    return QueryRequest(parameters: Map<String, dynamic>.from(map));
  }

  @override
  Map<String, dynamic> toJson() => Map<String, dynamic>.from(parameters);

  /// Add a query parameter
  QueryRequest addParameter(String key, dynamic value) {
    final newParams = Map<String, dynamic>.from(parameters);
    newParams[key] = value;
    return QueryRequest(parameters: newParams);
  }

  /// Remove a query parameter
  QueryRequest removeParameter(String key) {
    final newParams = Map<String, dynamic>.from(parameters);
    newParams.remove(key);
    return QueryRequest(parameters: newParams);
  }

  @override
  List<Object?> get props => [parameters];
}

/// Request model for POST/PUT requests with body data
class BodyRequest<T> extends BaseRequest {
  final T data;
  final Map<String, dynamic>? metadata;

  const BodyRequest({
    required this.data,
    this.metadata,
  });

  @override
  Map<String, dynamic> toJson() {
    return {
      'data': _convertToJson(data),
      if (metadata != null) 'metadata': metadata,
    };
  }

  dynamic _convertToJson(dynamic value) {
    if (value is Map<String, dynamic>) {
      return value;
    } else if (value is List) {
      return value.map((item) => _convertToJson(item)).toList();
    } else if (value is BaseRequest) {
      return value.toJson();
    } else {
      return value;
    }
  }

  @override
  void validate() {
    if (data == null) {
      throw ArgumentError('Request body data cannot be null');
    }
  }

  @override
  List<Object?> get props => [data, metadata];
}

/// Request model for file upload requests
class FileUploadRequest extends BaseRequest {
  final List<UploadFile> files;
  final Map<String, dynamic>? fields;

  const FileUploadRequest({
    required this.files,
    this.fields,
  });

  @override
  Map<String, dynamic> toJson() {
    throw UnsupportedError(
        'File upload requests should not be converted to JSON');
  }

  @override
  void validate() {
    if (files.isEmpty) {
      throw ArgumentError('At least one file must be provided');
    }
    for (final file in files) {
      file.validate();
    }
  }

  @override
  List<Object?> get props => [files, fields];
}

/// Represents a file to be uploaded
class UploadFile {
  final String fieldName;
  final String fileName;
  final List<int> bytes;
  final String? contentType;

  const UploadFile({
    required this.fieldName,
    required this.fileName,
    required this.bytes,
    this.contentType,
  });

  void validate() {
    if (fieldName.isEmpty) {
      throw ArgumentError('Field name cannot be empty');
    }
    if (fileName.isEmpty) {
      throw ArgumentError('File name cannot be empty');
    }
    if (bytes.isEmpty) {
      throw ArgumentError('File bytes cannot be empty');
    }
  }
}