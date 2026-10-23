import {
  lokal, klokken, kr, plusDage, totalpriser, bedsteVindue, snit, indeksVed, KVARTER
} from './beregn.js';

// Indsæt dit Buy Me a Coffee-link her, så dukker kilowatttime-knappen op.
// Fx 'https://buymeacoffee.com/ditnavn'
const KILOWATTTIME_LINK = '';

const $ = (id) => document.getElementById(id);
const gem = {
  hent(k) { try { return localStorage.getItem(k); } catch { return null; } },
  saet(k, v) { try { localStorage.setItem(k, v); } catch { /* privat vindue */ } }
};

let data = null;
let maskiner = [];
let historik = null;
let sidstHentet = 0;
let valgtNet = gem.hent('netselskab');
let valgtMaskine = gem.hent('maskine') || 'opvasker';

const datoKort = new Intl.DateTimeFormat('da-DK', { day: 'numeric', month: 'short', timeZone: 'Europe/Copenhagen' });
const ugedag = new Intl.DateTimeFormat('da-DK', { weekday: 'short', timeZone: 'Europe/Copenhagen' });

async function hentData() {
  const v = Math.floor(Date.now() / (5 * 60 * 1000));
  const [d, m, h] = await Promise.all([
    fetch(`data/latest.json?v=${v}`).then((r) => r.json()),
    fetch('maskiner.json').then((r) => r.json()),
    fetch(`data/historik.json?v=${v}`).then((r) => (r.ok ? r.json() : null)).catch(() => null)
  ]);
  data = d;
  maskiner = m;
  historik = h;
  sidstHentet = Date.now();
}

function byggeValg() {
  const net = $('netselskab');
  net.innerHTML = '';
  for (const [omr, navn] of [['DK2', 'Øst for Storebælt'], ['DK1', 'Vest for Storebælt']]) {
    const gruppe = document.createElement('optgroup');
    gruppe.label = navn;
    for (const ns of data.netselskaber.filter((n) => n.omraade === omr)) {
      gruppe.append(new Option(ns.navn, ns.id));
    }
    if (gruppe.children.length) net.append(gruppe);
  }
  if (!valgtNet || !data.netselskaber.some((n) => n.id === valgtNet)) {
    $('gaet').hidden = false;
    valgtNet = data.netselskaber.some((n) => n.id === 'radius') ? 'radius' : data.netselskaber[0].id;
  }
  net.value = valgtNet;

  const mask = $('maskine');
  mask.innerHTML = '';
  for (const m of maskiner) mask.append(new Option(m.ord, m.id));
  if (!maskiner.some((m) => m.id === valgtMaskine)) valgtMaskine = maskiner[0].id;
  mask.value = valgtMaskine;

  $('antagelser').textContent = 'Antagelser: ' + maskiner
    .map((m) => `${m.navn.toLowerCase()} ${kr(m.kwh).replace(',00', '')} kWh på ${m.kvarterer / 4} t`)
    .join(', ') + '.';
}

// "02:00" i nat, "i morgen kl. 13:00" når det er i morgen i dagtimerne.
function tidTekst(ms, nu) {
  const l = lokal(ms);
  const idag = lokal(nu).dato;
  if (l.dato === idag || (l.dato === plusDage(idag, 1) && l.time < 6)) return klokken(ms);
  if (l.dato === plusDage(idag, 1)) return `i morgen kl. ${klokken(ms)}`;
  return `${ugedag.format(ms)} kl. ${klokken(ms)}`;
}

function saet(id, tekst) { $(id).textContent = tekst; }

