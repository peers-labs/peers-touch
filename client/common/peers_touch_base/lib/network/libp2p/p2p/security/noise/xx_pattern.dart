import 'dart:async';
import 'dart:convert';
import 'dart:typed_data';

import 'package:cryptography/cryptography.dart';
import 'package:meta/meta.dart';
import 'package:peers_touch_base/network/libp2p/p2p/security/noise/handshake_state.dart';

/// Represents the immutable state of a Noise handshake
class HandshakeState {

  const HandshakeState({
    required this.chainKey,
    required this.handshakeHash,
    required this.state,
    this.cipherKey, // Current cipher key for encryption/decryption during handshake
    this.sendKey,   // Final transport send key (after handshake complete)
    this.recvKey,   // Final transport receive key (after handshake complete)
    this.remoteEphemeralKey,
    this.remoteStaticKey,
    this.nonce = 0, // Nonce counter for cipher key
  });
  final Uint8List chainKey;
  final Uint8List handshakeHash;
  final XXHandshakeState state;
  final SecretKey? cipherKey;
  final SecretKey? sendKey;
  final SecretKey? recvKey;
  final Uint8List? remoteEphemeralKey;
  final Uint8List? remoteStaticKey;
  final int nonce;

  HandshakeState copyWith({
    Uint8List? chainKey,
    Uint8List? handshakeHash,
    XXHandshakeState? state,
    SecretKey? cipherKey,
    SecretKey? sendKey,
    SecretKey? recvKey,
    Uint8List? remoteEphemeralKey,
    Uint8List? remoteStaticKey,
    int? nonce,
  }) {
    return HandshakeState(
      chainKey: chainKey ?? this.chainKey,
      handshakeHash: handshakeHash ?? this.handshakeHash,
      state: state ?? this.state,
      cipherKey: cipherKey ?? this.cipherKey,
      sendKey: sendKey ?? this.sendKey,
      recvKey: recvKey ?? this.recvKey,
      remoteEphemeralKey: remoteEphemeralKey ?? this.remoteEphemeralKey,
      remoteStaticKey: remoteStaticKey ?? this.remoteStaticKey,
      nonce: nonce ?? this.nonce,
    );
  }
}

/// Message type for length validation
enum NoiseMessageType {
  ephemeralKey,
  secondMessage,
  finalMessage,
}

/// Implementation of the Noise XX pattern for libp2p
/// 
/// The XX pattern:
///   -> e                    // Initial: Initiator sends ephemeral key
///   <- e, ee, s, es        // Response: Responder sends ephemeral key, performs ee+es
///   -> s, se               // Final: Initiator sends static key, performs se
class NoiseXXPattern {
  
  NoiseXXPattern._(
    this._isInitiator,
    this._staticKeys,
    this._ephemeralKeys,
    this._state,
  );
  static const PROTOCOL_NAME = 'Noise_XX_25519_ChaChaPoly_SHA256';
  static const KEY_LEN = 32;
  static const MAC_LEN = 16;
  
  // Core components
  final bool _isInitiator;
  final SimpleKeyPair _staticKeys;
  final SimpleKeyPair _ephemeralKeys;
  
  // Current handshake state
  HandshakeState _state;

