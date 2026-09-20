use std::collections::{BTreeMap, HashMap, HashSet};

use sha2::{Digest, Sha256};
use thiserror::Error;

const MAX_FIELD_NUMBER: u32 = (1 << 29) - 1;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
#[repr(u8)]
pub enum WireType {
    Varint = 0,
    Fixed64 = 1,
    LengthDelimited = 2,
    Fixed32 = 5,
}

impl TryFrom<u8> for WireType {
    type Error = CanonicalProtobufError;

    fn try_from(value: u8) -> Result<Self, Self::Error> {
        match value {
            0 => Ok(Self::Varint),
            1 => Ok(Self::Fixed64),
            2 => Ok(Self::LengthDelimited),
            5 => Ok(Self::Fixed32),
            _ => Err(CanonicalProtobufError::UnsupportedWireType(value)),
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Cardinality {
    Singular,
    Repeated,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct FieldRule {
    pub number: u32,
    pub wire_type: WireType,
    pub cardinality: Cardinality,
    pub oneof_group: Option<u16>,
    pub reject_default: bool,
    pub nested: Option<&'static [FieldRule]>,
}

impl FieldRule {
    pub const fn singular(number: u32, wire_type: WireType) -> Self {
        Self {
            number,
            wire_type,
            cardinality: Cardinality::Singular,
            oneof_group: None,
            reject_default: true,
            nested: None,
        }
    }

    pub const fn repeated(number: u32, wire_type: WireType) -> Self {
        Self {
            number,
            wire_type,
            cardinality: Cardinality::Repeated,
            oneof_group: None,
            reject_default: false,
            nested: None,
        }
    }

    pub const fn oneof(number: u32, wire_type: WireType, group: u16) -> Self {
        Self {
            number,
            wire_type,
            cardinality: Cardinality::Singular,
            oneof_group: Some(group),
            reject_default: false,
            nested: None,
        }
    }

    pub const fn message(number: u32, nested: &'static [FieldRule]) -> Self {
        Self {
            number,
            wire_type: WireType::LengthDelimited,
            cardinality: Cardinality::Singular,
            oneof_group: None,
            reject_default: false,
            nested: Some(nested),
        }
    }

    pub const fn oneof_message(number: u32, group: u16, nested: &'static [FieldRule]) -> Self {
        Self {
            number,
            wire_type: WireType::LengthDelimited,
            cardinality: Cardinality::Singular,
            oneof_group: Some(group),
            reject_default: false,
            nested: Some(nested),
        }
    }

    pub const fn preserve_empty(mut self) -> Self {
        self.reject_default = false;
        self
    }
}

#[derive(Debug, Error, Clone, PartialEq, Eq)]
pub enum CanonicalProtobufError {
    #[error("canonical protobuf field number is invalid")]
    InvalidFieldNumber,
    #[error("canonical protobuf wire type {0} is unsupported")]
    UnsupportedWireType(u8),
    #[error("canonical protobuf input is truncated")]
    Truncated,
    #[error("canonical protobuf varint is not minimal")]
    NonMinimalVarint,
    #[error("canonical protobuf field {0} is unknown")]
    UnknownField(u32),
    #[error("canonical protobuf field {0} has the wrong wire type")]
    WrongWireType(u32),
    #[error("canonical protobuf singular field {0} is duplicated")]
    DuplicateSingularField(u32),
    #[error("canonical protobuf oneof group {0} has multiple values")]
    DuplicateOneof(u16),
    #[error("canonical protobuf field {0} explicitly encodes its default")]
    ExplicitDefault(u32),
    #[error("canonical protobuf fields are not ordered")]
    NonCanonicalOrder,
}

#[derive(Debug, Clone)]
struct ParsedField {
    number: u32,
    wire_type: WireType,
    value: Vec<u8>,
}

pub fn canonicalize_message(
    input: &[u8],
    rules: &[FieldRule],
) -> Result<Vec<u8>, CanonicalProtobufError> {
    let rules = validate_rules(rules)?;
    let mut cursor = 0;
    let mut parsed = Vec::new();
    let mut singular = HashSet::new();
    let mut oneofs = HashSet::new();

    while cursor < input.len() {
        let (key, key_bytes) = decode_varint(&input[cursor..])?;
        cursor += key_bytes;
        let number =
            u32::try_from(key >> 3).map_err(|_| CanonicalProtobufError::InvalidFieldNumber)?;
        if number == 0 || number > MAX_FIELD_NUMBER {
            return Err(CanonicalProtobufError::InvalidFieldNumber);
        }
        let wire_type = WireType::try_from((key & 0x07) as u8)?;
        let rule = rules
            .get(&number)
            .ok_or(CanonicalProtobufError::UnknownField(number))?;
        if rule.wire_type != wire_type {
            return Err(CanonicalProtobufError::WrongWireType(number));
        }
        if rule.cardinality == Cardinality::Singular && !singular.insert(number) {
            return Err(CanonicalProtobufError::DuplicateSingularField(number));
        }
        if let Some(group) = rule.oneof_group {
            if !oneofs.insert(group) {
                return Err(CanonicalProtobufError::DuplicateOneof(group));
            }
        }

        let (mut value, consumed, is_default) = parse_value(&input[cursor..], wire_type)?;
        cursor += consumed;
        if rule.reject_default && is_default {
            return Err(CanonicalProtobufError::ExplicitDefault(number));
        }
        if let Some(nested) = rule.nested {
            let (length, prefix) = decode_varint(&value)?;
            let length = usize::try_from(length).map_err(|_| CanonicalProtobufError::Truncated)?;
            let nested_value = value
                .get(prefix..prefix + length)
                .ok_or(CanonicalProtobufError::Truncated)?;
            value = encode_length_delimited(&canonicalize_message(nested_value, nested)?);
        }
        parsed.push(ParsedField {
            number,
            wire_type,
            value,
        });
    }

    parsed.sort_by_key(|field| field.number);
    let mut canonical = Vec::with_capacity(input.len());
    for field in parsed {
        encode_key(field.number, field.wire_type, &mut canonical);
        canonical.extend_from_slice(&field.value);
    }
    Ok(canonical)
}

pub fn validate_canonical_message(
    input: &[u8],
    rules: &[FieldRule],
) -> Result<(), CanonicalProtobufError> {
    let canonical = canonicalize_message(input, rules)?;
    if canonical != input {
        return Err(CanonicalProtobufError::NonCanonicalOrder);
    }
    Ok(())
}

pub fn canonical_sha256(
    input: &[u8],
    rules: &[FieldRule],
) -> Result<[u8; 32], CanonicalProtobufError> {
    Ok(Sha256::digest(canonicalize_message(input, rules)?).into())
}

#[derive(Debug, Default)]
pub struct CanonicalMessageEncoder {
    fields: BTreeMap<u32, Vec<EncodedField>>,
    singular: HashSet<u32>,
    oneofs: HashSet<u16>,
}

#[derive(Debug)]
struct EncodedField {
    wire_type: WireType,
    value: Vec<u8>,
}

impl CanonicalMessageEncoder {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn singular_varint(
        &mut self,
        number: u32,
        value: u64,
    ) -> Result<(), CanonicalProtobufError> {
        if value == 0 {
            return Ok(());
        }
        let mut encoded = Vec::new();
        encode_varint(value, &mut encoded);
        self.insert(number, WireType::Varint, encoded, true, None)
    }

    pub fn singular_bytes(
        &mut self,
        number: u32,
        value: &[u8],
    ) -> Result<(), CanonicalProtobufError> {
        if value.is_empty() {
            return Ok(());
        }
        self.insert(
            number,
            WireType::LengthDelimited,
            encode_length_delimited(value),
            true,
            None,
        )
    }

    pub fn singular_message(
        &mut self,
        number: u32,
        value: &[u8],
    ) -> Result<(), CanonicalProtobufError> {
        self.insert(
            number,
            WireType::LengthDelimited,
            encode_length_delimited(value),
            true,
            None,
        )
    }

    pub fn repeated_bytes(
        &mut self,
        number: u32,
        value: &[u8],
    ) -> Result<(), CanonicalProtobufError> {
        self.insert(
            number,
            WireType::LengthDelimited,
            encode_length_delimited(value),
            false,
            None,
        )
    }

    pub fn oneof_message(
        &mut self,
        number: u32,
        group: u16,
        value: &[u8],
    ) -> Result<(), CanonicalProtobufError> {
        self.insert(
            number,
            WireType::LengthDelimited,
            encode_length_delimited(value),
            true,
            Some(group),
        )
    }

    pub fn finish(self) -> Vec<u8> {
        let mut output = Vec::new();
        for (number, values) in self.fields {
            for field in values {
                encode_key(number, field.wire_type, &mut output);
                output.extend_from_slice(&field.value);
            }
        }
        output
    }

    fn insert(
        &mut self,
        number: u32,
        wire_type: WireType,
        value: Vec<u8>,
        singular: bool,
        oneof_group: Option<u16>,
    ) -> Result<(), CanonicalProtobufError> {
        if number == 0 || number > MAX_FIELD_NUMBER {
            return Err(CanonicalProtobufError::InvalidFieldNumber);
        }
        if singular && !self.singular.insert(number) {
            return Err(CanonicalProtobufError::DuplicateSingularField(number));
        }
        if let Some(group) = oneof_group {
            if !self.oneofs.insert(group) {
                return Err(CanonicalProtobufError::DuplicateOneof(group));
            }
        }
        self.fields
            .entry(number)
            .or_default()
            .push(EncodedField { wire_type, value });
        Ok(())
    }
}

fn validate_rules(rules: &[FieldRule]) -> Result<HashMap<u32, FieldRule>, CanonicalProtobufError> {
    let mut indexed = HashMap::with_capacity(rules.len());
    for rule in rules {
        if rule.number == 0
            || rule.number > MAX_FIELD_NUMBER
            || (rule.nested.is_some() && rule.wire_type != WireType::LengthDelimited)
            || indexed.insert(rule.number, *rule).is_some()
        {
            return Err(CanonicalProtobufError::InvalidFieldNumber);
        }
    }
    Ok(indexed)
}

fn parse_value(
    input: &[u8],
    wire_type: WireType,
) -> Result<(Vec<u8>, usize, bool), CanonicalProtobufError> {
    match wire_type {
        WireType::Varint => {
            let (value, size) = decode_varint(input)?;
            Ok((input[..size].to_vec(), size, value == 0))
        }
        WireType::Fixed64 => {
            let bytes = input.get(..8).ok_or(CanonicalProtobufError::Truncated)?;
            Ok((bytes.to_vec(), 8, bytes.iter().all(|byte| *byte == 0)))
        }
        WireType::LengthDelimited => {
            let (length, prefix) = decode_varint(input)?;
            let length = usize::try_from(length).map_err(|_| CanonicalProtobufError::Truncated)?;
            let end = prefix
                .checked_add(length)
                .ok_or(CanonicalProtobufError::Truncated)?;
            let bytes = input.get(..end).ok_or(CanonicalProtobufError::Truncated)?;
            Ok((bytes.to_vec(), end, length == 0))
        }
        WireType::Fixed32 => {
            let bytes = input.get(..4).ok_or(CanonicalProtobufError::Truncated)?;
            Ok((bytes.to_vec(), 4, bytes.iter().all(|byte| *byte == 0)))
        }
    }
}

fn decode_varint(input: &[u8]) -> Result<(u64, usize), CanonicalProtobufError> {
    let mut value = 0_u64;
    for index in 0..10 {
        let byte = *input.get(index).ok_or(CanonicalProtobufError::Truncated)?;
        if index == 9 && byte > 1 {
            return Err(CanonicalProtobufError::NonMinimalVarint);
        }
        value |= u64::from(byte & 0x7f) << (index * 7);
        if byte & 0x80 == 0 {
            if index > 0 && byte == 0 {
                return Err(CanonicalProtobufError::NonMinimalVarint);
            }
            return Ok((value, index + 1));
        }
    }
    Err(CanonicalProtobufError::NonMinimalVarint)
}

fn encode_key(number: u32, wire_type: WireType, output: &mut Vec<u8>) {
    encode_varint((u64::from(number) << 3) | wire_type as u64, output);
}

fn encode_varint(mut value: u64, output: &mut Vec<u8>) {
    while value >= 0x80 {
        output.push((value as u8 & 0x7f) | 0x80);
        value >>= 7;
    }
    output.push(value as u8);
}

fn encode_length_delimited(value: &[u8]) -> Vec<u8> {
    let mut encoded = Vec::with_capacity(value.len() + 10);
    encode_varint(value.len() as u64, &mut encoded);
    encoded.extend_from_slice(value);
    encoded
}

#[cfg(test)]
mod tests {
    use super::*;

    const ENCRYPTED_PAYLOAD_VECTOR: &str = include_str!(concat!(
        env!("CARGO_MANIFEST_DIR"),
        "/../../model/domain/secure_content/testdata/encrypted_payload.hex"
    ));

    fn decode_hex(value: &str) -> Vec<u8> {
        let value = value.trim();
        (0..value.len())
            .step_by(2)
            .map(|index| u8::from_str_radix(&value[index..index + 2], 16).unwrap())
            .collect()
    }

    #[test]
    fn validates_and_rebuilds_the_tracked_payload_vector() {
        let vector = decode_hex(ENCRYPTED_PAYLOAD_VECTOR);
        let payload_rules = [
            FieldRule::singular(1, WireType::Varint),
            FieldRule::singular(2, WireType::LengthDelimited).preserve_empty(),
            FieldRule::singular(3, WireType::Varint),
            FieldRule::singular(4, WireType::LengthDelimited),
            FieldRule::singular(5, WireType::LengthDelimited),
            FieldRule::singular(6, WireType::LengthDelimited),
            FieldRule::singular(7, WireType::LengthDelimited),
        ];
        validate_canonical_message(&vector, &payload_rules).unwrap();

        let mut resource = CanonicalMessageEncoder::new();
        resource.singular_varint(1, 2).unwrap();
        resource.singular_bytes(2, b"01HX").unwrap();
        resource.singular_varint(3, 7).unwrap();

        let mut payload = CanonicalMessageEncoder::new();
        payload.singular_varint(1, 1).unwrap();
        payload.singular_message(2, &resource.finish()).unwrap();
        payload.singular_varint(3, 1).unwrap();
        payload.singular_bytes(4, &[1, 2, 3]).unwrap();
        payload.singular_bytes(5, &[0xaa, 0xbb]).unwrap();
        payload.singular_bytes(6, &[0xcc]).unwrap();
        payload.singular_bytes(7, &[0xdd]).unwrap();
        assert_eq!(payload.finish(), vector);
    }

    #[test]
    fn rejects_unknown_duplicate_nonminimal_and_noncanonical_fields() {
        let rules = [
            FieldRule::singular(1, WireType::Varint),
            FieldRule::oneof(2, WireType::LengthDelimited, 1),
            FieldRule::oneof(3, WireType::LengthDelimited, 1),
        ];
        assert_eq!(
            validate_canonical_message(&[0x20, 0x01], &rules),
            Err(CanonicalProtobufError::UnknownField(4))
        );
        assert_eq!(
            validate_canonical_message(&[0x08, 0x01, 0x08, 0x02], &rules),
            Err(CanonicalProtobufError::DuplicateSingularField(1))
        );
        assert_eq!(
            validate_canonical_message(&[0x08, 0x81, 0x00], &rules),
            Err(CanonicalProtobufError::NonMinimalVarint)
        );
        assert_eq!(
            validate_canonical_message(&[0x12, 0x01, 0x61, 0x08, 0x01], &rules),
            Err(CanonicalProtobufError::NonCanonicalOrder)
        );
        assert_eq!(
            validate_canonical_message(&[0x12, 0x01, 0x61, 0x1a, 0x01, 0x62], &rules),
            Err(CanonicalProtobufError::DuplicateOneof(1))
        );
    }

    #[test]
    fn recursively_canonicalizes_nested_messages() {
        const NESTED: &[FieldRule] = &[
            FieldRule::singular(1, WireType::Varint),
            FieldRule::singular(2, WireType::LengthDelimited),
        ];
        let rules = [FieldRule::message(1, NESTED)];
        let noncanonical_nested = [0x12, 0x01, 0x61, 0x08, 0x01];
        let mut outer = vec![0x0a, noncanonical_nested.len() as u8];
        outer.extend_from_slice(&noncanonical_nested);

        assert_eq!(
            validate_canonical_message(&outer, &rules),
            Err(CanonicalProtobufError::NonCanonicalOrder)
        );
        assert_eq!(
            canonicalize_message(&outer, &rules).unwrap(),
            [0x0a, 0x05, 0x08, 0x01, 0x12, 0x01, 0x61]
        );
    }
}
