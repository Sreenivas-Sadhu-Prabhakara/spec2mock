// Dump generated WireMock mappings to <outDir>/mappings/*.json (for live testing).
//   node scripts/dump-mappings.js <specPath> <outDir>
import { readFileSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import yaml from 'js-yaml'
import { generate } from '../src/generate.js'
import { convertToV3 } from '../src/convert.js'

const [, , specPath, outDir] = process.argv
if (!specPath || !outDir) {
  console.error('usage: node scripts/dump-mappings.js <specPath> <outDir>')
  process.exit(1)
}

const text = readFileSync(specPath, 'utf8')
let spec = specPath.match(/\.json$/) ? JSON.parse(text) : yaml.load(text)
if (String(spec.swagger) === '2.0') {
  const { openapi } = convertToV3(spec)
  spec = openapi
  console.log('(converted Swagger 2.0 -> OpenAPI 3.0)')
}
const { mappings, stats } = generate(spec, { includeErrors: true, cors: true })

const mapDir = join(outDir, 'mappings')
rmSync(mapDir, { recursive: true, force: true })
mkdirSync(mapDir, { recursive: true })
for (const m of mappings) {
  const { _name, ...clean } = m
  writeFileSync(join(mapDir, `${_name}.json`), JSON.stringify(clean, null, 2))
}
console.log(`Wrote ${mappings.length} mappings (${stats.operations} operations) to ${mapDir}`)
