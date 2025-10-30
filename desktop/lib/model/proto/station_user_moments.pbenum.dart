//
//  Generated code. Do not modify.
//  source: station_user_moments.proto
//
// @dart = 3.3

// ignore_for_file: annotate_overrides, camel_case_types, comment_references
// ignore_for_file: constant_identifier_names, library_prefixes
// ignore_for_file: non_constant_identifier_names, prefer_final_fields
// ignore_for_file: unnecessary_import, unnecessary_this, unused_import

import 'dart:core' as $core;

import 'package:protobuf/protobuf.dart' as $pb;

/// Enums
class MomentType extends $pb.ProtobufEnum {
  static const MomentType MOMENT_TYPE_UNSPECIFIED = MomentType._(0, _omitEnumNames ? '' : 'MOMENT_TYPE_UNSPECIFIED');
  static const MomentType MOMENT_TYPE_TEXT = MomentType._(1, _omitEnumNames ? '' : 'MOMENT_TYPE_TEXT');
  static const MomentType MOMENT_TYPE_PHOTO = MomentType._(2, _omitEnumNames ? '' : 'MOMENT_TYPE_PHOTO');
  static const MomentType MOMENT_TYPE_VIDEO = MomentType._(3, _omitEnumNames ? '' : 'MOMENT_TYPE_VIDEO');
  static const MomentType MOMENT_TYPE_LIFE_UPDATE = MomentType._(4, _omitEnumNames ? '' : 'MOMENT_TYPE_LIFE_UPDATE');
  static const MomentType MOMENT_TYPE_MEMORY = MomentType._(5, _omitEnumNames ? '' : 'MOMENT_TYPE_MEMORY');
  static const MomentType MOMENT_TYPE_ACHIEVEMENT = MomentType._(6, _omitEnumNames ? '' : 'MOMENT_TYPE_ACHIEVEMENT');

  static const $core.List<MomentType> values = <MomentType> [
    MOMENT_TYPE_UNSPECIFIED,
    MOMENT_TYPE_TEXT,
    MOMENT_TYPE_PHOTO,
    MOMENT_TYPE_VIDEO,
    MOMENT_TYPE_LIFE_UPDATE,
    MOMENT_TYPE_MEMORY,
    MOMENT_TYPE_ACHIEVEMENT,
  ];

  static final $core.Map<$core.int, MomentType> _byValue = $pb.ProtobufEnum.initByValue(values);
  static MomentType? valueOf($core.int value) => _byValue[value];

  const MomentType._(super.v, super.n);
}

class MediaType extends $pb.ProtobufEnum {
  static const MediaType MEDIA_TYPE_UNSPECIFIED = MediaType._(0, _omitEnumNames ? '' : 'MEDIA_TYPE_UNSPECIFIED');
  static const MediaType MEDIA_TYPE_IMAGE = MediaType._(1, _omitEnumNames ? '' : 'MEDIA_TYPE_IMAGE');
  static const MediaType MEDIA_TYPE_VIDEO = MediaType._(2, _omitEnumNames ? '' : 'MEDIA_TYPE_VIDEO');
  static const MediaType MEDIA_TYPE_AUDIO = MediaType._(3, _omitEnumNames ? '' : 'MEDIA_TYPE_AUDIO');
  static const MediaType MEDIA_TYPE_DOCUMENT = MediaType._(4, _omitEnumNames ? '' : 'MEDIA_TYPE_DOCUMENT');

  static const $core.List<MediaType> values = <MediaType> [
    MEDIA_TYPE_UNSPECIFIED,
    MEDIA_TYPE_IMAGE,
    MEDIA_TYPE_VIDEO,
    MEDIA_TYPE_AUDIO,
    MEDIA_TYPE_DOCUMENT,
  ];

  static final $core.Map<$core.int, MediaType> _byValue = $pb.ProtobufEnum.initByValue(values);
  static MediaType? valueOf($core.int value) => _byValue[value];

  const MediaType._(super.v, super.n);
}

class Privacy extends $pb.ProtobufEnum {
  static const Privacy PRIVACY_UNSPECIFIED = Privacy._(0, _omitEnumNames ? '' : 'PRIVACY_UNSPECIFIED');
  static const Privacy PRIVACY_FAMILY_ONLY = Privacy._(1, _omitEnumNames ? '' : 'PRIVACY_FAMILY_ONLY');
  static const Privacy PRIVACY_CLOSE_FAMILY = Privacy._(2, _omitEnumNames ? '' : 'PRIVACY_CLOSE_FAMILY');
  static const Privacy PRIVACY_PUBLIC = Privacy._(3, _omitEnumNames ? '' : 'PRIVACY_PUBLIC');

  static const $core.List<Privacy> values = <Privacy> [
    PRIVACY_UNSPECIFIED,
    PRIVACY_FAMILY_ONLY,
    PRIVACY_CLOSE_FAMILY,
    PRIVACY_PUBLIC,
  ];

  static final $core.Map<$core.int, Privacy> _byValue = $pb.ProtobufEnum.initByValue(values);
  static Privacy? valueOf($core.int value) => _byValue[value];

