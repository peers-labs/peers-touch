#[path = "../src/image_preview.rs"]
mod image_preview;

use image::{DynamicImage, ImageFormat};
use std::io::{self, BufRead, Cursor, Read, Seek, SeekFrom};
use std::sync::{Arc, atomic::{AtomicBool, Ordering}};

struct CancelledReader {
    bytes: Cursor<Vec<u8>>,
    cancelled: Arc<AtomicBool>,
}
impl Read for CancelledReader {
    fn read(&mut self, output: &mut [u8]) -> io::Result<usize> {
        if self.cancelled.swap(true, Ordering::SeqCst) {
            return Err(io::Error::new(io::ErrorKind::PermissionDenied, "revoked"));
        }
        self.bytes.read(output)
    }
}
impl Seek for CancelledReader {
    fn seek(&mut self, offset: SeekFrom) -> io::Result<u64> { self.bytes.seek(offset) }
}
impl BufRead for CancelledReader {
    fn fill_buf(&mut self) -> io::Result<&[u8]> { self.bytes.fill_buf() }
    fn consume(&mut self, amount: usize) { self.bytes.consume(amount) }
}

#[test]
fn oversized_encoded_source_is_rejected_before_codec_reads() {
    let source = Cursor::new(vec![0xff, 0xd8, 0xff, 0xd9]);
    assert_eq!(
        image_preview::render(source, 512 * 1024 * 1024).unwrap_err(),
        "FILE_PREVIEW_RESOURCE_UNAVAILABLE"
    );
}

#[test]
fn cancellation_during_jpeg_input_read_returns_instead_of_retrying() {
    let cancelled = Arc::new(AtomicBool::new(false));
    let reader = CancelledReader {
        bytes: Cursor::new(vec![0xff, 0xd8, 0xff, 0xd9]),
        cancelled: cancelled.clone(),
    };
    assert!(image_preview::render(reader, 4).is_err());
    assert!(cancelled.load(Ordering::SeqCst));
}

#[test]
fn high_bit_depth_output_is_rejected_before_full_decode() {
    // Encode a tiny RGBA16 PNG, then change only its IHDR dimensions and CRC.
    // Decoder admission reads headers; it must reject without decoding IDAT.
    let mut output = Cursor::new(Vec::new());
    DynamicImage::new_rgba16(1, 1).write_to(&mut output, ImageFormat::Png).unwrap();
    let mut bytes = output.into_inner();
    bytes[16..20].copy_from_slice(&8192u32.to_be_bytes());
    bytes[20..24].copy_from_slice(&4096u32.to_be_bytes());
    let mut crc = !0u32;
    for byte in &bytes[12..29] {
        crc ^= u32::from(*byte);
        for _ in 0..8 { crc = (crc >> 1) ^ (0xedb88320 & 0u32.wrapping_sub(crc & 1)); }
    }
    bytes[29..33].copy_from_slice(&(!crc).to_be_bytes());
    let size = bytes.len() as u64;
    assert_eq!(
        image_preview::render(Cursor::new(bytes), size).unwrap_err(),
        "FILE_PREVIEW_RESOURCE_UNAVAILABLE"
    );
}

#[test]
fn ordinary_png_is_reduced_and_preserves_colored_content() {
    let original = DynamicImage::ImageRgb8(image::RgbImage::from_pixel(2400, 1200, image::Rgb([32, 164, 151])));
    let mut input = Cursor::new(Vec::new());
    original.write_to(&mut input, ImageFormat::Png).unwrap();
    let bytes = input.into_inner();
    let size = bytes.len() as u64;
    let reduced = image_preview::render(Cursor::new(bytes), size).unwrap();
    let image = image::load_from_memory(&reduced).unwrap().to_rgb8();
    assert_eq!(image.dimensions(), (1600, 800));
    assert_eq!(image.get_pixel(800, 400).0, [32, 164, 151]);
}

