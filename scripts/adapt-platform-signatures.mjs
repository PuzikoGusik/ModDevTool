import { readFile, writeFile } from 'node:fs/promises';
import JSZip from 'jszip';

const [source, destination] = process.argv.slice(2);
if (!source || !destination) throw new Error('Usage: node scripts/adapt-platform-signatures.mjs <original-ct.sym> <output-ct.sym>');
const original = await JSZip.loadAsync(await readFile(source));
const adapted = new JSZip();
for (const entry of Object.values(original.files)) {
  const releases = entry.name.split('/')[0];
  if (entry.dir || !/[8BH]/.test(releases) || !entry.name.endsWith('.sig')) continue;
  const bytes = await entry.async('uint8array');
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (view.getUint32(0) !== 0xcafebabe || view.getUint16(6) > 65) throw new Error(`Unsupported signature format: ${entry.name}`);
  view.setUint16(6, 61);
  adapted.file(entry.name, bytes);
}
await writeFile(destination, await adapted.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE', compressionOptions: { level: 9 } }));
