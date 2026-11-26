// Dónde quedan los archivos que se suben (adjuntos de las tarjetas, imágenes del lienzo).
//   · almacenCarpeta: en una carpeta del disco (local: .datos/archivos).
//   · almacenBase: en la propia base, tabla `archivos` (online: Vercel no tiene disco propio).
// Las rutas son relativas y sin "..": "<tarjeta>/<id>-<nombre>", "lienzo/<id>-<nombre>", "importar/<nombre>",
// "proyectos/<proyecto>-<id>.<ext>" (la foto del proyecto).
// Cuentas (docs/cuentas.md): cada cuenta ve SU carpeta. El Servicio de una cuenta tiene `almacenDe(base, cuenta)`: las mismas
// rutas de siempre ("lienzo/x.png", y la misma dirección /archivos/lienzo/x.png), pero guardadas en "c/<cuenta>/lienzo/x.png".
// La cuenta 'dueno' sigue en la raíz (lo que ya existía no se mueve) y no puede leer "c/…". Así una cuenta no tiene forma de
// nombrar un archivo de otra: ni por la dirección, ni desde un marco de Diseño, ni desde el lienzo.
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import type { Conexion } from './conexion'

export interface Almacen {
  readonly tipo: 'carpeta' | 'base'
  guardar(ruta: string, datos: Uint8Array, mime: string): Promise<void>
  /** null si no existe. `mime` vacío: que lo deduzca quien sirve el archivo. */
  leer(ruta: string): Promise<{ datos: Uint8Array; mime: string } | null>
  borrar(ruta: string): Promise<void>
  /** Bytes guardados bajo esta carpeta ("c/<cuenta>"): para el tope de cada cuenta. */
  usado(carpeta: string): Promise<number>
}

/** La cuenta que no tiene topes ni carpeta propia (es la de siempre: la del juego y la clave del MCP). */
export const CUENTA_DUENO = 'dueno'
/** Hasta cuánto guarda en total una cuenta nueva (MB). */
export const TOPE_ARCHIVOS_MB = 200

export class ErrorAlmacen extends Error {
  constructor(
    mensaje: string,
    readonly estado: number,
  ) {
    super(mensaje)
  }
}

/** Una ruta relativa segura (sin salir de la raíz, sin vacíos). */
export function rutaSegura(ruta: string): string {
  const partes = ruta.split('/').filter(Boolean)
  if (!partes.length || partes.some((p) => p === '.' || p === '..' || p.includes('\\'))) throw new Error('Ruta de archivo inválida.')
  return partes.join('/')
}

export function almacenCarpeta(raiz: string): Almacen {
  const destino = (ruta: string) => path.join(path.resolve(raiz), ...rutaSegura(ruta).split('/'))
  return {
    tipo: 'carpeta',
    async guardar(ruta, datos) {
      const d = destino(ruta)
      mkdirSync(path.dirname(d), { recursive: true })
      writeFileSync(d, datos)
    },
    async leer(ruta) {
      const d = destino(ruta)
      if (!existsSync(d) || !statSync(d).isFile()) return null
      return { datos: readFileSync(d), mime: '' }
    },
    // En el disco queda (papelera implícita, como siempre): se limpia aparte.
    async borrar() {},
    async usado(carpeta) {
      const sumar = (d: string): number => {
        if (!existsSync(d)) return 0
        let n = 0
        for (const e of readdirSync(d, { withFileTypes: true })) n += e.isDirectory() ? sumar(path.join(d, e.name)) : statSync(path.join(d, e.name)).size
        return n
      }
      return sumar(destino(carpeta))
    },
  }
}

export function almacenBase(db: Conexion): Almacen {
  return {
    tipo: 'base',
    async guardar(ruta, datos, mime) {
      const r = rutaSegura(ruta)
      await db.consulta(
        `insert into archivos (ruta, mime, datos, tamano, propietario) values ($1, $2, $3, $4, $5)
         on conflict (ruta) do update set mime = excluded.mime, datos = excluded.datos, tamano = excluded.tamano`,
        [r, mime || 'application/octet-stream', Buffer.from(datos), datos.byteLength, propietarioDeRuta(r)],
      )
    },
    async leer(ruta) {
      const [f] = await db.consulta<{ mime: string; datos: Uint8Array }>(`select mime, datos from archivos where ruta = $1`, [
        rutaSegura(ruta),
      ])
      return f ? { datos: new Uint8Array(f.datos), mime: f.mime } : null
    },
    async borrar(ruta) {
      await db.consulta(`delete from archivos where ruta = $1`, [rutaSegura(ruta)])
    },
    async usado(carpeta) {
      const cuenta = propietarioDeRuta(`${carpeta}/x`)
      const [f] = await db.consulta<{ n: string | number }>(`select coalesce(sum(tamano), 0) as n from archivos where propietario = $1`, [cuenta])
      return Number(f?.n ?? 0)
    },
  }
}

/** De qué cuenta es una ruta física: "c/<cuenta>/…" es de esa cuenta; el resto, de 'dueno'. (La columna `propietario` de
 *  `archivos` sale de acá: es solo para sumar el tope, la carpeta es la que manda.) */
export function propietarioDeRuta(ruta: string): string {
  const [a, b] = ruta.split('/')
  return a === 'c' && b ? b : CUENTA_DUENO
}

/**
 * El almacén que ve una cuenta: su carpeta. Las rutas que recibe y devuelve son las de siempre ("lienzo/x.png"); por dentro,
 * las de una cuenta nueva van a "c/<cuenta>/…". 'dueno' usa la raíz, pero no puede tocar "c/…" (son de las otras cuentas).
 * Una cuenta nueva tiene tope: TOPE_ARCHIVOS_MB en total.
 */
export function almacenDe(base: Almacen, cuenta: string): Almacen {
  const dueno = cuenta === CUENTA_DUENO
  const carpeta = `c/${cuenta}`
  const fisica = (ruta: string) => {
    const r = rutaSegura(ruta)
    if (dueno) {
      if (r === 'c' || r.startsWith('c/')) throw new ErrorAlmacen('No encontrado', 404)
      return r
    }
    return `${carpeta}/${r}`
  }
  return {
    tipo: base.tipo,
    async guardar(ruta, datos, mime) {
      const r = fisica(ruta)
      if (!dueno) {
        const usado = await base.usado(carpeta)
        if (usado + datos.byteLength > TOPE_ARCHIVOS_MB * 1024 * 1024)
          throw new ErrorAlmacen(
            `Llegaste al tope de ${TOPE_ARCHIVOS_MB} MB de archivos de tu cuenta (usás ${(usado / 1024 / 1024).toFixed(1)} MB). Achicá la imagen o sacá adjuntos que no uses.`,
            413,
          )
      }
      return base.guardar(r, datos, mime)
    },
    async leer(ruta) {
      let r: string
      try {
        r = fisica(ruta)
      } catch (e) {
        if (e instanceof ErrorAlmacen) return null
        throw e
      }
      return base.leer(r)
    },
    async borrar(ruta) {
      return base.borrar(fisica(ruta))
    },
    async usado() {
      return dueno ? 0 : base.usado(carpeta)
    },
  }
}
