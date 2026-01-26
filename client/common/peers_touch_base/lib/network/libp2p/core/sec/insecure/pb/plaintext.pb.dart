//
//  Generated code. Do not modify.
//  source: plaintext.proto
//
// @dart = 2.12

// ignore_for_file: annotate_overrides, camel_case_types, comment_references
// ignore_for_file: constant_identifier_names, library_prefixes
// ignore_for_file: non_constant_identifier_names, prefer_final_fields
// ignore_for_file: unnecessary_import, unnecessary_this, unused_import

import 'dart:core' as $core;

import 'package:protobuf/protobuf.dart' as $pb;

import 'package:peers_touch_base/network/libp2p/core/crypto/pb/crypto.pb.dart'
    as $crypto;

/// Exchange message for plaintext protocol
/// Used to exchange peer identity information without encryption
class Exchange extends $pb.GeneratedMessage {
  factory Exchange({
    $core.List<$core.int>? id,
    $crypto.PublicKey? pubkey,
  }) {
    final $result = create();
    if (id != null) {
      $result.id = id;
    }
    if (pubkey != null) {
      $result.pubkey = pubkey;
    }
    return $result;
  }
  Exchange._() : super();
  factory Exchange.fromBuffer($core.List<$core.int> i,
          [$pb.ExtensionRegistry r = $pb.ExtensionRegistry.EMPTY]) =>
      create()..mergeFromBuffer(i, r);
  factory Exchange.fromJson($core.String i,
          [$pb.ExtensionRegistry r = $pb.ExtensionRegistry.EMPTY]) =>
      create()..mergeFromJson(i, r);

  static final $pb.BuilderInfo _i = $pb.BuilderInfo(
      _omitMessageNames ? '' : 'Exchange',
      package:
          const $pb.PackageName(_omitMessageNames ? '' : 'plaintext.pb'),
      createEmptyInstance: create)
    ..a<$core.List<$core.int>>(
        1, _omitFieldNames ? '' : 'id', $pb.PbFieldType.OY)
    ..aOM<$crypto.PublicKey>(2, _omitFieldNames ? '' : 'pubkey',
        subBuilder: $crypto.PublicKey.create)
    ..hasRequiredFields = false;

  @$core.Deprecated('Using this can add significant overhead to your binary. '
      'Use [GeneratedMessageGenericExtensions.deepCopy] instead. '
      'Will be removed in next major version')
  Exchange clone() => Exchange()..mergeFromMessage(this);
  @$core.Deprecated('Using this can add significant overhead to your binary. '
      'Use [GeneratedMessageGenericExtensions.rebuild] instead. '
      'Will be removed in next major version')
  Exchange copyWith(void Function(Exchange) updates) =>
      super.copyWith((message) => updates(message as Exchange)) as Exchange;

  $pb.BuilderInfo get info_ => _i;

  @$core.pragma('dart2js:noInline')
  static Exchange create() => Exchange._();
  Exchange createEmptyInstance() => create();
  static $pb.PbList<Exchange> createRepeated() => $pb.PbList<Exchange>();
  @$core.pragma('dart2js:noInline')
  static Exchange getDefault() =>
      _defaultInstance ??= $pb.GeneratedMessage.$_defaultFor<Exchange>(create);
  static Exchange? _defaultInstance;

  @$pb.TagNumber(1)
  $core.List<$core.int> get id => $_getN(0);
  @$pb.TagNumber(1)
  set id($core.List<$core.int> v) {
    $_setBytes(0, v);
  }

  @$pb.TagNumber(1)
  $core.bool hasId() => $_has(0);
  @$pb.TagNumber(1)
  void clearId() => clearField(1);

  @$pb.TagNumber(2)
  $crypto.PublicKey get pubkey => $_getN(1);
  @$pb.TagNumber(2)
  set pubkey($crypto.PublicKey v) {
    setField(2, v);
  }

  @$pb.TagNumber(2)
  $core.bool hasPubkey() => $_has(1);
  @$pb.TagNumber(2)
  void clearPubkey() => clearField(2);
  @$pb.TagNumber(2)
  $crypto.PublicKey ensurePubkey() => $_ensure(1);
}

const _omitFieldNames =
    $core.bool.fromEnvironment('protobuf.omit_field_names');
const _omitMessageNames =
    $core.bool.fromEnvironment('protobuf.omit_message_names');
