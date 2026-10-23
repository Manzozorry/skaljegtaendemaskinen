#!/usr/bin/env node
// Henter dagens og morgendagens elpriser, nettariffer og afgifter fra
// Energi Data Service (Energinet) og skriver:
//   site/data/latest.json   – data til siden
//   site/data/historik.json – hvad hver maskine har sparet siden start
//   site/cal/<netselskab>-<maskine>.ics – kalenderabonnementer
//
// Kør:  node scripts/update.mjs
// Test: node scripts/update.mjs --fixtures test/fixtures --nu 2026-10-23T19:40:00Z

import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  lokal, plusDage, klokken, kr, totalpriser, aftenvindue, KVARTER
} from '../site/beregn.js';

const ROD = join(dirname(fileURLToPath(import.meta.url)), '..');
const SITE = join(ROD, 'site');
const API = 'https://api.energidataservice.dk/dataset/';
const ENERGINET_GLN = '5790000432752';
const DOMAENE = 'skaljegtaendemaskinen';
const ADRESSE = 'https://www.skaljegtaendemaskinen.fun/';

const arg = (navn) => {
  const i = process.argv.indexOf(navn);
  return i > -1 ? process.argv[i + 1] : null;
};
const FIXTURES = arg('--fixtures');
const NU = arg('--nu') ? Date.parse(arg('--nu')) : Date.now();

async function hent(dataset, params, fixtur) {
  if (FIXTURES) {
    return JSON.parse(await readFile(join(ROD, FIXTURES, fixtur + '.json'), 'utf8')).records;
  }
  const url = API + dataset + '?' + new URLSearchParams(params);
  for (let forsoeg = 1; ; forsoeg++) {
    try {
      const svar = await fetch(url, {
        headers: { 'User-Agent': `${DOMAENE} (github.com/Manzozorry/${DOMAENE})` }
      });
      if (!svar.ok) throw new Error(`${svar.status} ${svar.statusText}`);
      return (await svar.json()).records ?? [];
    } catch (fejl) {
      if (forsoeg >= 4) throw new Error(`${dataset}: ${fejl.message}`);
      await new Promise((r) => setTimeout(r, 3000 * forsoeg));
    }
  }
}

// Den nyeste post, der gælder på datoen.
function gyldig(poster, dato) {
  return poster
    .filter((p) => p.ValidFrom.slice(0, 10) <= dato && (!p.ValidTo || p.ValidTo.slice(0, 10) > dato))
    .sort((a, b) => b.ValidFrom.localeCompare(a.ValidFrom))[0] ?? null;
}

const somUTC = (s) => Date.parse(/Z|[+-]\d\d:\d\d$/.test(s) ? s : s + 'Z');
const rund = (x, d) => Math.round(x * 10 ** d) / 10 ** d;

