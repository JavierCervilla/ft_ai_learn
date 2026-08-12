#!/usr/bin/env node
/**
 * Genera los iconos PNG de la PWA.
 *
 * Se dibujan aquí, con `zlib` y nada más, por dos razones: el manifiesto tiene que **servir los
 * iconos que declara** (criterio V5 — un manifiesto que apunta a ficheros que no existen es un JSON
 * decorativo), y meter una dependencia de imagen para pintar tres círculos y dos líneas sería pagar
 * un árbol de node_modules por un glifo.
 *
 * El dibujo es el propio producto: tres nodos encadenados, que es lo que hace la app.
 *
 * Uso: node scripts/generar-iconos.mjs [dir-destino]
 */
import { deflateSync } from "node:zlib";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const FONDO = [0x0b, 0x10, 0x20];
const NODO = [0x7d, 0xd3, 0xfc];
const ARISTA = [0x38, 0xbd, 0xf8];

/** CRC32, que es lo único que PNG exige y `zlib` no da hecho. */
const TABLA_CRC = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (const b of buf) c = TABLA_CRC[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(tipo, datos) {
  const largo = Buffer.alloc(4);
  largo.writeUInt32BE(datos.length);
  const cuerpo = Buffer.concat([Buffer.from(tipo, "ascii"), datos]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(cuerpo));
  return Buffer.concat([largo, cuerpo, crc]);
}

function png(ancho, alto, pixeles) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(ancho, 0);
  ihdr.writeUInt32BE(alto, 4);
  ihdr[8] = 8; // profundidad
  ihdr[9] = 2; // color: RGB
  // filtro 0 por fila: el peso no importa a este tamaño y así el fichero es reproducible byte a byte.
  const filas = [];
  for (let y = 0; y < alto; y++) {
    filas.push(Buffer.from([0]), pixeles.subarray(y * ancho * 3, (y + 1) * ancho * 3));
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(Buffer.concat(filas), { level: 9 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

/** Distancia de un punto al segmento ab: para pintar las aristas con grosor. */
function distanciaASegmento(px, py, ax, ay, bx, by) {
  const dx = bx - ax, dy = by - ay;
  const largo2 = dx * dx + dy * dy;
  const t = largo2 === 0 ? 0 : Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / largo2));
  const cx = ax + t * dx, cy = ay + t * dy;
  return Math.hypot(px - cx, py - cy);
}

/**
 * @param {number} lado  tamaño en px
 * @param {number} zonaSegura  fracción del lienzo que ocupa el glifo (0.62 en maskable: los
 *   lanzadores recortan hasta un 20% por lado, así que el dibujo tiene que caber en el centro).
 */
function dibujar(lado, zonaSegura) {
  const px = Buffer.alloc(lado * lado * 3);
  const c = lado / 2;
  const r = (lado * zonaSegura) / 2;
  // Tres nodos en cadena, en diagonal: el grafo que la app recorre.
  const nodos = [
    [c - r * 0.72, c + r * 0.62],
    [c, c - r * 0.1],
    [c + r * 0.72, c - r * 0.78],
  ];
  const radioNodo = lado * 0.085;
  const grosorArista = Math.max(1, lado * 0.032);

  for (let y = 0; y < lado; y++) {
    for (let x = 0; x < lado; x++) {
      let color = FONDO;
      for (let i = 0; i + 1 < nodos.length; i++) {
        const [ax, ay] = nodos[i], [bx, by] = nodos[i + 1];
        if (distanciaASegmento(x + 0.5, y + 0.5, ax, ay, bx, by) <= grosorArista / 2) color = ARISTA;
      }
      for (const [nx, ny] of nodos) {
        if (Math.hypot(x + 0.5 - nx, y + 0.5 - ny) <= radioNodo) color = NODO;
      }
      const o = (y * lado + x) * 3;
      px[o] = color[0];
      px[o + 1] = color[1];
      px[o + 2] = color[2];
    }
  }
  return png(lado, lado, px);
}

const destino = process.argv[2] ?? join(process.cwd(), "public", "icons");
mkdirSync(destino, { recursive: true });

const salidas = [
  ["icon-192.png", 192, 0.78],
  ["icon-512.png", 512, 0.78],
  ["icon-maskable-512.png", 512, 0.62],
];
for (const [nombre, lado, zona] of salidas) {
  writeFileSync(join(destino, nombre), dibujar(lado, zona));
  console.log(`  ✓ ${nombre} (${lado}×${lado})`);
}
