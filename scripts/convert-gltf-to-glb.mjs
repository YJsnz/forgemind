// Batch convert step_to_gltf/*.gltf + *.bin -> public/models/industrial/*.glb
// Usage: node scripts/convert-gltf-to-glb.mjs
import pkg from 'gltf-pipeline';
const { gltfToGlb } = pkg;
import { readFile, writeFile, mkdir, copyFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { existsSync } from 'node:fs';

const ROOT = resolve(import.meta.dirname, '..');
const SRC = resolve(ROOT, 'step_to_gltf');
const DST = resolve(ROOT, 'public', 'models', 'industrial');

// mapping: [source gltf relative path (inside step_to_gltf), target glb filename]
const MAPPINGS = [
  // --- replacements (all 7 equipment folders now included) ---
  ['液压双冲压机/Hydraulic Twin Punch Press.gltf', 'hydraulic_press_detail.glb'],
  ['分流机/assemblymtr.gltf',                       'flow_node_detail.glb'],
  ['仓储货架/Regały/MT STEP.gltf',                  'pallet_buffer_detail.glb'],
  ['原料输送机/19F468EFFBD676E443D0A131A498A7E5.gltf', 'roller_conveyor_segment.glb'],
  ['毛刺清洗机/Assemblage final.gltf',              'wash_deburr_detail.glb'],
  ['数控中心/TB-L850-B1 -20190316(1).gltf',         'cnc_machining_center.glb'],
  ['视觉检测站/TCP613.gltf',                         'vision_inspection.glb'],
  // --- new additions ---
  ['原料药罐/API.gltf',                              'api_tank.glb'],
  ['工作站/TRABALHO.gltf',                           'workstation.glb'],
];

async function convertOne(srcRel, dstName) {
  const srcGltf = resolve(SRC, srcRel);
  const srcDir = dirname(srcGltf);
  const dstPath = resolve(DST, dstName);

  if (!existsSync(srcGltf)) {
    console.warn(`[SKIP] source not found: ${srcGltf}`);
    return false;
  }
  await mkdir(DST, { recursive: true });

  const gltfBuffer = await readFile(srcGltf);
  const gltf = JSON.parse(gltfBuffer.toString('utf8'));
  const options = {
    resourceDirectory: srcDir,
  };
  console.log(`[CONVERT] ${srcRel}  ->  ${dstName}`);
  const results = await gltfToGlb(gltf, options);
  // results.glb is a Uint8Array/Buffer
  const glbBuffer = Buffer.from(results.glb);
  await writeFile(dstPath, glbBuffer);
  console.log(`  -> wrote ${dstPath} (${(glbBuffer.length / 1024).toFixed(1)} KB)`);
  return true;
}

async function main() {
  let ok = 0, fail = 0;
  for (const [src, dst] of MAPPINGS) {
    try {
      if (await convertOne(src, dst)) ok++;
      else fail++;
    } catch (e) {
      console.error(`[ERROR] ${src}:`, e.message || e);
      fail++;
    }
  }
  console.log(`\nDone. Success=${ok}, Skipped/Failed=${fail}`);
}

main().catch(e => { console.error(e); process.exit(1); });