async function main() {
  const idag = lokal(NU).dato;
  const datoer = [plusDage(idag, -1), idag, plusDage(idag, 1)];

  // 1. Spotpriser (DKK/MWh pr. kvarter) for DK1 og DK2
  const spot = await hent('DayAheadPrices', {
    start: plusDage(idag, -2),
    end: plusDage(idag, 3),
    filter: JSON.stringify({ PriceArea: ['DK1', 'DK2'] }),
    columns: 'TimeUTC,PriceArea,DayAheadPriceDKK',
    sort: 'TimeUTC asc',
    limit: '5000'
  }, 'spot');

  const omraader = {};
  for (const omr of ['DK1', 'DK2']) {
    const raekker = spot
      .filter((r) => r.PriceArea === omr && r.DayAheadPriceDKK != null)
      .map((r) => ({ t: somUTC(r.TimeUTC), p: r.DayAheadPriceDKK / 1000 }))
      .filter((r) => datoer.includes(lokal(r.t).dato))
      .sort((a, b) => a.t - b.t);
    const kvarter = [];
    let start = null;
    for (const r of raekker) {
      if (start === null) { start = r.t; kvarter.push(r.p); continue; }
      const forventet = start + kvarter.length * KVARTER;
      if (r.t < forventet) continue;
      if (r.t > forventet) break;
      kvarter.push(r.p);
    }
    if (kvarter.length) {
      omraader[omr] = { start: new Date(start).toISOString(), kvarter: kvarter.map((p) => rund(p, 5)) };
    }
  }
  if (!omraader.DK1 || !omraader.DK2) throw new Error('Mangler spotpriser for DK1 eller DK2');

  // 2. Elafgift og Energinets tariffer (kr./kWh ekskl. moms)
  const fasteRaa = await hent('DatahubPricelist', {
    filter: JSON.stringify({
      GLN_Number: [ENERGINET_GLN],
      ChargeType: ['D03'],
      Note: ['Elafgift', 'Systemtarif', 'Transmissions nettarif']
    }),
    sort: 'ValidFrom desc',
    limit: '200'
  }, 'faste');
  const noegler = { 'Elafgift': 'elafgift', 'Systemtarif': 'systemtarif', 'Transmissions nettarif': 'transmission' };
  const faste = {};
  for (const d of datoer) {
    const f = {};
    for (const [note, noegle] of Object.entries(noegler)) {
      const p = gyldig(fasteRaa.filter((x) => x.Note === note), d);
      if (p) f[noegle] = p.Price1;
    }
    if (Object.keys(f).length === 3) faste[d] = f;
  }
  if (!faste[idag]) throw new Error('Mangler afgifter for i dag');

  // 3. Nettarif C pr. netselskab (24 timepriser pr. dato)
  const konfig = JSON.parse(await readFile(join(ROD, 'scripts/netselskaber.json'), 'utf8'));
  const netselskaber = [];
  for (const ns of konfig) {
    let raa;
    try {
      raa = await hent('DatahubPricelist', {
        filter: JSON.stringify({ GLN_Number: [ns.gln], ChargeTypeCode: ns.koder, ChargeType: ['D03'] }),
        sort: 'ValidFrom desc',
        limit: '300'
      }, 'tarif-' + ns.id);
    } catch (fejl) {
      console.warn(`Springer ${ns.navn} over: ${fejl.message}`);
      continue;
    }
    const tarif = {};
    for (const d of datoer) {
      const timer = new Array(24).fill(0);
      let fundet = 0;
      for (const kode of ns.koder) {
        const p = gyldig(raa.filter((x) => x.ChargeTypeCode === kode), d);
        if (!p) continue;
        fundet++;
        for (let h = 0; h < 24; h++) timer[h] += p['Price' + (h + 1)] ?? p.Price1;
      }
      if (fundet) tarif[d] = timer.map((v) => rund(v, 6));
    }
    const t = tarif[idag];
    if (!t) {
      console.warn(`Ingen gyldig tarif i dag for ${ns.navn}, springer over`);
    } else if (!(t[2] < t[8] && t[8] < t[18])) {
      // Alle netselskaber skal bruge tidstarif (lav om natten, højest kl. 17-21).
      // Ser tariffen anderledes ud, peger tarifkoden sandsynligvis på en forkert
      // eller forældet tarif, og så er et forkert svar værre end intet svar.
      console.warn(`Tariffen for ${ns.navn} ligner ikke en tidstarif (${t[2]}/${t[8]}/${t[18]}), springer over`);
    } else {
      netselskaber.push({ id: ns.id, navn: ns.navn, omraade: ns.omraade, tarif });
    }
  }
  if (!netselskaber.length) throw new Error('Fandt ingen nettariffer');

  // Gennemsnit pr. prisområde for dem, der ikke kender deres netselskab
  const gennemsnit = [];
  for (const [omr, id, da, en] of [
    ['DK2', 'dk2-snit', 'Øst for Storebælt (gennemsnit)', 'Zealand and Copenhagen (average)'],
    ['DK1', 'dk1-snit', 'Vest for Storebælt (gennemsnit)', 'Jutland and Funen (average)']
  ]) {
    const gruppe = netselskaber.filter((n) => n.omraade === omr);
    if (!gruppe.length) continue;
    const tarif = {};
    for (const d of datoer) {
      const med = gruppe.filter((n) => n.tarif[d]);
      if (!med.length) continue;
      tarif[d] = Array.from({ length: 24 }, (_, h) =>
        rund(med.reduce((s, n) => s + n.tarif[d][h], 0) / med.length, 6));
    }
    gennemsnit.push({ id, navn: da, navne: { da, en }, omraade: omr, snit: true, antal: gruppe.length, tarif });
  }
  netselskaber.unshift(...gennemsnit);

  const data = {
    opdateret: new Date(NU).toISOString(),
    kilde: 'Energi Data Service (Energinet): DayAheadPrices og DatahubPricelist',
    omraader,
    faste,
    netselskaber
  };

  await mkdir(join(SITE, 'data'), { recursive: true });
  await mkdir(join(SITE, 'cal', 'en'), { recursive: true });
  await writeFile(join(SITE, 'data/latest.json'), JSON.stringify(data));

  // 4. Kalendere og "sparet siden" (begge bruger maskinens standardprogram)
  const maskiner = JSON.parse(await readFile(join(SITE, 'maskiner.json'), 'utf8'))
    .map((m) => ({ ...m, ...standardProgram(m) }));
  const historikSti = join(SITE, 'data/historik.json');
  let historik;
  try {
    historik = JSON.parse(await readFile(historikSti, 'utf8'));
  } catch {
    historik = null;
  }
  historik = tilHistorikV2(historik);

  let kalendere = 0;
  for (const ns of netselskaber) {
    const priser = totalpriser(data, ns.id);
    historik.senest[ns.id] ??= {};
    historik.sum[ns.id] ??= {};

    for (const m of maskiner) {
      const begivenheder = [];
      for (const d of datoer) {
        const v = aftenvindue(priser, d, m.kvarterer);
        if (v) begivenheder.push({ dato: d, ...v });
      }
      await writeFile(join(SITE, 'cal', `${ns.id}-${m.id}.ics`), kalender(ns, m, begivenheder, 'da'));
      await writeFile(join(SITE, 'cal', 'en', `${ns.id}-${m.id}.ics`), kalender(ns, m, begivenheder, 'en'));
      kalendere += 2;

      // Læg hver aftens besparelse til én gang pr. dato
      for (const d of datoer) {
        const senest = historik.senest[ns.id][m.id];
        if (senest && senest >= d) continue;
        const v = aftenvindue(priser, d, m.kvarterer);
        if (!v) continue;
        historik.sum[ns.id][m.id] = rund((historik.sum[ns.id][m.id] ?? 0) + (v.naiv - v.snit) * m.kwh, 4);
        historik.senest[ns.id][m.id] = d;
        if (!historik.siden[m.id] || historik.siden[m.id] > d) historik.siden[m.id] = d;
      }
    }
  }
  await writeFile(historikSti, JSON.stringify(historik, null, 1));

  const kvarterer = Object.fromEntries(Object.entries(omraader).map(([k, v]) => [k, v.kvarter.length]));
  console.log(`OK: ${netselskaber.length} netselskaber, kvarterer ${JSON.stringify(kvarterer)}, ${kalendere} kalendere`);
}

