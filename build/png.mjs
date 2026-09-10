/** 极简 PNG 生成器：只用来产出占位图标，避免仓库里塞二进制文件。 */
import zlib from 'node:zlib';

function crc32(buf) {
  let c, crc = 0xffffffff;
  for (let n = 0; n < buf.length; n++) {
    c = (crc ^ buf[n]) & 0xff;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    crc = c ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}

/** 生成一张纯色圆角方块图标 */
export function solidIcon(size, hex) {
  const r = parseInt(hex.slice(1, 3), 16), g = parseInt(hex.slice(3, 5), 16), b = parseInt(hex.slice(5, 7), 16);
  const radius = Math.round(size * 0.22);
  const raw = Buffer.alloc(size * (size * 4 + 1));
  let o = 0;
  for (let y = 0; y < size; y++) {
    raw[o++] = 0;                                   // filter: none
    for (let x = 0; x < size; x++) {
      // 圆角判定
      let inside = true;
      const cx = x < radius ? radius : (x >= size - radius ? size - radius - 1 : x);
      const cy = y < radius ? radius : (y >= size - radius ? size - radius - 1 : y);
      if ((x < radius || x >= size - radius) && (y < radius || y >= size - radius)) {
        inside = (x - cx) ** 2 + (y - cy) ** 2 <= radius ** 2;
      }
      raw[o++] = r; raw[o++] = g; raw[o++] = b; raw[o++] = inside ? 255 : 0;
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0); ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; ihdr[9] = 6; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

/** 最小可用的 .ico（内嵌一张 32x32 PNG） */
export function icoFromPng(png32) {
  const head = Buffer.alloc(6);
  head.writeUInt16LE(0, 0); head.writeUInt16LE(1, 2); head.writeUInt16LE(1, 4);
  const ent = Buffer.alloc(16);
  ent[0] = 32; ent[1] = 32; ent[2] = 0; ent[3] = 0;
  ent.writeUInt16LE(1, 4); ent.writeUInt16LE(32, 6);
  ent.writeUInt32LE(png32.length, 8); ent.writeUInt32LE(22, 12);
  return Buffer.concat([head, ent, png32]);
}