fn jpeg_with_orientation(orientation: u16) -> Vec<u8> {
    let source = image::RgbImage::from_fn(40, 20, |x, _| {
        if x < 20 { image::Rgb([240, 0, 0]) } else { image::Rgb([0, 0, 240]) }
    });
    let mut encoded = Vec::new();
    image::codecs::jpeg::JpegEncoder::new_with_quality(&mut encoded, 100)
        .encode_image(&DynamicImage::ImageRgb8(source)).unwrap();
    let mut exif = b"Exif\0\0II\x2a\0\x08\0\0\0\x01\0\x12\x01\x03\0\x01\0\0\0".to_vec();
    exif.extend_from_slice(&orientation.to_le_bytes());
    exif.extend_from_slice(&[0; 6]);
    let mut output = vec![0xff, 0xd8, 0xff, 0xe1];
    output.extend_from_slice(&((exif.len() + 2) as u16).to_be_bytes());
    output.extend(exif);
    output.extend_from_slice(&encoded[2..]);
    output
}

#[test]
fn jpeg_exif_rotation_and_mirroring_survive_derived_png() {
    for orientation in [6, 2] {
        let bytes = jpeg_with_orientation(orientation);
        let size = bytes.len() as u64;
        let png = image_preview::render(Cursor::new(bytes), size).unwrap();
        let image = image::load_from_memory(&png).unwrap().to_rgb8();
        let (red, blue) = if orientation == 6 {
            assert_eq!(image.dimensions(), (20, 40));
            (image.get_pixel(10, 5), image.get_pixel(10, 35))
        } else {
            assert_eq!(image.dimensions(), (40, 20));
            (image.get_pixel(35, 10), image.get_pixel(5, 10))
        };
        assert!(red[0] > 200 && red[2] < 30);
        assert!(blue[2] > 200 && blue[0] < 30);
    }
}

#[test]
fn progressive_jpeg_working_planes_are_admitted_before_decode() {
    let mut bytes = jpeg_with_orientation(1);
    let position = bytes.windows(2).position(|value| value == [0xff, 0xc0]).unwrap();
    bytes[position + 1] = 0xc2;
    bytes[position + 5..position + 7].copy_from_slice(&4000u16.to_be_bytes());
    bytes[position + 7..position + 9].copy_from_slice(&4000u16.to_be_bytes());
    let size = bytes.len() as u64;
    assert_eq!(image_preview::render(Cursor::new(bytes), size).unwrap_err(),
               "FILE_PREVIEW_RESOURCE_UNAVAILABLE");
}

#[test]
fn animated_webp_canvas_is_admitted_before_frame_decode() {
    let mut encoded = Cursor::new(Vec::new());
    DynamicImage::new_rgba8(1, 1).write_to(&mut encoded, ImageFormat::WebP).unwrap();
    let mut chunks = Vec::new();
    fn chunk(output: &mut Vec<u8>, name: &[u8], data: &[u8]) {
        output.extend_from_slice(name);
        output.extend_from_slice(&(data.len() as u32).to_le_bytes());
        output.extend_from_slice(data);
        if data.len() % 2 != 0 { output.push(0); }
    }
    let mut extended = vec![0x12, 0, 0, 0];
    for _ in 0..2 { extended.extend_from_slice(&3399u32.to_le_bytes()[..3]); }
    chunk(&mut chunks, b"VP8X", &extended);
    chunk(&mut chunks, b"ANIM", &[0; 6]);
    let mut frame = vec![0; 16];
    frame[12] = 10;
    frame.extend_from_slice(&encoded.into_inner()[12..]);
    chunk(&mut chunks, b"ANMF", &frame);
    let mut bytes = b"RIFF".to_vec();
    bytes.extend_from_slice(&((chunks.len() + 4) as u32).to_le_bytes());
    bytes.extend_from_slice(b"WEBP");
    bytes.extend(chunks);
    let size = bytes.len() as u64;
    assert_eq!(image_preview::render(Cursor::new(bytes), size).unwrap_err(),
               "FILE_PREVIEW_RESOURCE_UNAVAILABLE");
}
