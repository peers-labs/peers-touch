
class BridgeMessage {
  final String module;
  final String action;
  final Map<String, dynamic> params;
  final String? callbackId;

  BridgeMessage({
    required this.module,
    required this.action,
    required this.params,
    this.callbackId,
  });

  factory BridgeMessage.fromMap(Map<String, dynamic> map) {
    return BridgeMessage(
      module: map['module'] as String,
      action: map['action'] as String,
      params: Map<String, dynamic>.from(map['params'] as Map),
      callbackId: map['callbackId'] as String?,
    );
  }

  Map<String, dynamic> toMap() {
    return {
      'module': module,
      'action': action,
      'params': params,
      'callbackId': callbackId,
    };
  }
}

class BridgeResponse {
  final bool success;
  final dynamic data;
  final String? error;

  BridgeResponse({
    required this.success,
    this.data,
    this.error,
  });

  Map<String, dynamic> toMap() {
    return {
      'success': success,
      'data': data,
      'error': error,
    };
  }
  
  factory BridgeResponse.success(dynamic data) {
    return BridgeResponse(success: true, data: data);
  }

  factory BridgeResponse.failure(String error) {
    return BridgeResponse(success: false, error: error);
  }
}
