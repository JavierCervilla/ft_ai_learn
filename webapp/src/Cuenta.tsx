import { useEffect, useState } from "react";
import {
  emitirInvitacion,
  ErrorApi,
  type EstadoInvitaciones,
  type Invitacion,
  misInvitaciones,
  revocarInvitacion,
  salir,
  type Sesion,
} from "./api.ts";

/**
 * Estás dentro.
 *
 * De momento la pantalla es tu cuenta y tu círculo: el grafo llega en FTAI-E. Se enseña lo que hoy
 * se puede **hacer** —invitar, revocar, salir— y no un panel de métricas de adorno.
 */
export function Cuenta({ sesion, alSalir }: { sesion: Sesion; alSalir: () => void }) {
  const [estado, setEstado] = useState<EstadoInvitaciones | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [paraQuien, setParaQuien] = useState("");
  const [ocupado, setOcupado] = useState(false);
  const [recienEmitida, setRecienEmitida] = useState<string | null>(null);

  const recargar = async () => {
    try {
      setEstado(await misInvitaciones());
    } catch (fallo) {
      setError(fallo instanceof ErrorApi ? fallo.message : "No se pudieron leer las invitaciones.");
    }
  };

  // La carga inicial va en `.then` y no con `await` dentro del efecto: la regla
  // `react-hooks/set-state-in-effect` veta el `setState` síncrono en el cuerpo, y el flag `vivo`
  // evita escribir estado sobre un componente ya desmontado.
  useEffect(() => {
    let vivo = true;
    misInvitaciones()
      .then((e) => vivo && setEstado(e))
      .catch((fallo) => {
        if (vivo) {
          setError(
            fallo instanceof ErrorApi ? fallo.message : "No se pudieron leer las invitaciones.",
          );
        }
      });
    return () => {
      vivo = false;
    };
  }, []);

  const emitir = async () => {
    setError(null);
    setOcupado(true);
    try {
      const nueva = await emitirInvitacion(paraQuien.trim() || undefined);
      setRecienEmitida(nueva.code);
      setParaQuien("");
      await recargar();
    } catch (fallo) {
      setError(fallo instanceof ErrorApi ? fallo.message : "No se pudo emitir la invitación.");
    } finally {
      setOcupado(false);
    }
  };

  const revocar = async (code: string) => {
    setError(null);
    try {
      await revocarInvitacion(code);
      if (recienEmitida === code) setRecienEmitida(null);
      await recargar();
    } catch (fallo) {
      setError(fallo instanceof ErrorApi ? fallo.message : "No se pudo revocar.");
    }
  };

  return (
    <main className="mx-auto flex min-h-full w-full max-w-md flex-col gap-8 px-6 py-10">
      <header className="flex items-start justify-between gap-4">
        <div className="flex flex-col gap-1">
          <h1 className="font-[family-name:var(--font-display)] text-3xl leading-tight">
            {sesion.user.name}
          </h1>
          <p className="text-sm text-[var(--color-tenue)]">{sesion.user.email}</p>
        </div>
        <button
          type="button"
          onClick={async () => {
            await salir().catch(() => {});
            alSalir();
          }}
          className="shrink-0 text-sm text-[var(--color-tenue)] underline underline-offset-4"
        >
          Salir
        </button>
      </header>

      <section className="flex flex-col gap-4 rounded-xl border border-[var(--color-borde)] bg-[var(--color-panel)] p-5">
        <div className="flex items-baseline justify-between">
          <h2 className="text-sm font-medium tracking-wide text-[var(--color-tenue)] uppercase">
            Tu círculo
          </h2>
          <span className="text-sm text-[var(--color-tenue)]">
            {estado ? `${estado.cupo} por repartir` : "…"}
          </span>
        </div>

        <div className="flex gap-2">
          <input
            value={paraQuien}
            onChange={(e) => setParaQuien(e.target.value)}
            placeholder="correo (opcional)"
            type="email"
            className="min-w-0 flex-1 rounded-md border border-[var(--color-borde)] bg-[var(--color-fondo)] px-3 py-2 text-[var(--color-tinta)] outline-none focus:border-[var(--color-acento)]"
          />
          <button
            type="button"
            onClick={emitir}
            disabled={ocupado || estado?.cupo === 0}
            className="shrink-0 rounded-md border border-[var(--color-acento)] px-3 py-2 text-sm text-[var(--color-acento)] disabled:opacity-40"
          >
            Invitar
          </button>
        </div>
        <p className="text-xs text-[var(--color-tenue)]">
          Con correo, la invitación sirve <em>sólo</em> para esa persona. Sin correo, la usa quien
          tenga el código.
        </p>

        {recienEmitida && (
          <output className="animate-[aparecer_var(--duracion-entrada)_var(--easing-salida)] rounded-md border border-[var(--color-acento)] bg-[var(--color-fondo)] p-3">
            <p className="mb-1 text-xs text-[var(--color-tenue)]">
              Cópialo ahora: no se vuelve a mostrar.
            </p>
            <code className="font-[family-name:var(--font-mono)] text-[var(--color-acento)] break-all">
              {recienEmitida}
            </code>
          </output>
        )}

        {error && (
          <p role="alert" className="text-sm text-[var(--color-alerta)]">
            {error}
          </p>
        )}

        <ul className="flex flex-col gap-2">
          {estado?.invitaciones.map((i) => <Fila key={i.code} invitacion={i} alRevocar={revocar} />)}
          {estado?.invitaciones.length === 0 && (
            <li className="text-sm text-[var(--color-tenue)]">Todavía no has invitado a nadie.</li>
          )}
        </ul>
      </section>

      <p className="text-sm text-[var(--color-tenue)]">
        El grafo llega en la siguiente trayectoria. De momento esto es tu cuenta y tu círculo.
      </p>
    </main>
  );
}

/** El estado de una invitación se **deriva** de sus fechas: no hay una columna que pueda discrepar. */
function estadoDe(i: Invitacion): { texto: string; usada: boolean } {
  if (i.revokedAt) return { texto: "revocada", usada: true };
  if (i.usedAt) return { texto: "usada", usada: true };
  return { texto: i.email ?? "al portador", usada: false };
}

function Fila({
  invitacion,
  alRevocar,
}: {
  invitacion: Invitacion;
  alRevocar: (code: string) => void;
}) {
  const { texto, usada } = estadoDe(invitacion);
  return (
    <li className="flex items-center justify-between gap-3 border-t border-[var(--color-borde)] pt-2 text-sm">
      <span className={usada ? "text-[var(--color-apagado)]" : "text-[var(--color-tinta)]"}>
        {texto}
      </span>
      {!usada && (
        <button
          type="button"
          onClick={() => alRevocar(invitacion.code)}
          className="shrink-0 text-[var(--color-tenue)] underline underline-offset-4"
        >
          revocar
        </button>
      )}
    </li>
  );
}
