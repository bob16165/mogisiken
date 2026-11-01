import { readdir, readFile, mkdir, unlink, writeFile, copyFile } from 'node:fs/promises'
import { basename, join } from 'node:path'

const root = process.cwd()
const buildHtmlPath = join(root, 'dist/scripts/past-question-student-build.html')
const assetSourceDirectory = join(root, 'dist/assets')
const staticAssetDirectory = join(root, 'app/past-question-assets')
const buildHtml = await readFile(buildHtmlPath, 'utf8')
const entryFile = buildHtml.match(/<script[^>]+src="\/assets\/([^"]+\.js)"/)?.[1]
const stylesheetFile = buildHtml.match(/<link[^>]+href="\/assets\/([^"]+\.css)"/)?.[1]
const copyNormalizedAsset = async (sourcePath, targetPath) => {
  const contents = await readFile(sourcePath, 'utf8')
  await writeFile(targetPath, contents.replace(/[ \t]+$/gm, ''))
}

if (!entryFile || !stylesheetFile) {
  throw new Error('Vite output did not contain the student page entry and stylesheet.')
}

await mkdir(staticAssetDirectory, { recursive: true })
for (const file of await readdir(staticAssetDirectory)) {
  if (file.endsWith('.js') || file.endsWith('.css')) {
    await unlink(join(staticAssetDirectory, file))
  }
}

const copiedChunks = new Set()
const pendingChunks = [entryFile]
while (pendingChunks.length > 0) {
  const file = pendingChunks.pop()
  if (!file || copiedChunks.has(file)) continue
  copiedChunks.add(file)
  const sourcePath = join(assetSourceDirectory, file)
  const code = await readFile(sourcePath, 'utf8')
  for (const match of code.matchAll(/(?:from|import)\s*["']([^"']+\.js)["']/g)) {
    const dependency = match[1]
    if (dependency.startsWith('./')) pendingChunks.push(basename(dependency))
  }
  const targetName = file === entryFile ? 'past-questions.js' : file
  await copyNormalizedAsset(sourcePath, join(staticAssetDirectory, targetName))
}

await copyNormalizedAsset(
  join(assetSourceDirectory, stylesheetFile),
  join(staticAssetDirectory, 'past-questions.css'),
)
await writeFile(
  join(root, 'app/past-questions.html'),
  `<!doctype html>
<html lang="ja">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <meta name="robots" content="noindex, nofollow" />
    <title>柔整国家試験 過去問</title>
    <link rel="stylesheet" href="./past-question-assets/past-questions.css" />
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="./past-question-assets/past-questions.js"></script>
  </body>
</html>
`,
)

const previewAssetDirectory = join(root, 'dist/app/past-question-assets')
await mkdir(previewAssetDirectory, { recursive: true })
for (const file of await readdir(previewAssetDirectory)) {
  if (file.endsWith('.js') || file.endsWith('.css')) {
    await unlink(join(previewAssetDirectory, file))
  }
}
for (const file of await readdir(staticAssetDirectory)) {
  await copyFile(join(staticAssetDirectory, file), join(previewAssetDirectory, file))
}
await copyFile(join(root, 'app/past-questions.html'), join(root, 'dist/app/past-questions.html'))

console.log(`Synced ${copiedChunks.size} JavaScript chunks and the stylesheet to ${staticAssetDirectory}`)
