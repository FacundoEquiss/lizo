// Prueba del TLS hacia la base (SRV-4). `npm run tls:probar`. Sin base ni red: un servidor falso que habla el arranque de Postgres
// (responde «S» al pedido de TLS) y presenta un certificado propio, que NO es el de Supabase.
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import net from 'node:net'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { after, test } from 'node:test'
import tls from 'node:tls'
import { abrirPostgres } from './postgres'
import { esErrorDeCertificado, tlsDeLaUrl } from './tls'

const dir = mkdtempSync(path.join(tmpdir(), 'telar-tls-'))
after(() => rmSync(dir, { recursive: true, force: true }))
execFileSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-days', '2', '-subj', '/CN=localhost', '-addext', 'subjectAltName=DNS:localhost', '-keyout', path.join(dir, 'k.pem'), '-out', path.join(dir, 'c.pem')], { stdio: 'ignore' })
const KEY = readFileSync(path.join(dir, 'k.pem'))
const CERT = readFileSync(path.join(dir, 'c.pem'))

/** Servidor que dice «sí» al TLS, lo levanta con el certificado propio y, si el cliente sigue, corta. Cuenta los TLS que llegaron a completarse. */
async function servidorFalso() {
  const visto = { pedidos: 0, tlsCompletos: 0 }
  const srv = net.createServer((sock) => {
    sock.once('data', () => {
      visto.pedidos++
      sock.write('S')
      const t = new tls.TLSSocket(sock, { isServer: true, key: KEY, cert: CERT })
      t.on('secure', () => {
        visto.tlsCompletos++
        t.destroy()
      })
      t.on('error', () => {})
    })
    sock.on('error', () => {})
  })
  await new Promise<void>((r) => srv.listen(0, '127.0.0.1', r))
  const puerto = (srv.address() as net.AddressInfo).port
  return { visto, url: `postgresql://u:p@localhost:${puerto}/db`, cerrar: () => new Promise<void>((r) => srv.close(() => r())) }
}

async function callando<T>(f: () => Promise<T>) {
  const avisos: string[] = []
  const original = console.error
  console.error = (...a: unknown[]) => void avisos.push(a.join(' '))
  try {
    return { avisos, ...(await f().then((v) => ({ v, e: null as unknown }), (e) => ({ v: null as T | null, e }))) }
  } finally {
    console.error = original
  }
}

test('la URL se limpia y las opciones salen según el modo', () => {
  const v = tlsDeLaUrl('postgresql://u:p@h:6543/postgres?sslmode=require&application_name=telar', {})
  assert.equal(v.modo, 'verificado')
  assert.equal(v.url, 'postgresql://u:p@h:6543/postgres?application_name=telar')
  assert.equal((v.ssl as tls.ConnectionOptions).rejectUnauthorized, true)
  assert.ok(((v.ssl as tls.ConnectionOptions).ca as string[]).some((c) => c.includes('BEGIN CERTIFICATE')))
  assert.equal(tlsDeLaUrl('postgresql://u:p@h/db?sslmode=disable', {}).ssl, false)
  assert.equal(tlsDeLaUrl('postgresql://u:p@h/db?sslmode=no-verify', {}).modo, 'sin-verificar')
  assert.equal(tlsDeLaUrl('postgresql://u:p@h/db', { TABLERO_DB_TLS: 'sin-verificar' }).modo, 'sin-verificar')
  const extra = tlsDeLaUrl('postgresql://u:p@h/db', { TABLERO_DB_CA: '-----BEGIN CERTIFICATE-----\\nXX\\n-----END CERTIFICATE-----' })
  assert.equal(((extra.ssl as tls.ConnectionOptions).ca as string[]).length, 2)
  assert.ok(((extra.ssl as tls.ConnectionOptions).ca as string[])[1].includes('\nXX\n'))
  assert.equal(tlsDeLaUrl('postgresql://u:p@h/db?x=1&sslmode=require', {}).url, 'postgresql://u:p@h/db?x=1')
})

test('solo los errores de certificado cuentan como tales', () => {
  assert.equal(esErrorDeCertificado({ code: 'DEPTH_ZERO_SELF_SIGNED_CERT' }), true)
  assert.equal(esErrorDeCertificado({ code: 'ECONNREFUSED' }), false)
  assert.equal(esErrorDeCertificado(new Error('x')), false)
  assert.equal(esErrorDeCertificado(null), false)
})

test('por defecto: un certificado ajeno se rechaza, se avisa y NO se reintenta sin verificar', async () => {
  const s = await servidorFalso()
  try {
    const r = await callando(() => abrirPostgres(s.url))
    assert.ok(r.e, 'tenía que fallar')
    assert.equal(esErrorDeCertificado(r.e), true, `error inesperado: ${String(r.e)}`)
    assert.equal(s.visto.tlsCompletos, 0, 'el TLS no tenía que completarse con un certificado ajeno')
    assert.equal(s.visto.pedidos, 1, 'no tenía que reintentar')
    assert.ok(r.avisos.some((a) => a.includes('no se pudo verificar')), 'tiene que avisar')
  } finally {
    await s.cerrar()
  }
})

test('TABLERO_DB_TLS=sin-verificar: es la excepción explícita, completa el TLS y avisa', async () => {
  const s = await servidorFalso()
  process.env.TABLERO_DB_TLS = 'sin-verificar'
  try {
    const r = await callando(() => abrirPostgres(s.url))
    assert.ok(r.e, 'el servidor falso corta apenas termina el TLS: tiene que fallar')
    assert.equal(esErrorDeCertificado(r.e), false)
    assert.equal(s.visto.pedidos, 1)
    assert.equal(s.visto.tlsCompletos, 1)
  } finally {
    delete process.env.TABLERO_DB_TLS
    await s.cerrar()
  }
})

test('con TABLERO_DB_CA con el certificado de ese servidor, se verifica y conecta sin avisos', async () => {
  const s = await servidorFalso()
  process.env.TABLERO_DB_CA = CERT.toString()
  try {
    const r = await callando(() => abrirPostgres(s.url))
    assert.equal(esErrorDeCertificado(r.e), false)
    assert.equal(s.visto.pedidos, 1, 'un solo intento: el certificado verificó')
    assert.equal(s.visto.tlsCompletos, 1)
    assert.ok(!r.avisos.some((a) => a.includes('no se pudo verificar')))
  } finally {
    delete process.env.TABLERO_DB_CA
    await s.cerrar()
  }
})
