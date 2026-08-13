import { useEffect, useState } from "react";
import { type Sesion, sesionActual } from "./api.ts";
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
 */
type Estado =
  | { fase: "cargando" }
  | { fase: "fuera" }
  | { fase: "dentro"; sesion: Sesion };

export function App() {
  const [estado, setEstado] = useState<Estado>({ fase: "cargando" });

  useEffect(() => {
    let vivo = true;
    sesionActual().then((s) => {
      if (!vivo) return;
      setEstado(s ? { fase: "dentro", sesion: s } : { fase: "fuera" });
    });
    return () => {
      vivo = false;
    };
  }, []);

  if (estado.fase === "cargando") {
    return (
      <main className="flex min-h-full items-center justify-center">
        <p className="text-[var(--color-tenue)]">…</p>
      </main>
    );
  }

  if (estado.fase === "fuera") {
    return <Acceso alEntrar={(sesion) => setEstado({ fase: "dentro", sesion })} />;
  }

  return <Cuenta sesion={estado.sesion} alSalir={() => setEstado({ fase: "fuera" })} />;
}