  /// Creates a new NoiseXXPattern instance
  static Future<NoiseXXPattern> create(bool isInitiator, SimpleKeyPair staticKeys, {List<int>? prologue}) async {
    // Generate ephemeral keys
    final ephemeralKeys = await X25519().newKeyPair();
    
    // Initialize symmetric state per Noise spec and flynn/noise behavior:
    // 1. If len(protocol_name) <= HASHLEN (32): h = protocol_name (padded with zeros)
    //    Else: h = HASH(protocol_name)
    // 2. ck = h
    // 3. MixHash(prologue) - h = SHA256(h || prologue)
    // 4. k = empty (no cipher key until first MixKey)
    final protocolName = utf8.encode(PROTOCOL_NAME);
    _validateProtocolName(protocolName);
    
    const hashLen = 32; // SHA256 output length
    Uint8List initialH;
    if (protocolName.length <= hashLen) {
      // Direct copy, pad with zeros if needed
      initialH = Uint8List(hashLen);
      for (var i = 0; i < protocolName.length; i++) {
        initialH[i] = protocolName[i];
      }
    } else {
      // Hash the protocol name
      final hash = await Sha256().hash(protocolName);
      initialH = Uint8List.fromList(hash.bytes);
    }
    
    // ck = h (before MixHash)
    final chainKey = Uint8List.fromList(initialH);
    
    // MixHash(prologue) - h = SHA256(h || prologue)
    // This is ALWAYS called, even with empty prologue
    final prologueData = prologue ?? <int>[];
    final mixedHash = await Sha256().hash([...initialH, ...prologueData]);
    final handshakeHash = Uint8List.fromList(mixedHash.bytes);
    
    final state = HandshakeState(
      chainKey: chainKey,
      handshakeHash: handshakeHash,
      state: XXHandshakeState.initial,
      // cipherKey starts as null - will be set after first MixKey
    );
    
    return NoiseXXPattern._(isInitiator, staticKeys, ephemeralKeys, state);
  }

  /// Process an incoming handshake message and return decrypted payload (if any)
  Future<Uint8List> readMessage(Uint8List message) async {
    if (_state.state == XXHandshakeState.error) {
      throw StateError('Cannot read message in error state');
    }
    
    try {
      _validateReadState();
      
      final (newState, payload) = await switch (_state.state) {
        XXHandshakeState.initial => _processInitialMessageWithPayload(message),
        XXHandshakeState.sentE => _processSecondMessageWithPayload(message),
        XXHandshakeState.sentEES => _processFinalMessageWithPayload(message),
        _ => throw StateError('Cannot read message in state: ${_state.state}'),
      };
      
      _state = newState;
      return payload;
    } catch (e) {
      // Only set error state for non-validation errors
      if (e is! StateError) {
        _state = _state.copyWith(state: XXHandshakeState.error);
      }
      rethrow;
    }
  }

  /// Generate the next handshake message with optional payload
  /// - Message 1 (initiator): payload is ignored (no encryption key yet)
  /// - Message 2 (responder): payload is encrypted and appended
  /// - Message 3 (initiator): payload is encrypted and appended
  Future<Uint8List> writeMessage(List<int> payload) async {
    if (_state.state == XXHandshakeState.error) {
      throw StateError('Cannot write message in error state');
    }
    
    try {
      _validateWriteState();
      
      final result = await switch (_state.state) {
        XXHandshakeState.initial => _writeInitialMessage(),
        XXHandshakeState.sentE => _writeSecondMessageWithPayload(payload),
        XXHandshakeState.sentEES => _writeFinalMessage(payload),
        _ => throw StateError('Cannot write message in state: ${_state.state}'),
      };
      
      _state = result.$2;  // Update state
      return result.$1;    // Return message
    } catch (e) {
      // Only set error state for non-validation errors
      if (e is! StateError) {
        _state = _state.copyWith(state: XXHandshakeState.error);
      }
      rethrow;
    }
  }

  /// Validates that we can read in the current state
  void _validateReadState() {
    if (_state.state == XXHandshakeState.complete) {
      throw StateError('Handshake already complete');
    }

    if (_isInitiator && _state.state == XXHandshakeState.initial) {
      throw StateError('Initiator cannot read first message');
    }
  }

