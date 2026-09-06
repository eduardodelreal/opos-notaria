"use client";

import * as React from "react";
import { BellRing, Loader2, Trash2 } from "lucide-react";
import { useSesion } from "@/components/Sesion";
import { Boton, Campo, Card, TituloSeccion, cx } from "@/components/ui";
import { clienteNavegador } from "@/lib/supabase/navegador";
import { hayAvisos } from "@/lib/avisos/config";
import {
  activar,
  avisoDePrueba,
  desactivar,
  esIosSinInstalar,
  inspeccionar,
  refrescarSuscripcion,
  type EstadoDispositivo,
} from "@/lib/avisos/navegador";
import {
  guardarPreferencias,
  leerPreferencias,
  listarDispositivos,
  nombreDispositivo,
} from "@/lib/avisos/preferencias";
import {
  PREFERENCIAS_POR_DEFECTO,
  TIPOS_AVISO,
  type PreferenciasAviso,
  type SuscripcionAviso,
  type TipoAviso,
} from "@/lib/avisos/tipos";

/**
 * Ajustes de los recordatorios push.
 *
 * Componente suelto y autónomo: se enchufa donde se quiera (la idea es
 * `app/ajustes/page.tsx`) y **se pinta a sí mismo como nada** si la
 * instalación no tiene Supabase, si no hay sesión iniciada o si no hay claves
 * VAPID. Mismo trato que le da la app a la IA: sin la pieza detrás, la opción
 * no existe, pero nada se rompe.
 *
 * Escribe DIRECTAMENTE en Supabase, no en el store local. La razón está en
 * lib/avisos/preferencias.ts: quien manda los avisos es un cron que solo ve la
 * base de datos, así que una preferencia que se quedara esperando al próximo
 * empujón de la sincronización no serviría de nada.
 */

const DIAS = [
  { iso: 1, letra: "L", nombre: "lunes" },
  { iso: 2, letra: "M", nombre: "martes" },
  { iso: 3, letra: "X", nombre: "miércoles" },
  { iso: 4, letra: "J", nombre: "jueves" },
  { iso: 5, letra: "V", nombre: "viernes" },
  { iso: 6, letra: "S", nombre: "sábado" },
  { iso: 7, letra: "D", nombre: "domingo" },
];

