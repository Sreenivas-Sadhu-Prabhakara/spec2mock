import yaml from 'js-yaml'
import { saveAs } from 'file-saver'
import { generate, STATUS_HEADER } from './generate.js'
import { buildZip } from './bundle.js'
import { convertToV3 } from './convert.js'

const el = (id) => document.getElementById(id)
const esc = (s) =>
  String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c])

// ---------- tabs ----------
document.querySelectorAll('.tab').forEach((btn) => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.tab').forEach((b) => b.classList.toggle('active', b === btn))
    el('panel-gen').hidden = btn.dataset.tab !== 'gen'
    el('panel-conv').hidden = btn.dataset.tab !== 'conv'
  })
})
function switchTo(tab) {
  document.querySelector(`.tab[data-tab="${tab}"]`).click()
}

// ---------- shared input wiring ----------
function parseText(text) {
  const t = text.trim()
  if (!t) throw new Error('Empty input.')
  const doc = t[0] === '{' ? JSON.parse(t) : yaml.load(t)
  if (!doc || typeof doc !== 'object') throw new Error('Could not parse as JSON or YAML.')
  return doc
}

function wireInput(dropId, fileId, pasteId, onText) {
  const drop = el(dropId)
  const file = el(fileId)
  const paste = el(pasteId)
  file.addEventListener('change', () => {
    const f = file.files[0]
    if (f) f.text().then((t) => onText(t, f.name))
  })
  ;['dragenter', 'dragover'].forEach((ev) =>
    drop.addEventListener(ev, (e) => {
      e.preventDefault()
      drop.classList.add('over')
    }),
  )
  ;['dragleave', 'drop'].forEach((ev) =>
    drop.addEventListener(ev, (e) => {
      e.preventDefault()
      drop.classList.remove('over')
    }),
  )
  drop.addEventListener('drop', (e) => {
    const f = e.dataTransfer.files[0]
    if (f) f.text().then((t) => onText(t, f.name))
  })
  let timer
  paste.addEventListener('input', () => {
    clearTimeout(timer)
    const v = paste.value
    if (!v.trim()) return
    timer = setTimeout(() => onText(v, 'pasted-spec'), 400)
  })
}

function specTitle(spec, fallback) {
  const t = spec.info && spec.info.title
  return (t && t.trim()) || (fallback ? fallback.replace(/\.(ya?ml|json)$/i, '') : 'api')
}

// ========================================================================
// GENERATE tab
// ========================================================================
let genSpec = null
let genName = 'api'
let lastGen = null
const showG = (html) => (el('result-g').innerHTML = html)

wireInput('drop-g', 'file-g', 'paste-g', (text, name) => {
  try {
    let doc = parseText(text)
    const notes = []
    if (String(doc.swagger) === '2.0') {
      const { openapi, warnings } = convertToV3(doc)
      doc = openapi
      notes.push(`Auto-converted from Swagger 2.0.${warnings.length ? ` (${warnings.length} conversion note${warnings.length === 1 ? '' : 's'})` : ''}`)
    } else if (!doc.openapi) {
      throw new Error('Missing "openapi" field. If this is Swagger 2.0 it needs `swagger: "2.0"`.')
    }
    if (!doc.paths || !Object.keys(doc.paths).length) throw new Error('No "paths" found in the spec.')
    genSpec = doc
    genName = specTitle(doc, name)
    lastGen = null
    el('download').disabled = true
    el('generate').disabled = false
    const n = Object.keys(doc.paths).length
    showG(`<p class="ok">Loaded <strong>${esc(genName)}</strong> — ${n} path${n === 1 ? '' : 's'}.${notes.length ? ' ' + esc(notes.join(' ')) : ''} Ready to generate.</p>`)
  } catch (e) {
    genSpec = null
    el('generate').disabled = true
    el('download').disabled = true
    showG(`<p class="err">${esc(e.message)}</p>`)
  }
})

el('generate').addEventListener('click', () => {
  if (!genSpec) return
  try {
    lastGen = generate(genSpec, { includeErrors: el('errors').checked, cors: el('cors').checked })
    renderGen(lastGen)
    el('download').disabled = false
  } catch (e) {
    showG(`<p class="err">Generation failed: ${esc(e.message)}</p>`)
  }
})

el('download').addEventListener('click', async () => {
  if (!lastGen) return
  const btn = el('download')
  btn.disabled = true
  btn.textContent = 'Packaging…'
  try {
    const info = await buildZip({ mappings: lastGen.mappings, specName: genName, stats: lastGen.stats, warnings: lastGen.warnings })
    btn.textContent = `Downloaded (${info.fileCount} stubs)`
  } catch (e) {
    showG(`<p class="err">Packaging failed: ${esc(e.message)}</p>`)
    btn.textContent = 'Download ZIP bundle'
  } finally {
    setTimeout(() => {
      btn.disabled = false
      btn.textContent = 'Download ZIP bundle'
    }, 2500)
  }
})

