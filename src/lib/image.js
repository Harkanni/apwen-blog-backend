/**
 * Detect image type from magic bytes and read pixel dimensions without any
 * dependency. Supports JPEG, PNG, GIF, WebP (VP8/VP8L/VP8X) and AVIF (ispe box).
 */
export function inspectImage(buf) {
  if (buf.length < 16) return null;

  // PNG
  if (buf.readUInt32BE(0) === 0x89504e47) {
    return { mime: 'image/png', ext: 'png', width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
  }

  // GIF
  if (buf.toString('ascii', 0, 3) === 'GIF') {
    return { mime: 'image/gif', ext: 'gif', width: buf.readUInt16LE(6), height: buf.readUInt16LE(8) };
  }

  // WebP
  if (buf.toString('ascii', 0, 4) === 'RIFF' && buf.toString('ascii', 8, 12) === 'WEBP') {
    const chunk = buf.toString('ascii', 12, 16);
    let width = null;
    let height = null;
    if (chunk === 'VP8X') {
      width = 1 + buf.readUIntLE(24, 3);
      height = 1 + buf.readUIntLE(27, 3);
    } else if (chunk === 'VP8 ') {
      width = buf.readUInt16LE(26) & 0x3fff;
      height = buf.readUInt16LE(28) & 0x3fff;
    } else if (chunk === 'VP8L') {
      const b = buf.readUInt32LE(21);
      width = 1 + (b & 0x3fff);
      height = 1 + ((b >> 14) & 0x3fff);
    }
    return { mime: 'image/webp', ext: 'webp', width, height };
  }

  // AVIF / HEIF
  if (buf.toString('ascii', 4, 8) === 'ftyp' && /avi[fs]/.test(buf.toString('ascii', 8, 12))) {
    const i = buf.indexOf('ispe');
    const dims = i > 0 && i + 16 <= buf.length ? { width: buf.readUInt32BE(i + 8), height: buf.readUInt32BE(i + 12) } : {};
    return { mime: 'image/avif', ext: 'avif', width: dims.width ?? null, height: dims.height ?? null };
  }

  // JPEG
  if (buf[0] === 0xff && buf[1] === 0xd8) {
    let offset = 2;
    while (offset + 9 < buf.length) {
      if (buf[offset] !== 0xff) { offset++; continue; }
      const marker = buf[offset + 1];
      if (marker === 0xd8 || (marker >= 0xd0 && marker <= 0xd7) || marker === 0x01) { offset += 2; continue; }
      const len = buf.readUInt16BE(offset + 2);
      // SOF markers carry dimensions (excluding DHT, JPG, DAC)
      if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker)) {
        return { mime: 'image/jpeg', ext: 'jpg', height: buf.readUInt16BE(offset + 5), width: buf.readUInt16BE(offset + 7) };
      }
      offset += 2 + len;
    }
    return { mime: 'image/jpeg', ext: 'jpg', width: null, height: null };
  }

  return null;
}