function render() {
  if (!data) return;
  const m = maskiner.find((x) => x.id === valgtMaskine) || maskiner[0];
  const n = m.kvarterer;
  const timer = n / 4;
  const nu = Date.now();

  saet('maskineord', m.ord);
  document.title = `Skal jeg tænde ${m.ord}?`;
  saet('opdateret', `${datoKort.format(new Date(data.opdateret))} kl. ${klokken(Date.parse(data.opdateret))}`);

  const alle = totalpriser(data, valgtNet);
  const i0 = indeksVed(alle, nu);
  const priser = i0 >= 0 ? alle.slice(i0) : [];

  $('replik').hidden = !m.replik;
  saet('replik', m.replik || '');

  if (priser.length < n) {
    saet('svar', 'HM.');
    saet('under', 'Det ved jeg ikke endnu.');
    saet('note', 'Morgendagens priser kommer ved 13-tiden. Prøv igen lidt senere.');
    saet('enhedEtiket', 'På maskinen');
    saet('enhedTal', '?');
    saet('enhedTekst', 'Jeg mangler priser langt nok frem.');
    saet('spar', '–');
    saet('sparHale', '');
    tegnGraf(priser, null, n);
    opdaterKalender(m);
    opdaterHistorik();
    return;
  }

  const bedst = bedsteVindue(priser, n);
  const nuSnit = snit(priser, 0, n);
  const spar = Math.max(0, (nuSnit - bedst.snit) * m.kwh);
  const vent = bedst.start - nu;
  const ligegyldigt = spar < 0.05;
  const ja = bedst.i === 0 || vent < 10 * 60 * 1000 || ligegyldigt;
  const nuPris = priser[0];

  saet('svar', ja ? 'JA.' : 'NEJ.');
  saet('note', 'Svaret skifter hvert kvarter.');

  if (ja && nuPris.pris < 0) saet('under', 'De betaler dig. Helt ærligt.');
  else if (ja && nuPris.spot < 0) saet('under', 'De betaler dig. Næsten.');
  else if (ja && ligegyldigt && bedst.i > 0) saet('under', 'Det er lige meget lige nu.');
  else if (ja) saet('under', m.styring === 'app' ? 'Sæt den til nu.' : 'Tænd den nu.');
  else saet('under', `Vent til ${tidTekst(bedst.start, nu)}.`);

  // Hvad man gør på maskinen eller i appen
  if (m.styring === 'app') {
    const start = ja ? nu : bedst.start;
    saet('enhedEtiket', 'I bilens app');
    saet('enhedTal', ja ? 'Nu' : klokken(bedst.start));
    saet('enhedTekst', `Sæt ladestart til ${ja ? 'nu' : klokken(bedst.start)}. De billigste ${timer} timer slutter ${klokken(start + n * KVARTER)}.`);
  } else if (ja) {
    saet('enhedEtiket', 'På maskinen');
    saet('enhedTal', 'Start');
    saet('enhedTekst', 'Nu. Ingen grund til at vente.');
  } else {
    const t = Math.round(vent / 3600000);
    saet('enhedEtiket', 'På maskinen');
    if (t < 1) {
      saet('enhedTal', `${Math.max(1, Math.round(vent / 60000))} min`);
      saet('enhedTekst', `Vent lidt. Start den ${klokken(bedst.start)}.`);
    } else if (t > 24) {
      saet('enhedTal', `+${t} t`);
      saet('enhedTekst', 'Det er længere end de fleste maskiner kan udskyde. Kom tilbage i aften.');
    } else {
      const gang = nu + t * 3600000;
      saet('enhedTal', `+${t} t`);
      saet('enhedTekst', `Tryk udskudt start til ${t} ${t === 1 ? 'time' : 'timer'}. Den går i gang ${klokken(gang)} og er færdig ${klokken(gang + n * KVARTER)}.`);
    }
  }

  saet('spar', kr(spar));
  saet('sparHale', ja
    ? (ligegyldigt && bedst.i > 0 ? 'Altså ingenting. Bare tænd den.' : 'Fordi du gør det rigtige.')
    : spar >= 5 ? 'Det er faktisk noget.' : 'Det er ikke meget. Men det er dit.');

  tegnGraf(priser, bedst, n);
  opdaterKalender(m);
  opdaterHistorik();
}

