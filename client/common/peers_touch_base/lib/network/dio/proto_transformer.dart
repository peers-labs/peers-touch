import 'dart:async';
import 'dart:typed_data';

import 'package:dio/dio.dart';
import 'package:protobuf/protobuf.dart';

class ProtoTransformer extends SyncTransformer {
  ProtoTransformer() : super(jsonDecodeCallback: _parseJson);

  static dynamic _parseJson(String text) {
    return text;
  }

  @override
  Future<String> transformRequest(RequestOptions options) async {
    final data = options.data;
    
    if (data is GeneratedMessage) {
      options.contentType = Headers.jsonContentType;
      return data.writeToJson();
    }
    
    return super.transformRequest(options);
  }

  @override
  Future transformResponse(RequestOptions options, ResponseBody responseBody) async {
    final contentType = responseBody.headers['content-type']?.first ?? '';
    
    if (contentType.contains('application/json')) {
      final responseType = options.responseType;
      final String text = await responseBody.stream.bytesToString();
      
      if (responseType == ResponseType.plain) {
        return text;
      }
      
      final type = options.extra['responseType'] as Type?;
      if (type != null && _isProtoType(type)) {
        final proto = _createProtoInstance(type);
        if (proto != null) {
          proto.mergeFromProto3Json(text);
          return proto;
        }
      }
      
      return text;
    } else if (contentType.contains('application/protobuf') || 
               contentType.contains('application/x-protobuf')) {
      final Uint8List bytes = await responseBody.stream.toBytes();
      
      final type = options.extra['responseType'] as Type?;
      if (type != null && _isProtoType(type)) {
        final proto = _createProtoInstance(type);
        if (proto != null) {
          proto.mergeFromBuffer(bytes);
          return proto;
        }
      }
      
      return bytes;
    }
    
    return super.transformResponse(options, responseBody);
  }

  bool _isProtoType(Type type) {
    try {
      final instance = _createProtoInstance(type);
      return instance is GeneratedMessage;
    } catch (e) {
      return false;
    }
  }

  GeneratedMessage? _createProtoInstance(Type type) {
    return null;
  }
}
