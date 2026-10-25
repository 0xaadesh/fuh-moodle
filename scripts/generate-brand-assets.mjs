import { readFile, writeFile } from "node:fs/promises"
import { fileURLToPath } from "node:url"
import sharp from "sharp"

// Keep every browser and installed-app icon in sync with the vector logo.
const publicDirectory = new URL("../public/", import.meta.url)
const source = await readFile(new URL("favicon.svg", publicDirectory))
const variants = [
  ["favicon-96x96.png", 96],
  ["apple-touch-icon.png", 180],
  ["web-app-manifest-192x192.png", 192],
  ["web-app-manifest-512x512.png", 512],
]

for (const [filename, size] of variants) {
  await sharp(source)
    .resize(size, size)
    .png()
    .toFile(fileURLToPath(new URL(filename, publicDirectory)))
}

// ICO supports PNG frames; include small sizes for legacy browser tabs.
const sizes = [16, 32, 48]
const frames = await Promise.all(
  sizes.map((size) => sharp(source).resize(size, size).png().toBuffer())
)
const header = Buffer.alloc(6 + frames.length * 16)
header.writeUInt16LE(1, 2)
header.writeUInt16LE(frames.length, 4)
let offset = header.length

frames.forEach((frame, index) => {
  const entry = 6 + index * 16
  header[entry] = sizes[index]
  header[entry + 1] = sizes[index]
  header.writeUInt16LE(1, entry + 4)
  header.writeUInt16LE(32, entry + 6)
  header.writeUInt32LE(frame.length, entry + 8)
  header.writeUInt32LE(offset, entry + 12)
  offset += frame.length
})

await writeFile(
  new URL("favicon.ico", publicDirectory),
  Buffer.concat([header, ...frames])
)
console.log("Generated MoodleBee browser and installed-app icons.")
