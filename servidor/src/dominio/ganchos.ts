// Los ganchos del Servicio (plan de la IA integrada, 5.9): por dónde la IA se entera de que se guardó un texto, sin que
// servicio.ts importe nada de servidor/src/ia/ (evita el ciclo de imports y deja al Servicio probado como está).
// Reglas: se llaman DESPUÉS de confirmar la escritura, nunca adentro de una transacción, y nunca tiran: si fallan, el
// guardado igual quedó hecho y el Servicio avisa (o lo registra) y sigue. Sin ganchos conectados todo anda igual que antes.
import type { Mencion, OrigenMencion, TrabajoResumen } from '../../../compartido/ia'
import type { Ctx, Servicio } from './servicio'

export interface TextoGuardado {
  origen: { tipo: OrigenMencion; id: string }
  /** Texto plano o Markdown. De un DocRico, textoPlano(doc). */
  texto: string
  proyectoId: string | null
  tableroId: string | null
  tarjetaId: string | null
  tarjetaClave: string | null
  /** Comentario al que responde: menciona de hecho a su autor si es una IA (hoy; un agente de adentro desde la F2). */
  respuestaA?: string | null
  /** true: se guarda mientras se escribe (porqué, notas). El trabajo espera a que se deje de escribir (F2). */
  enVivo: boolean
  /** true: el texto se acaba de crear (un comentario nuevo); false: se editó uno que ya existía. Atender solo cuenta al crear. */
  nuevo?: boolean
}

export interface ResultadoMenciones {
  /** Las menciones de esos textos que hoy siguen escritas. */
  menciones: Mencion[]
  trabajos: TrabajoResumen[]
  /** Si algo falló: el texto para mostrarle a la persona. El guardado igual quedó hecho. */
  aviso?: string
}

export interface GanchosServicio {
  textoGuardado?(s: Servicio, ctx: Ctx, textos: TextoGuardado[]): Promise<ResultadoMenciones>
  textoBorrado?(s: Servicio, ctx: Ctx, origenes: { tipo: OrigenMencion; id: string }[]): Promise<void>
  /**
   * Una tarjeta entró a una lista (se creó ahí o la movieron ahí): la IA proactiva (Anexo F.4, disparador `tarjeta_nueva`) se entera.
   * Mismas reglas que los otros: después de confirmar, nunca tira. Lo llama también el importador de Discord (actor `sistema`).
   */
  tarjetaEnLista?(s: Servicio, ctx: Ctx, e: { tarjetaId: string; listaId: string }): Promise<void>
  /**
   * Telar quiere avisarle algo a la persona de la cuenta (hoy: que archivó solo tarjetas de Hecho). Va a la campana como una
   * notificación de tipo `aviso`, una sola vez por `claveUnica`. Mismas reglas: después de confirmar, nunca tira.
   */
  avisoDeTelar?(s: Servicio, a: { titulo: string; cuerpo: string; enlace: string | null; claveUnica: string }): Promise<void>
}
