/**
 * Les WebM produits par MediaRecorder n'indiquent pas leur durée, ce qui
 * empêche la navigation dans certains lecteurs. On insère l'élément EBML
 * « Duration » dans l'en-tête « Info » (traitement local, sur les premiers Ko).
 */

const ID = { EBML: 0x1a45dfa3, SEGMENT: 0x18538067, INFO: 0x1549a966, SCALE: 0x2ad7b1, DURATION: 0x4489 };

function readId(bytes, pos) {
  const first = bytes[pos];
  let length = 1;
  while (length <= 4 && !(first & (0x80 >> (length - 1)))) length += 1;
  if (length > 4) return null;
  let value = 0;
  for (let i = 0; i < length; i += 1) value = value * 256 + bytes[pos + i];
  return { value, length };
}

function readSize(bytes, pos) {
  const first = bytes[pos];
  let length = 1;
  while (length <= 8 && !(first & (0x80 >> (length - 1)))) length += 1;
  if (length > 8) return null;
  let value = first & (0xff >> length);
  let unknown = value === (0xff >> length);
  for (let i = 1; i < length; i += 1) {
    value = value * 256 + bytes[pos + i];
    if (bytes[pos + i] !== 0xff) unknown = false;
  }
  return { value, length, unknown };
}

function encodeSize(value, length) {
  if (value >= 2 ** (7 * length) - 1) return null;
  const out = new Uint8Array(length);
  let v = value;
  for (let i = length - 1; i >= 0; i -= 1) {
    out[i] = v % 256;
    v = Math.floor(v / 256);
  }
  out[0] |= 0x80 >> (length - 1);
  return out;
}

export async function fixWebmDuration(blob, durationSeconds) {
  try {
    const headLength = Math.min(blob.size, 256 * 1024);
    const bytes = new Uint8Array(await blob.slice(0, headLength).arrayBuffer());
    let pos = 0;

    const ebml = readId(bytes, pos);
    if (!ebml || ebml.value !== ID.EBML) return blob;
    pos += ebml.length;
    const ebmlSize = readSize(bytes, pos);
    pos += ebmlSize.length + ebmlSize.value;

    const segment = readId(bytes, pos);
    if (!segment || segment.value !== ID.SEGMENT) return blob;
    const segmentSizePos = pos + segment.length;
    const segmentSize = readSize(bytes, segmentSizePos);
    pos = segmentSizePos + segmentSize.length;

    while (pos < bytes.length - 12) {
      const id = readId(bytes, pos);
      const size = id && readSize(bytes, pos + id.length);
      if (!id || !size || size.unknown) return blob;
      const dataStart = pos + id.length + size.length;
      if (id.value !== ID.INFO) {
        pos = dataStart + size.value;
        continue;
      }

      let scale = 1e6;
      let child = dataStart;
      while (child < dataStart + size.value) {
        const cid = readId(bytes, child);
        const csize = readSize(bytes, child + cid.length);
        const cdata = child + cid.length + csize.length;
        if (cid.value === ID.DURATION) return blob; // durée déjà présente
        if (cid.value === ID.SCALE) {
          scale = 0;
          for (let i = 0; i < csize.value; i += 1) scale = scale * 256 + bytes[cdata + i];
        }
        child = cdata + csize.value;
      }

      const durationElement = new Uint8Array(11);
      durationElement.set([0x44, 0x89, 0x88]);
      new DataView(durationElement.buffer).setFloat64(3, (durationSeconds * 1e9) / scale);

      const newInfoSize = encodeSize(size.value + 11, size.length) ?? encodeSize(size.value + 11, 8);
      const infoEnd = dataStart + size.value;
      const parts = [
        bytes.slice(0, pos + id.length),
        newInfoSize,
        bytes.slice(dataStart, infoEnd),
        durationElement,
        bytes.slice(infoEnd),
      ];
      if (!segmentSize.unknown) {
        const grow = 11 + newInfoSize.length - size.length;
        const newSegmentSize = encodeSize(segmentSize.value + grow, 8);
        parts[0] = new Uint8Array([
          ...bytes.slice(0, segmentSizePos),
          ...newSegmentSize,
          ...bytes.slice(segmentSizePos + segmentSize.length, pos + id.length),
        ]);
      }
      return new Blob([...parts, blob.slice(headLength)], { type: blob.type });
    }
  } catch {
    /* en cas de structure inattendue, le fichier d'origine reste valide */
  }
  return blob;
}
