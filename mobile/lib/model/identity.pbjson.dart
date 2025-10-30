// This is a generated file - do not edit.
//
// Generated from identity.proto.

// @dart = 3.3

// ignore_for_file: annotate_overrides, camel_case_types, comment_references
// ignore_for_file: constant_identifier_names
// ignore_for_file: curly_braces_in_flow_control_structures
// ignore_for_file: deprecated_member_use_from_same_package, library_prefixes
// ignore_for_file: non_constant_identifier_names, unused_import

import 'dart:convert' as $convert;
import 'dart:core' as $core;
import 'dart:typed_data' as $typed_data;

@$core.Deprecated('Use identityIDDescriptor instead')
const IdentityID$json = {
  '1': 'IdentityID',
  '2': [
    {'1': 'value', '3': 1, '4': 1, '5': 9, '10': 'value'},
  ],
};

/// Descriptor for `IdentityID`. Decode as a `google.protobuf.DescriptorProto`.
final $typed_data.Uint8List identityIDDescriptor =
    $convert.base64Decode('CgpJZGVudGl0eUlEEhQKBXZhbHVlGAEgASgJUgV2YWx1ZQ==');

@$core.Deprecated('Use identityMetaDescriptor instead')
const IdentityMeta$json = {
  '1': 'IdentityMeta',
  '2': [
    {
      '1': 'id',
      '3': 1,
      '4': 1,
      '5': 11,
      '6': '.peers_touch.v2.IdentityID',
      '10': 'id'
    },
    {'1': 'public_key', '3': 2, '4': 1, '5': 12, '10': 'publicKey'},
    {
      '1': 'attributes',
      '3': 3,
      '4': 3,
      '5': 11,
      '6': '.peers_touch.v2.IdentityMeta.AttributesEntry',
      '10': 'attributes'
    },
    {
      '1': 'created_at',
      '3': 4,
      '4': 1,
      '5': 11,
      '6': '.google.protobuf.Timestamp',
      '10': 'createdAt'
    },
    {
      '1': 'updated_at',
      '3': 5,
      '4': 1,
      '5': 11,
      '6': '.google.protobuf.Timestamp',
      '10': 'updatedAt'
    },
    {
      '1': 'expires_at',
      '3': 6,
      '4': 1,
      '5': 11,
      '6': '.google.protobuf.Timestamp',
      '10': 'expiresAt'
    },
  ],
  '3': [IdentityMeta_AttributesEntry$json],
};

@$core.Deprecated('Use identityMetaDescriptor instead')
const IdentityMeta_AttributesEntry$json = {
  '1': 'AttributesEntry',
  '2': [
    {'1': 'key', '3': 1, '4': 1, '5': 9, '10': 'key'},
    {'1': 'value', '3': 2, '4': 1, '5': 9, '10': 'value'},
  ],
  '7': {'7': true},
};

/// Descriptor for `IdentityMeta`. Decode as a `google.protobuf.DescriptorProto`.
final $typed_data.Uint8List identityMetaDescriptor = $convert.base64Decode(
    'CgxJZGVudGl0eU1ldGESKgoCaWQYASABKAsyGi5wZWVyc190b3VjaC52Mi5JZGVudGl0eUlEUg'
    'JpZBIdCgpwdWJsaWNfa2V5GAIgASgMUglwdWJsaWNLZXkSTAoKYXR0cmlidXRlcxgDIAMoCzIs'
    'LnBlZXJzX3RvdWNoLnYyLklkZW50aXR5TWV0YS5BdHRyaWJ1dGVzRW50cnlSCmF0dHJpYnV0ZX'
    'MSOQoKY3JlYXRlZF9hdBgEIAEoCzIaLmdvb2dsZS5wcm90b2J1Zi5UaW1lc3RhbXBSCWNyZWF0'
    'ZWRBdBI5Cgp1cGRhdGVkX2F0GAUgASgLMhouZ29vZ2xlLnByb3RvYnVmLlRpbWVzdGFtcFIJdX'
    'BkYXRlZEF0EjkKCmV4cGlyZXNfYXQYBiABKAsyGi5nb29nbGUucHJvdG9idWYuVGltZXN0YW1w'
    'UglleHBpcmVzQXQaPQoPQXR0cmlidXRlc0VudHJ5EhAKA2tleRgBIAEoCVIDa2V5EhQKBXZhbH'
    'VlGAIgASgJUgV2YWx1ZToCOAE=');