  /// Validates that we can write in the current state
  void _validateWriteState() {
    if (_state.state == XXHandshakeState.complete) {
      throw StateError('Handshake already complete');
    }

    if (!_isInitiator && _state.state == XXHandshakeState.initial) {
      throw StateError('Responder cannot write first message');
    }

    if (_isInitiator && _state.state == XXHandshakeState.sentE) {
      throw StateError('Initiator cannot write second message');
    }

    if (!_isInitiator && _state.state == XXHandshakeState.sentE) {
      if (_state.remoteEphemeralKey == null) {
        throw StateError('Cannot write second message without remote ephemeral key');
      }
    }

    if (_isInitiator && _state.state == XXHandshakeState.sentEES) {
      if (_state.remoteStaticKey == null) {
        throw StateError('Cannot write final message without remote static key');
      }
    }
  }

  /// Process the initial message (e) - returns (state, payload)
  /// Note: msg1 has no payload, so payload is always empty
  Future<(HandshakeState, Uint8List)> _processInitialMessageWithPayload(Uint8List message) async {
    _validateMessageLength(message, KEY_LEN, NoiseMessageType.ephemeralKey);
    
    var state = _state;
    
    // Extract remote ephemeral key
    final remoteEphemeral = message.sublist(0, KEY_LEN);
    await _validatePublicKey(remoteEphemeral);
    
    // Mix hash with ephemeral key
    var newHash = await _mixHash(state.handshakeHash, remoteEphemeral);
    state = state.copyWith(
      handshakeHash: newHash,
      remoteEphemeralKey: remoteEphemeral,
    );
    
    // DecryptAndHash(remaining payload) - since no cipher key, this is just MixHash(payload)
    // For msg1, the remaining payload after 'e' is empty
    // This matches flynn/noise behavior where ReadMessage always calls DecryptAndHash on remaining data
    final remainingPayload = message.length > KEY_LEN ? message.sublist(KEY_LEN) : <int>[];
    newHash = await _mixHash(state.handshakeHash, remainingPayload);
    state = state.copyWith(handshakeHash: newHash);
    
    return (
      state.copyWith(state: XXHandshakeState.sentE),
      Uint8List.fromList(remainingPayload), // Payload in msg1 (usually empty)
    );
  }

  /// Process the second message (e, ee, s, es + payload) - returns (state, payload)
  /// 
  /// For initiator receiving msg2: e, ee, s, es + encrypted_payload
  /// The payload is encrypted with the key derived after 'es'
  Future<(HandshakeState, Uint8List)> _processSecondMessageWithPayload(Uint8List message) async {
    // Check state first
    if (!_isInitiator && _state.state == XXHandshakeState.sentE) {
      throw StateError('Responder cannot receive second message');
    }
    
    const minLen = KEY_LEN + KEY_LEN + MAC_LEN;
    _validateMessageLength(message, minLen, NoiseMessageType.secondMessage);
    
    var state = _state;
    
    // Extract and validate remote ephemeral key (e)
    final remoteEphemeral = message.sublist(0, KEY_LEN);
    await _validatePublicKey(remoteEphemeral);
    
    // Mix hash with 'e'
    var newHash = await _mixHash(state.handshakeHash, remoteEphemeral);
    state = state.copyWith(
      handshakeHash: newHash,
      remoteEphemeralKey: remoteEphemeral,
    );
    
    // ee: MixKey(DH(e, re))
    final (ck1, k1) = await _mixKey(
      _ephemeralKeys,
      remoteEphemeral,
      state.chainKey,
    );
    state = state.copyWith(chainKey: ck1, cipherKey: k1, nonce: 0);
    
    // Decrypt s (responder's static key encrypted with k1)
    final encryptedStatic = message.sublist(KEY_LEN, KEY_LEN + KEY_LEN + MAC_LEN);
    
    final remoteStatic = await _decryptWithAdAndNonce(
      encryptedStatic,
      state.handshakeHash,
      state.cipherKey!,
      state.nonce,
    );
    await _validatePublicKey(remoteStatic);
    state = state.copyWith(nonce: state.nonce + 1);
    
    // Mix hash with encrypted static
    newHash = await _mixHash(state.handshakeHash, encryptedStatic);
    state = state.copyWith(
      handshakeHash: newHash,
      remoteStaticKey: remoteStatic,
    );
    
    // es: MixKey(DH(e, rs)) - initiator uses own ephemeral with responder's static
    final (ck2, k2) = await _mixKey(
      _ephemeralKeys,
      remoteStatic,
      state.chainKey,
    );
    state = state.copyWith(chainKey: ck2, cipherKey: k2, nonce: 0);
    
    // Decrypt payload if present (msg2 contains responder's handshake payload)
    Uint8List decryptedPayload = Uint8List(0);
    final payloadStart = KEY_LEN + KEY_LEN + MAC_LEN;
    if (message.length > payloadStart) {
      final encryptedPayload = message.sublist(payloadStart);
      if (encryptedPayload.length > MAC_LEN) {
        decryptedPayload = await _decryptWithAdAndNonce(
          encryptedPayload,
          state.handshakeHash,
          state.cipherKey!,
          state.nonce,
        );
        state = state.copyWith(nonce: state.nonce + 1);
        
        // Mix hash with encrypted payload
        newHash = await _mixHash(state.handshakeHash, encryptedPayload);
        state = state.copyWith(handshakeHash: newHash);
      }
    }
    
    return (
      state.copyWith(state: XXHandshakeState.sentEES),
      decryptedPayload,
    );
  }

