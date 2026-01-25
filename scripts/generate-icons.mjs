/**
 * シンプルなPNGアイコンを生成するスクリプト
 * 依存関係なしで動作する最小限の実装
 */

import { writeFileSync } from 'fs';
import { deflateSync as nodeDeflateSync } from 'zlib';

// CRC32テーブル（遅延初期化）
let crc32Table = null;

// アイコンサイズ
const sizes = [16, 48, 128];

// カラー（Slack風の緑）
const primaryColor = '#007a5a';
const accentColor = '#ffffff';

sizes.forEach(size => {
  const png = createSimplePng(size, primaryColor, accentColor);
  writeFileSync(`icons/icon${size}.png`, png);
  console.log(`Created icon${size}.png`);
});

/**
 * シンプルなPNGを生成（外部依存なし）
 */
function createSimplePng(size, bgColor, fgColor) {
  // PNG signature
  const signature = Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]);
  
  // Parse colors
  const bg = parseColor(bgColor);
  const fg = parseColor(fgColor);
  
  // Create raw image data (RGBA)
  const rawData = [];
  const centerX = size / 2;
  const centerY = size / 2;
  const radius = size * 0.35;
  const letterWidth = size * 0.15;
  
  for (let y = 0; y < size; y++) {
    rawData.push(0); // Filter byte
    for (let x = 0; x < size; x++) {
      const dx = x - centerX;
      const dy = y - centerY;
      const dist = Math.sqrt(dx * dx + dy * dy);
      
      // 背景色
      let r = bg.r, g = bg.g, b = bg.b, a = 255;
      
      // "S" の形を描画（簡略化）
      const inLetter = isInLetterS(x, y, centerX, centerY, size);
      if (inLetter) {
        r = fg.r;
        g = fg.g;
        b = fg.b;
      }
      
      rawData.push(r, g, b, a);
    }
  }
  
  // Compress with deflate (simplified - using zlib would be better)
  const imageData = Buffer.from(rawData);
  const compressed = deflateSync(imageData);
  
  // IHDR chunk
  const ihdr = createIHDRChunk(size, size);
  
  // IDAT chunk
  const idat = createChunk('IDAT', compressed);
  
  // IEND chunk
  const iend = createChunk('IEND', Buffer.alloc(0));
  
  return Buffer.concat([signature, ihdr, idat, iend]);
}

function parseColor(hex) {
  const match = hex.match(/^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i);
  return {
    r: parseInt(match[1], 16),
    g: parseInt(match[2], 16),
    b: parseInt(match[3], 16)
  };
}

function isInLetterS(x, y, cx, cy, size) {
  // 簡略化された "S" または "✓" のような形状
  const relX = (x - cx) / size;
  const relY = (y - cy) / size;
  
  // チェックマーク風の形状
  const thickness = 0.08;
  
  // 左下から中央へ
  if (relX >= -0.2 && relX <= 0.05 && relY >= 0 && relY <= 0.2) {
    const expectedX = -0.2 + (relY / 0.2) * 0.25;
    if (Math.abs(relX - expectedX) < thickness) return true;
  }
  
  // 中央から右上へ
  if (relX >= -0.05 && relX <= 0.25 && relY >= -0.25 && relY <= 0.05) {
    const expectedX = 0.25 - ((relY + 0.25) / 0.3) * 0.3;
    if (Math.abs(relX - expectedX) < thickness) return true;
  }
  
  return false;
}

function createIHDRChunk(width, height) {
  const data = Buffer.alloc(13);
  data.writeUInt32BE(width, 0);
  data.writeUInt32BE(height, 4);
  data.writeUInt8(8, 8);  // bit depth
  data.writeUInt8(6, 9);  // color type (RGBA)
  data.writeUInt8(0, 10); // compression
  data.writeUInt8(0, 11); // filter
  data.writeUInt8(0, 12); // interlace
  return createChunk('IHDR', data);
}

function createChunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);
  
  const typeBuffer = Buffer.from(type, 'ascii');
  const crcData = Buffer.concat([typeBuffer, data]);
  const crc = crc32(crcData);
  
  const crcBuffer = Buffer.alloc(4);
  crcBuffer.writeUInt32BE(crc, 0);
  
  return Buffer.concat([length, typeBuffer, data, crcBuffer]);
}

function crc32(buffer) {
  let crc = 0xFFFFFFFF;
  const table = getCRC32Table();
  
  for (let i = 0; i < buffer.length; i++) {
    crc = (crc >>> 8) ^ table[(crc ^ buffer[i]) & 0xFF];
  }
  
  return (crc ^ 0xFFFFFFFF) >>> 0;
}

function getCRC32Table() {
  if (crc32Table) return crc32Table;
  
  crc32Table = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let j = 0; j < 8; j++) {
      c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
    }
    crc32Table[i] = c;
  }
  return crc32Table;
}

function deflateSync(data) {
  return nodeDeflateSync(data, { level: 9 });
}
