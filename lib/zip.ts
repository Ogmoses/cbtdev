import { deflateRawSync } from "zlib";

/**
 * A tiny ZIP writer (no dependencies): enough to bundle spreadsheets and images for a school export.
 * Names are stored as UTF-8 so file names with accents survive. Plain ZIP (not ZIP64): up to 65,535 files
 * and 4 GB, far beyond what an export can reach (the storage bucket stops at 50 MB).
 */
const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

export function crc32(buf: Uint8Array): number {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function dosDateTime(d: Date) {
  const time = (d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1);
  const date = ((Math.max(d.getFullYear(), 1980) - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate();
  return { time, date };
}

export class ZipBuilder {
  private parts: Buffer[] = [];
  private central: Buffer[] = [];
  private offset = 0;
  private count = 0;

  /** Add one file. `store: true` skips compression (for images, which are already compressed). */
  add(name: string, data: Buffer, opts: { store?: boolean } = {}) {
    if (this.count >= 65535) throw new Error("Too many files for one ZIP.");
    const nameBuf = Buffer.from(name, "utf8");
    const crc = crc32(data);
    let method = 0;
    let body = data;
    if (!opts.store && data.length >= 64) {
      const compressed = deflateRawSync(data, { level: 6 });
      if (compressed.length < data.length) {
        method = 8;
        body = compressed;
      }
    }
    const { time, date } = dosDateTime(new Date());

    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4); // version needed
    local.writeUInt16LE(0x0800, 6); // flags: UTF-8 names
    local.writeUInt16LE(method, 8);
    local.writeUInt16LE(time, 10);
    local.writeUInt16LE(date, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(body.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(nameBuf.length, 26);
    local.writeUInt16LE(0, 28); // extra length
    this.parts.push(local, nameBuf, body);

    const cen = Buffer.alloc(46);
    cen.writeUInt32LE(0x02014b50, 0);
    cen.writeUInt16LE(20, 4); // version made by
    cen.writeUInt16LE(20, 6); // version needed
    cen.writeUInt16LE(0x0800, 8);
    cen.writeUInt16LE(method, 10);
    cen.writeUInt16LE(time, 12);
    cen.writeUInt16LE(date, 14);
    cen.writeUInt32LE(crc, 16);
    cen.writeUInt32LE(body.length, 20);
    cen.writeUInt32LE(data.length, 24);
    cen.writeUInt16LE(nameBuf.length, 28);
    cen.writeUInt32LE(this.offset, 42);
    this.central.push(cen, nameBuf);

    this.offset += 30 + nameBuf.length + body.length;
    this.count += 1;
  }

  finish(): Buffer {
    const centralBuf = Buffer.concat(this.central);
    const end = Buffer.alloc(22);
    end.writeUInt32LE(0x06054b50, 0);
    end.writeUInt16LE(this.count, 8);
    end.writeUInt16LE(this.count, 10);
    end.writeUInt32LE(centralBuf.length, 12);
    end.writeUInt32LE(this.offset, 16);
    return Buffer.concat([...this.parts, centralBuf, end]);
  }
}
