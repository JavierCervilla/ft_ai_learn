import { type FormEvent, useState } from "react";
import { entrar, ErrorApi, registrarse, type Sesion } from "./api.ts";

/**
 * La entrada al mapa.
 *
 * Dos modos en la misma pantalla —entrar y unirse— porque son el mismo gesto con un campo más, y
 * partirlos en dos rutas obligaría a un router para un `if`.
 *
 * **El error se enseña tal cual lo manda el servidor.** No se traduce por código de estado ni se
 * "mejora": el 403 del alta es deliberadamente el mismo para un código inválido, uno ya usado y uno
 * que no es tuyo, y adivinar cuál fue sería regalar el oráculo de pertenencia que la API cierra.
 */

type Modo = "entrar" | "unirse";

export function Acceso({ alEntrar }: { alEntrar: (s: Sesion) => void }) {
  const [modo, setModo] = useState<Modo>("entrar");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [inviteCode, setInviteCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);

  const enviar = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    setEnviando(true);
    try {
      // `trim()` en correo y código, y **no** en la contraseña: un espacio ahí puede ser parte de la
      // clave y recortarlo cambiaría el secreto de la persona. El código sí se recorta porque copiarlo
      // desde un chat —o desde el propio `<code>` de la pantalla, que además avisa de que no se vuelve
      // a mostrar— arrastra un espacio final, y el servidor rechaza con el mismo 403 indistinguible
      // que un código inventado. Es decir: la invitación buena en la mano y ni una pista de por qué no
      // entra. El no-oráculo del servidor está bien; lo que fallaba era mandarle algo que la persona
      // no quiso escribir (F7/A2 de `qa-adversario`).
      const sesion = modo === "entrar"
        ? await entrar({ email: email.trim(), password })
        : await registrarse({
          email: email.trim(),
          name: name.trim(),
          password,
          inviteCode: inviteCode.trim(),
        });
      alEntrar(sesion);
    } catch (fallo) {
      setError(fallo instanceof ErrorApi ? fallo.message : "No se pudo completar la operación.");
    } finally {
      setEnviando(false);
    }
  };

  return (
    <main className="mx-auto flex min-h-full w-full max-w-md flex-col justify-center gap-8 px-6 py-12">
      <header className="flex flex-col gap-3">
        <h1 className="font-[family-name:var(--font-display)] text-5xl leading-none tracking-tight">
          Holy Graph<span className="text-[var(--color-acento)]">.</span>
        </h1>
        <p className="text-[var(--color-tenue)]">
          Un mapa de competencias de IA que se ilumina conforme lo recorres. Entrada sólo por
          invitación.
        </p>
      </header>

      <form onSubmit={enviar} className="flex flex-col gap-4" noValidate>
        <Campo
          etiqueta="Correo"
          type="email"
          value={email}
          onChange={setEmail}
          autoComplete="email"
          required
        />

        {modo === "unirse" && (
          <Campo etiqueta="Nombre" value={name} onChange={setName} autoComplete="name" required />
        )}

        <Campo
          etiqueta="Contraseña"
          type="password"
          value={password}
          onChange={setPassword}
          autoComplete={modo === "entrar" ? "current-password" : "new-password"}
          required
        />

        {modo === "unirse" && (
          <Campo
            etiqueta="Código de invitación"
            value={inviteCode}
            onChange={setInviteCode}
            mono
            required
          />
        )}

        {error && (
          <p
            role="alert"
            className="border-l-2 border-[var(--color-alerta)] pl-3 text-sm text-[var(--color-alerta)]"
          >
            {error}
          </p>
        )}

        <button
          type="submit"
          disabled={enviando}
          className="mt-2 rounded-md bg-[var(--color-acento)] px-4 py-3 font-medium text-[var(--color-fondo)] transition-opacity duration-[var(--duracion-toque)] disabled:opacity-60"
        >
          {enviando ? "…" : modo === "entrar" ? "Entrar" : "Unirse"}
        </button>
      </form>

      <p className="text-sm text-[var(--color-tenue)]">
        {modo === "entrar" ? "¿Tienes una invitación? " : "¿Ya tienes cuenta? "}
        <button
          type="button"
          onClick={() => {
            setModo(modo === "entrar" ? "unirse" : "entrar");
            setError(null);
          }}
          className="text-[var(--color-acento)] underline underline-offset-4"
        >
          {modo === "entrar" ? "Únete" : "Entra"}
        </button>
      </p>
    </main>
  );
}

function Campo({
  etiqueta,
  value,
  onChange,
  mono = false,
  ...resto
}: {
  etiqueta: string;
  value: string;
  onChange: (v: string) => void;
  mono?: boolean;
  type?: string;
  autoComplete?: string;
  required?: boolean;
}) {
  return (
    <label className="flex flex-col gap-1.5">
      <span className="text-sm text-[var(--color-tenue)]">{etiqueta}</span>
      <input
        {...resto}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className={`rounded-md border border-[var(--color-borde)] bg-[var(--color-panel)] px-3 py-2.5 text-[var(--color-tinta)] outline-none focus:border-[var(--color-acento)] ${
          mono ? "font-[family-name:var(--font-mono)] tracking-tight" : ""
        }`}
      />
    </label>
  );
}
