const fs = require("fs");
const path = require("path");
const dir = "C:/Users/Admin/Desktop/grokbot/_extract/app/resources/asar_extracted/dist/renderer/assets";
const src = fs.readFileSync(path.join(dir, "index-DVUCYGay.js"), "utf8");

// find all data-grok-state attribute writes anywhere in bundle
for (const m of src.matchAll(/data-grok-state[^,;]{0,80}/g)) {
	console.log(m[0].replace(/\n/g, " "));
}
console.log("---");
// find where the state prop is passed: look for 'state:' near mark fn and its type union
// search backwards for the prop type containing "idle"
let i = -1;
while ((i = src.indexOf('"idle"', i + 1)) >= 0) {
	const ctx = src.slice(Math.max(0, i - 120), i + 220).replace(/\n/g, " ");
	if (/grok|state|mark/i.test(ctx)) console.log("idle ctx:", ctx, "\n");
}
