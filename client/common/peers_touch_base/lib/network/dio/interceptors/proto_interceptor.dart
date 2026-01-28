import 'dart:convert';
import 'dart:typed_data';

import 'package:dio/dio.dart';
import 'package:protobuf/protobuf.dart';

class ProtoInterceptor extends Interceptor {
  @override
  void onRequest(RequestOptions options, RequestInterceptorHandler handler) {
    final data = options.data;
    
    if (data is GeneratedMessage) {
      options.headers['Content-Type'] = 'application/protobuf';
      options.data = data.writeToBuffer();
    }
    
    // Only set Accept header if not already set, allowing callers to request JSON
    if (!options.headers.containsKey('Accept')) {
      options.headers['Accept'] = 'application/protobuf';
      options.responseType = ResponseType.bytes;
    }
    
    handler.next(options);
  }

  @override
  void onResponse(Response response, ResponseInterceptorHandler handler) {
    final contentType = response.headers.value('content-type') ?? '';
    final data = response.data;
    
    if (contentType.contains('application/protobuf') || 
        contentType.contains('application/x-protobuf')) {
      if (data is List<int>) {
        response.data = Uint8List.fromList(data);
      } else if (data is Uint8List) {
        response.data = data;
      }
    } else if (contentType.contains('application/json')) {
      if (data is String) {
        try {
          response.data = jsonDecode(data);
        } catch (e) {
          // Keep as string if decode fails
        }
      } else if (data is List<int>) {
        try {
          final jsonStr = utf8.decode(data);
          response.data = jsonDecode(jsonStr);
        } catch (e) {
          // Keep as bytes if decode fails
        }
      }
    }
    
    handler.next(response);
  }
}
