// `npm run dev` (servidor) y `npm start`. Si el puerto ya lo tiene otro tablero
// (por ejemplo el MCP que abrió Claude), espera y lo releva cuando se cierra.
import { config } from './config'
import { hayTablero, iniciarServidor, PuertoOcupado, type ServidorEnMarcha } from './servidor'

const produccion = process.argv.includes('--produccion')
const desarrollo = process.argv.includes('--dev')
let enMarcha: ServidorEnMarcha | null = null
let avisado = false

async function intentar(): Promise<void> {
  try {
    enMarcha = await iniciarServidor({ produccion, desarrollo, log: (m) => console.log(`[tablero] ${m}`) })
    if (produccion) console.log(`[tablero] abrí http://localhost:${config.puerto}`)
  } catch (e) {
    if (!(e instanceof PuertoOcupado)) {
      console.error('[tablero] no pude arrancar:', e)
      process.exit(1)
    }
    if (!(await hayTablero())) {
      console.error(
        `[tablero] el puerto ${config.puerto} lo está usando otro programa. Elegí otro con TABLERO_PUERTO=4320 (y reiniciá).`,
      )
      process.exit(1)
    }
    if (!avisado) {
      console.log(
        `[tablero] ya hay un tablero corriendo en el puerto ${config.puerto} (seguramente lo abrió el MCP): uso ese. Si se cierra, lo levanto yo.`,
      )
      avisado = true
    }
    setTimeout(intentar, 2500)
  }
}

async function salir() {
  await enMarcha?.cerrar().catch(() => {})
  process.exit(0)
}
process.on('SIGINT', salir)
process.on('SIGTERM', salir)

await intentar()
