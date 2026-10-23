// Browser entry of admin-encode-check: bundled by the script (vite lib build) and loaded by a page in Chrome.
// Runs the real admin encoder on a fixture and hands the result back as plain data (files as base64).
import { QUALITY_TABLE, fitWithin, planUploadFiles, variantPlan } from '@mp/shared';
import { createCanvasSurfaceFactory, createEncoder } from '../apps/admin/src/encode/index.ts';

const encoder = createEncoder(createCanvasSurfaceFactory());
const PLAN_ID = '00000000-0000-4000-8000-000000000000';

const toBase64 = (blob) =>
  new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result).split(',')[1]);
    r.onerror = () => reject(r.error);
    r.readAsDataURL(blob);
  });

window.adminEncode = async function adminEncode(name, url, type) {
  const blob = await (await fetch(url)).blob();
  const file = new File([blob], name, { type });
  const t0 = performance.now();
  const phases = [];
  const photo = await encoder.encode(file, new AbortController().signal, (p) => phases.push(p));
  const ms = performance.now() - t0;
  const files = [];
  for (const f of photo.files) files.push({ kind: f.kind, tier: f.tier, type: f.body.type, bytes: f.bytes, base64: await toBase64(f.body) });
  return {
    ms,
    phases,
    caps: Object.fromEntries(Object.entries(QUALITY_TABLE).map(([k, v]) => [k, v.capBytes])),
    width: photo.width,
    height: photo.height,
    dominantColor: photo.dominantColor,
    plan: variantPlan(photo.width, photo.height),
    planFiles: planUploadFiles(PLAN_ID, photo.width, photo.height).map((f) => ({ kind: f.kind, tier: f.tier })),
    fit: fitWithin(photo.width, photo.height),
    files,
    heapMB: performance.memory ? Math.round(performance.memory.usedJSHeapSize / 1048576) : null,
  };
};
window.adminEncodeReady = true;
