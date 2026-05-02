// ============================================================
//  Salt & Pepper Shakers — Bulk Import Script
//  Run from inside the saltandpepper folder:
//    node import.js
// ============================================================

import admin from "firebase-admin";
import { createRequire } from "module";
import fs from "fs";
import path from "path";
import { createCanvas, loadImage } from "canvas";
import { parse } from "csv-parse/sync";

const require = createRequire(import.meta.url);

// ── Config ────────────────────────────────────────────────────────────────
const SERVICE_ACCOUNT_PATH = "./salt-n-peppers-firebase-adminsdk-fbsvc-3ed749ad70.json";
const CSV_PATH             = "../sp_chart.csv";
const IMAGE_FOLDER         = "../Images";
const STORAGE_BUCKET       = "salt-n-peppers.firebasestorage.app"; // ← Fill in your Firebase storage bucket name
                                  //   e.g. "salt-pepper-12345.appspot.com"
                                  //   Find it in Firebase Console → Storage

const OUT_W = 1200;
const OUT_H = 900;

// ── Init Firebase ─────────────────────────────────────────────────────────
const serviceAccount = JSON.parse(fs.readFileSync(SERVICE_ACCOUNT_PATH, "utf8"));

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
  storageBucket: STORAGE_BUCKET,
});

const db      = admin.firestore();
const bucket  = admin.storage().bucket();

// ── Read & parse CSV ──────────────────────────────────────────────────────
const csvText = fs.readFileSync(CSV_PATH, "utf8");
const rows = parse(csvText, {
  columns: (header) =>
    header.map(h => h.replace(/^\uFEFF/, "").trim()), // use first row as headers and remove BOM character
  skip_empty_lines: true,
  trim: true,
  relax_column_count: true,
});

console.log(`\nFound ${rows.length} rows in CSV.\n`);

// ── Helpers ───────────────────────────────────────────────────────────────

// Find image file by photo number (case-insensitive, any extension)
function findImage(photoNumber) {
  if (!photoNumber) return null;
  const num = String(photoNumber).trim();
  try {
    const files = fs.readdirSync(IMAGE_FOLDER);
    console.log("Files found:", files.length, "| Looking for:", num, "| First file:", files[0]);
    const match = files.find(f => {
      const base = path.basename(f, path.extname(f));
      return base.includes(num);
    });
    return match ? path.join(IMAGE_FOLDER, match) : null;
  } catch (e) {
    console.log("findImage error:", e.message);
    return null;
  }
}

// Centre-crop image file to 4:3 (1200x900), return buffer
async function cropImage(imagePath) {
  const img = await loadImage(imagePath);
  const canvas = createCanvas(OUT_W, OUT_H);
  const ctx = canvas.getContext("2d");

  // Parchment background for any exposed areas
  ctx.fillStyle = "#e8dcc8";
  ctx.fillRect(0, 0, OUT_W, OUT_H);

  // Fit image inside 4:3, centred
  const scale = Math.min(OUT_W / img.width, OUT_H / img.height);
  const drawW = img.width  * scale;
  const drawH = img.height * scale;
  const x = (OUT_W - drawW) / 2;
  const y = (OUT_H - drawH) / 2;
  ctx.drawImage(img, x, y, drawW, drawH);

  return canvas.toBuffer("image/jpeg", { quality: 0.92 });
}

// Upload buffer to Firebase Storage, return public URL
async function uploadImage(buffer, filename) {
  const file = bucket.file(`sets/${filename}`);
  await file.save(buffer, {
    metadata: { contentType: "image/jpeg" },
    public: true,
  });
  await file.makePublic();
  return `https://storage.googleapis.com/${STORAGE_BUCKET}/sets/${filename}`;
}

// ── Main import loop ──────────────────────────────────────────────────────
async function runImport() {
  let succeeded = 0, failed = 0, noImage = 0;

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];

    const photoNumber = (row["photo_number"] || "").trim();
    const setNo       = row["set_number"] ? parseInt(row["set_number"]) : null;
    const year        = row["year"]       ? parseInt(row["year"])       : null;
    const giftedBy    = (row["from_person"] || "").trim();
    const city        = (row["from_geo"]    || "").trim();  // dumped into city field as-is
    const name        = (row["set_name"]    || "").trim();
    const description = (row["set_desc"]    || "").trim();
    // occasion column intentionally skipped

    if (!name) {
      console.log(`Row ${i+1}: skipped — no name`);
      failed++;
      continue;
    }

    process.stdout.write(`[${i+1}/${rows.length}] #${setNo} "${name}"… `);

    // Handle image
    let imageUrl  = "";
    let imagePath = "";
    const imgFile = findImage(photoNumber);

    if (imgFile) {
      try {
        const buffer   = await cropImage(imgFile);
        const filename = `import_${Date.now()}_${photoNumber}.jpg`;
        imageUrl  = await uploadImage(buffer, filename);
        imagePath = `sets/${filename}`;
        process.stdout.write(`image ✓  `);
      } catch (e) {
        process.stdout.write(`image FAILED (${e.message})  `);
        noImage++;
      }
    } else {
      process.stdout.write(`no image  `);
      noImage++;
    }

    // Write to Firestore
    try {
      await db.collection("sets").add({
        setNo,
        name,
        year,
        giftedBy,
        city,
        country: "",       // left blank — clean up manually per your plan
        description,
        categories: [],
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

    // Brief pause to avoid rate limiting
    await new Promise(r => setTimeout(r, 200));
  }

  console.log("\n─────────────────────────────────────");
  console.log(`Done!`);
  console.log(`  Imported:      ${succeeded}`);
  console.log(`  Failed:        ${failed}`);
  console.log(`  Missing image: ${noImage}`);
  console.log("─────────────────────────────────────\n");
}

runImport().catch(e => {
  console.error("Fatal error:", e);
  process.exit(1);
});