  /// Process the final message (s, se + payload) - returns (state, payload)
  /// 
  /// Responder processes msg3 from initiator: s, se, encrypted_payload
  Future<(HandshakeState, Uint8List)> _processFinalMessageWithPayload(Uint8List message) async {
    const minLen = KEY_LEN + MAC_LEN;
    _validateMessageLength(message, minLen, NoiseMessageType.finalMessage);
    
    var state = _state;
    
    // At this point, cipherKey should be set from processing/writing msg2
    if (state.cipherKey == null) {
      throw StateError('Cipher key is null - handshake state corrupted');
    }
    
    // Decrypt s (initiator's static key)
    final encryptedStatic = message.sublist(0, KEY_LEN + MAC_LEN);
    final remoteStatic = await _decryptWithAdAndNonce(
      encryptedStatic,
      state.handshakeHash,
      state.cipherKey!,
      state.nonce,
    );
    await _validatePublicKey(remoteStatic);
    state = state.copyWith(nonce: state.nonce + 1);
    
    // Mix hash with encrypted static key
    var newHash = await _mixHash(state.handshakeHash, encryptedStatic);
    state = state.copyWith(
      handshakeHash: newHash,
      remoteStaticKey: remoteStatic,
    );
    
    // se: MixKey(DH(e, rs)) - responder uses ephemeral with initiator's static
    final (ck3, k3) = await _mixKey(
      _ephemeralKeys,
      remoteStatic,
      state.chainKey,
    );
    state = state.copyWith(chainKey: ck3, cipherKey: k3, nonce: 0);
    
    // Process payload if present (msg3 contains initiator's handshake payload)
    Uint8List decryptedPayload = Uint8List(0);
    if (message.length > minLen) {
      final encryptedPayload = message.sublist(minLen);
      if (encryptedPayload.length > MAC_LEN) {
        decryptedPayload = await _decryptWithAdAndNonce(
          encryptedPayload,
          state.handshakeHash,
          state.cipherKey!,
          state.nonce,
        );
        state = state.copyWith(nonce: state.nonce + 1);
        
        newHash = await _mixHash(state.handshakeHash, encryptedPayload);
        state = state.copyWith(handshakeHash: newHash);
      }
    }
    
    // Derive final transport keys
    final (sendKey, recvKey) = await _deriveKeys(state.chainKey);
    state = state.copyWith(sendKey: sendKey, recvKey: recvKey);
    
    return (
      state.copyWith(state: XXHandshakeState.complete),
      decryptedPayload,
    );
  }

