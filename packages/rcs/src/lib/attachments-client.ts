/**
 * Browser-side image handling for the composer: downscale oversized pastes
 * before upload. Re-encoding also normalizes `image/png` screenshots to JPEG,
 * which keeps most prompts well under the gateway's size limit.
 */

import { isAllowedAttachmentMediaType } from './attachments'

/** Longest edge the CLI/API reliably accepts without wasting tokens. */
export const MAX_IMAGE_DIMENSION = 1568
const JPEG_QUALITY = 0.82
/** Files under this size and dimension budget are uploaded as-is. */
const PASSTHROUGH_BYTES = 512 * 1024

export class UnsupportedImageError extends Error {}

/** True for clipboard/file-picker items that look like supported images. */
export function isImageFile(file: { type: string }): boolean {
  return isAllowedAttachmentMediaType(file.type)
}

/**
 * Downscales to `MAX_IMAGE_DIMENSION` and re-encodes as JPEG when the source is
 * larger than the passthrough budget. Animated GIFs and already-small files are
 * returned untouched so nothing degrades needlessly.
 */
export async function prepareImageFile(file: File): Promise<Blob> {
  if (!isImageFile(file)) throw new UnsupportedImageError('Unsupported image type')

  const bitmap = await createImageBitmap(file)
  try {
    const longestEdge = Math.max(bitmap.width, bitmap.height)
    if (longestEdge <= MAX_IMAGE_DIMENSION && file.size <= PASSTHROUGH_BYTES) return file
    if (file.type === 'image/gif') return file

    const scale = Math.min(1, MAX_IMAGE_DIMENSION / longestEdge)
    const canvas = document.createElement('canvas')
    canvas.width = Math.max(1, Math.round(bitmap.width * scale))
    canvas.height = Math.max(1, Math.round(bitmap.height * scale))
    const context = canvas.getContext('2d')
    if (!context) return file
    context.drawImage(bitmap, 0, 0, canvas.width, canvas.height)

    const encoded = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', JPEG_QUALITY))
    return encoded && encoded.size < file.size ? encoded : file
  } finally {
    bitmap.close()
  }
}