function renderGen(gen) {
  const { stats, warnings, mappings } = gen
  const preview = mappings
    .filter((m) => m.priority === 5)
    .slice(0, 4)
    .map((m) => `${m.request.method.padEnd(6)} ${m.request.urlPathTemplate}  →  ${m.response.status}`)
    .join('\n')
  const warnHtml = warnings.length
    ? `<details class="warns"><summary>${warnings.length} note${warnings.length === 1 ? '' : 's'}</summary><ul>${warnings.map((w) => `<li>${esc(w)}</li>`).join('')}</ul></details>`
    : ''
  showG(`
    <div class="stats">
      <div><span class="num">${stats.operations}</span><span class="lbl">operations</span></div>
      <div><span class="num">${stats.stubs}</span><span class="lbl">stubs</span></div>
    </div>
    <pre class="routes">${esc(preview)}${mappings.length > 4 ? '\n…' : ''}</pre>
    <p class="hint">Success responses answer by default. Force a documented error with <code>${STATUS_HEADER}: 404</code> (etc).</p>
    ${warnHtml}
  `)
}

// ========================================================================
// CONVERT tab
// ========================================================================
let convSource = null
let convResult = null
let convName = 'api'
const showC = (html) => (el('result-c').innerHTML = html)

wireInput('drop-c', 'file-c', 'paste-c', (text, name) => {
  try {
    const doc = parseText(text)
    convResult = null
    setConvDownloads(false)
    if (doc.openapi) {
      convSource = null
      el('convert').disabled = true
      showC(`<p class="ok">This is already OpenAPI ${esc(String(doc.openapi))} — no conversion needed. Use the <strong>Generate mock</strong> tab.</p>`)
      return
    }
    if (String(doc.swagger) !== '2.0') throw new Error('Not a Swagger 2.0 document (expected `swagger: "2.0"`).')
    convSource = doc
    convName = specTitle(doc, name)
    el('convert').disabled = false
    const n = Object.keys(doc.paths || {}).length
    showC(`<p class="ok">Loaded Swagger 2.0 <strong>${esc(convName)}</strong> — ${n} path${n === 1 ? '' : 's'}. Ready to convert.</p>`)
  } catch (e) {
    convSource = null
    el('convert').disabled = true
    setConvDownloads(false)
    showC(`<p class="err">${esc(e.message)}</p>`)
  }
})

el('convert').addEventListener('click', () => {
  if (!convSource) return
  try {
    convResult = convertToV3(convSource)
    setConvDownloads(true)
    const w = convResult.warnings
    const warnHtml = w.length
      ? `<details class="warns"><summary>${w.length} conversion note${w.length === 1 ? '' : 's'}</summary><ul>${w.map((x) => `<li>${esc(x)}</li>`).join('')}</ul></details>`
      : '<p class="hint">No conversion notes.</p>'
    showC(`<p class="ok">Converted to <strong>OpenAPI ${esc(convResult.openapi.openapi)}</strong>. Download it, or send it straight to the mock generator.</p>${warnHtml}`)
  } catch (e) {
    setConvDownloads(false)
    showC(`<p class="err">Conversion failed: ${esc(e.message)}</p>`)
  }
})

el('dl-yaml').addEventListener('click', () => {
  if (!convResult) return
  saveAs(new Blob([yaml.dump(convResult.openapi)], { type: 'text/yaml;charset=utf-8' }), `${fileBase(convName)}.openapi.yaml`)
})
el('dl-json').addEventListener('click', () => {
  if (!convResult) return
  saveAs(new Blob([JSON.stringify(convResult.openapi, null, 2)], { type: 'application/json;charset=utf-8' }), `${fileBase(convName)}.openapi.json`)
})
el('to-gen').addEventListener('click', () => {
  if (!convResult) return
  genSpec = convResult.openapi
  genName = convName
  lastGen = null
  el('download').disabled = true
  el('generate').disabled = false
  const n = Object.keys(genSpec.paths).length
  showG(`<p class="ok">Loaded converted <strong>${esc(genName)}</strong> — ${n} path${n === 1 ? '' : 's'}. Ready to generate.</p>`)
  switchTo('gen')
})

function setConvDownloads(on) {
  el('dl-yaml').disabled = !on
  el('dl-json').disabled = !on
  el('to-gen').disabled = !on
}
function fileBase(s) {
  return (String(s || 'api').replace(/[^a-zA-Z0-9._-]+/g, '-').replace(/^-+|-+$/g, '') || 'api').toLowerCase()
}
