// Escribe docs/guia-para-ias.md con la guía de servidor/src/mcp/guia.ts: la misma que da leer_guia por MCP.
//   npm run guia                  → escribe el documento
//   npm run guia -- --verificar   → solo compara (sale con error si el documento quedó viejo)
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { documentoGuia } from '../servidor/src/mcp/guia'

const archivo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'docs', 'guia-para-ias.md')
const nuevo = documentoGuia()
const actual = existsSync(archivo) ? readFileSync(archivo, 'utf8') : ''

if (process.argv.includes('--verificar')) {
  if (actual !== nuevo) {
    console.error('docs/guia-para-ias.md quedó viejo: corré npm run guia.')
    process.exit(1)
  }
  console.log('docs/guia-para-ias.md está al día con leer_guia.')
} else if (actual === nuevo) {
  console.log('docs/guia-para-ias.md ya estaba al día.')
} else {
  writeFileSync(archivo, nuevo)
  console.log(`Escribí docs/guia-para-ias.md (${Math.round(nuevo.length / 1024)} KB).`)
}