  const Privacy._(super.v, super.n);
}

class LikeTargetType extends $pb.ProtobufEnum {
  static const LikeTargetType LIKE_TARGET_TYPE_UNSPECIFIED = LikeTargetType._(0, _omitEnumNames ? '' : 'LIKE_TARGET_TYPE_UNSPECIFIED');
  static const LikeTargetType LIKE_TARGET_TYPE_MOMENT = LikeTargetType._(1, _omitEnumNames ? '' : 'LIKE_TARGET_TYPE_MOMENT');
  static const LikeTargetType LIKE_TARGET_TYPE_COMMENT = LikeTargetType._(2, _omitEnumNames ? '' : 'LIKE_TARGET_TYPE_COMMENT');

  static const $core.List<LikeTargetType> values = <LikeTargetType> [
    LIKE_TARGET_TYPE_UNSPECIFIED,
    LIKE_TARGET_TYPE_MOMENT,
    LIKE_TARGET_TYPE_COMMENT,
  ];

  static final $core.Map<$core.int, LikeTargetType> _byValue = $pb.ProtobufEnum.initByValue(values);
  static LikeTargetType? valueOf($core.int value) => _byValue[value];

  const LikeTargetType._(super.v, super.n);
}

class ReactionType extends $pb.ProtobufEnum {
  static const ReactionType REACTION_TYPE_UNSPECIFIED = ReactionType._(0, _omitEnumNames ? '' : 'REACTION_TYPE_UNSPECIFIED');
  static const ReactionType REACTION_TYPE_LIKE = ReactionType._(1, _omitEnumNames ? '' : 'REACTION_TYPE_LIKE');
  static const ReactionType REACTION_TYPE_LOVE = ReactionType._(2, _omitEnumNames ? '' : 'REACTION_TYPE_LOVE');
  static const ReactionType REACTION_TYPE_LAUGH = ReactionType._(3, _omitEnumNames ? '' : 'REACTION_TYPE_LAUGH');
  static const ReactionType REACTION_TYPE_WOW = ReactionType._(4, _omitEnumNames ? '' : 'REACTION_TYPE_WOW');
  static const ReactionType REACTION_TYPE_SAD = ReactionType._(5, _omitEnumNames ? '' : 'REACTION_TYPE_SAD');
  static const ReactionType REACTION_TYPE_ANGRY = ReactionType._(6, _omitEnumNames ? '' : 'REACTION_TYPE_ANGRY');

  static const $core.List<ReactionType> values = <ReactionType> [
    REACTION_TYPE_UNSPECIFIED,
    REACTION_TYPE_LIKE,
    REACTION_TYPE_LOVE,
    REACTION_TYPE_LAUGH,
    REACTION_TYPE_WOW,
    REACTION_TYPE_SAD,
    REACTION_TYPE_ANGRY,
  ];

  static final $core.Map<$core.int, ReactionType> _byValue = $pb.ProtobufEnum.initByValue(values);
  static ReactionType? valueOf($core.int value) => _byValue[value];

  const ReactionType._(super.v, super.n);
}

class FamilyRole extends $pb.ProtobufEnum {
  static const FamilyRole FAMILY_ROLE_UNSPECIFIED = FamilyRole._(0, _omitEnumNames ? '' : 'FAMILY_ROLE_UNSPECIFIED');
  static const FamilyRole FAMILY_ROLE_PARENT = FamilyRole._(1, _omitEnumNames ? '' : 'FAMILY_ROLE_PARENT');
  static const FamilyRole FAMILY_ROLE_CHILD = FamilyRole._(2, _omitEnumNames ? '' : 'FAMILY_ROLE_CHILD');
  static const FamilyRole FAMILY_ROLE_GRANDPARENT = FamilyRole._(3, _omitEnumNames ? '' : 'FAMILY_ROLE_GRANDPARENT');
  static const FamilyRole FAMILY_ROLE_SIBLING = FamilyRole._(4, _omitEnumNames ? '' : 'FAMILY_ROLE_SIBLING');
  static const FamilyRole FAMILY_ROLE_SPOUSE = FamilyRole._(5, _omitEnumNames ? '' : 'FAMILY_ROLE_SPOUSE');
  static const FamilyRole FAMILY_ROLE_EXTENDED = FamilyRole._(6, _omitEnumNames ? '' : 'FAMILY_ROLE_EXTENDED');

  static const $core.List<FamilyRole> values = <FamilyRole> [
    FAMILY_ROLE_UNSPECIFIED,
    FAMILY_ROLE_PARENT,
    FAMILY_ROLE_CHILD,
    FAMILY_ROLE_GRANDPARENT,
    FAMILY_ROLE_SIBLING,
    FAMILY_ROLE_SPOUSE,
    FAMILY_ROLE_EXTENDED,
  ];

  static final $core.Map<$core.int, FamilyRole> _byValue = $pb.ProtobufEnum.initByValue(values);
  static FamilyRole? valueOf($core.int value) => _byValue[value];

  const FamilyRole._(super.v, super.n);
}


const _omitEnumNames = $core.bool.fromEnvironment('protobuf.omit_enum_names');
