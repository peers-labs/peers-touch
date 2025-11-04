import 'package:equatable/equatable.dart';

/// Base class for all API response models
abstract class BaseResponse<T> extends Equatable {
  final bool success;
  final String? message;
  final T? data;
  final Map<String, dynamic>? metadata;

  const BaseResponse({
    required this.success,
    this.message,
    this.data,
    this.metadata,
  });

  /// Convert the response to a JSON-compatible Map
  Map<String, dynamic> toJson();

  /// Check if the response indicates success
  bool get isSuccess => success;

  /// Check if the response indicates failure
  bool get isFailure => !success;

  /// Get error message if response failed
  String? get errorMessage => isFailure ? (message ?? 'Unknown error') : null;

  @override
  List<Object?> get props => [success, message, data, metadata];
}

/// Standard API response with generic data type
class ApiResponse<T> extends BaseResponse<T> {
  const ApiResponse({
    required super.success,
    super.message,
    super.data,
    super.metadata,
  });

  factory ApiResponse.success({
    T? data,
    String? message,
    Map<String, dynamic>? metadata,
  }) {
    return ApiResponse(
      success: true,
      data: data,
      message: message ?? 'Success',
      metadata: metadata,
    );
  }

  factory ApiResponse.failure({
    required String message,
    T? data,
    Map<String, dynamic>? metadata,
  }) {
    return ApiResponse(
      success: false,
      message: message,
      data: data,
      metadata: metadata,
    );
  }

  factory ApiResponse.fromJson(
    Map<String, dynamic> json,
    T Function(dynamic) fromJsonT,
  ) {
    return ApiResponse(
      success: json['success'] as bool? ?? false,
      message: json['message'] as String?,
      data: json['data'] != null ? fromJsonT(json['data']) : null,
      metadata: json['metadata'] as Map<String, dynamic>?,
    );
  }

  @override
  Map<String, dynamic> toJson() {
    return {
      'success': success,
      if (message != null) 'message': message,
      if (data != null) 'data': _convertToJson(data),
      if (metadata != null) 'metadata': metadata,
    };
  }

  dynamic _convertToJson(dynamic value) {
    if (value is Map<String, dynamic>) {
      return value;
    } else if (value is List) {
      return value.map((item) => _convertToJson(item)).toList();
    } else if (value is BaseResponse) {
      return value.toJson();
    } else {
      return value;
    }
  }
}

/// Paginated API response with metadata
class PaginatedResponse<T> extends BaseResponse<List<T>> {
  final int currentPage;
  final int totalPages;
  final int totalItems;
  final int itemsPerPage;
  final bool hasNextPage;
  final bool hasPreviousPage;

  const PaginatedResponse({
    required super.success,
    required super.data,
    required this.currentPage,
    required this.totalPages,
    required this.totalItems,
    required this.itemsPerPage,
    required this.hasNextPage,
    required this.hasPreviousPage,
    super.message,
    super.metadata,
  });

  factory PaginatedResponse.success({
    required List<T> data,
    required int currentPage,
    required int totalPages,
    required int totalItems,
    required int itemsPerPage,
    String? message,
    Map<String, dynamic>? metadata,
  }) {
    return PaginatedResponse(
      success: true,
      data: data,
      currentPage: currentPage,
      totalPages: totalPages,
      totalItems: totalItems,
      itemsPerPage: itemsPerPage,
      hasNextPage: currentPage < totalPages,
      hasPreviousPage: currentPage > 1,
      message: message ?? 'Success',
      metadata: metadata,
    );
  }

  factory PaginatedResponse.fromJson(
    Map<String, dynamic> json,
    T Function(dynamic) fromJsonT,
  ) {
    final dataList = json['data'] as List<dynamic>? ?? [];
    final pagination = json['pagination'] as Map<String, dynamic>? ?? {};

    return PaginatedResponse(
      success: json['success'] as bool? ?? false,
      message: json['message'] as String?,
      data: dataList.map((item) => fromJsonT(item)).toList(),
      currentPage: pagination['currentPage'] as int? ?? 1,
      totalPages: pagination['totalPages'] as int? ?? 1,
      totalItems: pagination['totalItems'] as int? ?? dataList.length,
      itemsPerPage: pagination['itemsPerPage'] as int? ?? dataList.length,
      hasNextPage: pagination['hasNextPage'] as bool? ?? false,
      hasPreviousPage: pagination['hasPreviousPage'] as bool? ?? false,
      metadata: json['metadata'] as Map<String, dynamic>?,
    );
  }