@$core.Deprecated('Use signatureDescriptor instead')
const Signature$json = {
  '1': 'Signature',
  '2': [
    {'1': 'data', '3': 1, '4': 1, '5': 12, '10': 'data'},
    {'1': 'key_id', '3': 2, '4': 1, '5': 9, '10': 'keyId'},
    {'1': 'algorithm', '3': 3, '4': 1, '5': 9, '10': 'algorithm'},
    {
      '1': 'timestamp',
      '3': 4,
      '4': 1,
      '5': 11,
      '6': '.google.protobuf.Timestamp',
      '10': 'timestamp'
    },
  ],
};

/// Descriptor for `Signature`. Decode as a `google.protobuf.DescriptorProto`.
final $typed_data.Uint8List signatureDescriptor = $convert.base64Decode(
    'CglTaWduYXR1cmUSEgoEZGF0YRgBIAEoDFIEZGF0YRIVCgZrZXlfaWQYAiABKAlSBWtleUlkEh'
    'wKCWFsZ29yaXRobRgDIAEoCVIJYWxnb3JpdGhtEjgKCXRpbWVzdGFtcBgEIAEoCzIaLmdvb2ds'
    'ZS5wcm90b2J1Zi5UaW1lc3RhbXBSCXRpbWVzdGFtcA==');

@$core.Deprecated('Use credentialDescriptor instead')
const Credential$json = {
  '1': 'Credential',
  '2': [
    {'1': 'id', '3': 1, '4': 1, '5': 9, '10': 'id'},
    {
      '1': 'issuer',
      '3': 2,
      '4': 1,
      '5': 11,
      '6': '.peers_touch.v2.IdentityID',
      '10': 'issuer'
    },
    {
      '1': 'subject',
      '3': 3,
      '4': 1,
      '5': 11,
      '6': '.peers_touch.v2.IdentityID',
      '10': 'subject'
    },
    {
      '1': 'claims',
      '3': 4,
      '4': 3,
      '5': 11,
      '6': '.peers_touch.v2.Credential.ClaimsEntry',
      '10': 'claims'
    },
    {
      '1': 'issued_at',
      '3': 5,
      '4': 1,
      '5': 11,
      '6': '.google.protobuf.Timestamp',
      '10': 'issuedAt'
    },
    {
      '1': 'expires_at',
      '3': 6,
      '4': 1,
      '5': 11,
      '6': '.google.protobuf.Timestamp',
      '10': 'expiresAt'
    },
    {
      '1': 'signature',
      '3': 7,
      '4': 1,
      '5': 11,
      '6': '.peers_touch.v2.Signature',
      '10': 'signature'
    },
  ],
  '3': [Credential_ClaimsEntry$json],
};

@$core.Deprecated('Use credentialDescriptor instead')
const Credential_ClaimsEntry$json = {
  '1': 'ClaimsEntry',
  '2': [
    {'1': 'key', '3': 1, '4': 1, '5': 9, '10': 'key'},
    {'1': 'value', '3': 2, '4': 1, '5': 9, '10': 'value'},
  ],
  '7': {'7': true},
};

