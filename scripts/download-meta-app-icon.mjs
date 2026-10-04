import fs from "node:fs";

const vars = {};
for (const line of fs.readFileSync(".dev.vars", "utf8").split(/\r?\n/)) {
  const index = line.indexOf("=");
  if (index <= 0 || line.trimStart().startsWith("#")) continue;
  vars[line.slice(0, index).trim()] = line.slice(index + 1).trim().replace(/^"|"$/g, "");
}

const metadataResponse = await fetch("https://graph.facebook.com/v26.0/1076700328863815?fields=picture.type(large)", {
  headers: { authorization: `Bearer ${vars.META_PAGE_ACCESS_TOKEN}` },
});
const metadata = await metadataResponse.json();
if (!metadataResponse.ok || metadata.error || !metadata.picture?.data?.url) {
  throw new Error(metadata.error?.message || "Page picture is unavailable");
}
const imageResponse = await fetch(metadata.picture.data.url);
if (!imageResponse.ok) throw new Error(`Image download failed: ${imageResponse.status}`);
const bytes = Buffer.from(await imageResponse.arrayBuffer());
fs.writeFileSync("public/nurainur-app-icon.jpg", bytes);
console.log(JSON.stringify({ saved: true, bytes: bytes.length, contentType: imageResponse.headers.get("content-type") }));
