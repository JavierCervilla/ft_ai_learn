import { useCallback, useEffect, useState } from "react";
import { ErrorApi, type Sesion, sesionActual, SIN_RED } from "./api.ts";
import { Acceso } from "./Acceso.tsx";
import { Cuenta } from "./Cuenta.tsx";

/**
 * Quién ve qué.
 *
 * Sin router: son dos pantallas y una pregunta al servidor. `react-router` sería una dependencia,
 * un bundle mayor y un modelo mental más para resolver un `if` — y la spec §6.2 dice que el cliente
 * es un bundle estático que hay que poder empaquetar para tiendas. Cuando el grafo traiga rutas de
 * verdad (un nodo por URL, compartible) se añadirá con un motivo, no por costumbre.
 *
 * `cargando` existe como estado propio para no pintar el formulario de acceso durante el parpadeo
 * inicial: quien ya tiene sesión no debería ver un login que desaparece.
 *
 * **`sinRed` existe por la misma razón, llevada hasta el final.** No saber quién eres porque no hay
 * cobertura no es lo mismo que saber que no eres nadie, y confundirlos le enseñaba la pantalla de
 * acceso a quien tenía la sesión viva (F3/A9 de `qa-adversario`). Un estado que la app no puede
 * distinguir es un estado sobre el que va a mentir.
 */
type Estado =
  | { fase: "cargando" }
  | { fase: "sinRed" }
  | { fase: "fuera" }
  | { fase: "dentro"; sesion: Sesion };

export function App() {
  const [estado, setEstado] = useState<Estado>({ fase: "cargando" });

  const preguntar = useCallback(async (): Promise<Estado> => {
    try {
      const s = await sesionActual();
      return s ? { fase: "dentro", sesion: s } : { fase: "fuera" };
    } catch (fallo) {
      if (fallo instanceof ErrorApi && fallo.estado === SIN_RED) return { fase: "sinRed" };
      return { fase: "fuera" };
    }
  }, []);

  useEffect(() => {
    let vivo = true;
    preguntar().then((e) => vivo && setEstado(e));
    return () => {
      vivo = false;
    };
  }, [preguntar]);

  /**
   * Al volver a la pestaña, se vuelve a preguntar quién eres.
   *
   * La cookie es del navegador entero: si en otra pestaña alguien sale y entra con su cuenta, ésta
   * seguía pintando al anterior indefinidamente. Ver el comentario de `recargar` en `Cuenta.tsx` —
   * allí está el daño concreto, que no es cosmético.
   */
  useEffect(() => {
    const alVolver = () => {
      if (document.visibilityState !== "visible") return;
      preguntar().then(setEstado);
    };
    document.addEventListener("visibilitychange", alVolver);
    globalThis.addEventListener("focus", alVolver);
    return () => {
      document.removeEventListener("visibilitychange", alVolver);
      globalThis.removeEventListener("focus", alVolver);
    };
  }, [preguntar]);

  if (estado.fase === "cargando") {
    return (
      <main className="flex min-h-full items-center justify-center">
        <p className="text-[var(--color-tenue)]">…</p>
      </main>
    );
  }

  if (estado.fase === "sinRed") {
    return (
      <main className="mx-auto flex min-h-full w-full max-w-md flex-col justify-center gap-4 px-6 text-center">
        <h1 className="font-[family-name:var(--font-display)] text-3xl">Sin conexión</h1>
        <p className="text-[var(--color-tenue)]">
          No se pudo comprobar tu sesión. No has salido: vuelve a intentarlo cuando tengas cobertura.
        </p>
        <button
          type="button"
          onClick={() => {
            setEstado({ fase: "cargando" });
            preguntar().then(setEstado);
          }}
          className="mx-auto rounded-md border border-[var(--color-acento)] px-4 py-3 text-[var(--color-acento)]"
        >
          Reintentar
        </button>
      </main>
    );
  }

  if (estado.fase === "fuera") {
    return <Acceso alEntrar={(sesion) => setEstado({ fase: "dentro", sesion })} />;
  }

  return (
    <Cuenta
      sesion={estado.sesion}
      alSalir={() => setEstado({ fase: "fuera" })}
      alCambiarSesion={(s) => setEstado(s ? { fase: "dentro", sesion: s } : { fase: "fuera" })}
    />
  );
}