/// Descriptor for `Credential`. Decode as a `google.protobuf.DescriptorProto`.
final $typed_data.Uint8List credentialDescriptor = $convert.base64Decode(
    'CgpDcmVkZW50aWFsEg4KAmlkGAEgASgJUgJpZBIyCgZpc3N1ZXIYAiABKAsyGi5wZWVyc190b3'
    'VjaC52Mi5JZGVudGl0eUlEUgZpc3N1ZXISNAoHc3ViamVjdBgDIAEoCzIaLnBlZXJzX3RvdWNo'
    'LnYyLklkZW50aXR5SURSB3N1YmplY3QSPgoGY2xhaW1zGAQgAygLMiYucGVlcnNfdG91Y2gudj'
    'IuQ3JlZGVudGlhbC5DbGFpbXNFbnRyeVIGY2xhaW1zEjcKCWlzc3VlZF9hdBgFIAEoCzIaLmdv'
    'b2dsZS5wcm90b2J1Zi5UaW1lc3RhbXBSCGlzc3VlZEF0EjkKCmV4cGlyZXNfYXQYBiABKAsyGi'
    '5nb29nbGUucHJvdG9idWYuVGltZXN0YW1wUglleHBpcmVzQXQSNwoJc2lnbmF0dXJlGAcgASgL'
    'MhkucGVlcnNfdG91Y2gudjIuU2lnbmF0dXJlUglzaWduYXR1cmUaOQoLQ2xhaW1zRW50cnkSEA'
    'oDa2V5GAEgASgJUgNrZXkSFAoFdmFsdWUYAiABKAlSBXZhbHVlOgI4AQ==');

@$core.Deprecated('Use identityCreateRequestDescriptor instead')
const IdentityCreateRequest$json = {
  '1': 'IdentityCreateRequest',
  '2': [
    {
      '1': 'attributes',
      '3': 1,
      '4': 3,
      '5': 11,
      '6': '.peers_touch.v2.IdentityCreateRequest.AttributesEntry',
      '10': 'attributes'
    },
  ],
  '3': [IdentityCreateRequest_AttributesEntry$json],
};

@$core.Deprecated('Use identityCreateRequestDescriptor instead')
const IdentityCreateRequest_AttributesEntry$json = {
  '1': 'AttributesEntry',
  '2': [
    {'1': 'key', '3': 1, '4': 1, '5': 9, '10': 'key'},
    {'1': 'value', '3': 2, '4': 1, '5': 9, '10': 'value'},
  ],
  '7': {'7': true},
};

/// Descriptor for `IdentityCreateRequest`. Decode as a `google.protobuf.DescriptorProto`.
final $typed_data.Uint8List identityCreateRequestDescriptor = $convert.base64Decode(
    'ChVJZGVudGl0eUNyZWF0ZVJlcXVlc3QSVQoKYXR0cmlidXRlcxgBIAMoCzI1LnBlZXJzX3RvdW'
    'NoLnYyLklkZW50aXR5Q3JlYXRlUmVxdWVzdC5BdHRyaWJ1dGVzRW50cnlSCmF0dHJpYnV0ZXMa'
    'PQoPQXR0cmlidXRlc0VudHJ5EhAKA2tleRgBIAEoCVIDa2V5EhQKBXZhbHVlGAIgASgJUgV2YW'
    'x1ZToCOAE=');

@$core.Deprecated('Use identityUpdateRequestDescriptor instead')
const IdentityUpdateRequest$json = {
  '1': 'IdentityUpdateRequest',
  '2': [
    {
      '1': 'id',
      '3': 1,
      '4': 1,
      '5': 11,
      '6': '.peers_touch.v2.IdentityID',
      '10': 'id'
    },
    {
      '1': 'attributes',
      '3': 2,
      '4': 3,
      '5': 11,
      '6': '.peers_touch.v2.IdentityUpdateRequest.AttributesEntry',
      '10': 'attributes'
    },
  ],
  '3': [IdentityUpdateRequest_AttributesEntry$json],
};

@$core.Deprecated('Use identityUpdateRequestDescriptor instead')
const IdentityUpdateRequest_AttributesEntry$json = {
  '1': 'AttributesEntry',
  '2': [
    {'1': 'key', '3': 1, '4': 1, '5': 9, '10': 'key'},
    {'1': 'value', '3': 2, '4': 1, '5': 9, '10': 'value'},
  ],
  '7': {'7': true},
};

/// Descriptor for `IdentityUpdateRequest`. Decode as a `google.protobuf.DescriptorProto`.
final $typed_data.Uint8List identityUpdateRequestDescriptor = $convert.base64Decode(
    'ChVJZGVudGl0eVVwZGF0ZVJlcXVlc3QSKgoCaWQYASABKAsyGi5wZWVyc190b3VjaC52Mi5JZG'
    'VudGl0eUlEUgJpZBJVCgphdHRyaWJ1dGVzGAIgAygLMjUucGVlcnNfdG91Y2gudjIuSWRlbnRp'
    'dHlVcGRhdGVSZXF1ZXN0LkF0dHJpYnV0ZXNFbnRyeVIKYXR0cmlidXRlcxo9Cg9BdHRyaWJ1dG'
    'VzRW50cnkSEAoDa2V5GAEgASgJUgNrZXkSFAoFdmFsdWUYAiABKAlSBXZhbHVlOgI4AQ==');

