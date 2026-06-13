// ============================================================
//  Salt & Pepper Shakers — Bulk Import Script v3
//
//  Imports profiles first, then sets (with images).
//
//  Run from inside the saltandpepper folder:
//    node import_v3.js
//
//  Run profiles-only (no sets, no images):
//    node import_v3.js --profiles-only
//
//  Run sets-only (skip profile import):
//    node import_v3.js --sets-only
//
//  Dry run (parse + report, no writes):
//    node import_v3.js --dry-run
// ============================================================

import admin from "firebase-admin";
import fs from "fs";
import path from "path";
import { createCanvas, loadImage } from "canvas";
import { parse } from "csv-parse/sync";

// ── Config ────────────────────────────────────────────────────────────────
const SERVICE_ACCOUNT_PATH = "./salt-n-peppers-firebase-adminsdk-fbsvc-3ed749ad70.json";
const SET_CSV_PATH         = "../set_data.csv";
const PROFILE_CSV_PATH     = "../profiles.csv";
const IMAGE_FOLDER         = "../Images";
const STORAGE_BUCKET       = "salt-n-peppers.firebasestorage.app";

const OUT_W = 1200;
const OUT_H = 900;

// ── CLI flags ─────────────────────────────────────────────────────────────
const args         = process.argv.slice(2);
const DRY_RUN      = args.includes("--dry-run");
const PROFILES_ONLY = args.includes("--profiles-only");
const SETS_ONLY    = args.includes("--sets-only");

if (DRY_RUN)       console.log("⚠️  DRY RUN — no data will be written\n");
if (PROFILES_ONLY) console.log("ℹ️  Profiles-only mode\n");
if (SETS_ONLY)     console.log("ℹ️  Sets-only mode (skipping profiles)\n");

// ── Init Firebase ─────────────────────────────────────────────────────────
const serviceAccount = JSON.parse(fs.readFileSync(SERVICE_ACCOUNT_PATH, "utf8"));
admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
  storageBucket: STORAGE_BUCKET,
});
const db     = admin.firestore();
const bucket = admin.storage().bucket();

// ── Parse CSVs ────────────────────────────────────────────────────────────
function parseCsv(filePath) {
  const text = fs.readFileSync(filePath, "utf8");
  return parse(text, {
    columns: h => h.map(col => col.replace(/^\uFEFF/, "").trim()),
    skip_empty_lines: true,
    trim: true,
    relax_column_count: true,
  });
}

// ── Image helpers ─────────────────────────────────────────────────────────

// Match a photo number against filenames in the Images folder.
// Handles: plain integers ("1676"), DSC-style ("DSC00160"), ambiguous ("33?")
function findImage(photoNumber) {
  if (!photoNumber) return null;
  const num = String(photoNumber).trim();
  // Strip trailing punctuation like "?" from ambiguous entries
  const cleaned = num.replace(/[^a-zA-Z0-9]/g, "");
  if (!cleaned) return null;
  try {
    const files = fs.readdirSync(IMAGE_FOLDER);
    const match = files.find(f => {
      const base = path.basename(f, path.extname(f));
      return base.includes(cleaned);
    });
    return match ? path.join(IMAGE_FOLDER, match) : null;
  } catch (e) {
    return null;
  }
}

// Centre-fit image into 4:3 canvas (no crop — fits whole image, parchment bg)
async function processImage(imagePath) {
  const img    = await loadImage(imagePath);
  const canvas = createCanvas(OUT_W, OUT_H);
  const ctx    = canvas.getContext("2d");
  ctx.fillStyle = "#e8dcc8";
  ctx.fillRect(0, 0, OUT_W, OUT_H);
  const scale = Math.min(OUT_W / img.width, OUT_H / img.height);
  const drawW = img.width  * scale;
  const drawH = img.height * scale;
  const x = (OUT_W - drawW) / 2;
  const y = (OUT_H - drawH) / 2;
  ctx.drawImage(img, x, y, drawW, drawH);
  return canvas.toBuffer("image/jpeg", { quality: 0.92 });
}

async function uploadImage(buffer, filename) {
  const file = bucket.file(`sets/${filename}`);
  await file.save(buffer, { metadata: { contentType: "image/jpeg" }, public: true });
  await file.makePublic();
  return `https://storage.googleapis.com/${STORAGE_BUCKET}/sets/${filename}`;
}

// ── Text cleanup helpers ─────────────────────────────────────────────────────
const LOWERCASE_WORDS = new Set([
  'a','an','the','and','but','or','nor','for','so','yet',
  'in','on','at','to','of','up','as','by','is'
]);

function toTitleCase(str) {
  if (!str) return '';
  return str
    .split(' ')
    .map((word, i) => {
      if (!word) return word;
      const lower = word.toLowerCase();
      // Always capitalise first word, last word, and any word not in the list
      if (i === 0 || !LOWERCASE_WORDS.has(lower)) {
        return word.charAt(0).toUpperCase() + word.slice(1);
      }
      return lower;
    })
    .join(' ');
}

