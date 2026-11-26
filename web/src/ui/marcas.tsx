// Marca de Telar y marcas de GitHub, Figma y Discord para los chips de enlaces.
import { useId, type SVGProps } from 'react'

type P = SVGProps<SVGSVGElement> & { size?: number }

/**
 * Telar, «la pasada»: tres hilos de urdimbre y una trama que pasa por encima de los de los costados y por debajo del
 * central (el central y la trama forman la T). Es el glifo de `public/marca/telar-glifo.svg`, en `currentColor`; los
 * cortes se hacen con máscaras con ids propios para poder usarlo varias veces en la misma página.
 */
export function MarcaTelar({ size = 24, ...p }: P) {
  const id = 'telar' + useId().replace(/[^a-zA-Z0-9_-]/g, '')
  return (
    <svg viewBox="0 0 64 64" width={size} height={size} fill="currentColor" aria-hidden {...p}>
      <defs>
        <mask id={`${id}a`} maskUnits="userSpaceOnUse" x="0" y="0" width="64" height="64">
          <rect width="64" height="64" fill="#fff" />
          <rect x="6.5" y="18.5" width="51" height="12" rx="6" fill="#000" />
        </mask>
        <mask id={`${id}b`} maskUnits="userSpaceOnUse" x="0" y="0" width="64" height="64">
          <rect width="64" height="64" fill="#fff" />
          <rect x="26" y="9.5" width="12" height="45" rx="6" fill="#000" />
        </mask>
      </defs>
      <g mask={`url(#${id}a)`} opacity={0.45}>
        <rect x="12" y="14" width="8" height="36" rx="4" />
        <rect x="44" y="14" width="8" height="36" rx="4" />
      </g>
      <rect mask={`url(#${id}b)`} x="8" y="20" width="48" height="9" rx="4.5" />
      <rect x="27.5" y="11" width="9" height="42" rx="4.5" />
    </svg>
  )
}

export function MarcaGithub({ size = 14, ...p }: P) {
  return (
    <svg viewBox="0 0 16 16" width={size} height={size} fill="currentColor" aria-hidden {...p}>
      <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0 0 16 8c0-4.42-3.58-8-8-8z" />
    </svg>
  )
}

export function MarcaFigma({ size = 14, ...p }: P) {
  return (
    <svg viewBox="0 0 38 57" width={(size * 38) / 57} height={size} aria-hidden {...p}>
      <path d="M19 28.5a9.5 9.5 0 1 1 19 0 9.5 9.5 0 0 1-19 0z" fill="#1ABCFE" />
      <path d="M0 47.5A9.5 9.5 0 0 1 9.5 38H19v9.5a9.5 9.5 0 1 1-19 0z" fill="#0ACF83" />
      <path d="M19 0v19h9.5a9.5 9.5 0 1 0 0-19H19z" fill="#FF7262" />
      <path d="M0 9.5A9.5 9.5 0 0 0 9.5 19H19V0H9.5A9.5 9.5 0 0 0 0 9.5z" fill="#F24E1E" />
      <path d="M0 28.5A9.5 9.5 0 0 0 9.5 38H19V19H9.5A9.5 9.5 0 0 0 0 28.5z" fill="#A259FF" />
    </svg>
  )
}

export function MarcaDiscord({ size = 14, ...p }: P) {
  return (
    <svg viewBox="0 0 127.14 96.36" width={(size * 127) / 96} height={size} fill="currentColor" aria-hidden {...p}>
      <path d="M107.7 8.07A105.15 105.15 0 0 0 81.47 0a72.06 72.06 0 0 0-3.36 6.83 97.68 97.68 0 0 0-29.11 0A72.37 72.37 0 0 0 45.64 0a105.89 105.89 0 0 0-26.25 8.09C2.79 32.65-1.71 56.6.54 80.21a105.73 105.73 0 0 0 32.17 16.15 77.7 77.7 0 0 0 6.89-11.11 68.42 68.42 0 0 1-10.85-5.18c.91-.66 1.8-1.34 2.66-2a75.57 75.57 0 0 0 64.32 0c.87.71 1.76 1.39 2.66 2a68.68 68.68 0 0 1-10.87 5.19 77 77 0 0 0 6.89 11.1 105.25 105.25 0 0 0 32.19-16.14c2.64-27.38-4.51-51.11-18.9-72.15zM42.45 65.69C36.18 65.69 31 60 31 53s5-12.74 11.43-12.74S54 46 53.89 53s-5.05 12.69-11.44 12.69zm42.24 0C78.41 65.69 73.25 60 73.25 53s5-12.74 11.44-12.74S96.23 46 96.12 53s-5.04 12.69-11.43 12.69z" />
    </svg>
  )
}