@$core.Deprecated('Use identityResolveRequestDescriptor instead')
const IdentityResolveRequest$json = {
  '1': 'IdentityResolveRequest',
  '2': [
    {
      '1': 'ids',
      '3': 1,
      '4': 3,
      '5': 11,
      '6': '.peers_touch.v2.IdentityID',
      '10': 'ids'
    },
  ],
};

/// Descriptor for `IdentityResolveRequest`. Decode as a `google.protobuf.DescriptorProto`.
final $typed_data.Uint8List identityResolveRequestDescriptor =
    $convert.base64Decode(
        'ChZJZGVudGl0eVJlc29sdmVSZXF1ZXN0EiwKA2lkcxgBIAMoCzIaLnBlZXJzX3RvdWNoLnYyLk'
        'lkZW50aXR5SURSA2lkcw==');

@$core.Deprecated('Use identityResolveResponseDescriptor instead')
const IdentityResolveResponse$json = {
  '1': 'IdentityResolveResponse',
  '2': [
    {
      '1': 'identities',
      '3': 1,
      '4': 3,
      '5': 11,
      '6': '.peers_touch.v2.IdentityResolveResponse.IdentitiesEntry',
      '10': 'identities'
    },
  ],
  '3': [IdentityResolveResponse_IdentitiesEntry$json],
};

@$core.Deprecated('Use identityResolveResponseDescriptor instead')
const IdentityResolveResponse_IdentitiesEntry$json = {
  '1': 'IdentitiesEntry',
  '2': [
    {'1': 'key', '3': 1, '4': 1, '5': 9, '10': 'key'},
    {
      '1': 'value',
      '3': 2,
      '4': 1,
      '5': 11,
      '6': '.peers_touch.v2.IdentityMeta',
      '10': 'value'
    },
  ],
  '7': {'7': true},
};

/// Descriptor for `IdentityResolveResponse`. Decode as a `google.protobuf.DescriptorProto`.
final $typed_data.Uint8List identityResolveResponseDescriptor = $convert.base64Decode(
    'ChdJZGVudGl0eVJlc29sdmVSZXNwb25zZRJXCgppZGVudGl0aWVzGAEgAygLMjcucGVlcnNfdG'
    '91Y2gudjIuSWRlbnRpdHlSZXNvbHZlUmVzcG9uc2UuSWRlbnRpdGllc0VudHJ5UgppZGVudGl0'
    'aWVzGlsKD0lkZW50aXRpZXNFbnRyeRIQCgNrZXkYASABKAlSA2tleRIyCgV2YWx1ZRgCIAEoCz'
    'IcLnBlZXJzX3RvdWNoLnYyLklkZW50aXR5TWV0YVIFdmFsdWU6AjgB');

@$core.Deprecated('Use signRequestDescriptor instead')
const SignRequest$json = {
  '1': 'SignRequest',
  '2': [
    {'1': 'payload', '3': 1, '4': 1, '5': 12, '10': 'payload'},
  ],
};

/// Descriptor for `SignRequest`. Decode as a `google.protobuf.DescriptorProto`.
final $typed_data.Uint8List signRequestDescriptor = $convert
    .base64Decode('CgtTaWduUmVxdWVzdBIYCgdwYXlsb2FkGAEgASgMUgdwYXlsb2Fk');

@$core.Deprecated('Use signResponseDescriptor instead')
const SignResponse$json = {
  '1': 'SignResponse',
  '2': [
    {
      '1': 'signature',
      '3': 1,
      '4': 1,
      '5': 11,
      '6': '.peers_touch.v2.Signature',
      '10': 'signature'
    },
  ],
};

