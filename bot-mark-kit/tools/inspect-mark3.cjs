const fs = require("fs");
const path = require("path");
const dir = "C:/Users/Admin/Desktop/grokbot/_extract/app/resources/asar_extracted/dist/renderer/assets";
const src = fs.readFileSync(path.join(dir, "index-DVUCYGay.js"), "utf8");
const mi = src.indexOf('ie("sand-grok-bot-mark"');
const win = src.slice(mi - 14000, mi + 14000); // widen window around mark component

// dump readable identifiers: string literals near the mark
const lits = new Set();
for (const m of win.matchAll(/"([a-zA-Z][a-zA-Z0-9_-]{3,24})"/g)) lits.add(m[1]);
const interesting = [...lits].filter((s) =>
	/(state|anim|idle|think|work|speak|listen|mirror|enter|exit|pop|glance|bounce|tilt|pulse|breath|wiggle|nudge|shimmer|wave|dance|joy|sad|error|run|wake|sleep|alert)/i.test(s),
);
console.log("string literals near mark:\n" + interesting.join("\n"));

// function names defined in window
const fns = [...win.matchAll(/function\s+([A-Za-z0-9_$]+)/g)].map((m) => m[1]);
console.log("\nfunctions near mark (first 60):\n" + fns.slice(0, 60).join(", "));
