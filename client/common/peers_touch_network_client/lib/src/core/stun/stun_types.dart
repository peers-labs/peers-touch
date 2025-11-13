import 'dart:typed_data';
import 'dart:io';

/// STUN消息类型
enum StunMessageType {
  bindingRequest(0x0001),
  bindingResponse(0x0101),
  bindingErrorResponse(0x0111),
  sharedSecretRequest(0x0002),
  sharedSecretResponse(0x0102),
  sharedSecretErrorResponse(0x0112);

  final int value;
  const StunMessageType(this.value);

  static StunMessageType? fromValue(int value) {
    return StunMessageType.values.firstWhere(
      (type) => type.value == value,
      orElse: () => throw ArgumentError('Invalid STUN message type: $value'),
    );
  }
}

/// STUN属性类型
enum StunAttributeType {
  mappedAddress(0x0001),
  responseAddress(0x0002),
  changeRequest(0x0003),
  sourceAddress(0x0004),
  changedAddress(0x0005),
  username(0x0006),
  password(0x0007),
  messageIntegrity(0x0008),
  errorCode(0x0009),
  unknownAttributes(0x000A),
  reflectedFrom(0x000B),
  xorMappedAddress(0x0020),
  xorRelayedAddress(0x0016),
  lifetime(0x000D),
  bandwidth(0x0010),
  data(0x0013);

  final int value;
  const StunAttributeType(this.value);
}

/// STUN响应
class StunResponse {
  final bool success;
  final InternetAddress? publicAddress;
  final int? publicPort;
  final String? errorMessage;
  final Map<String, dynamic> attributes;

  StunResponse({
    required this.success,
    this.publicAddress,
    this.publicPort,
    this.errorMessage,
    this.attributes = const {},
  });
}

/// STUN消息
class StunMessage {
  final StunMessageType type;
  final Uint8List transactionId;
  final Map<StunAttributeType, Uint8List> attributes;

  StunMessage({
    required this.type,
    required this.transactionId,
    this.attributes = const {},
  });

  /// 序列化为字节数组
  Uint8List toBytes() {
    // STUN消息头: 类型(2) + 长度(2) + 魔术Cookie(4) + 事务ID(12) = 20字节
    final buffer = BytesBuilder();
    
    // 消息类型
    buffer.addByte((type.value >> 8) & 0xFF);
    buffer.addByte(type.value & 0xFF);
    
    // 消息长度（不包括头部20字节）
    final attributesLength = attributes.values
        .fold<int>(0, (sum, attr) => sum + 4 + attr.length + (4 - attr.length % 4) % 4);
    
    buffer.addByte((attributesLength >> 8) & 0xFF);
    buffer.addByte(attributesLength & 0xFF);
    
    // 魔术Cookie (RFC 5389)
    final magicCookie = Uint8List.fromList([0x21, 0x12, 0xA4, 0x42]);
    buffer.add(magicCookie);
    
    // 事务ID
    buffer.add(transactionId);
    
    // 属性
    for (final entry in attributes.entries) {
      final attrType = entry.key;
      final attrValue = entry.value;
      
      // 属性类型
      buffer.addByte((attrType.value >> 8) & 0xFF);
      buffer.addByte(attrType.value & 0xFF);
      
      // 属性长度
      buffer.addByte((attrValue.length >> 8) & 0xFF);
      buffer.addByte(attrValue.length & 0xFF);
      
      // 属性值
      buffer.add(attrValue);
      
      // 填充到4字节边界
      final padding = (4 - attrValue.length % 4) % 4;
      if (padding > 0) {
        buffer.add(Uint8List(padding));
      }
    }
    
    return buffer.toBytes();
  }

  /// 从字节数组解析
  factory StunMessage.fromBytes(Uint8List bytes) {
    if (bytes.length < 20) {
      throw ArgumentError('Invalid STUN message: too short');
    }
    
    // 解析消息类型
    final messageTypeValue = (bytes[0] << 8) | bytes[1];
    final messageType = StunMessageType.fromValue(messageTypeValue) ?? 
                       StunMessageType.bindingRequest; // 默认值
    
    // 解析消息长度
    final messageLength = (bytes[2] << 8) | bytes[3];
    
    // 验证魔术Cookie
    final magicCookie = bytes.sublist(4, 8);
    if (!isValidMagicCookie(magicCookie)) {
      throw ArgumentError('Invalid STUN magic cookie');
    }
    
    // 解析事务ID
    final transactionId = bytes.sublist(8, 20);
    
    // 解析属性
    final attributes = <StunAttributeType, Uint8List>{};
    int offset = 20;
    
    while (offset < bytes.length && offset < 20 + messageLength) {
      if (offset + 4 > bytes.length) break;
      
      final attrTypeValue = (bytes[offset] << 8) | bytes[offset + 1];
      final attrLength = (bytes[offset + 2] << 8) | bytes[offset + 3];
      
      final attrType = StunAttributeType.values.firstWhere(
        (type) => type.value == attrTypeValue,
        orElse: () => StunAttributeType.mappedAddress, // 默认值
      );
      
      if (offset + 4 + attrLength <= bytes.length) {
        final attrValue = bytes.sublist(offset + 4, offset + 4 + attrLength);
        attributes[attrType] = attrValue;
      }
      
      // 跳过属性和填充
      final paddedLength = attrLength + (4 - attrLength % 4) % 4;
      offset += 4 + paddedLength;
    }
    
    return StunMessage(
      type: messageType,
      transactionId: transactionId,
      attributes: attributes,
    );
  }

  static bool isValidMagicCookie(Uint8List cookie) {
    return cookie.length == 4 &&
        cookie[0] == 0x21 &&
        cookie[1] == 0x12 &&
        cookie[2] == 0xA4 &&
        cookie[3] == 0x42;
  }
}