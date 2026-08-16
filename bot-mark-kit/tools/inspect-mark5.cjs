const fs = require("fs");
const path = require("path");
const dir = "C:/Users/Admin/Desktop/grokbot/_extract/app/resources/asar_extracted/dist/renderer/assets";
const src = fs.readFileSync(path.join(dir, "index-DVUCYGay.js"), "utf8");

// 1. full state list XFt
const xi = src.indexOf("XFt=[{label:");
if (xi >= 0) {
	console.log("=== state machine groups ===");
	console.log(src.slice(xi, xi + 900));
}

// 2. pose component vzt props + pose apply
const vi = src.indexOf("pose:m={turn:0,tilt:0,roll:0,scale:1}");
console.log("\n=== pose component props ===");
console.log(src.slice(vi - 260, vi + 700));

// 3. face config per shape (al = shapes with face offsets)
const ai = src.indexOf("al.wedge.face.leftDX=-6");
console.log("\n=== per-shape face config ===");
console.log(src.slice(ai - 1500, ai + 200));
