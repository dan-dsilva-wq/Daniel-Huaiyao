const fs = require("fs");
const { parser } = require("stream-json");
const { streamArray } = require("stream-json/streamers/StreamArray");

const IN = ".hive-cache/az-replay-buffer.backup.json";
const OUT = ".hive-cache/az-replay-buffer.json";
const N = parseInt(process.argv[2] || "30000", 10);

const ring = new Array(N);
let count = 0;

fs.createReadStream(IN)
  .pipe(parser())
  .pipe(streamArray())
  .on("data", ({ value }) => {
    ring[count % N] = value;
    count++;
  })
  .on("end", () => {
    const k = Math.min(count, N);
    const start = count >= N ? (count % N) : 0;
    const out = [];
    for (let i = 0; i < k; i++) out.push(ring[(start + i) % N]);
    fs.writeFileSync(OUT, JSON.stringify(out));
    console.log(`Wrote ${out.length} samples to ${OUT} (from ${count} total).`);
  })
  .on("error", (e) => {
    console.error(e && e.stack ? e.stack : e);
    process.exit(1);
  });
