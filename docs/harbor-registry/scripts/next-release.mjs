import fs from "node:fs";
import { pathToFileURL } from "node:url";
export function nextRelease(slug, tags) {
  if (!/^[a-z0-9][a-z0-9-]{0,63}$/.test(slug)) throw new Error("Invalid slug");
  const pattern = new RegExp(`^${slug}-v([0-9]+)$`);
  return Math.max(0, ...tags.map(tag => Number(pattern.exec(tag)?.[1] || 0))) + 1;
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  console.log(nextRelease(process.argv[2], JSON.parse(fs.readFileSync(0, "utf8")).map(r => r.tagName)));
}
