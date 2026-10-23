// Fælles beregninger for siden (browser) og opdateringsscriptet (Node).
// Ingen afhængigheder, så samme fil kan importeres begge steder.

export const TZ = 'Europe/Copenhagen';
export const KVARTER = 15 * 60 * 1000;
export const MOMS = 0.25;

const formatter = new Intl.DateTimeFormat('en-CA', {
  timeZone: TZ,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23'
});

const cache = new Map();

// Dansk lokal dato og klokkeslæt for et tidspunkt (ms siden 1970, UTC).
export function lokal(ms) {
  let v = cache.get(ms);
  if (v) return v;
  const p = {};
  for (const { type, value } of formatter.formatToParts(new Date(ms))) p[type] = value;
  v = { dato: `${p.year}-${p.month}-${p.day}`, time: Number(p.hour) % 24, minut: Number(p.minute) };
  if (cache.size > 5000) cache.clear();
  cache.set(ms, v);
  return v;
}

const to = (n) => String(n).padStart(2, '0');

export function klokken(ms) {
  const l = lokal(ms);
  return `${to(l.time)}:${to(l.minut)}`;
}

export function plusDage(dato, n) {
  const [y, m, d] = dato.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
}

export function kr(x) {
  return (Math.round(x * 100) / 100).toFixed(2).replace('.', ',').replace('-0,00', '0,00');
}

// Samlet pris pr. kvarter for et netselskab, i kr./kWh inkl. moms:
// spotpris + nettarif (efter time på døgnet) + elafgift + Energinets tariffer.
// Elselskabets eget tillæg og abonnementer er ikke med.
// Med { fast: true } (fast elpris) tælles spotprisen ikke med, kun det der svinger.
export function totalpriser(data, netselskabId, { fast = false } = {}) {
  const ns = data.netselskaber.find((n) => n.id === netselskabId);
  if (!ns) return [];
  const omr = data.omraader[ns.omraade];
  if (!omr) return [];
  const start = Date.parse(omr.start);
  const ud = [];
  for (let i = 0; i < omr.kvarter.length; i++) {
    const t = start + i * KVARTER;
    const l = lokal(t);
    const tarif = ns.tarif[l.dato];
    const faste = data.faste[l.dato];
    if (!tarif || !faste) continue;
    const spot = fast ? 0 : omr.kvarter[i];
    const afgifter = faste.elafgift + faste.systemtarif + faste.transmission;
    ud.push({ t, spot, pris: (spot + tarif[l.time] + afgifter) * (1 + MOMS) });
  }
  return ud;
}

// Gennemsnitspris for n sammenhængende kvarterer fra indeks i, eller null.
export function snit(priser, i, n) {
  if (i < 0 || i + n > priser.length) return null;
  if (priser[i + n - 1].t - priser[i].t !== (n - 1) * KVARTER) return null;
  let sum = 0;
  for (let k = i; k < i + n; k++) sum += priser[k].pris;
  return sum / n;
}

// Billigste sammenhængende vindue på n kvarterer med start i [fra, til).
// Ved lige priser vinder det tidligste.
export function bedsteVindue(priser, n, fra = -Infinity, til = Infinity) {
  let bedst = null;
  for (let i = 0; i + n <= priser.length; i++) {
    const s = priser[i].t;
    if (s < fra || s >= til) continue;
    const g = snit(priser, i, n);
    if (g === null) continue;
    if (!bedst || g < bedst.snit - 1e-9) bedst = { i, start: s, slut: s + n * KVARTER, snit: g };
  }
  return bedst;
}

// Indeks for kvarteret, der indeholder tidspunktet ms, eller -1.
export function indeksVed(priser, ms) {
  for (let i = 0; i < priser.length; i++) {
    if (priser[i].t <= ms && ms < priser[i].t + KVARTER) return i;
  }
  return -1;
}

// Første kvarter på en given lokal dato og time (håndterer sommertid).
export function tidspunkt(priser, dato, time) {
  for (const p of priser) {
    const l = lokal(p.t);
    if (l.dato === dato && l.time === time && l.minut === 0) return p.t;
  }
  return null;
}

// "Aftenvinduet" for en dato: start mellem kl. 19 og kl. 17 dagen efter,
// færdig senest kl. 17. Bruges til kalenderen og til "sparet siden".
export function aftenvindue(priser, dato, n) {
  const fra = tidspunkt(priser, dato, 19);
  const slut = tidspunkt(priser, plusDage(dato, 1), 17);
  if (fra === null || slut === null) return null;
  const bedst = bedsteVindue(priser, n, fra, slut - n * KVARTER + 1);
  const i19 = indeksVed(priser, fra);
  const naiv = snit(priser, i19, n);
  if (!bedst || naiv === null) return null;
  return { ...bedst, naiv };
}