  /// Write the initial message (e)
  Future<(Uint8List message, HandshakeState state)> _writeInitialMessage() async {
    // Get our ephemeral public key
    final ephemeralPub = await _ephemeralKeys.extractPublicKey();
    final ephemeralBytes = ephemeralPub.bytes;
    
    // Mix hash with ephemeral key
    var newHash = await _mixHash(_state.handshakeHash, ephemeralBytes);
    
    // EncryptAndHash(empty payload) - since no cipher key, this is just MixHash(empty)
    // This matches flynn/noise behavior where WriteMessage always calls EncryptAndHash on payload
    newHash = await _mixHash(newHash, <int>[]);
    
    return (
      Uint8List.fromList(ephemeralBytes),
      _state.copyWith(
        handshakeHash: newHash,
        state: XXHandshakeState.sentE,
      ),
    );
  }

  /// Write the second message (e, ee, s, es + optional payload)
  /// 
  /// Responder writes msg2: e, ee, s, es, encrypted_payload
  Future<(Uint8List message, HandshakeState state)> _writeSecondMessageWithPayload(List<int> payload) async {
    var state = _state;
    final messageBytes = <int>[];
    
    // Validate we have the required keys
    if (state.remoteEphemeralKey == null) {
      throw StateError('Cannot write second message without remote ephemeral key');
    }
    
    // e - append our ephemeral public key
    final ephemeralPub = await _ephemeralKeys.extractPublicKey();
    final ephemeralBytes = ephemeralPub.bytes;
    messageBytes.addAll(ephemeralBytes);
    
    // Mix hash with e
    var newHash = await _mixHash(state.handshakeHash, ephemeralBytes);
    state = state.copyWith(handshakeHash: newHash);
    
    // ee: MixKey(DH(e, re))
    final (ck1, k1) = await _mixKey(
      _ephemeralKeys,
      state.remoteEphemeralKey as List<int>,
      state.chainKey,
    );
    state = state.copyWith(chainKey: ck1, cipherKey: k1, nonce: 0);
    
    // s - encrypt our static public key with k1
    final staticPub = await _staticKeys.extractPublicKey();
    final staticBytes = staticPub.bytes;
    final encryptedStatic = await _encryptWithAdAndNonce(
      staticBytes,
      state.handshakeHash,
      state.cipherKey!,
      state.nonce,
    );
    messageBytes.addAll(encryptedStatic);
    state = state.copyWith(nonce: state.nonce + 1);
    
    // Mix hash with encrypted static
    newHash = await _mixHash(state.handshakeHash, encryptedStatic);
    state = state.copyWith(handshakeHash: newHash);
    
    // es: MixKey(DH(s, re)) - responder uses own static with initiator's ephemeral
    final (ck2, k2) = await _mixKey(
      _staticKeys,
      state.remoteEphemeralKey as List<int>,
      state.chainKey,
    );
    state = state.copyWith(chainKey: ck2, cipherKey: k2, nonce: 0);
    
    // Encrypt and append payload if present
    if (payload.isNotEmpty) {
      final encryptedPayload = await _encryptWithAdAndNonce(
        payload,
        state.handshakeHash,
        state.cipherKey!,
        state.nonce,
      );
      messageBytes.addAll(encryptedPayload);
      state = state.copyWith(nonce: state.nonce + 1);
      
      newHash = await _mixHash(state.handshakeHash, encryptedPayload);
      state = state.copyWith(handshakeHash: newHash);
    }
    
    return (
      Uint8List.fromList(messageBytes),
      state.copyWith(state: XXHandshakeState.sentEES),
    );
  }