  @override
  Map<String, dynamic> toJson() {
    return {
      'success': success,
      if (message != null) 'message': message,
      if (data != null) 'data': data!.map((item) => _convertToJson(item)).toList(),
      'pagination': {
        'currentPage': currentPage,
        'totalPages': totalPages,
        'totalItems': totalItems,
        'itemsPerPage': itemsPerPage,
        'hasNextPage': hasNextPage,
        'hasPreviousPage': hasPreviousPage,
      },
      if (metadata != null) 'metadata': metadata,
    };
  }

  dynamic _convertToJson(dynamic value) {
    if (value is Map<String, dynamic>) {
      return value;
    } else if (value is List) {
      return value.map((item) => _convertToJson(item)).toList();
    } else if (value is BaseResponse) {
      return value.toJson();
    } else {
      return value;
    }
  }

  /// Get the next page number
  int? get nextPage => hasNextPage ? currentPage + 1 : null;

  /// Get the previous page number
  int? get previousPage => hasPreviousPage ? currentPage - 1 : null;

  @override
  List<Object?> get props => [
        ...super.props,
        currentPage,
        totalPages,
        totalItems,
        itemsPerPage,
        hasNextPage,
        hasPreviousPage,
      ];
}

/// Empty response for operations that don't return data
class EmptyResponse extends BaseResponse<void> {
  const EmptyResponse({
    required super.success,
    super.message,
    super.metadata,
  });

  factory EmptyResponse.success({String? message, Map<String, dynamic>? metadata}) {
    return EmptyResponse(
      success: true,
      message: message ?? 'Success',
      metadata: metadata,
    );
  }

  factory EmptyResponse.failure({required String message, Map<String, dynamic>? metadata}) {
    return EmptyResponse(
      success: false,
      message: message,
      metadata: metadata,
    );
  }

  factory EmptyResponse.fromJson(Map<String, dynamic> json) {
    return EmptyResponse(
      success: json['success'] as bool? ?? false,
      message: json['message'] as String?,
      metadata: json['metadata'] as Map<String, dynamic>?,
    );
  }

  @override
  Map<String, dynamic> toJson() {
    return {
      'success': success,
      if (message != null) 'message': message,
      if (metadata != null) 'metadata': metadata,
    };
  }
}

/// Error response with detailed error information
class ErrorResponse extends BaseResponse<void> {
  final String errorCode;
  final Map<String, dynamic>? errorDetails;
  final List<String>? validationErrors;

  const ErrorResponse({
    required this.errorCode,
    required super.message,
    this.errorDetails,
    this.validationErrors,
    super.metadata,
  }) : super(success: false);

  factory ErrorResponse.fromJson(Map<String, dynamic> json) {
    return ErrorResponse(
      errorCode: json['errorCode'] as String? ?? 'UNKNOWN_ERROR',
      message: json['message'] as String? ?? 'Unknown error occurred',
      errorDetails: json['errorDetails'] as Map<String, dynamic>?,
      validationErrors: json['validationErrors'] != null
          ? List<String>.from(json['validationErrors'] as List)
          : null,
      metadata: json['metadata'] as Map<String, dynamic>?,
    );
  }

  @override
  Map<String, dynamic> toJson() {
    return {
      'success': success,
      'errorCode': errorCode,
      'message': message,
      if (errorDetails != null) 'errorDetails': errorDetails,
      if (validationErrors != null) 'validationErrors': validationErrors,
      if (metadata != null) 'metadata': metadata,
    };
  }

  @override
  List<Object?> get props => [
        ...super.props,
        errorCode,
        errorDetails,
        validationErrors,
      ];
}