function tegnGraf(priser, bedst, n) {
  const boks = $('soejler');
  const akse = $('akse');
  boks.innerHTML = '';
  akse.innerHTML = '';
  if (!priser.length) {
    saet('grafTitel', 'Ingen priser endnu');
    saet('billigst', '');
    return;
  }
  const vis = priser.slice(0, 144);
  const max = Math.max(...vis.map((p) => p.pris));
  const min = Math.min(0, ...vis.map((p) => p.pris));
  boks.classList.toggle('taet', vis.length > 72);
  const trin = window.innerWidth < 600 && vis.length > 48 ? 6 : 3;

  let billigst = vis[0];
  vis.forEach((p, i) => {
    if (p.pris < billigst.pris) billigst = p;
    const d = document.createElement('div');
    d.style.height = `${Math.max(2, ((p.pris - min) / (max - min || 1)) * 100)}%`;
    if (bedst && i >= bedst.i && i < bedst.i + n) d.className = 'vindue';
    else if (i === 0) d.className = 'nu';
    boks.append(d);

    const l = lokal(p.t);
    if (l.minut === 0 && l.time % trin === 0 && i > 1 && i < vis.length - 4) {
      const s = document.createElement('span');
      s.style.left = `${(i / vis.length) * 100}%`;
      s.textContent = l.time === 0 ? ugedag.format(p.t) : String(l.time).padStart(2, '0');
      akse.append(s);
    }
  });

  const nu = Date.now();
  saet('grafTitel', `Pris de næste ${Math.round(vis.length / 4)} timer · kr/kWh`);
  const hvornaar = tidTekst(billigst.t, nu);
  saet('billigst', `Billigst ${kr(billigst.pris)} kr ${hvornaar.includes('kl.') ? hvornaar : 'kl. ' + hvornaar}`);
  if (bedst) {
    saet('vindueTekst', `Billigste ${n / 4} timer · ${klokken(bedst.start)}–${klokken(bedst.slut)}`);
    boks.setAttribute('aria-label',
      `Elprisen pr. kvarter de næste ${Math.round(vis.length / 4)} timer. Billigst ${kr(billigst.pris)} kr. ` +
      `De billigste ${n / 4} timer er ${klokken(bedst.start)} til ${klokken(bedst.slut)}.`);
  }
}

function opdaterKalender(m) {
  const https = new URL(`cal/${valgtNet}-${m.id}.ics`, location.href).href;
  const webcal = https.replace(/^https?:/, 'webcal:');
  const ns = data.netselskaber.find((x) => x.id === valgtNet);
  const navn = `${m.kalender} · ${ns ? ns.navn : ''}`;
  $('kalGoogle').href = `https://calendar.google.com/calendar/r?cid=${encodeURIComponent(webcal)}`;
  $('kalOutlook').href = `https://outlook.live.com/calendar/0/addfromweb?url=${encodeURIComponent(https)}&name=${encodeURIComponent(navn)}`;
  $('kalIphone').href = webcal;
  $('kalKopier').dataset.url = https;
}

function opdaterHistorik() {
  const sum = historik && historik.sum ? historik.sum[valgtNet] : undefined;
  $('historik').hidden = sum === undefined;
  if (sum === undefined) return;
  saet('historikEtiket', `Hvis du havde fulgt siden fra ${datoKort.format(new Date(historik.siden + 'T12:00:00Z'))}`);
  saet('historikSum', kr(sum));
  const link = KILOWATTTIME_LINK.trim();
  $('kwhKnap').hidden = !link;
  $('kwhNote').hidden = !link;
  if (link) $('kwhKnap').href = link;
}

async function start() {
  try {
    await hentData();
  } catch {
    saet('svar', 'HM.');
    saet('under', 'Jeg kunne ikke hente priserne.');
    saet('note', 'Prøv at genindlæse siden om lidt.');
    return;
  }
  byggeValg();
  render();

  $('netselskab').addEventListener('change', (e) => {
    valgtNet = e.target.value;
    gem.saet('netselskab', valgtNet);
    $('gaet').hidden = true;
    render();
  });
  $('maskine').addEventListener('change', (e) => {
    valgtMaskine = e.target.value;
    gem.saet('maskine', valgtMaskine);
    render();
  });
  $('kalKopier').addEventListener('click', async (e) => {
    const knap = e.currentTarget;
    try {
      await navigator.clipboard.writeText(knap.dataset.url);
      knap.textContent = 'Kopieret';
    } catch {
      knap.textContent = 'Kunne ikke kopiere';
    }
    setTimeout(() => { knap.textContent = 'Kopiér link'; }, 2000);
  });

  setInterval(render, 60 * 1000);
  const opfrisk = async () => {
    if (Date.now() - sidstHentet < 10 * 60 * 1000) return;
    try { await hentData(); render(); } catch { /* prøver igen senere */ }
  };
  setInterval(opfrisk, 15 * 60 * 1000);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') { opfrisk(); render(); }
  });
}

start();
