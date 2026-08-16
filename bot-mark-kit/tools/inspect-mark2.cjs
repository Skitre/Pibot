const fs = require("fs");
const path = require("path");
const dir = "C:/Users/Admin/Desktop/grokbot/_extract/app/resources/asar_extracted/dist/renderer/assets";
const src = fs.readFileSync(path.join(dir, "index-DVUCYGay.js"), "utf8");

// 1. find the mark component's own animation: search around "sand-grok-bot-mark" for rAF loops / state machines
const mi = src.indexOf('ie("sand-grok-bot-mark"');
console.log("mark at", mi);
// scan forward 6000 chars for interesting driver code
const win = src.slice(mi, mi + 9000);
for (const kw of ["requestAnimationFrame", "state", "thinking", "working", "speaking", "idle", "listening", "mirror", "eyes", "blink", "wink"]) {
	let from = 0, count = 0;
	const idxs = [];
	while (true) {
		const k = win.indexOf(kw, from);
		if (k < 0) break;
		idxs.push(k); from = k + 1; if (++count > 4) break;
	}
	console.log(kw, "->", idxs.slice(0, 5).join(","));
}

// 2. data-grok-state values (JSX prop or attribute set)
const attr = [...src.matchAll(/"data-grok-state"\s*,\s*"([a-z-]+)"/g)].map((m) => m[1]);
console.log("data-grok-state literals:", [...new Set(attr)].join(", "));

// try template form
const t2 = [...src.matchAll(/grok-state[^"]*"([a-z-]+)"/g)].map((m) => m[1]);
console.log("grok-state any:", [...new Set(t2)].slice(0, 20).join(", "));

// 3. find words like 'glance','wiggle','bounce','enter','exit' near mark component within first 20k
const big = src.slice(mi, mi + 20000);
for (const kw of ["glance", "wiggle", "bounce", "enter", "exit", "pop", "nudge", "bounce", "tilt", "shimmer", "pulse", "breathe"]) {
	if (big.includes(kw)) console.log("near-mark kw:", kw, big.indexOf(kw));
}
