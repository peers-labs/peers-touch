class BaseResponse<T> {
  final int code;
  final String msg;
  final T? data;

  BaseResponse({required this.code, required this.msg, this.data});

  factory BaseResponse.fromJson(
    Map<String, dynamic> json,
    T Function(Object? json)? fromJsonT,
  ) {
    return BaseResponse(
      code: (json['code'] as int?) ?? 0,
      msg: (json['msg'] as String?) ?? '',
      data: fromJsonT?.call(json['data']),
    );
  }

  Map<String, dynamic> toJson() => {
        'code': code,
        'msg': msg,
        'data': data,
      };
}