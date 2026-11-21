// Length of an mp3 from its bytes, so speech results report duration_sec
// like videos do. Walks the MPEG audio frames (works for CBR and VBR) after
// skipping an ID3v2 tag; no dependencies, no decoding.

// Bitrates in kbps, by [version is MPEG-1][layer index][bitrate index].
const BITRATES: Record<string, number[]> = {
  '1-1': [0, 32, 64, 96, 128, 160, 192, 224, 256, 288, 320, 352, 384, 416, 448],
  '1-2': [0, 32, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320, 384],
  '1-3': [0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320],
  '2-1': [0, 32, 48, 56, 64, 80, 96, 112, 128, 144, 160, 176, 192, 224, 256],
  '2-2': [0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160],
  '2-3': [0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160],
};
const SAMPLE_RATES: Record<number, number[]> = {
  3: [44100, 48000, 32000], // MPEG-1
  2: [22050, 24000, 16000], // MPEG-2
  0: [11025, 12000, 8000], // MPEG-2.5
};

interface Frame {
  size: number;
  samples: number;
  sampleRate: number;
}

function readFrame(buf: Uint8Array, i: number): Frame | null {
  if (i + 4 > buf.length || buf[i] !== 0xff || (buf[i + 1] & 0xe0) !== 0xe0) return null;
  const versionBits = (buf[i + 1] >> 3) & 3; // 3 = MPEG-1, 2 = MPEG-2, 0 = MPEG-2.5
  const layerBits = (buf[i + 1] >> 1) & 3; // 3 = Layer I, 2 = II, 1 = III
  const bitrateIndex = buf[i + 2] >> 4;
  const rateIndex = (buf[i + 2] >> 2) & 3;
  if (versionBits === 1 || layerBits === 0 || bitrateIndex === 0 || bitrateIndex === 15 || rateIndex === 3) return null;
  const layer = 4 - layerBits;
  const mpeg1 = versionBits === 3;
  const bitrate = BITRATES[`${mpeg1 ? 1 : 2}-${layer}`][bitrateIndex] * 1000;
  const sampleRate = SAMPLE_RATES[versionBits][rateIndex];
  const padding = (buf[i + 2] >> 1) & 1;
  const samples = layer === 1 ? 384 : layer === 3 && !mpeg1 ? 576 : 1152;
  const size =
    layer === 1
      ? (Math.floor((12 * bitrate) / sampleRate) + padding) * 4
      : Math.floor(((samples / 8) * bitrate) / sampleRate) + padding;
  return size > 4 ? { size, samples, sampleRate } : null;
}

/** Seconds of audio in an mp3, rounded to 0.1s; null when it isn't one. */
export function mp3DurationSec(input: Uint8Array): number | null {
  const buf = input;
  let i = 0;
  // ID3v2 tag: "ID3", version, flags, then a 28-bit syncsafe size.
  if (buf.length >= 10 && buf[0] === 0x49 && buf[1] === 0x44 && buf[2] === 0x33) {
    i = 10 + ((buf[6] & 0x7f) << 21) + ((buf[7] & 0x7f) << 14) + ((buf[8] & 0x7f) << 7) + (buf[9] & 0x7f);
    if (buf[5] & 0x10) i += 10; // footer
  }
  // Find the first frame that is followed by another, so stray 0xFF bytes
  // in padding aren't taken for audio.
  let frame: Frame | null = null;
  for (const limit = Math.min(buf.length, i + 64 * 1024); i < limit; i++) {
    const f = readFrame(buf, i);
    if (f && (i + f.size >= buf.length || readFrame(buf, i + f.size))) {
      frame = f;
      break;
    }
  }
  if (!frame) return null;
  let seconds = 0;
  while (frame) {
    seconds += frame.samples / frame.sampleRate;
    i += frame.size;
    frame = readFrame(buf, i);
  }
  return seconds > 0 ? Math.round(seconds * 10) / 10 : null;
}