  /// Write the final message (s, se + payload)
  /// 
  /// Initiator writes msg3: s, se, encrypted_payload
  Future<(Uint8List message, HandshakeState state)> _writeFinalMessage(List<int> payload) async {
    var state = _state;
    final messageBytes = <int>[];
    
    // At this point, cipherKey should be set from processing msg2
    if (state.cipherKey == null) {
      throw StateError('Cipher key is null - handshake state corrupted');
    }
    if (state.remoteEphemeralKey == null) {
      throw StateError('Remote ephemeral key is null - handshake state corrupted');
    }
    
    // s - encrypt our static key with current cipher key
    final staticPub = await _staticKeys.extractPublicKey();
    final staticBytes = staticPub.bytes;
    final encryptedStatic = await _encryptWithAdAndNonce(
      staticBytes,
      state.handshakeHash,
      state.cipherKey!,
      state.nonce,
    );
    messageBytes.addAll(encryptedStatic);
    state = state.copyWith(nonce: state.nonce + 1);
    
    // Mix hash with encrypted static key
    var newHash = await _mixHash(state.handshakeHash, encryptedStatic);
    state = state.copyWith(handshakeHash: newHash);
    
    // se: MixKey(DH(s, re)) - initiator uses own static with responder's ephemeral
    final (ck3, k3) = await _mixKey(
      _staticKeys,
      state.remoteEphemeralKey as List<int>,
      state.chainKey,
    );
    state = state.copyWith(chainKey: ck3, cipherKey: k3, nonce: 0);
    
    // Encrypt payload if present
    if (payload.isNotEmpty) {
      final encryptedPayload = await _encryptWithAdAndNonce(
        payload,
        state.handshakeHash,
        state.cipherKey!,
        state.nonce,
      );
      messageBytes.addAll(encryptedPayload);
      state = state.copyWith(nonce: state.nonce + 1);
      
      newHash = await _mixHash(state.handshakeHash, encryptedPayload);
      state = state.copyWith(handshakeHash: newHash);
    }
    
    // Derive final transport keys
    final (sendKey, recvKey) = await _deriveKeys(state.chainKey);
    
    return (
      Uint8List.fromList(messageBytes),
      state.copyWith(
        sendKey: sendKey,
        recvKey: recvKey,
        state: XXHandshakeState.complete,
      ),
    );
  }

  // Cryptographic operations

  /// Validates a public key
  Future<void> _validatePublicKey(List<int> publicKey) async {
    if (publicKey.length != KEY_LEN) {
      throw StateError('Invalid public key length: ${publicKey.length}');
    }
    // Additional validation could be added here
  }

  /// Validates protocol name
  static void _validateProtocolName(List<int> protocolName) {
    if (protocolName.length != utf8.encode(PROTOCOL_NAME).length) {
      throw StateError('Invalid protocol name length');
    }
    if (!protocolName.every((b) => b >= 32 && b <= 126)) {
      throw StateError('Protocol name contains non-printable characters');
    }
    if (PROTOCOL_NAME != 'Noise_XX_25519_ChaChaPoly_SHA256') {
      throw StateError('Invalid protocol name');
    }
  }

  /// Validates message length
  void _validateMessageLength(Uint8List message, int minLength, NoiseMessageType type) {
    switch (type) {
      case NoiseMessageType.ephemeralKey:
        if (message.length < KEY_LEN) {
          throw StateError('Message too short to contain ephemeral key: ${message.length} < $KEY_LEN');
        }
        break;
      case NoiseMessageType.secondMessage:
        // First check for ephemeral key
        if (message.length < KEY_LEN) {
          throw StateError('Message too short to contain ephemeral key: ${message.length} < $KEY_LEN');
        }
        // Then check if we have enough space for the encrypted static key
        if (message.length < KEY_LEN + KEY_LEN) {
          throw StateError('Message too short to contain encrypted static key: ${message.length} < ${KEY_LEN + KEY_LEN}');
        }
        // Finally check for full message length including MAC
        if (message.length < minLength) {
          throw StateError('Second message too short: ${message.length} < $minLength (needs 32 bytes ephemeral key + 32 bytes encrypted static key + 16 bytes MAC)');
        }
        break;
      case NoiseMessageType.finalMessage:
        if (message.length < minLength) {
          throw StateError('Final message too short: ${message.length} < $minLength (needs 32 bytes encrypted static key + 16 bytes MAC)');
        }
        break;
    }
  }

