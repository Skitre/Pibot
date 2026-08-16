const fs = require("fs");
const src = fs.readFileSync(
	"C:/Users/Admin/Desktop/grokbot/_extract/app/resources/asar_extracted/dist/renderer/assets/index-DVUCYGay.js",
	"utf8",
);

for (const kw of ["requestAnimationFrame", ".animate(", "prefers-reduced-motion", "AnimatePresence", "useSpring"]) {
	console.log(kw, (src.match(new RegExp(kw.replace(/[.()]/g, "\\$&"), "g")) || []).length);
}

// find first .animate( usage after the mark component
const i = src.indexOf("ring${X}");
const j = src.indexOf(".animate(", i);
if (j > 0) {
	console.log("--- animate ctx ---");
	console.log(src.slice(j - 500, j + 500).replace(/\n/g, " "));
}

// find zzt hash->index function (color bucket)
const z = src.indexOf("function zzt");
if (z > 0) {
	console.log("--- zzt ---");
	console.log(src.slice(z, z + 300));
}

// count bot-mark states: search data-grok-state values
const states = [...src.matchAll(/grokState[=:]"([a-z-]+)"/g)].map((m) => m[1]);
console.log("grokStates:", [...new Set(states)].join(", "));
