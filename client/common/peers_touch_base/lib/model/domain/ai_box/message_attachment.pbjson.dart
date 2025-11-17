// This is a generated file - do not edit.
//
// Generated from domain/ai_box/message_attachment.proto.

// @dart = 3.3

// ignore_for_file: annotate_overrides, camel_case_types, comment_references
// ignore_for_file: constant_identifier_names
// ignore_for_file: curly_braces_in_flow_control_structures
// ignore_for_file: deprecated_member_use_from_same_package, library_prefixes
// ignore_for_file: non_constant_identifier_names, unused_import

import 'dart:convert' as $convert;
import 'dart:core' as $core;
import 'dart:typed_data' as $typed_data;

@$core.Deprecated('Use messageAttachmentDescriptor instead')
const MessageAttachment$json = {
  '1': 'MessageAttachment',
  '2': [
    {'1': 'id', '3': 1, '4': 1, '5': 9, '10': 'id'},
    {'1': 'message_id', '3': 2, '4': 1, '5': 9, '10': 'messageId'},
    {'1': 'name', '3': 3, '4': 1, '5': 9, '10': 'name'},
    {'1': 'size', '3': 4, '4': 1, '5': 3, '10': 'size'},
    {'1': 'type', '3': 5, '4': 1, '5': 9, '10': 'type'},
    {'1': 'url', '3': 6, '4': 1, '5': 9, '10': 'url'},
    {'1': 'metadata_json', '3': 7, '4': 1, '5': 9, '10': 'metadataJson'},
    {'1': 'created_at', '3': 8, '4': 1, '5': 3, '10': 'createdAt'},
  ],
};

/// Descriptor for `MessageAttachment`. Decode as a `google.protobuf.DescriptorProto`.
final $typed_data.Uint8List messageAttachmentDescriptor = $convert.base64Decode(
    'ChFNZXNzYWdlQXR0YWNobWVudBIOCgJpZBgBIAEoCVICaWQSHQoKbWVzc2FnZV9pZBgCIAEoCV'
    'IJbWVzc2FnZUlkEhIKBG5hbWUYAyABKAlSBG5hbWUSEgoEc2l6ZRgEIAEoA1IEc2l6ZRISCgR0'
    'eXBlGAUgASgJUgR0eXBlEhAKA3VybBgGIAEoCVIDdXJsEiMKDW1ldGFkYXRhX2pzb24YByABKA'
    'lSDG1ldGFkYXRhSnNvbhIdCgpjcmVhdGVkX2F0GAggASgDUgljcmVhdGVkQXQ=');
