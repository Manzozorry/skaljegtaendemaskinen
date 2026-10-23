import {
  lokal, klokken, plusDage, totalpriser, bedsteVindue, snit, indeksVed, KVARTER
} from './beregn.js';
import { tekster, belob } from './tekster.js';

// Buy Me a Coffee-link til kilowatttime-knappen. Tom streng skjuler knappen.
const KILOWATTTIME_LINK = 'https://www.buymeacoffee.com/manz';

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
let sprog = vaelgSprog();
let T = tekster[sprog];

// ?lang=en i adressen > tidligere valg > browserens sprog
function vaelgSprog() {
  const fraUrl = new URLSearchParams(location.search).get('lang');
  if (fraUrl === 'da' || fraUrl === 'en') return fraUrl;
  const gemt = gem.hent('sprog');
  if (gemt === 'da' || gemt === 'en') return gemt;
  const browser = (navigator.languages || [navigator.language || 'da']).map((l) => l.toLowerCase());
  const dansk = browser.findIndex((l) => l.startsWith('da') || l.startsWith('nb') || l.startsWith('no'));
  const engelsk = browser.findIndex((l) => !l.startsWith('da') && !l.startsWith('nb') && !l.startsWith('no'));
  if (dansk === -1) return 'en';
  if (engelsk === -1) return 'da';
  return dansk < engelsk ? 'da' : 'en';
}

const fmt = {};
function opdaterFormater() {
  fmt.dato = new Intl.DateTimeFormat(T.locale, { day: 'numeric', month: 'short', timeZone: 'Europe/Copenhagen' });
  fmt.ugedag = new Intl.DateTimeFormat(T.locale, { weekday: 'short', timeZone: 'Europe/Copenhagen' });
}

function anvendSprog() {
  T = tekster[sprog];
  document.documentElement.lang = sprog;
  opdaterFormater();
  for (const el of document.querySelectorAll('[data-t]')) {
    const v = T[el.dataset.t];
    if (typeof v === 'string') el.textContent = v;
  }
  for (const knap of document.querySelectorAll('.sprogknap')) {
    knap.setAttribute('aria-pressed', String(knap.dataset.sprog === sprog));
  }
  $('maskine').setAttribute('aria-label', T.vaelgMaskine);
}

const m2 = (m) => m[sprog] || m.da;

