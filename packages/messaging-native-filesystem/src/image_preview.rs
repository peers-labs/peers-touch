//! Reduced image representation, decoded from an already verified grant.
use image::{ImageDecoder, ImageFormat, ImageReader, Limits};
use std::io::{BufRead, Cursor, Seek};

const MAX_ENCODED_BYTES: u64 = 32 * 1024 * 1024;
const MAX_PREVIEW_ALLOC: u64 = 128 * 1024 * 1024;
const DECODER_RESERVE: u64 = 16 * 1024 * 1024;
const THUMBNAIL_EDGE: u32 = 1600;

pub(crate) fn render(reader: impl BufRead + Seek, encoded_size: u64) -> Result<Vec<u8>, String> {
    // JPEG's constructor buffers its input before ImageReader applies Limits.
    // Admit the verified source length before constructing any decoder.
    if encoded_size > MAX_ENCODED_BYTES {
        return Err("FILE_PREVIEW_RESOURCE_UNAVAILABLE".into());
    }
    let mut source = ImageReader::new(reader)
        .with_guessed_format().map_err(|_| "FILE_PREVIEW_CODEC_UNAVAILABLE")?;
    let mut limits = Limits::default();
    limits.max_image_width = Some(16384);
    limits.max_image_height = Some(16384);
    limits.max_alloc = Some(MAX_PREVIEW_ALLOC);
    limits.reserve(encoded_size * 2 + DECODER_RESERVE)
        .map_err(|_| "FILE_PREVIEW_RESOURCE_UNAVAILABLE")?;
    source.limits(limits.clone());
    let format = source.format();
    let mut decoder = source.into_decoder().map_err(|_| "FILE_PREVIEW_RESOURCE_UNAVAILABLE")?;
    let (width, height) = decoder.dimensions();
    if width == 0 || height == 0 || u64::from(width) * u64::from(height) > 32 * 1024 * 1024 {
        return Err("FILE_PREVIEW_RESOURCE_UNAVAILABLE".into());
    }
    // from_decoder does not reserve its output in ImageReader's Limits.
    // Include actual bit depth, a second decoder buffer, thumbnail and PNG output.
    let thumbnail_bytes = u64::from(width.min(THUMBNAIL_EDGE))
        * u64::from(height.min(THUMBNAIL_EDGE))
        * u64::from(decoder.color_type().bytes_per_pixel());
    limits.reserve(decoder.total_bytes().saturating_mul(2) + thumbnail_bytes * 2)
        .map_err(|_| "FILE_PREVIEW_RESOURCE_UNAVAILABLE")?;
    // JPEG's allocation limit is dimension-only. Progressive decoding keeps
    // padded i16 coefficient planes (up to four) alongside the RGB output.
    if format == Some(ImageFormat::Jpeg) {
        let padded_pixels = u64::from(width.div_ceil(32) * 32)
            * u64::from(height.div_ceil(32) * 32);
        limits.reserve(padded_pixels * 8)
            .map_err(|_| "FILE_PREVIEW_RESOURCE_UNAVAILABLE")?;
    } else if format == Some(ImageFormat::WebP) {
        // Animated WebP keeps a decoded RGBA frame and compositing canvas
        // alongside output; lossless transforms also need a working plane.
        limits.reserve(decoder.total_bytes().saturating_mul(2))
            .map_err(|_| "FILE_PREVIEW_RESOURCE_UNAVAILABLE")?;
    }
    let orientation = decoder.orientation().map_err(|_| "FILE_PREVIEW_UNAVAILABLE")?;
    let image = image::DynamicImage::from_decoder(decoder)
        .map_err(|_| "FILE_PREVIEW_RESOURCE_UNAVAILABLE")?;
    let mut thumbnail = if width <= THUMBNAIL_EDGE && height <= THUMBNAIL_EDGE {
        image
    } else {
        image.thumbnail(THUMBNAIL_EDGE, THUMBNAIL_EDGE)
    };
    thumbnail.apply_orientation(orientation);
    let mut output = Cursor::new(Vec::new());
    thumbnail.write_to(&mut output, ImageFormat::Png)
        .map_err(|_| "FILE_PREVIEW_UNAVAILABLE")?;
    Ok(output.into_inner())
}