function cleanDescription(str) {
  if (!str) return '';
  let s = str.charAt(0).toUpperCase() + str.slice(1);
  if (!s.endsWith('.')) s += '.';
  return s;
}

// ── Profile auto-linking ─────────────────────────────────────────────────────

// Given a text string and a sorted list of {name, id} profiles (longest names
// first to avoid partial matches), wrap each whole-word occurrence of a profile
// name in [name](id) syntax.
function autoLinkProfiles(text, profileList) {
  if (!text || profileList.length === 0) return text;
  let result = text;
  for (const { name, id } of profileList) {
    // Escape any regex special chars in the name
    const escaped = name.replace(/[.*+?^${}()|[\]\]/g, '\$&');
    // Match whole-word only (word boundary on both sides)
    const rx = new RegExp(`\\b${escaped}\\b`, 'g');
    result = result.replace(rx, `[${name}](${id})`);
  }
  return result;
}

// ── Category helpers ──────────────────────────────────────────────────────

// Load all existing Firestore categories into a name→id map (case-insensitive)
async function loadCategories() {
  const snap = await db.collection("categories").get();
  const map = {};
  snap.docs.forEach(d => {
    map[d.data().name.toLowerCase().trim()] = d.id;
  });
  return map;
}

// Parse tag string into matched category IDs; warn on unmatched tags
function resolveTags(tagString, categoryMap, setNo) {
  if (!tagString || !tagString.trim()) return [];
  const tags = tagString.split(",").map(t => t.trim()).filter(Boolean);
  const ids = [];
  for (const tag of tags) {
    const id = categoryMap[tag.toLowerCase()] || categoryMap[toTitleCase(tag).toLowerCase()];
    if (id) {
      ids.push(id);
    } else {
      console.warn(`  ⚠️  Set #${setNo}: unmatched tag "${tag}" — skipped`);
    }
  }
  return ids;
}

// ── PHASE 1: Import profiles ──────────────────────────────────────────────
async function importProfiles() {
  console.log("══ Phase 1: Profiles ════════════════════════════════════════\n");

  const rows = parseCsv(PROFILE_CSV_PATH);
  console.log(`Found ${rows.length} rows in profiles.csv\n`);

  // Deduplicate: keep first occurrence that has a description; otherwise first
  const seen = new Map(); // name (lowercase) → row
  const dupes = [];
  for (const row of rows) {
    const name = (row["profile_name"] || "").trim();
    if (!name) continue;
    const key = name.toLowerCase();
    if (seen.has(key)) {
      dupes.push(name);
      // Prefer the one with a description
      if (!seen.get(key)["profile_desc"] && row["profile_desc"]) {
        seen.set(key, row);
      }
    } else {
      seen.set(key, row);
    }
  }

  if (dupes.length > 0) {
    console.log(`Duplicate profile names (keeping first with description):`);
    dupes.forEach(n => console.log(`  - ${n}`));
    console.log();
  }

  const profiles = [...seen.values()];
  let saved = 0, skipped = 0;

  for (const row of profiles) {
    const name = (row["profile_name"] || "").trim();
    const desc = (row["profile_desc"] || "").trim();
    if (!name) { skipped++; continue; }

    process.stdout.write(`  "${name}"… `);
    if (DRY_RUN) { console.log("(dry run)"); saved++; continue; }

    try {
      await db.collection("profiles").add({ name, description: desc });
      console.log("✓");
      saved++;
    } catch (e) {
      console.log(`FAILED: ${e.message}`);
      skipped++;
    }
    await new Promise(r => setTimeout(r, 100));
  }

  console.log(`\nProfiles: ${saved} saved, ${skipped} skipped\n`);
  return saved;
}

// Load all imported profiles from Firestore into a list sorted longest-name-first
// (so "Aunt Margaret Smith" matches before "Margaret Smith" before "Margaret")
async function loadProfilesForLinking() {
  const snap = await db.collection("profiles").get();
  const list = snap.docs.map(d => ({ id: d.id, name: d.data().name || "" }))
    .filter(p => p.name.length > 0)
    .sort((a, b) => b.name.length - a.name.length);
  return list;
}