async function hentData() {
  const v = Math.floor(Date.now() / (5 * 60 * 1000));
  const [d, m, h] = await Promise.all([
    fetch(`data/latest.json?v=${v}`).then((r) => r.json()),
    fetch(`maskiner.json?v=${v}`).then((r) => r.json()),
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
  // Først de to gennemsnit (kræver kun, at man ved, hvilken side af Storebælt man bor),
  // derefter de enkelte netselskaber for dem, der vil have det præcise svar.
  for (const ns of data.netselskaber.filter((n) => n.snit)) {
    net.append(new Option(T['snit' + ns.omraade] || ns.navn, ns.id));
  }
  for (const [omr, navn] of [['DK2', T.oest], ['DK1', T.vest]]) {
    const gruppe = document.createElement('optgroup');
    gruppe.label = navn;
    for (const ns of data.netselskaber.filter((n) => n.omraade === omr && !n.snit)) {
      gruppe.append(new Option(ns.navn, ns.id));
    }
    if (gruppe.children.length) net.append(gruppe);
  }
  if (!valgtNet || !data.netselskaber.some((n) => n.id === valgtNet)) {
    $('gaet').hidden = false;
    valgtNet = ['dk2-snit', 'radius'].find((id) => data.netselskaber.some((n) => n.id === id)) || data.netselskaber[0].id;
  }
  net.value = valgtNet;

  const mask = $('maskine');
  mask.innerHTML = '';
  for (const m of maskiner) mask.append(new Option(m2(m).ord, m.id));
  if (!maskiner.some((m) => m.id === valgtMaskine)) valgtMaskine = maskiner[0].id;
  mask.value = valgtMaskine;

  $('antagelser').textContent = T.antagelser(maskiner
    .map((m) => T.antagelse(m2(m).navn, new Intl.NumberFormat(T.locale, { maximumFractionDigits: 2 }).format(m.kwh), m.kvarterer / 4))
    .join(', '));
}

// "02:00" i nat, "i morgen kl. 13:00" når det er i morgen i dagtimerne.
function tidTekst(ms, nu, medKl = false) {
  const l = lokal(ms);
  const idag = lokal(nu).dato;
  if (l.dato === idag || (l.dato === plusDage(idag, 1) && l.time < 6)) return medKl ? T.kl(klokken(ms)) : klokken(ms);
  if (l.dato === plusDage(idag, 1)) return T.iMorgen(klokken(ms));
  return T.ugedagKl(fmt.ugedag.format(ms), klokken(ms));
}

function saet(id, tekst) { $(id).textContent = tekst; }

function render() {
  if (!data) return;
  const m = maskiner.find((x) => x.id === valgtMaskine) || maskiner[0];
  const mt = m2(m);
  const n = m.kvarterer;
  const timer = n / 4;
  const nu = Date.now();

  saet('maskineord', mt.ord);
  document.title = T.titel(mt.ord);
  const opd = Date.parse(data.opdateret);
  saet('opdateret', T.opdateret(fmt.dato.format(opd), klokken(opd)));
  const valgt = data.netselskaber.find((x) => x.id === valgtNet);
  saet('snitNote', valgt && valgt.snit ? T.snitNote : '');

  const alle = totalpriser(data, valgtNet);
  const i0 = indeksVed(alle, nu);
  const priser = i0 >= 0 ? alle.slice(i0) : [];

  $('replik').hidden = !mt.replik;
  saet('replik', mt.replik || '');

  if (priser.length < n) {
    saet('svar', T.hm);
    saet('under', T.vedIkke);
    saet('note', T.noteMangler);
    saet('enhedEtiket', T.paaMaskinen);
    saet('enhedTal', '?');
    saet('enhedTekst', T.manglerPriser);
    saet('spar', '–');
    saet('sparHale', '');
    tegnGraf(priser, null, n, m);
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

  saet('svar', ja ? T.ja : T.nej);
  const kunIdag = lokal(alle[alle.length - 1].t).dato === lokal(nu).dato;
  const gammel = nu - opd > 30 * 3600000;
  saet('note', gammel
    ? T.gamlePriser(T.opdateret(fmt.dato.format(opd), klokken(opd)))
    : kunIdag ? T.noteKunIdag : T.noteKvarter);

  if (ja && nuPris.pris < 0) saet('under', T.betalerHelt);
  else if (ja && nuPris.spot < 0) saet('under', T.betalerNaesten);
  else if (ja && ligegyldigt && bedst.i > 0) saet('under', T.ligegyldigt);
  else if (ja) saet('under', m.styring === 'app' ? T.saetNu : T.taendNu);
  else saet('under', T.vent(tidTekst(bedst.start, nu)));

  // Hvad man gør på maskinen eller i appen
  if (m.styring === 'app') {
    const start = ja ? nu : bedst.start;
    saet('enhedEtiket', T.iBilensApp);
    saet('enhedTal', ja ? T.nu : klokken(bedst.start));
    saet('enhedTekst', ja
      ? T.ladeNu(klokken(start + n * KVARTER), timer)
      : T.lade(klokken(bedst.start), klokken(bedst.slut), timer));
  } else if (ja) {
    saet('enhedEtiket', T.paaMaskinen);
    saet('enhedTal', T.start);
    saet('enhedTekst', T.ingenGrund);
  } else {
    // Udskudt start går i hele timer. Vælg den af de to nærmeste, der faktisk er billigst,
    // så maskinen ikke ryger ind i en dyrere time ved en ren afrunding.
    const raa = vent / 3600000;
    let t = Math.round(raa);
    let bedstG = Infinity;
    for (const k of new Set([Math.floor(raa), Math.ceil(raa)])) {
      if (k < 1 || k > 24) continue;
      const ik = indeksVed(priser, nu + k * 3600000);
      const g = ik >= 0 ? snit(priser, ik, n) : null;
      if (g !== null && g < bedstG) { bedstG = g; t = k; }
    }
    saet('enhedEtiket', T.paaMaskinen);
    if (t < 1) {
      saet('enhedTal', T.minutter(Math.max(1, Math.round(vent / 60000))));
      saet('enhedTekst', T.ventLidt(klokken(bedst.start)));
    } else if (t > 24) {
      saet('enhedTal', T.timerKort(t));
      saet('enhedTekst', T.forLangt);
    } else {
      const gang = nu + t * 3600000;
      saet('enhedTal', T.timerKort(t));
      saet('enhedTekst', T.udskudt(t, klokken(gang), klokken(gang + n * KVARTER)));
    }
  }

  saet('spar', belob(spar, sprog));
  saet('sparHale', ja
    ? (ligegyldigt && bedst.i > 0 ? T.haleIngenting : T.halePaaFoer)
    : spar >= 5 ? T.haleNoget : T.haleLidt);

  tegnGraf(priser, bedst, n, m);
  opdaterKalender(m);
  opdaterHistorik();
}

// Tilstand for den interaktive graf
const graf = { priser: [], vis: [], n: 0, m: null, bedst: null, valgt: -1 };

function tegnGraf(priser, bedst, n, m) {
  const boks = $('soejler');
  const akse = $('akse');
  boks.innerHTML = '';
  akse.innerHTML = '';
  Object.assign(graf, { priser, vis: priser.slice(0, 144), n, m, bedst });
  const vis = graf.vis;
  if (!vis.length) {
    saet('grafTitel', T.ingenPriser);
    saet('billigst', '');
    ryd();
    return;
  }
  const max = Math.max(...vis.map((p) => p.pris));
  const min = Math.min(0, ...vis.map((p) => p.pris));
  boks.classList.toggle('taet', vis.length > 72);
  const trin = window.innerWidth < 600 && vis.length > 48 ? 6 : 3;

  let billigst = vis[0];
  vis.forEach((p, i) => {
    if (p.pris < billigst.pris) billigst = p;
    const d = document.createElement('div');
    // Højeste søjle fylder 72 %, så prisboksen har plads over den
    d.style.height = `${Math.max(2, ((p.pris - min) / (max - min || 1)) * 72)}%`;
    if (bedst && i >= bedst.i && i < bedst.i + n) d.className = 'vindue';
    else if (i === 0) d.className = 'nu';
    boks.append(d);

    const l = lokal(p.t);
    if (l.minut === 0 && l.time % trin === 0 && i > 1 && i < vis.length - 4) {
      const s = document.createElement('span');
      s.style.left = `${(i / vis.length) * 100}%`;
      s.textContent = l.time === 0 ? fmt.ugedag.format(p.t) : String(l.time).padStart(2, '0');
      akse.append(s);
    }
  });

  const nu = Date.now();
  const timer = Math.round(vis.length / 4);
  saet('grafTitel', T.grafTitel(timer));
  saet('billigst', T.billigst(belob(billigst.pris, sprog), tidTekst(billigst.t, nu, true)));
  boks.setAttribute('aria-label', T.grafSlider);
  boks.setAttribute('aria-valuemax', String(vis.length - 1));
  if (bedst) {
    saet('vindueTekst', T.vindue(n / 4, klokken(bedst.start), klokken(bedst.slut)));
    saet('grafResume', T.grafAria(timer, belob(billigst.pris, sprog), n / 4, klokken(bedst.start), klokken(bedst.slut)));
  } else {
    saet('vindueTekst', T.vindueStandard);
    saet('grafResume', '');
  }
  if (graf.valgt >= 0) markeer(graf.valgt);
}

// Vis pris og "hvad koster det at starte her" for kvarter i.
function markeer(i) {
  const { priser, vis, n, m } = graf;
  if (!vis.length || !m) return;
  i = Math.max(0, Math.min(vis.length - 1, i));
  graf.valgt = i;
  const boks = $('soejler');
  boks.classList.add('peger');
  const soejler = boks.children;
  for (let k = 0; k < soejler.length; k++) {
    soejler[k].classList.toggle('proeve', k >= i && k < i + n);
    soejler[k].classList.toggle('markoer', k === i);
  }
  const p = vis[i];
  const prisTekst = T.tipPris(`${fmt.ugedag.format(p.t)} ${klokken(p.t)}`, belob(p.pris, sprog));
  const g = snit(priser, i, n);
  const bedstKr = graf.bedst && graf.bedst.i !== i ? belob(graf.bedst.snit * m.kwh, sprog) : null;
  const koster = g === null ? T.tipForSent : T.tipKoster(m2(m).ord, belob(g * m.kwh, sprog), bedstKr);
  saet('tipPris', prisTekst);
  saet('tipKoster', koster);

  const tip = $('tip');
  tip.hidden = false;
  const bredde = boks.clientWidth;
  const hoejde = boks.clientHeight;
  const x = ((i + 0.5) / vis.length) * bredde;
  const tw = tip.offsetWidth;
  const th = tip.offsetHeight;
  const soejleTop = hoejde - soejler[i].offsetHeight;
  tip.style.left = `${Math.max(0, Math.min(bredde - tw, x - tw / 2))}px`;
  tip.style.top = `${Math.max(0, soejleTop - th - 8)}px`;
  boks.setAttribute('aria-valuenow', String(i));
  boks.setAttribute('aria-valuetext', `${prisTekst}. ${koster}`);
}

function ryd() {
  graf.valgt = -1;
  const boks = $('soejler');
  boks.classList.remove('peger');
  for (const s of boks.children) s.classList.remove('proeve', 'markoer');
  $('tip').hidden = true;
}

function grafStyring() {
  const boks = $('soejler');
  const indeks = (e) => {
    const r = boks.getBoundingClientRect();
    return Math.floor(((e.clientX - r.left) / r.width) * graf.vis.length);
  };
  boks.addEventListener('pointerdown', (e) => markeer(indeks(e)));
  boks.addEventListener('pointermove', (e) => markeer(indeks(e)));
  boks.addEventListener('pointerleave', (e) => { if (e.pointerType === 'mouse') ryd(); });
  document.addEventListener('pointerdown', (e) => { if (!boks.contains(e.target)) ryd(); });
  boks.addEventListener('focus', () => { if (graf.valgt < 0) markeer(0); });
  boks.addEventListener('blur', ryd);
  boks.addEventListener('keydown', (e) => {
    const len = graf.vis.length;
    if (!len) return;
    const i = graf.valgt < 0 ? 0 : graf.valgt;
    const skridt = e.shiftKey ? 4 : 1;
    const nyt = {
      ArrowRight: i + skridt, ArrowUp: i + skridt,
      ArrowLeft: i - skridt, ArrowDown: i - skridt,
      PageUp: i + 4, PageDown: i - 4,
      Home: 0, End: len - 1
    }[e.key];
    if (e.key === 'Escape') { ryd(); return; }
    if (nyt === undefined) return;
    e.preventDefault();
    markeer(nyt);
  });
}

function opdaterKalender(m) {
  const sti = sprog === 'en' ? `cal/en/${valgtNet}-${m.id}.ics` : `cal/${valgtNet}-${m.id}.ics`;
  const https = new URL(sti, location.href).href;
  const webcal = https.replace(/^https?:/, 'webcal:');
  const ns = data.netselskaber.find((x) => x.id === valgtNet);
  const nsNavn = ns ? (ns.navne ? ns.navne[sprog] : ns.navn) : '';
  const navn = `${m2(m).kalender} · ${nsNavn}`;
  $('kalGoogle').href = `https://calendar.google.com/calendar/r?cid=${encodeURIComponent(webcal)}`;
  $('kalOutlook').href = `https://outlook.live.com/calendar/0/addfromweb?url=${encodeURIComponent(https)}&name=${encodeURIComponent(navn)}`;
  $('kalIphone').href = webcal;
  $('kalKopier').dataset.url = https;
}

function opdaterHistorik() {
  const sum = historik && historik.sum ? historik.sum[valgtNet] : undefined;
  $('historik').hidden = sum === undefined;
  if (sum === undefined) return;
  saet('historikEtiket', T.historikEtiket(fmt.dato.format(new Date(historik.siden + 'T12:00:00Z'))));
  saet('historikSum', belob(sum, sprog));
  const link = KILOWATTTIME_LINK.trim();
  $('kwhKnap').hidden = !link;
  $('kwhNote').hidden = !link;
  if (link) $('kwhKnap').href = link;
}

async function start() {
  anvendSprog();
  try {
    await hentData();
  } catch {
    saet('svar', T.hm);
    saet('under', T.kunneIkkeHente);
    saet('note', T.proevIgen);
    return;
  }
  byggeValg();
  render();
  grafStyring();

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
  for (const knap of document.querySelectorAll('.sprogknap')) {
    knap.addEventListener('click', () => {
      sprog = knap.dataset.sprog;
      gem.saet('sprog', sprog);
      const url = new URL(location.href);
      url.searchParams.delete('lang');
      history.replaceState(null, '', url);
      anvendSprog();
      byggeValg();
      render();
    });
  }
  $('kalKopier').addEventListener('click', async (e) => {
    const knap = e.currentTarget;
    try {
      await navigator.clipboard.writeText(knap.dataset.url);
      knap.textContent = T.kalKopieret;
    } catch {
      knap.textContent = T.kalKopiFejl;
    }
    setTimeout(() => { knap.textContent = T.kalKopier; }, 2000);
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