// Maskinens standardprogram (bruges til kalendere og "sparet siden")
function standardProgram(m) {
  const p = m.programmer.find((x) => x.id === m.standard) || m.programmer[0];
  return { kvarterer: p.kvarterer, kwh: p.kwh };
}

// Første version gemte kun opvaskeren: { siden, senest: {ns: dato}, sum: {ns: kr} }
function tilHistorikV2(h) {
  if (h && h.v === 2) return h;
  const ny = { v: 2, siden: {}, senest: {}, sum: {} };
  if (h && h.siden) {
    ny.siden.opvasker = h.siden;
    for (const [ns, dato] of Object.entries(h.senest || {})) ny.senest[ns] = { opvasker: dato };
    for (const [ns, kr] of Object.entries(h.sum || {})) ny.sum[ns] = { opvasker: kr };
  }
  return ny;
}

// --- iCalendar ---

function tekst(s) {
  return s.replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\n/g, '\\n');
}

// Folder linjer til højst 75 bytes (RFC 5545), uden at dele tegn.
function fold(linje) {
  const ud = [];
  let del = '';
  let bytes = 0;
  for (const tegn of linje) {
    const b = Buffer.byteLength(tegn);
    if (bytes + b > (ud.length ? 74 : 75)) {
      ud.push(del);
      del = '';
      bytes = 0;
    }
    del += tegn;
    bytes += b;
  }
  ud.push(del);
  return ud.join('\r\n ');
}