export function AjustesAvisos() {
  const { configurado, usuario } = useSesion();
  const supabase = React.useMemo(() => clienteNavegador(), []);

  const [cargando, setCargando] = React.useState(true);
  const [prefs, setPrefs] = React.useState<PreferenciasAviso>(PREFERENCIAS_POR_DEFECTO);
  const [dispositivo, setDispositivo] = React.useState<EstadoDispositivo>({
    soportado: false,
    permiso: "no-soportado",
    suscrito: false,
    endpoint: null,
  });
  const [dispositivos, setDispositivos] = React.useState<SuscripcionAviso[]>([]);
  const [trabajando, setTrabajando] = React.useState(false);
  const [aviso, setAviso] = React.useState<{ ok: boolean; texto: string } | null>(null);

  const usuarioId = usuario?.id ?? null;

  const recargarDispositivos = React.useCallback(async () => {
    if (!supabase) return;
    const { dispositivos } = await listarDispositivos(supabase);
    setDispositivos(dispositivos);
  }, [supabase]);

  React.useEffect(() => {
    if (!supabase || !usuarioId) {
      setCargando(false);
      return;
    }
    let vivo = true;
    (async () => {
      // Antes de leer nada: si este navegador ya estaba suscrito, se pone al
      // día su fila (zona horaria, endpoint rotado). Ver refrescarSuscripcion.
      await refrescarSuscripcion(supabase, usuarioId);
      const [{ preferencias }, estadoDispositivo, { dispositivos }] = await Promise.all([
        leerPreferencias(supabase),
        inspeccionar(),
        listarDispositivos(supabase),
      ]);
      if (!vivo) return;
      setPrefs(preferencias);
      setDispositivo(estadoDispositivo);
      setDispositivos(dispositivos);
      setCargando(false);
    })().catch(() => vivo && setCargando(false));
    return () => {
      vivo = false;
    };
  }, [supabase, usuarioId]);

  /** Guarda un cambio de preferencia y lo refleja al momento en pantalla. */
  const guardar = React.useCallback(
    async (cambios: Partial<PreferenciasAviso>) => {
      setPrefs((p) => ({ ...p, ...cambios }));
      if (!supabase || !usuarioId) return;
      const r = await guardarPreferencias(supabase, usuarioId, cambios);
      setAviso(
        r.ok
          ? { ok: true, texto: "Guardado." }
          : { ok: false, texto: r.error ?? "No se ha podido guardar." },
      );
    },
    [supabase, usuarioId],
  );

  // La hora se teclea dígito a dígito: sin esperar, cada pulsación sería un
  // viaje a Supabase y la fila acabaría con una hora a medio escribir.
  const relojHora = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  const cambiarHora = (valor: string) => {
    setPrefs((p) => ({ ...p, hora: valor }));
    if (relojHora.current) clearTimeout(relojHora.current);
    relojHora.current = setTimeout(() => guardar({ hora: valor }), 700);
  };
  React.useEffect(
    () => () => {
      if (relojHora.current) clearTimeout(relojHora.current);
    },
    [],
  );

  const alternarInterruptor = async () => {
    setTrabajando(true);
    setAviso(null);
    try {
      if (prefs.activos && dispositivo.suscrito) {
        await desactivar(supabase);
        await guardar({ activos: false });
        setDispositivo(await inspeccionar());
        await recargarDispositivos();
        setAviso({ ok: true, texto: "Avisos apagados." });
        return;
      }
      const r = await activar(supabase, usuarioId);
      if (!r.ok) {
        setDispositivo(await inspeccionar());
        setAviso({ ok: false, texto: r.mensaje ?? "No se ha podido activar." });
        return;
      }
      await guardar({ activos: true });
      setDispositivo(await inspeccionar());
      await recargarDispositivos();
      setAviso({ ok: true, texto: "Listo. Recibirás como mucho un aviso al día." });
    } finally {
      setTrabajando(false);
    }
  };

  const quitar = async (sub: SuscripcionAviso) => {
    setTrabajando(true);
    await desactivar(
      supabase,
      // Si es este mismo navegador, `desactivar` sin endpoint también cancela
      // la suscripción en el propio navegador; para los demás solo se puede
      // marcar la baja en el servidor.
      sub.endpoint === dispositivo.endpoint ? undefined : sub.endpoint,
    );
    setDispositivo(await inspeccionar());
    await recargarDispositivos();
    setTrabajando(false);
  };

  const alternarDia = (iso: number) => {
    const dias = prefs.dias.includes(iso)
      ? prefs.dias.filter((d) => d !== iso)
      : [...prefs.dias, iso].sort();
    guardar({ dias });
  };

  const alternarTipo = (tipo: TipoAviso) => {
    const tipos = prefs.tipos.includes(tipo)
      ? prefs.tipos.filter((t) => t !== tipo)
      : [...prefs.tipos, tipo];
    guardar({ tipos });
  };

  /* --------------------------- Casos de no pintar -------------------------- */

  // Sin cuentas o sin sesión no hay avisos que configurar: los manda un
  // servidor y necesita saber a quién. No se enseña nada, y no se rompe nada.
  if (!configurado || !usuario) return null;

  if (!hayAvisos())
    return (
      <Card>
        <TituloSeccion>Avisos</TituloSeccion>
        <p className="text-[13px] text-muted leading-relaxed">
          Esta instalación no tiene claves VAPID configuradas, así que no puede
          mandar recordatorios. Se generan una sola vez y se declaran antes de
          compilar; está explicado en <code>docs/avisos.md</code>.
        </p>
      </Card>
    );

  const encendido = prefs.activos && dispositivo.suscrito;
  const bloqueado = dispositivo.permiso === "denied";

  return (
    <Card>
      <TituloSeccion
        accion={
          <Interruptor
            encendido={encendido}
            trabajando={trabajando}
            onClick={alternarInterruptor}
            etiqueta={encendido ? "Apagar los avisos" : "Encender los avisos"}
          />
        }
      >
        Avisos
      </TituloSeccion>

      <p className="text-[13px] text-muted leading-relaxed">
        Un recordatorio al día como mucho, y solo cuando hay algo concreto que
        decir: un tema que se oxida, un repaso vencido, la racha en el filo. Si
        vas al día no llega nada.
      </p>

      {cargando ? (
        <div className="flex items-center gap-2 text-[13px] text-subtle mt-4">
          <Loader2 className="size-3.5 animate-spin" /> Cargando
        </div>
      ) : (
        <>
          {!dispositivo.soportado && (
            <p className="text-[12px] text-[var(--warn)] mt-4 leading-relaxed">
              {esIosSinInstalar()
                ? "En iPhone y iPad, Safari solo entrega avisos a las webs añadidas a la pantalla de inicio. Esta todavía no lo está, así que aquí no llegarán."
                : "Este navegador no admite avisos push."}
            </p>
          )}

          {bloqueado && (
            <p className="text-[12px] text-[var(--warn)] mt-4 leading-relaxed">
              Bloqueaste las notificaciones de este sitio. Hay que volver a
              permitirlas desde el candado de la barra de direcciones: desde
              aquí ya no se puede pedir.
            </p>
          )}

          {encendido && (
            <div className="mt-5 space-y-5">
              <div className="grid sm:grid-cols-2 gap-4 items-start">
                <Campo
                  etiqueta="A qué hora"
                  type="time"
                  value={prefs.hora}
                  onChange={(e) => cambiarHora(e.target.value)}
                  pista="Hora de cada aparato, no del servidor"
                />
                <div>
                  <span className="block text-xs font-medium text-muted mb-1.5">
                    Qué días
                  </span>
                  <div className="flex gap-1">
                    {DIAS.map((d) => (
                      <button
                        key={d.iso}
                        onClick={() => alternarDia(d.iso)}
                        aria-pressed={prefs.dias.includes(d.iso)}
                        aria-label={d.nombre}
                        className={cx(
                          "size-9 rounded-lg border text-[13px] font-medium transition-colors",
                          prefs.dias.includes(d.iso)
                            ? "bg-[var(--laton-soft)] border-[var(--laton)] text-[var(--laton)]"
                            : "bg-[var(--surface-2)] border-[var(--border)] text-subtle hover:text-fg",
                        )}
                      >
                        {d.letra}
                      </button>
                    ))}
                  </div>
                  {!prefs.dias.length && (
                    <span className="block text-[11px] text-subtle mt-1.5">
                      Sin días marcados no llegará ninguno.
                    </span>
                  )}
                </div>
              </div>

              <div>
                <span className="block text-xs font-medium text-muted mb-2">
                  De qué avisar
                </span>
                <div className="space-y-1.5">
                  {TIPOS_AVISO.map((t) => {
                    const activo = prefs.tipos.includes(t.id);
                    return (
                      <button
                        key={t.id}
                        onClick={() => alternarTipo(t.id)}
                        aria-pressed={activo}
                        className={cx(
                          "w-full text-left rounded-[10px] border px-3 py-2.5 transition-colors",
                          activo
                            ? "bg-[var(--surface-2)] border-[var(--border-strong)]"
                            : "bg-transparent border-[var(--border)] opacity-60 hover:opacity-100",
                        )}
                      >
                        <span className="flex items-center gap-2">
                          <span
                            className={cx(
                              "size-3.5 rounded border shrink-0",
                              activo
                                ? "bg-[var(--laton)] border-[var(--laton)]"
                                : "border-[var(--border-strong)]",
                            )}
                          />
                          <span className="text-[13px] font-medium">{t.label}</span>
                        </span>
                        <span className="block text-[12px] text-subtle mt-1 pl-[22px] leading-relaxed">
                          {t.desc}
                        </span>
                      </button>
                    );
                  })}
                </div>
                {!prefs.tipos.length && (
                  <span className="block text-[11px] text-subtle mt-2">
                    Sin ningún tipo marcado no llegará ninguno.
                  </span>
                )}
              </div>

              {dispositivos.length > 0 && (
                <div>
                  <span className="block text-xs font-medium text-muted mb-2">
                    Aparatos suscritos
                  </span>
                  <ul className="space-y-1">
                    {dispositivos.map((d) => (
                      <li
                        key={d.id}
                        className="flex items-center justify-between gap-3 text-[13px] rounded-lg px-3 h-10 bg-[var(--surface-2)] border border-[var(--border)]"
                      >
                        <span className="truncate">
                          {nombreDispositivo(d.userAgent)}
                          <span className="text-subtle">
                            {" · "}
                            {d.zonaHoraria}
                            {d.endpoint === dispositivo.endpoint ? " · este" : ""}
                          </span>
                        </span>
                        <button
                          onClick={() => quitar(d)}
                          disabled={trabajando}
                          aria-label={`Quitar ${nombreDispositivo(d.userAgent)}`}
                          className="text-subtle hover:text-[var(--danger)] transition-colors shrink-0"
                        >
                          <Trash2 className="size-4" />
                        </button>
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              <div className="flex items-center gap-3">
                <Boton
                  tam="sm"
                  variante="secundario"
                  onClick={async () => {
                    const r = await avisoDePrueba();
                    setAviso(
                      r.ok
                        ? { ok: true, texto: "Mandado. Si no lo ves, míralo en el centro de notificaciones del sistema." }
                        : { ok: false, texto: r.mensaje ?? "No se ha podido." },
                    );
                  }}
                >
                  <BellRing className="size-3.5" />
                  Ver cómo se verá
                </Boton>
                <span className="text-[11px] text-subtle leading-tight">
                  Es una notificación local: comprueba el permiso, no la entrega
                  desde el servidor.
                </span>
              </div>
            </div>
          )}

          {aviso && (
            <p
              className={cx(
                "text-[12px] mt-4",
                aviso.ok ? "text-[var(--ok)]" : "text-[var(--danger)]",
              )}
            >
              {aviso.texto}
            </p>
          )}
        </>
      )}
    </Card>
  );
}

/* -------------------------------------------------------------------------
   Interruptor
   No está en components/ui.tsx porque ahí no hay ninguno y ese fichero es
   territorio compartido. Si mañana hace falta un segundo, se sube allí.
   ------------------------------------------------------------------------- */

function Interruptor({
  encendido,
  trabajando,
  onClick,
  etiqueta,
}: {
  encendido: boolean;
  trabajando: boolean;
  onClick: () => void;
  etiqueta: string;
}) {
  return (
    <button
      role="switch"
      aria-checked={encendido}
      aria-label={etiqueta}
      disabled={trabajando}
      onClick={onClick}
      className={cx(
        "relative h-6 w-11 rounded-full border transition-colors disabled:opacity-45",
        encendido
          ? "bg-[var(--laton)] border-[var(--laton)]"
          : "bg-[var(--surface-3)] border-[var(--border)]",
      )}
    >
      <span
        className={cx(
          "absolute top-1/2 -translate-y-1/2 size-4 rounded-full bg-[var(--bg-elevated)] shadow-sm transition-[left] duration-150",
          encendido ? "left-[22px]" : "left-[3px]",
        )}
      >
        {trabajando && (
          <Loader2 className="size-4 animate-spin text-[var(--fg-subtle)]" />
        )}
      </span>
    </button>
  );
}
