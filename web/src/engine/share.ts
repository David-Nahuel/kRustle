/**
 * Equipos compartidos por enlace. El nombre y el paste van comprimidos en el fragmento de la URL
 * (lo que va tras `#`), que el navegador no envía al servidor: no hace falta backend y nadie más
 * que quien abre el enlace ve el equipo.
 */

export interface SharedTeam {
  name: string;
  paste: string;
}

/** Versión del formato, para poder cambiarlo sin romper los enlaces ya compartidos. */
const PREFIX = 't1.';

/** Un paste de 6 Pokémon ocupa ~1,5 KB: con esto sobra, y un enlace malicioso no se expande sin fin. */
const MAX_BYTES = 64 * 1024;

export async function encodeTeam(team: SharedTeam): Promise<string> {
  const json = JSON.stringify([team.name, team.paste]);
  const bytes = await pipe(new TextEncoder().encode(json), new CompressionStream('deflate-raw'));
  return PREFIX + toBase64Url(bytes);
}

/** Si el fragmento es de un enlace de equipo (aunque luego no se pueda leer). */
export function isTeamFragment(fragment: string | null | undefined): fragment is string {
  return !!fragment?.startsWith(PREFIX);
}

/** El equipo de un fragmento de URL, o `null` si no es un enlace de equipo válido. */
export async function decodeTeam(fragment: string | null | undefined): Promise<SharedTeam | null> {
  if (!isTeamFragment(fragment)) return null;
  try {
    const bytes = await pipe(
      fromBase64Url(fragment.slice(PREFIX.length)),
      new DecompressionStream('deflate-raw'),
    );
    const data: unknown = JSON.parse(new TextDecoder().decode(bytes));
    if (!Array.isArray(data) || data.length !== 2) return null;
    const [name, paste] = data;
    if (typeof name !== 'string' || typeof paste !== 'string' || !paste.trim()) return null;
    return { name, paste };
  } catch {
    return null;
  }
}

/** Pasa los bytes por el (des)compresor, sin dejarle producir más de `MAX_BYTES`. */
async function pipe(
  bytes: Uint8Array,
  transform: CompressionStream | DecompressionStream,
): Promise<Uint8Array> {
  const input = new ReadableStream<BufferSource>({
    start(controller) {
      controller.enqueue(bytes as Uint8Array<ArrayBuffer>);
      controller.close();
    },
  });
  const reader = input.pipeThrough(transform).getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.length;
    if (size > MAX_BYTES) {
      await reader.cancel();
      throw new Error('too large');
    }
    chunks.push(value);
  }
  const out = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.length;
  }
  return out;
}

function toBase64Url(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromBase64Url(text: string): Uint8Array {
  const binary = atob(text.replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from(binary, (c) => c.charCodeAt(0));
}
