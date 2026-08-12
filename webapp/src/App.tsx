import { useEffect, useState } from "react";

interface Salud {
  ok: boolean;
  db: "up" | "down";
  schema: "ready" | "missing" | "unknown";
  version: string;
}

type Estado = { fase: "cargando" } | { fase: "ok"; salud: Salud } | { fase: "sin-red" };

/**
 * La pantalla de la semilla.
 *
 * Existe para enseñar que la cadena está enchufada de punta a punta —navegador → API → Postgres— y
 * para tener dónde medir la instalabilidad de la PWA. El grafo lo pinta FTAI-E.
 */
export function App() {
  const [estado, setEstado] = useState<Estado>({ fase: "cargando" });

  useEffect(() => {
    let vivo = true;
    fetch("/health")
      .then((r) => r.json())
      .then((salud: Salud) => vivo && setEstado({ fase: "ok", salud }))
      // Sin red no se miente diciendo que todo va bien: se dice que no se pudo preguntar.
      .catch(() => vivo && setEstado({ fase: "sin-red" }));
    return () => {
      vivo = false;
    };
  }, []);

  return (
    <main className="mx-auto flex min-h-full max-w-2xl flex-col justify-center gap-8 px-6 py-12">
      <header className="flex flex-col gap-3">
        <img src="/icons/icon-192.png" alt="" width={56} height={56} className="rounded-xl" />
        <h1 className="text-3xl font-semibold tracking-tight">Holy Graph de IA</h1>
        <p className="text-[var(--color-tenue)]">
          Un mapa de competencias recorrible en sentadas de quince minutos. Cada nodo se aprueba con
          evidencia en Git y desbloquea los siguientes.
        </p>
      </header>

      <section className="rounded-xl border border-[var(--color-borde)] bg-[var(--color-panel)] p-5">
        <h2 className="mb-3 text-sm font-medium uppercase tracking-wide text-[var(--color-tenue)]">
          Estado del servicio
        </h2>
        <Diagnostico estado={estado} />
      </section>

      <p className="text-sm text-[var(--color-tenue)]">
        Semilla del proyecto. El grafo navegable, el progreso y el radar llegan en las trayectorias
        siguientes.
      </p>
    </main>
  );
}

function Diagnostico({ estado }: { estado: Estado }) {
  if (estado.fase === "cargando") {
    return <p className="text-[var(--color-tenue)]">Preguntando…</p>;
  }
  if (estado.fase === "sin-red") {
    return (
      <p className="text-[var(--color-tenue)]">
        Sin conexión con el servidor. La app abre igual: lo que ya viste sigue disponible.
      </p>
    );
  }
  const { salud } = estado;
  return (
    <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-sm">
      <Fila termino="Servicio" valor={salud.ok ? "en marcha" : "degradado"} bien={salud.ok} />
      <Fila termino="Base de datos" valor={salud.db} bien={salud.db === "up"} />
      <Fila termino="Esquema" valor={salud.schema} bien={salud.schema === "ready"} />
      <Fila termino="Versión" valor={salud.version} bien />
    </dl>
  );
}

function Fila({ termino, valor, bien }: { termino: string; valor: string; bien: boolean }) {
  return (
    <>
      <dt className="text-[var(--color-tenue)]">{termino}</dt>
      <dd className={bien ? "text-[var(--color-acento)]" : "text-amber-300"}>{valor}</dd>
    </>
  );
}
