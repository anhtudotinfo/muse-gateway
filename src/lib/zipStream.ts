import fs from 'node:fs';

// Streaming ZIP writer for "download selected" on the media page. Generated
// images and videos are already compressed, so entries are STORED (no
// deflate) and each file is piped straight from disk: memory stays flat no
// matter how many videos are picked. Sizes and CRCs travel in a data
// descriptor after each file (general-purpose flag bit 3), so nothing has to
// be read twice. Plain ZIP (no ZIP64): callers keep the total under 4 GB.

export const MAX_ZIP_BYTES = 3.5 * 1024 ** 3;

export interface ZipEntry {
  /** Name inside the archive (ASCII-safe, no directories). */
  name: string;
  /** File on disk. */
  path: string;
}

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

export function crc32(chunk: Uint8Array, crc = 0): number {
  let c = ~crc >>> 0;
  for (let i = 0; i < chunk.length; i++) c = CRC_TABLE[(c ^ chunk[i]) & 0xff] ^ (c >>> 8);
  return ~c >>> 0;
}

/** MS-DOS time/date fields for an entry. */
function dosDateTime(date: Date) {
  const time = (date.getHours() << 11) | (date.getMinutes() << 5) | Math.floor(date.getSeconds() / 2);
  const day = ((Math.max(1980, date.getFullYear()) - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate();
  return { time, day };
}

/** ReadableStream of a ZIP holding `entries`. Missing files are skipped. */
export function zipStream(entries: ZipEntry[]): ReadableStream<Uint8Array> {
  return new ReadableStream<Uint8Array>({
    async start(controller) {
      const central: Buffer[] = [];
      let offset = 0;
      const push = (buf: Buffer) => {
        controller.enqueue(new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength));
        offset += buf.byteLength;
      };
      try {
        for (const entry of entries) {
          let stat: fs.Stats;
          try {
            stat = fs.statSync(entry.path);
            if (!stat.isFile()) continue;
          } catch {
            continue;
          }
          const name = Buffer.from(entry.name, 'utf8');
          const { time, day } = dosDateTime(stat.mtime);
          const headerOffset = offset;

          const local = Buffer.alloc(30);
          local.writeUInt32LE(0x04034b50, 0); // local file header
          local.writeUInt16LE(20, 4); // version needed
          local.writeUInt16LE(0x0808, 6); // bit 3: data descriptor · bit 11: UTF-8 names
          local.writeUInt16LE(0, 8); // stored
          local.writeUInt16LE(time, 10);
          local.writeUInt16LE(day, 12);
          // crc + sizes are 0 here; they follow in the data descriptor
          local.writeUInt16LE(name.length, 26);
          push(Buffer.concat([local, name]));

          let crc = 0;
          let size = 0;
          for await (const chunk of fs.createReadStream(entry.path)) {
            const buf = chunk as Buffer;
            crc = crc32(buf, crc);
            size += buf.length;
            push(buf);
          }

          const descriptor = Buffer.alloc(16);
          descriptor.writeUInt32LE(0x08074b50, 0);
          descriptor.writeUInt32LE(crc, 4);
          descriptor.writeUInt32LE(size, 8);
          descriptor.writeUInt32LE(size, 12);
          push(descriptor);

          const record = Buffer.alloc(46);
          record.writeUInt32LE(0x02014b50, 0); // central directory header
          record.writeUInt16LE(20, 4); // made by
          record.writeUInt16LE(20, 6); // needed
          record.writeUInt16LE(0x0808, 8);
          record.writeUInt16LE(0, 10);
          record.writeUInt16LE(time, 12);
          record.writeUInt16LE(day, 14);
          record.writeUInt32LE(crc, 16);
          record.writeUInt32LE(size, 20);
          record.writeUInt32LE(size, 24);
          record.writeUInt16LE(name.length, 28);
          record.writeUInt32LE(headerOffset, 42);
          central.push(Buffer.concat([record, name]));
        }

        const dirOffset = offset;
        const dir = Buffer.concat(central);
        push(dir);
        const end = Buffer.alloc(22);
        end.writeUInt32LE(0x06054b50, 0); // end of central directory
        end.writeUInt16LE(central.length, 8);
        end.writeUInt16LE(central.length, 10);
        end.writeUInt32LE(dir.length, 12);
        end.writeUInt32LE(dirOffset, 16);
        push(end);
        controller.close();
      } catch (error) {
        controller.error(error);
      }
    },
  });
}
