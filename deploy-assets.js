import { readFile, writeFile, cp, mkdir, rm } from 'node:fs/promises'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const isMain = process.argv[1] === fileURLToPath(import.meta.url)

function minifyCSS(css) {
  return css
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\s+/g, ' ')
    .replace(/\s*([{}:;,])\s*/g, '$1')
    .replace(/;}/g, '}')
    .trim()
}

async function deployAssets() {
  const deployDir = join(__dirname, 'deploy')
  await rm(deployDir, { recursive: true, force: true })
  await mkdir(deployDir, { recursive: true })

  const cssFiles = ['css-var.css', 'styles.css', 'dark-mode.css']
  await Promise.all(cssFiles.map(async (f) => {
    const css = await readFile(join(__dirname, f), 'utf8')
    await writeFile(join(deployDir, f), minifyCSS(css))
  }))

  const jsFiles = ['archetype-client.js', 'dark-mode-client.js']
  await Promise.all(jsFiles.map(async (f) => {
    await cp(join(__dirname, f), join(deployDir, f))
  }))

  console.log('Assets deployed to deploy/')
}

if (isMain) deployAssets().catch(console.error)