// ── PHASE 2: Import sets ──────────────────────────────────────────────────
async function importSets() {
  console.log("══ Phase 2: Sets ════════════════════════════════════════════\n");

  const rows = parseCsv(SET_CSV_PATH);
  console.log(`Found ${rows.length} rows in set_data.csv`);

  // Filter out blank rows (no set_number and no set_name)
  const validRows = rows.filter(r =>
    r["set_number"]?.trim() || r["set_name"]?.trim()
  );
  const blankCount = rows.length - validRows.length;
  if (blankCount > 0) console.log(`Skipping ${blankCount} blank/empty rows\n`);

  // Pre-flight: flag problematic photo numbers
  console.log("── Pre-flight: photo number check ───────────────────────────");
  const flagged = [];
  for (const row of validRows) {
    const pn   = (row["photo_number"] || "").trim();
    const sn   = (row["set_number"]   || "").trim();
    const name = (row["set_name"]     || "").trim();
    if (!pn) {
      flagged.push({ sn, name, pn, reason: "missing" });
    } else if (!pn.match(/^\d+$/) && !pn.match(/^DSC\d+$/i)) {
      flagged.push({ sn, name, pn, reason: "non-standard" });
    }
  }

  if (flagged.length === 0) {
    console.log("All photo numbers look standard.\n");
  } else {
    console.log(`${flagged.length} sets have missing or non-standard photo numbers:`);
    flagged.forEach(f =>
      console.log(`  Set #${f.sn}: "${f.name}" — photo_number="${f.pn}" [${f.reason}]`)
    );
    console.log("These will be imported without images.\n");
  }

  const categoryMap = await loadCategories();
  console.log(`Loaded ${Object.keys(categoryMap).length} categories from Firestore`);

  const profileList = SETS_ONLY ? [] : await loadProfilesForLinking();
  if (profileList.length > 0) {
    console.log(`Loaded ${profileList.length} profiles for auto-linking`);
  }
  console.log();
  console.log("── Importing sets ────────────────────────────────────────────\n");

  let succeeded = 0, failed = 0, noImage = 0, noImageSets = [];

  for (let i = 0; i < validRows.length; i++) {
    const row = validRows[i];

    const photoNumber = (row["photo_number"] || "").trim();
    const setNo       = row["set_number"] ? parseInt(row["set_number"]) : null;
    const year        = row["year"]       ? parseInt(row["year"])       : null;
    const occasion    = toTitleCase((row["occasion"]  || "").trim());
    const giftedBy    = toTitleCase((row["gifted by"] || "").trim());
    const city        = toTitleCase((row["city"]      || "").trim());
    const province    = (row["province"]  || "").trim();
    const country     = (row["country"]   || "").trim();
    const name        = toTitleCase((row["set_name"]  || "").trim());
    const description = cleanDescription((row["set_desc"] || "").trim());
    const tagString   = (row["tags"]      || "").trim();

    if (!name) {
      console.log(`Row ${i+1}: skipped — no name`);
      failed++;
      continue;
    }

    process.stdout.write(`[${i+1}/${validRows.length}] #${setNo ?? "?"} "${name}"… `);

    const categories = resolveTags(tagString, categoryMap, setNo);

    // Auto-link profile names in giftedBy and description
    const linkedGiftedBy    = autoLinkProfiles(giftedBy, profileList);
    const linkedDescription = autoLinkProfiles(description, profileList);

    // Handle image
    let imageUrl  = "";
    let imagePath = "";

    const imgFile = findImage(photoNumber);
    if (imgFile) {
      let imageOk = false;
      try {
        const buffer   = await Promise.race([
          processImage(imgFile),
          new Promise((_, rej) => setTimeout(() => rej(new Error("timeout")), 15000))
        ]);
        const filename = `import_${setNo ?? i}_${photoNumber.replace(/[^a-zA-Z0-9]/g,"")}.jpg`;
        if (!DRY_RUN) {
          imageUrl  = await uploadImage(buffer, filename);
          imagePath = `sets/${filename}`;
        }
        process.stdout.write(`image ✓  `);
        imageOk = true;
      } catch (e) {
        process.stdout.write(`image FAILED (${e.message})  `);
      }
      if (!imageOk) {
        noImage++;
        noImageSets.push(`#${setNo} "${name}" [photo="${photoNumber}"]`);
      }
    } else {
      process.stdout.write(`no image  `);
      noImage++;
      noImageSets.push(`#${setNo} "${name}" [photo_number="${photoNumber}"]`);
    }

    if (DRY_RUN) { console.log("(dry run)"); succeeded++; continue; }

    // Write to Firestore
    try {
      await db.collection("sets").add({
        setNo,
        name,
        year,
        occasion,
        giftedBy: linkedGiftedBy,
        city,
        province,
        country,
        description: linkedDescription,
        categories,
        imageUrl,
        imagePath,
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
      });
      console.log("saved ✓");
      succeeded++;
    } catch (e) {
      console.log(`FIRESTORE ERROR: ${e.message}`);
      failed++;
    }

    await new Promise(r => setTimeout(r, 200));
  }

  console.log("\n─────────────────────────────────────────────────────────────");
  console.log(`Sets done!`);
  console.log(`  Imported:      ${succeeded}`);
  console.log(`  Failed:        ${failed}`);
  console.log(`  Missing image: ${noImage}`);
  if (noImageSets.length > 0) {
    console.log(`\nSets imported without images:`);
    noImageSets.forEach(s => console.log(`  - ${s}`));
  }
  console.log("─────────────────────────────────────────────────────────────\n");
}

// ── Main ──────────────────────────────────────────────────────────────────
async function main() {
  try {
    if (!SETS_ONLY)    await importProfiles();
    if (!PROFILES_ONLY) await importSets();
    console.log("All done! ✓");
    process.exit(0);
  } catch (e) {
    console.error("\nFatal error:", e);
    process.exit(1);
  }
}

main();