// This is a generated file - do not edit.
//
// Generated from domain/social/poll.proto.

// @dart = 3.3

// ignore_for_file: annotate_overrides, camel_case_types, comment_references
// ignore_for_file: constant_identifier_names
// ignore_for_file: curly_braces_in_flow_control_structures
// ignore_for_file: deprecated_member_use_from_same_package, library_prefixes
// ignore_for_file: non_constant_identifier_names, prefer_relative_imports
// ignore_for_file: unused_import

import 'dart:convert' as $convert;
import 'dart:core' as $core;
import 'dart:typed_data' as $typed_data;

@$core.Deprecated('Use votePollRequestDescriptor instead')
const VotePollRequest$json = {
  '1': 'VotePollRequest',
  '2': [
    {'1': 'post_id', '3': 1, '4': 1, '5': 9, '10': 'postId'},
    {'1': 'option_indices', '3': 2, '4': 3, '5': 5, '10': 'optionIndices'},
  ],
};

/// Descriptor for `VotePollRequest`. Decode as a `google.protobuf.DescriptorProto`.
final $typed_data.Uint8List votePollRequestDescriptor = $convert.base64Decode(
    'Cg9Wb3RlUG9sbFJlcXVlc3QSFwoHcG9zdF9pZBgBIAEoCVIGcG9zdElkEiUKDm9wdGlvbl9pbm'
    'RpY2VzGAIgAygFUg1vcHRpb25JbmRpY2Vz');

@$core.Deprecated('Use votePollResponseDescriptor instead')
const VotePollResponse$json = {
  '1': 'VotePollResponse',
  '2': [
    {'1': 'success', '3': 1, '4': 1, '5': 8, '10': 'success'},
    {
      '1': 'result',
      '3': 2,
      '4': 1,
      '5': 11,
      '6': '.peers_touch.model.social.v1.PollResult',
      '10': 'result'
    },
  ],
};

/// Descriptor for `VotePollResponse`. Decode as a `google.protobuf.DescriptorProto`.
final $typed_data.Uint8List votePollResponseDescriptor = $convert.base64Decode(
    'ChBWb3RlUG9sbFJlc3BvbnNlEhgKB3N1Y2Nlc3MYASABKAhSB3N1Y2Nlc3MSPwoGcmVzdWx0GA'
    'IgASgLMicucGVlcnNfdG91Y2gubW9kZWwuc29jaWFsLnYxLlBvbGxSZXN1bHRSBnJlc3VsdA==');

@$core.Deprecated('Use pollResultDescriptor instead')
const PollResult$json = {
  '1': 'PollResult',
  '2': [
    {'1': 'post_id', '3': 1, '4': 1, '5': 9, '10': 'postId'},
    {'1': 'total_votes', '3': 2, '4': 1, '5': 3, '10': 'totalVotes'},
    {
      '1': 'options',
      '3': 3,
      '4': 3,
      '5': 11,
      '6': '.peers_touch.model.social.v1.PollOptionResult',
      '10': 'options'
    },
    {'1': 'has_voted', '3': 4, '4': 1, '5': 8, '10': 'hasVoted'},
    {'1': 'user_votes', '3': 5, '4': 3, '5': 5, '10': 'userVotes'},
    {
      '1': 'expires_at',
      '3': 6,
      '4': 1,
      '5': 11,
      '6': '.google.protobuf.Timestamp',
      '10': 'expiresAt'
    },
    {'1': 'is_expired', '3': 7, '4': 1, '5': 8, '10': 'isExpired'},
  ],
};

/// Descriptor for `PollResult`. Decode as a `google.protobuf.DescriptorProto`.
final $typed_data.Uint8List pollResultDescriptor = $convert.base64Decode(
    'CgpQb2xsUmVzdWx0EhcKB3Bvc3RfaWQYASABKAlSBnBvc3RJZBIfCgt0b3RhbF92b3RlcxgCIA'
    'EoA1IKdG90YWxWb3RlcxJHCgdvcHRpb25zGAMgAygLMi0ucGVlcnNfdG91Y2gubW9kZWwuc29j'
    'aWFsLnYxLlBvbGxPcHRpb25SZXN1bHRSB29wdGlvbnMSGwoJaGFzX3ZvdGVkGAQgASgIUghoYX'
    'NWb3RlZBIdCgp1c2VyX3ZvdGVzGAUgAygFUgl1c2VyVm90ZXMSOQoKZXhwaXJlc19hdBgGIAEo'
    'CzIaLmdvb2dsZS5wcm90b2J1Zi5UaW1lc3RhbXBSCWV4cGlyZXNBdBIdCgppc19leHBpcmVkGA'
    'cgASgIUglpc0V4cGlyZWQ=');

@$core.Deprecated('Use pollOptionResultDescriptor instead')
const PollOptionResult$json = {
  '1': 'PollOptionResult',
  '2': [
    {'1': 'index', '3': 1, '4': 1, '5': 5, '10': 'index'},
    {'1': 'text', '3': 2, '4': 1, '5': 9, '10': 'text'},
    {'1': 'votes', '3': 3, '4': 1, '5': 3, '10': 'votes'},
    {'1': 'percentage', '3': 4, '4': 1, '5': 1, '10': 'percentage'},
  ],
};

/// Descriptor for `PollOptionResult`. Decode as a `google.protobuf.DescriptorProto`.
final $typed_data.Uint8List pollOptionResultDescriptor = $convert.base64Decode(
    'ChBQb2xsT3B0aW9uUmVzdWx0EhQKBWluZGV4GAEgASgFUgVpbmRleBISCgR0ZXh0GAIgASgJUg'
    'R0ZXh0EhQKBXZvdGVzGAMgASgDUgV2b3RlcxIeCgpwZXJjZW50YWdlGAQgASgBUgpwZXJjZW50'
    'YWdl');

@$core.Deprecated('Use getPollResultRequestDescriptor instead')
const GetPollResultRequest$json = {
  '1': 'GetPollResultRequest',
  '2': [
    {'1': 'post_id', '3': 1, '4': 1, '5': 9, '10': 'postId'},
  ],
};

/// Descriptor for `GetPollResultRequest`. Decode as a `google.protobuf.DescriptorProto`.
final $typed_data.Uint8List getPollResultRequestDescriptor =
    $convert.base64Decode(
        'ChRHZXRQb2xsUmVzdWx0UmVxdWVzdBIXCgdwb3N0X2lkGAEgASgJUgZwb3N0SWQ=');

@$core.Deprecated('Use getPollResultResponseDescriptor instead')
const GetPollResultResponse$json = {
  '1': 'GetPollResultResponse',
  '2': [
    {
      '1': 'result',
      '3': 1,
      '4': 1,
      '5': 11,
      '6': '.peers_touch.model.social.v1.PollResult',
      '10': 'result'
    },
  ],
};

/// Descriptor for `GetPollResultResponse`. Decode as a `google.protobuf.DescriptorProto`.
final $typed_data.Uint8List getPollResultResponseDescriptor = $convert.base64Decode(
    'ChVHZXRQb2xsUmVzdWx0UmVzcG9uc2USPwoGcmVzdWx0GAEgASgLMicucGVlcnNfdG91Y2gubW'
    '9kZWwuc29jaWFsLnYxLlBvbGxSZXN1bHRSBnJlc3VsdA==');