const icsTid = (ms) => new Date(ms).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');

const KAL = {
  da: {
    beskrivelse: 'Billigste tidspunkt hver aften og nat. skaljegtaendemaskinen.fun',
    billigst: (t, fra, til) => `Billigste ${t} timer: ${fra}–${til}.`,
    sparer: (x) => `Det sparer ${kr(x)} kr. i forhold til at starte kl. 19.`,
    ligesaa: 'Kl. 19 er lige så billigt i aften.',
    app: (fra) => `Sæt ladestart til ${fra} i bilens app.`,
    udskudt: (fra) => `Har maskinen udskudt start, så sæt den til at gå i gang kl. ${fra}.`,
    note: 'Priser inkl. nettarif, afgifter og moms (ekskl. elselskabets tillæg).'
  },
  en: {
    beskrivelse: 'The cheapest time every evening and night. skaljegtaendemaskinen.fun',
    billigst: (t, fra, til) => `Cheapest ${t} hours: ${fra}–${til}.`,
    sparer: (x) => `Saves ${(Math.round(x * 100) / 100).toFixed(2)} kr compared to starting at 7 pm.`,
    ligesaa: '7 pm is just as cheap tonight.',
    app: (fra) => `Set charging to start at ${fra} in the car app.`,
    udskudt: (fra) => `If the machine has delay start, set it to start at ${fra}.`,
    note: 'Prices include grid tariff, taxes and VAT (excluding your supplier’s markup).'
  }
};

function kalender(ns, m, begivenheder, sprog) {
  const timer = m.kvarterer / 4;
  const k = KAL[sprog];
  const navn = m[sprog].kalender;
  const nsNavn = ns.navne ? ns.navne[sprog] : ns.navn;
  const linjer = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    `PRODID:-//${DOMAENE}//${sprog.toUpperCase()}`,
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    `X-WR-CALNAME:${tekst(`${navn} · ${nsNavn}`)}`,
    `X-WR-CALDESC:${tekst(k.beskrivelse)}`,
    'X-WR-TIMEZONE:Europe/Copenhagen',
    'REFRESH-INTERVAL;VALUE=DURATION:PT4H',
    'X-PUBLISHED-TTL:PT4H'
  ];
  for (const b of begivenheder) {
    const spar = (b.naiv - b.snit) * m.kwh;
    const beskrivelse = [
      k.billigst(timer, klokken(b.start), klokken(b.slut)),
      spar >= 0.005 ? k.sparer(spar) : k.ligesaa,
      m.styring === 'app' ? k.app(klokken(b.start)) : k.udskudt(klokken(b.start)),
      k.note
    ].join('\n');
    linjer.push(
      'BEGIN:VEVENT',
      `UID:${b.dato}-${ns.id}-${m.id}-${sprog}@${DOMAENE}`,
      `DTSTAMP:${icsTid(NU)}`,
      `DTSTART:${icsTid(b.start)}`,
      `DTEND:${icsTid(b.slut)}`,
      `SUMMARY:${tekst(navn)}`,
      `DESCRIPTION:${tekst(beskrivelse)}`,
      `URL:${ADRESSE}`,
      'TRANSP:TRANSPARENT',
      'END:VEVENT'
    );
  }
  linjer.push('END:VCALENDAR');
  return linjer.map(fold).join('\r\n') + '\r\n';
}

main().catch((fejl) => {
  console.error('Fejl:', fejl.message);
  process.exit(1);
});
