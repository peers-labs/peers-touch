// This is a generated file - do not edit.
//
// Generated from domain/ai_box/access_control.proto.

// @dart = 3.3

// ignore_for_file: annotate_overrides, camel_case_types, comment_references
// ignore_for_file: constant_identifier_names
// ignore_for_file: curly_braces_in_flow_control_structures
// ignore_for_file: deprecated_member_use_from_same_package, library_prefixes
// ignore_for_file: non_constant_identifier_names, unused_import

import 'dart:convert' as $convert;
import 'dart:core' as $core;
import 'dart:typed_data' as $typed_data;

@$core.Deprecated('Use accessControlDescriptor instead')
const AccessControl$json = {
  '1': 'AccessControl',
  '2': [
    {'1': 'id', '3': 1, '4': 1, '5': 9, '10': 'id'},
    {'1': 'user_id', '3': 2, '4': 1, '5': 9, '10': 'userId'},
    {'1': 'provider_id', '3': 3, '4': 1, '5': 9, '10': 'providerId'},
    {'1': 'model_name', '3': 4, '4': 1, '5': 9, '10': 'modelName'},
    {'1': 'allowed', '3': 5, '4': 1, '5': 8, '10': 'allowed'},
    {'1': 'created_at', '3': 6, '4': 1, '5': 3, '10': 'createdAt'},
    {'1': 'updated_at', '3': 7, '4': 1, '5': 3, '10': 'updatedAt'},
  ],
};

/// Descriptor for `AccessControl`. Decode as a `google.protobuf.DescriptorProto`.
final $typed_data.Uint8List accessControlDescriptor = $convert.base64Decode(
    'Cg1BY2Nlc3NDb250cm9sEg4KAmlkGAEgASgJUgJpZBIXCgd1c2VyX2lkGAIgASgJUgZ1c2VySW'
    'QSHwoLcHJvdmlkZXJfaWQYAyABKAlSCnByb3ZpZGVySWQSHQoKbW9kZWxfbmFtZRgEIAEoCVIJ'
    'bW9kZWxOYW1lEhgKB2FsbG93ZWQYBSABKAhSB2FsbG93ZWQSHQoKY3JlYXRlZF9hdBgGIAEoA1'
    'IJY3JlYXRlZEF0Eh0KCnVwZGF0ZWRfYXQYByABKANSCXVwZGF0ZWRBdA==');