  /// Performs Diffie-Hellman and implements MixKey per Noise spec
  /// Returns (new_chainKey, new_cipherKey)
  /// 
  /// MixKey(input_key_material):
  ///   ck, temp_k = HKDF(ck, input_key_material, 2)
  ///   k = temp_k
  ///   n = 0
  Future<(Uint8List, SecretKey)> _mixKey(
    SimpleKeyPair privateKey,
    List<int> publicKey,
    List<int> currentChainKey,
  ) async {
    // Perform X25519 DH
    final algorithm = X25519();
    final shared = await algorithm.sharedSecretKey(
      keyPair: privateKey,
      remotePublicKey: SimplePublicKey(publicKey, type: KeyPairType.x25519),
    );
    final sharedBytes = await shared.extractBytes();
    
    // HKDF with 2 outputs: new_ck and temp_k
    // HKDF-Extract: temp_key = HMAC(ck, input_key_material)
    // HKDF-Expand: output1 = HMAC(temp_key, 0x01)
    //              output2 = HMAC(temp_key, output1 || 0x02)
    final hmac = Hmac.sha256();
    
    // Extract
    final tempKey = await hmac.calculateMac(
      sharedBytes,
      secretKey: SecretKey(currentChainKey),
    );
    
    // Expand - output1 = new chain key
    final output1 = await hmac.calculateMac(
      [0x01],
      secretKey: SecretKey(tempKey.bytes),
    );
    
    // Expand - output2 = new cipher key
    final output2 = await hmac.calculateMac(
      [...output1.bytes, 0x02],
      secretKey: SecretKey(tempKey.bytes),
    );
    
    return (
      Uint8List.fromList(output1.bytes),
      SecretKey(Uint8List.fromList(output2.bytes)),
    );
  }

  /// Mixes data into the handshake hash
  Future<Uint8List> _mixHash(List<int> currentHash, List<int> data) async {
    final hash = await Sha256().hash([...currentHash, ...data]);
    return Uint8List.fromList(hash.bytes);
  }

  /// Creates a 12-byte nonce from a counter value (little-endian, zero-padded)
  Uint8List _createNonce(int n) {
    final nonce = Uint8List(12);
    // Little-endian encoding of counter in lower 8 bytes
    var value = n;
    for (var i = 4; i < 12 && value > 0; i++) {
      nonce[i] = value & 0xFF;
      value >>= 8;
    }
    return nonce;
  }

  /// Encrypts data with additional data and nonce counter
  Future<Uint8List> _encryptWithAdAndNonce(
    List<int> plaintext,
    List<int> ad,
    SecretKey key,
    int n,
  ) async {
    final algorithm = Chacha20.poly1305Aead();
    final nonce = _createNonce(n);
    final secretBox = await algorithm.encrypt(
      plaintext,
      secretKey: key,
      nonce: nonce,
      aad: ad,
    );
    return Uint8List.fromList([
      ...secretBox.cipherText,
      ...secretBox.mac.bytes,
    ]);
  }

  /// Decrypts data with additional data and nonce counter
  Future<Uint8List> _decryptWithAdAndNonce(
    List<int> data,
    List<int> ad,
    SecretKey key,
    int n,
  ) async {
    if (data.length < MAC_LEN) {
      throw StateError('Data too short to contain MAC');
    }
    
    final algorithm = Chacha20.poly1305Aead();
    final nonce = _createNonce(n);
    final cipherText = data.sublist(0, data.length - MAC_LEN);
    final mac = data.sublist(data.length - MAC_LEN);
    
    return Uint8List.fromList(await algorithm.decrypt(
      SecretBox(cipherText, nonce: nonce, mac: Mac(mac)),
      secretKey: key,
      aad: ad,
    ));
  }