/// Descriptor for `SignResponse`. Decode as a `google.protobuf.DescriptorProto`.
final $typed_data.Uint8List signResponseDescriptor = $convert.base64Decode(
    'CgxTaWduUmVzcG9uc2USNwoJc2lnbmF0dXJlGAEgASgLMhkucGVlcnNfdG91Y2gudjIuU2lnbm'
    'F0dXJlUglzaWduYXR1cmU=');

@$core.Deprecated('Use verifyRequestDescriptor instead')
const VerifyRequest$json = {
  '1': 'VerifyRequest',
  '2': [
    {'1': 'payload', '3': 1, '4': 1, '5': 12, '10': 'payload'},
    {
      '1': 'signature',
      '3': 2,
      '4': 1,
      '5': 11,
      '6': '.peers_touch.v2.Signature',
      '10': 'signature'
    },
    {
      '1': 'identity_id',
      '3': 3,
      '4': 1,
      '5': 11,
      '6': '.peers_touch.v2.IdentityID',
      '10': 'identityId'
    },
  ],
};

/// Descriptor for `VerifyRequest`. Decode as a `google.protobuf.DescriptorProto`.
final $typed_data.Uint8List verifyRequestDescriptor = $convert.base64Decode(
    'Cg1WZXJpZnlSZXF1ZXN0EhgKB3BheWxvYWQYASABKAxSB3BheWxvYWQSNwoJc2lnbmF0dXJlGA'
    'IgASgLMhkucGVlcnNfdG91Y2gudjIuU2lnbmF0dXJlUglzaWduYXR1cmUSOwoLaWRlbnRpdHlf'
    'aWQYAyABKAsyGi5wZWVyc190b3VjaC52Mi5JZGVudGl0eUlEUgppZGVudGl0eUlk');

@$core.Deprecated('Use verifyResponseDescriptor instead')
const VerifyResponse$json = {
  '1': 'VerifyResponse',
  '2': [
    {'1': 'valid', '3': 1, '4': 1, '5': 8, '10': 'valid'},
    {'1': 'error_message', '3': 2, '4': 1, '5': 9, '10': 'errorMessage'},
  ],
};

/// Descriptor for `VerifyResponse`. Decode as a `google.protobuf.DescriptorProto`.
final $typed_data.Uint8List verifyResponseDescriptor = $convert.base64Decode(
    'Cg5WZXJpZnlSZXNwb25zZRIUCgV2YWxpZBgBIAEoCFIFdmFsaWQSIwoNZXJyb3JfbWVzc2FnZR'
    'gCIAEoCVIMZXJyb3JNZXNzYWdl');

@$core.Deprecated('Use credentialIssueRequestDescriptor instead')
const CredentialIssueRequest$json = {
  '1': 'CredentialIssueRequest',
  '2': [
    {
      '1': 'subject',
      '3': 1,
      '4': 1,
      '5': 11,
      '6': '.peers_touch.v2.IdentityID',
      '10': 'subject'
    },
    {
      '1': 'claims',
      '3': 2,
      '4': 3,
      '5': 11,
      '6': '.peers_touch.v2.CredentialIssueRequest.ClaimsEntry',
      '10': 'claims'
    },
    {'1': 'ttl_seconds', '3': 3, '4': 1, '5': 3, '10': 'ttlSeconds'},
  ],
  '3': [CredentialIssueRequest_ClaimsEntry$json],
};

@$core.Deprecated('Use credentialIssueRequestDescriptor instead')
const CredentialIssueRequest_ClaimsEntry$json = {
  '1': 'ClaimsEntry',
  '2': [
    {'1': 'key', '3': 1, '4': 1, '5': 9, '10': 'key'},
    {'1': 'value', '3': 2, '4': 1, '5': 9, '10': 'value'},
  ],
  '7': {'7': true},
};

