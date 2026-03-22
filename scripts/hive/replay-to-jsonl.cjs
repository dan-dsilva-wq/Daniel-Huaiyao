const fs = require("fs");
const { parser } = require("stream-json");
const { streamArray } = require("stream-json/streamers/StreamArray");

const IN = ".hive-cache/_archive/az-replay-buffer.backup.json";
const OUT = ".hive-cache/_archive/az-replay-buffer.backup.jsonl";
const out = fs.createWriteStream(OUT, { flags: "w" });

fs.createReadStream(IN)
  .pipe(parser())
  .pipe(streamArray())
  .on("data", ({ value }) => out.write(JSON.stringify(value) + "\n"))
  .on("end", () => { out.end(); console.log("Wrote", OUT); })
  .on("error", (e) => { console.error(e && e.stack ? e.stack : e); process.exit(1); });
