enum UploadStatus {
  UPLOADING,
  COMPLETED,
  FAILED,
}

class UploadProgress {
  final double percentage;
  final int uploaded;
  final int total;
  final UploadStatus status;

  const UploadProgress({
    required this.percentage,
    required this.uploaded,
    required this.total,
    required this.status,
  });

  factory UploadProgress.initial() {
    return const UploadProgress(
      percentage: 0.0,
      uploaded: 0,
      total: 0,
      status: UploadStatus.UPLOADING,
    );
  }

  factory UploadProgress.completed(int totalBytes) {
    return UploadProgress(
      percentage: 1.0,
      uploaded: totalBytes,
      total: totalBytes,
      status: UploadStatus.COMPLETED,
    );
  }

  factory UploadProgress.failed() {
    return const UploadProgress(
      percentage: 0.0,
      uploaded: 0,
      total: 0,
      status: UploadStatus.FAILED,
    );
  }

  UploadProgress copyWith({
    double? percentage,
    int? uploaded,
    int? total,
    UploadStatus? status,
  }) {
    return UploadProgress(
      percentage: percentage ?? this.percentage,
      uploaded: uploaded ?? this.uploaded,
      total: total ?? this.total,
      status: status ?? this.status,
    );
  }

  Map<String, dynamic> toJson() {
    return {
      'percentage': percentage,
      'uploaded': uploaded,
      'total': total,
      'status': status.name,
    };
  }

  factory UploadProgress.fromJson(Map<String, dynamic> json) {
    return UploadProgress(
      percentage: (json['percentage'] as num).toDouble(),
      uploaded: json['uploaded'] as int,
      total: json['total'] as int,
      status: UploadStatus.values.firstWhere(
        (e) => e.name == json['status'],
        orElse: () => UploadStatus.UPLOADING,
      ),
    );
  }

  @override
  String toString() {
    return 'UploadProgress(percentage: ${(percentage * 100).toStringAsFixed(1)}%, uploaded: $uploaded/$total, status: $status)';
  }

  @override
  bool operator ==(Object other) {
    if (identical(this, other)) return true;

    return other is UploadProgress &&
        other.percentage == percentage &&
        other.uploaded == uploaded &&
        other.total == total &&
        other.status == status;
  }

  @override
  int get hashCode {
    return percentage.hashCode ^
        uploaded.hashCode ^
        total.hashCode ^
        status.hashCode;
  }
}