/// Descriptor for `CredentialIssueRequest`. Decode as a `google.protobuf.DescriptorProto`.
final $typed_data.Uint8List credentialIssueRequestDescriptor = $convert.base64Decode(
    'ChZDcmVkZW50aWFsSXNzdWVSZXF1ZXN0EjQKB3N1YmplY3QYASABKAsyGi5wZWVyc190b3VjaC'
    '52Mi5JZGVudGl0eUlEUgdzdWJqZWN0EkoKBmNsYWltcxgCIAMoCzIyLnBlZXJzX3RvdWNoLnYy'
    'LkNyZWRlbnRpYWxJc3N1ZVJlcXVlc3QuQ2xhaW1zRW50cnlSBmNsYWltcxIfCgt0dGxfc2Vjb2'
    '5kcxgDIAEoA1IKdHRsU2Vjb25kcxo5CgtDbGFpbXNFbnRyeRIQCgNrZXkYASABKAlSA2tleRIU'
    'CgV2YWx1ZRgCIAEoCVIFdmFsdWU6AjgB');

@$core.Deprecated('Use credentialVerifyRequestDescriptor instead')
const CredentialVerifyRequest$json = {
  '1': 'CredentialVerifyRequest',
  '2': [
    {
      '1': 'credential',
      '3': 1,
      '4': 1,
      '5': 11,
      '6': '.peers_touch.v2.Credential',
      '10': 'credential'
    },
  ],
};

/// Descriptor for `CredentialVerifyRequest`. Decode as a `google.protobuf.DescriptorProto`.
final $typed_data.Uint8List credentialVerifyRequestDescriptor =
    $convert.base64Decode(
        'ChdDcmVkZW50aWFsVmVyaWZ5UmVxdWVzdBI6CgpjcmVkZW50aWFsGAEgASgLMhoucGVlcnNfdG'
        '91Y2gudjIuQ3JlZGVudGlhbFIKY3JlZGVudGlhbA==');

@$core.Deprecated('Use credentialVerifyResponseDescriptor instead')
const CredentialVerifyResponse$json = {
  '1': 'CredentialVerifyResponse',
  '2': [
    {'1': 'valid', '3': 1, '4': 1, '5': 8, '10': 'valid'},
    {'1': 'error_message', '3': 2, '4': 1, '5': 9, '10': 'errorMessage'},
  ],
};

/// Descriptor for `CredentialVerifyResponse`. Decode as a `google.protobuf.DescriptorProto`.
final $typed_data.Uint8List credentialVerifyResponseDescriptor =
    $convert.base64Decode(
        'ChhDcmVkZW50aWFsVmVyaWZ5UmVzcG9uc2USFAoFdmFsaWQYASABKAhSBXZhbGlkEiMKDWVycm'
        '9yX21lc3NhZ2UYAiABKAlSDGVycm9yTWVzc2FnZQ==');

@$core.Deprecated('Use credentialListRequestDescriptor instead')
const CredentialListRequest$json = {
  '1': 'CredentialListRequest',
  '2': [
    {
      '1': 'subject',
      '3': 1,
      '4': 1,
      '5': 11,
      '6': '.peers_touch.v2.IdentityID',
      '10': 'subject'
    },
  ],
};

/// Descriptor for `CredentialListRequest`. Decode as a `google.protobuf.DescriptorProto`.
final $typed_data.Uint8List credentialListRequestDescriptor = $convert.base64Decode(
    'ChVDcmVkZW50aWFsTGlzdFJlcXVlc3QSNAoHc3ViamVjdBgBIAEoCzIaLnBlZXJzX3RvdWNoLn'
    'YyLklkZW50aXR5SURSB3N1YmplY3Q=');

@$core.Deprecated('Use credentialListResponseDescriptor instead')
const CredentialListResponse$json = {
  '1': 'CredentialListResponse',
  '2': [
    {
      '1': 'credentials',
      '3': 1,
      '4': 3,
      '5': 11,
      '6': '.peers_touch.v2.Credential',
      '10': 'credentials'
    },
  ],
};

/// Descriptor for `CredentialListResponse`. Decode as a `google.protobuf.DescriptorProto`.
final $typed_data.Uint8List credentialListResponseDescriptor =
    $convert.base64Decode(
        'ChZDcmVkZW50aWFsTGlzdFJlc3BvbnNlEjwKC2NyZWRlbnRpYWxzGAEgAygLMhoucGVlcnNfdG'
        '91Y2gudjIuQ3JlZGVudGlhbFILY3JlZGVudGlhbHM=');
