/** Matches an http(s) URL span: from the scheme to the next whitespace. */
export const URL_SPAN = /https?:\/\/\S+/g;

function packParts(parts: string[], sep: string, max: number): string[] {
  const out: string[] = [];
  let cur = "";
  for (const p of parts) {
    if (!p) continue;
    if (p.length > max) {
      if (cur) out.push(cur);
      cur = "";
      out.push(...hardCut(p, max));
    } else if (!cur) cur = p;
    else if (cur.length + sep.length + p.length <= max) cur += sep + p;
    else {
      out.push(cur);
      cur = p;
    }
  }
  if (cur) out.push(cur);
  return out;
}

function hardCut(text: string, max: number): string[] {
  const out: string[] = [];
  let rest = text;
  while (rest.length > max) {
    let cut = -1;
    for (let i = max; i > 0; i--) {
      if (/\s/.test(rest[i] ?? "")) {
        cut = i;
        break;
      }
    }
    if (cut <= 0) {
      cut = max;
      for (const m of rest.matchAll(URL_SPAN)) {
        const end = m.index + m[0].length;
        if (m.index < cut && end > cut && m[0].length <= max && m.index > 0) {
          cut = m.index;
        }
      }
    }
    out.push(rest.slice(0, cut).trimEnd());
    rest = rest.slice(cut).trimStart();
  }
  if (rest) out.push(rest);
  return out;
}

/** Splits on paragraphs, then sentences, then hard cuts. Keeps fitting URLs whole. */
export function splitText(text: string, max: number): string[] {
  if (text.length <= max) return [text];
  const paragraphs = text.split(/\n{2,}/);
  const out: string[] = [];
  let cur = "";
  const flush = () => {
    if (cur) out.push(cur);
    cur = "";
  };
  for (const para of paragraphs) {
    if (para.length > max) {
      flush();
      const sentences = para.split(/(?<=[.!?])\s+/);
      out.push(...packParts(sentences, " ", max));
    } else if (!cur) cur = para;
    else if (cur.length + 2 + para.length <= max) cur += "\n\n" + para;
    else {
      flush();
      cur = para;
    }
  }
  flush();
  return out;
}
