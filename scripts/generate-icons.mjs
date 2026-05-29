import fs from 'node:fs/promises'
import path from 'node:path'
import process from 'node:process'
import pngToIco from 'png-to-ico'
import sharp from 'sharp'

const rootDir = process.cwd()
const sourceSvg = path.join(rootDir, 'public', 'Cend.svg')
const iconDir = path.join(rootDir, 'build')
const pngPath = path.join(iconDir, 'icon.png')
const icoPath = path.join(iconDir, 'icon.ico')
const icoSizes = [16, 24, 32, 48, 64, 128, 256]

await fs.mkdir(iconDir, { recursive: true })

await sharp(sourceSvg)
  .resize(1024, 1024, {
    fit: 'contain',
    background: { r: 0, g: 0, b: 0, alpha: 0 },
  })
  .png()
  .toFile(pngPath)

const icoImages = await Promise.all(
  icoSizes.map((size) => {
    return sharp(sourceSvg)
      .resize(size, size, {
        fit: 'contain',
        background: { r: 0, g: 0, b: 0, alpha: 0 },
      })
      .png()
      .toBuffer()
  }),
)

await fs.writeFile(icoPath, await pngToIco(icoImages))

console.log(`Generated ${path.relative(rootDir, pngPath)} and ${path.relative(rootDir, icoPath)}`)