  /// Derives the final cipher keys using Noise Split() function
  /// Split() uses HKDF to derive two transport keys from the chainKey:
  ///   tempKey = HMAC-SHA256(ck, [])
  ///   k1 = HMAC-SHA256(tempKey, [0x01])
  ///   k2 = HMAC-SHA256(tempKey, k1 || [0x02])
  Future<(SecretKey sendKey, SecretKey recvKey)> _deriveKeys(List<int> chainKey) async {
    final hmac = Hmac.sha256();
    
    // tempKey = HMAC-SHA256(chainKey, []) - empty input key material
    final tempKeyMac = await hmac.calculateMac(<int>[], secretKey: SecretKey(chainKey));
    final tempKey = Uint8List.fromList(tempKeyMac.bytes);
    
    // k1 = HMAC-SHA256(tempKey, [0x01])
    final k1Mac = await hmac.calculateMac([0x01], secretKey: SecretKey(tempKey));
    final k1 = Uint8List.fromList(k1Mac.bytes);
    
    // k2 = HMAC-SHA256(tempKey, k1 || [0x02])
    final k2Input = Uint8List.fromList([...k1, 0x02]);
    final k2Mac = await hmac.calculateMac(k2Input, secretKey: SecretKey(tempKey));
    final k2 = Uint8List.fromList(k2Mac.bytes);

    final k1Key = SecretKey(k1);
    final k2Key = SecretKey(k2);

    // According to Noise spec:
    // - Initiator: c1 = encrypt, c2 = decrypt
    // - Responder: c1 = decrypt, c2 = encrypt
    return _isInitiator ? (k1Key, k2Key) : (k2Key, k1Key);
  }

  // Public API

  bool get isComplete => _state.state == XXHandshakeState.complete;
  XXHandshakeState get state => _state.state;

  Future<Uint8List> getStaticPublicKey() async {
    final pubKey = await _staticKeys.extractPublicKey();
    return Uint8List.fromList(pubKey.bytes);
  }
  
  Uint8List get remoteStaticKey {
    final key = _state.remoteStaticKey;
    if (key == null) {
      throw StateError('Remote static key not available');
    }
    return key;
  }

  SecretKey get sendKey {
    final key = _state.sendKey;
    if (key == null) {
      throw StateError('Send key not initialized');
    }
    return key;
  }

  SecretKey get recvKey {
    final key = _state.recvKey;
    if (key == null) {
      throw StateError('Receive key not initialized');
    }
    return key;
  }

  // Testing support
  @visibleForTesting
  static Future<NoiseXXPattern> createForTesting(
    bool isInitiator,
    SimpleKeyPair staticKeys,
    SimpleKeyPair ephemeralKeys,
  ) async {
    final protocolName = utf8.encode(PROTOCOL_NAME);
    _validateProtocolName(protocolName);
    
    final initialHash = await Sha256().hash(protocolName);
    final tempKey = SecretKey(Uint8List.fromList(initialHash.bytes));
    
    final state = HandshakeState(
      chainKey: Uint8List.fromList(initialHash.bytes),
      handshakeHash: Uint8List.fromList(initialHash.bytes),
      state: XXHandshakeState.initial,
      sendKey: tempKey,
      recvKey: tempKey,
    );
    
    return NoiseXXPattern._(isInitiator, staticKeys, ephemeralKeys, state);
  }

  @visibleForTesting
  Uint8List get debugChainKey => _state.chainKey;
  
  @visibleForTesting
  Uint8List get debugHandshakeHash => _state.handshakeHash;
  
  @visibleForTesting
  SimpleKeyPair get debugEphemeralKeys => _ephemeralKeys;
  
  @visibleForTesting
  Uint8List? get debugRemoteStaticKey => _state.remoteStaticKey;
}
