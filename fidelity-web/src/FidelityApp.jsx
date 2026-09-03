import React, { useState, useRef, useEffect, useCallback } from "react";
import { UserPlus, ScanLine, Gift, LayoutDashboard, Plus, ArrowLeft, Camera, X, Keyboard, Search, Mail, Loader2 } from "lucide-react";

// ---------------------------------------------------------------------------
// COLLEGAMENTO SUPABASE (dati persistenti, non più in memoria)
// ---------------------------------------------------------------------------
const SUPABASE_URL = "https://foddafipvzsnrkolojex.supabase.co";
const SUPABASE_KEY = "sb_publishable_c-iXQLMKFyi3IkFiutB-6Q_lnDUMbq4";

async function supaFetch(path, options = {}) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    ...options,
    headers: {
      apikey: SUPABASE_KEY,
      Authorization: `Bearer ${SUPABASE_KEY}`,
      "Content-Type": "application/json",
      Prefer: options.prefer || "return=representation",
      ...(options.headers || {}),
    },
  });
  if (!res.ok) {
    const testo = await res.text().catch(() => "");
    throw new Error(`Errore Supabase (${res.status}): ${testo || res.statusText}`);
  }
  const contentType = res.headers.get("content-type") || "";
  if (contentType.includes("application/json")) return res.json();
  return null;
}

// ---------------------------------------------------------------------------
// SCHELETRO FIDELITY CARD DIGITALE
// ---------------------------------------------------------------------------
// Questo è un prototipo funzionante con dati SOLO in memoria (si perdono al
// refresh). Serve per validare il flusso prima di collegare un database vero.
//
// PROSSIMO PASSO REALE: sostituire lo stato locale (useState) con chiamate
// a Supabase (vedi note alla fine del file per lo schema tabelle e le query).
// ---------------------------------------------------------------------------

const PUNTI_PER_EURO = 1; // 1 punto ogni euro speso — personalizzabile
const SOGLIA_SCONTO = 1000; // punti necessari per lo sconto
const VALORE_SCONTO = 10; // € di sconto alla soglia
const ATTESA_SECONDI = 5 * 60; // timeout attesa scontrino: 5 minuti

// ---------------------------------------------------------------------------
// Generatore QR autonomo (nessuna dipendenza esterna/CDN — sempre affidabile)
// Adattato dall'algoritmo standard "QR Code Generator for JavaScript"
// di Kazuhiko Arase, licenza MIT.
// ---------------------------------------------------------------------------
function costruisciMatriceQR(testo) {
  const MODE_8BIT_BYTE = 4;
  const EC_M = 0;

  const QRMath = (() => {
    const EXP = new Array(256);
    const LOG = new Array(256);
    for (let i = 0; i < 8; i++) EXP[i] = 1 << i;
    for (let i = 8; i < 256; i++) EXP[i] = EXP[i - 4] ^ EXP[i - 5] ^ EXP[i - 6] ^ EXP[i - 8];
    for (let i = 0; i < 255; i++) LOG[EXP[i]] = i;
    return {
      glog: (n) => LOG[n],
      gexp: (n) => { while (n < 0) n += 255; while (n >= 256) n -= 255; return EXP[n]; },
    };
  })();

  function Poly(num, shift) {
    let offset = 0;
    while (offset < num.length && num[offset] === 0) offset++;
    const _num = new Array(num.length - offset + shift).fill(0);
    for (let i = 0; i < num.length - offset; i++) _num[i] = num[i + offset];
    return {
      get: (i) => _num[i],
      len: () => _num.length,
      multiply(e) {
        const r = new Array(this.len() + e.len() - 1).fill(0);
        for (let i = 0; i < this.len(); i++)
          for (let j = 0; j < e.len(); j++)
            r[i + j] ^= QRMath.gexp(QRMath.glog(this.get(i)) + QRMath.glog(e.get(j)));
        return Poly(r, 0);
      },
      mod(e) {
        if (this.len() - e.len() < 0) return this;
        const ratio = QRMath.glog(this.get(0)) - QRMath.glog(e.get(0));
        const r = new Array(this.len());
        for (let i = 0; i < this.len(); i++) r[i] = this.get(i);
        for (let i = 0; i < e.len(); i++) r[i] ^= QRMath.gexp(QRMath.glog(e.get(i)) + ratio);
        return Poly(r, 0).mod(e);
      },
    };
  }

  const PATTERN_POS = [[],[6,18],[6,22],[6,26],[6,30],[6,34],[6,22,38],[6,24,42],[6,26,46],[6,28,50],[6,30,54],[6,32,58],[6,34,62],[6,26,46,66],[6,26,48,70],[6,26,50,74],[6,30,54,78],[6,30,56,82],[6,30,58,86],[6,34,62,90],[6,28,50,72,94],[6,26,50,74,98],[6,30,54,78,102],[6,28,54,80,106],[6,32,58,84,110],[6,30,58,86,114],[6,34,62,90,118],[6,26,50,74,98,122],[6,30,54,78,102,126],[6,26,52,78,104,130],[6,30,56,82,108,134],[6,34,60,86,112,138],[6,30,58,86,114,142],[6,34,62,90,118,146],[6,30,54,78,102,126,150],[6,24,50,76,102,128,154],[6,28,54,80,106,132,158],[6,32,58,84,110,136,162],[6,26,54,82,110,138,166],[6,30,58,86,114,142,170]];
  const G15 = (1<<10)|(1<<8)|(1<<5)|(1<<4)|(1<<2)|(1<<1)|1, G18=(1<<12)|(1<<11)|(1<<10)|(1<<9)|(1<<8)|(1<<5)|(1<<2)|1, G15_MASK=(1<<14)|(1<<12)|(1<<10)|(1<<4)|(1<<1);
  function bchDigit(d) { let n = 0; while (d !== 0) { n++; d >>>= 1; } return n; }
  const getBCHTypeInfo = (data) => { let d = data << 10; while (bchDigit(d) - bchDigit(G15) >= 0) d ^= (G15 << (bchDigit(d) - bchDigit(G15))); return ((data << 10) | d) ^ G15_MASK; };
  const getBCHTypeNumber = (data) => { let d = data << 12; while (bchDigit(d) - bchDigit(G18) >= 0) d ^= (G18 << (bchDigit(d) - bchDigit(G18))); return (data << 12) | d; };

  const RS_BLOCK_TABLE = [[1,26,19],[1,44,34],[1,70,55],[1,100,80],[1,134,108],[2,86,68],[2,98,78],[2,121,97],[2,146,116],[4,101,81],[4,116,92],[4,133,107],[4,145,115],[8,109,87],[8,122,98],[8,135,107],[8,150,120],[9,141,113],[9,135,107]];
  // Solo livello M, versioni 1-19 (sufficienti per un codice cliente breve)

  function getRSBlocks(typeNumber) {
    const b = RS_BLOCK_TABLE[typeNumber - 1];
    return [{ totalCount: b[1], dataCount: b[2] }].concat(
      b[0] > 1 ? Array.from({ length: b[0] - 1 }, () => ({ totalCount: b[1], dataCount: b[2] })) : []
    );
  }

  function BitBuffer() {
    const buf = [];
    let len = 0;
    return {
      getBuffer: () => buf,
      getLengthInBits: () => len,
      putBit(bit) {
        const bi = Math.floor(len / 8);
        if (buf.length <= bi) buf.push(0);
        if (bit) buf[bi] |= 0x80 >>> (len % 8);
        len++;
      },
      put(num, length) { for (let i = 0; i < length; i++) this.putBit(((num >>> (length - i - 1)) & 1) === 1); },
    };
  }

  function tryBuild(typeNumber) {
    const dataBytes = Array.from(testo).map((c) => c.charCodeAt(0) & 0xff);
    const buffer = BitBuffer();
    buffer.put(MODE_8BIT_BYTE, 4);
    const lenBits = typeNumber < 10 ? 8 : 16;
    buffer.put(dataBytes.length, lenBits);
    dataBytes.forEach((b) => buffer.put(b, 8));

    const rsBlocks = getRSBlocks(typeNumber);
    let totalDataCount = 0;
    rsBlocks.forEach((b) => (totalDataCount += b.dataCount));
    if (buffer.getLengthInBits() > totalDataCount * 8) return null; // non ci sta, prova versione successiva

    if (buffer.getLengthInBits() + 4 <= totalDataCount * 8) buffer.put(0, 4);
    while (buffer.getLengthInBits() % 8 !== 0) buffer.putBit(false);
    while (buffer.getLengthInBits() < totalDataCount * 8) {
      buffer.put(0xec, 8);
      if (buffer.getLengthInBits() >= totalDataCount * 8) break;
      buffer.put(0x11, 8);
    }

    // Reed-Solomon
    let maxDc = 0, maxEc = 0;
    const dcdata = [], ecdata = [];
    let offset = 0;
    rsBlocks.forEach((rb, r) => {
      const dcCount = rb.dataCount, ecCount = rb.totalCount - dcCount;
      maxDc = Math.max(maxDc, dcCount); maxEc = Math.max(maxEc, ecCount);
      dcdata[r] = buffer.getBuffer().slice(offset, offset + dcCount);
      offset += dcCount;
      let rsPoly = Poly([1], 0);
      for (let i = 0; i < ecCount; i++) rsPoly = rsPoly.multiply(Poly([1, QRMath.gexp(i)], 0));
      const rawPoly = Poly(dcdata[r], rsPoly.len() - 1);
      const modPoly = rawPoly.mod(rsPoly);
      ecdata[r] = new Array(rsPoly.len() - 1).fill(0).map((_, i) => {
        const mi = i + modPoly.len() - (rsPoly.len() - 1);
        return mi >= 0 ? modPoly.get(mi) : 0;
      });
    });
    const totalCodeCount = rsBlocks.reduce((s, b) => s + b.totalCount, 0);
    const data = new Array(totalCodeCount);
    let idx = 0;
    for (let i = 0; i < maxDc; i++) rsBlocks.forEach((_, r) => { if (i < dcdata[r].length) data[idx++] = dcdata[r][i]; });
    for (let i = 0; i < maxEc; i++) rsBlocks.forEach((_, r) => { if (i < ecdata[r].length) data[idx++] = ecdata[r][i]; });

    const moduleCount = typeNumber * 4 + 17;
    const modules = Array.from({ length: moduleCount }, () => new Array(moduleCount).fill(null));

    function placeFinder(row, col) {
      for (let r = -1; r <= 7; r++) {
        if (row + r <= -1 || moduleCount <= row + r) continue;
        for (let c = -1; c <= 7; c++) {
          if (col + c <= -1 || moduleCount <= col + c) continue;
          modules[row + r][col + c] = (0 <= r && r <= 6 && (c === 0 || c === 6)) || (0 <= c && c <= 6 && (r === 0 || r === 6)) || (2 <= r && r <= 4 && 2 <= c && c <= 4);
        }
      }
    }
    placeFinder(0, 0); placeFinder(moduleCount - 7, 0); placeFinder(0, moduleCount - 7);

    const pos = PATTERN_POS[typeNumber - 1];
    pos.forEach((row) => pos.forEach((col) => {
      if (modules[row][col] !== null) return;
      for (let r = -2; r <= 2; r++) for (let c = -2; c <= 2; c++) {
        modules[row + r][col + c] = (r === -2 || r === 2 || c === -2 || c === 2 || (r === 0 && c === 0));
      }
    }));

    for (let r = 8; r < moduleCount - 8; r++) if (modules[r][6] === null) modules[r][6] = r % 2 === 0;
    for (let c = 8; c < moduleCount - 8; c++) if (modules[6][c] === null) modules[6][c] = c % 2 === 0;

    if (typeNumber >= 7) {
      const bits = getBCHTypeNumber(typeNumber);
      for (let i = 0; i < 18; i++) {
        const mod = ((bits >> i) & 1) === 1;
        modules[Math.floor(i / 3)][(i % 3) + moduleCount - 8 - 3] = mod;
        modules[(i % 3) + moduleCount - 8 - 3][Math.floor(i / 3)] = mod;
      }
    }

    // scegli maschera 0 (semplice ma valida) e scrivi type info
    const maskPattern = 0;
    const maskFunc = (i, j) => (i + j) % 2 === 0;
    const bitsInfo = getBCHTypeInfo((0 << 3) | maskPattern); // livello di correzione errori M = 0 nello standard QR (L=1,M=0,Q=3,H=2)
    for (let i = 0; i < 15; i++) {
      const mod = ((bitsInfo >> i) & 1) === 1;
      if (i < 6) modules[i][8] = mod; else if (i < 8) modules[i + 1][8] = mod; else modules[moduleCount - 15 + i][8] = mod;
    }
    for (let i = 0; i < 15; i++) {
      const mod = ((bitsInfo >> i) & 1) === 1;
      if (i < 8) modules[8][moduleCount - i - 1] = mod; else if (i < 9) modules[8][15 - i - 1 + 1] = mod; else modules[8][15 - i - 1] = mod;
    }
    modules[moduleCount - 8][8] = true;

    // mappa i dati
    let inc = -1, row = moduleCount - 1, bitIndex = 7, byteIndex = 0;
    for (let col = moduleCount - 1; col > 0; col -= 2) {
      if (col === 6) col -= 1;
      while (true) {
        for (let c = 0; c < 2; c++) {
          if (modules[row][col - c] === null) {
            let dark = false;
            if (byteIndex < data.length) dark = ((data[byteIndex] >>> bitIndex) & 1) === 1;
            if (maskFunc(row, col - c)) dark = !dark;
            modules[row][col - c] = dark;
            bitIndex--;
            if (bitIndex === -1) { byteIndex++; bitIndex = 7; }
          }
        }
        row += inc;
        if (row < 0 || moduleCount <= row) { row -= inc; inc = -inc; break; }
      }
    }
    return modules;
  }

  for (let typeNumber = 1; typeNumber <= 19; typeNumber++) {
    const m = tryBuild(typeNumber);
    if (m) return m;
  }
  return tryBuild(19);
}

function generaCodiceCliente() {
  return "SM-" + Math.random().toString(36).substring(2, 8).toUpperCase();
}

// Alcuni lettori di codici a barre, per via del layout tastiera configurato,
// leggono il trattino "-" come apostrofo o apice (' ` ’ ‘). Questa funzione
// corregge il codice appena digitato o scansionato, così l'app riconosce
// comunque il cliente anche se lo scanner "sbaglia" quel carattere.
function normalizzaCodiceCliente(testo) {
  return testo
    .trim()
    .toUpperCase()
    .replace(/['`’‘]/g, "-");
}

export default function FidelityApp() {
  const [clienti, setClienti] = useState([]);
  const [caricamentoClienti, setCaricamentoClienti] = useState(true);
  const [erroreCaricamento, setErroreCaricamento] = useState(null);
  const [storicoSelezionato, setStoricoSelezionato] = useState([]);
  const [caricamentoStorico, setCaricamentoStorico] = useState(false);
  const [vista, setVista] = useState("cassa"); // dashboard | nuovo | cassa | scheda — l'app apre già in cassa
  const [clienteSelezionato, setClienteSelezionato] = useState(null);
  const [formNome, setFormNome] = useState("");
  const [formTelefono, setFormTelefono] = useState("");
  const [formEmail, setFormEmail] = useState("");
  const [importoCassa, setImportoCassa] = useState("");
  const [codiceCassa, setCodiceCassa] = useState("");
  const [messaggioCassa, setMessaggioCassa] = useState(null);
  const [scannerAttivo, setScannerAttivo] = useState(false);
  const [erroreScanner, setErroreScanner] = useState(null);
  const [inputManuale, setInputManuale] = useState(false);
  const [modalitaCassa, setModalitaCassa] = useState("automatica"); // manuale | automatica — apre già con lo scan attivo
  const [clienteInAttesa, setClienteInAttesa] = useState(null);
  const [secondiRimasti, setSecondiRimasti] = useState(0);
  const [logListener, setLogListener] = useState([]);
  const [ricercaCliente, setRicercaCliente] = useState("");
  const [messaggioEmail, setMessaggioEmail] = useState(null);

  const attesaTimerRef = useRef(null);
  const countdownRef = useRef(null);
  const pollingScontriniRef = useRef(null);

  const videoRef = useRef(null);
  const canvasRef = useRef(null);
  const streamRef = useRef(null);
  const frameRef = useRef(null);
  const jsQrPronto = useRef(false);
  const importoRef = useRef(null);

  // Il QR viene generato localmente (funzione costruisciMatriceQR sopra),
  // senza dipendere da librerie esterne — così è sempre affidabile.

  // Carica la libreria jsQR da CDN una sola volta (decodifica QR dal video)
  useEffect(() => {
    if (window.jsQR) {
      jsQrPronto.current = true;
      return;
    }
    const script = document.createElement("script");
    script.src = "https://cdnjs.cloudflare.com/ajax/libs/jsqr/1.4.0/jsQR.js";
    script.onload = () => { jsQrPronto.current = true; };
    script.onerror = () => setErroreScanner("Impossibile caricare il modulo di scansione.");
    document.body.appendChild(script);
  }, []);

  const fermaScanner = useCallback(() => {
    if (frameRef.current) cancelAnimationFrame(frameRef.current);
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    }
    setScannerAttivo(false);
  }, []);

  const avviaScanner = useCallback(async () => {
    setErroreScanner(null);
    setInputManuale(false);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: "environment" },
      });
      streamRef.current = stream;
      setScannerAttivo(true);
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
      }
      const tick = () => {
        if (!videoRef.current || !canvasRef.current || !window.jsQR) {
          frameRef.current = requestAnimationFrame(tick);
          return;
        }
        const video = videoRef.current;
        if (video.readyState === video.HAVE_ENOUGH_DATA) {
          const canvas = canvasRef.current;
          canvas.width = video.videoWidth;
          canvas.height = video.videoHeight;
          const ctx = canvas.getContext("2d");
          ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
          const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
          const codice = window.jsQR(imageData.data, imageData.width, imageData.height);
          if (codice && codice.data) {
            setCodiceCassa(normalizzaCodiceCliente(codice.data));
            fermaScanner();
            return;
          }
        }
        frameRef.current = requestAnimationFrame(tick);
      };
      frameRef.current = requestAnimationFrame(tick);
    } catch (err) {
      setErroreScanner("Fotocamera non disponibile o accesso negato. Usa l'inserimento manuale.");
      setInputManuale(true);
    }
  }, [fermaScanner]);

  useEffect(() => {
    // Ferma la fotocamera quando si lascia la vista cassa
    if (vista !== "cassa") fermaScanner();
    return () => fermaScanner();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [vista]);

  useEffect(() => {
    // Carica lo storico (movimenti) del cliente quando si apre la sua scheda
    if (vista !== "scheda" || !clienteSelezionato) {
      setStoricoSelezionato([]);
      return;
    }
    let attivo = true;
    setCaricamentoStorico(true);
    supaFetch(`movimenti?cliente_id=eq.${encodeURIComponent(clienteSelezionato.id)}&select=*&order=data.desc`)
      .then((righe) => {
        if (attivo) setStoricoSelezionato(righe || []);
      })
      .catch(() => {
        if (attivo) setStoricoSelezionato([]);
      })
      .finally(() => {
        if (attivo) setCaricamentoStorico(false);
      });
    return () => {
      attivo = false;
    };
  }, [vista, clienteSelezionato]);

  useEffect(() => {
    // Caricamento iniziale dei clienti da Supabase (dati persistenti)
    let attivo = true;
    setCaricamentoClienti(true);
    setErroreCaricamento(null);
    supaFetch("clienti?select=*&order=creato_il.desc")
      .then((righe) => {
        if (!attivo) return;
        setClienti(righe || []);
      })
      .catch((err) => {
        if (!attivo) return;
        setErroreCaricamento(err.message);
      })
      .finally(() => {
        if (attivo) setCaricamentoClienti(false);
      });
    return () => {
      attivo = false;
    };
  }, []);

  useEffect(() => {
    return () => {
      clearTimeout(attesaTimerRef.current);
      clearInterval(countdownRef.current);
      clearInterval(pollingScontriniRef.current);
    };
  }, []);

  function registraCliente(e) {
    e.preventDefault();
    if (!formNome.trim()) return;
    const nuovo = {
      id: generaCodiceCliente(),
      nome: formNome.trim(),
      telefono: formTelefono.trim(),
      email: formEmail.trim(),
      punti: 0,
    };
    setClienti((prev) => [nuovo, ...prev]);
    setFormNome("");
    setFormTelefono("");
    setFormEmail("");
    setClienteSelezionato(nuovo);
    setVista("scheda");
    supaFetch("clienti", { method: "POST", body: JSON.stringify(nuovo) }).catch((err) => {
      setErroreCaricamento(`Cliente salvato solo localmente: ${err.message}`);
    });
  }

  function registraMovimento(clienteId, { importo, punti, tipo = "acquisto", scontrino = null }) {
    // Aggiorna subito localmente (UI reattiva), poi salva su Supabase in background
    setClienti((prev) =>
      prev.map((c) => (c.id === clienteId ? { ...c, punti: c.punti + punti } : c))
    );
    if (clienteSelezionato && clienteSelezionato.id === clienteId) {
      setClienteSelezionato((c) => (c ? { ...c, punti: c.punti + punti } : c));
      setStoricoSelezionato((prev) => [
        { data: new Date().toISOString(), importo, punti, tipo, scontrino },
        ...prev,
      ]);
    }
    supaFetch(`clienti?id=eq.${encodeURIComponent(clienteId)}`, {
      method: "PATCH",
      body: JSON.stringify({ punti: (clienti.find((c) => c.id === clienteId)?.punti || 0) + punti }),
      prefer: "return=minimal",
    }).catch((err) => setErroreCaricamento(`Aggiornamento punti non salvato: ${err.message}`));
    supaFetch("movimenti", {
      method: "POST",
      body: JSON.stringify({ cliente_id: clienteId, importo, punti, tipo, scontrino }),
      prefer: "return=minimal",
    }).catch((err) => setErroreCaricamento(`Movimento non salvato: ${err.message}`));
  }

  function registraAcquisto(e) {
    e.preventDefault();
    const importo = parseFloat(importoCassa);
    if (!importo || importo <= 0) return;
    const cliente = clienti.find((c) => c.id === normalizzaCodiceCliente(codiceCassa));
    if (!cliente) {
      setMessaggioCassa({ tipo: "errore", testo: "Codice cliente non trovato." });
      return;
    }
    const puntiGuadagnati = Math.round(importo * PUNTI_PER_EURO);
    const nuovoTotale = cliente.punti + puntiGuadagnati;
    registraMovimento(cliente.id, { importo, punti: puntiGuadagnati, tipo: "acquisto" });
    const messaggioSoglia = nuovoTotale >= SOGLIA_SCONTO
      ? ` — sconto di ${VALORE_SCONTO}€ disponibile!`
      : "";
    setMessaggioCassa({
      tipo: "successo",
      testo: `${cliente.nome}: +${puntiGuadagnati} punti (totale ${nuovoTotale})${messaggioSoglia}`,
    });
    setImportoCassa("");
    setCodiceCassa("");
    setInputManuale(false);
  }

  function usaSconto(cliente) {
    registraMovimento(cliente.id, { importo: -VALORE_SCONTO, punti: -SOGLIA_SCONTO, tipo: "sconto" });
  }

  function inviaTesseraEmail(cliente) {
    setMessaggioEmail({ clienteId: cliente.id, testo: "Invio in corso..." });
    fetch(`${SUPABASE_URL}/functions/v1/Invia-tessera`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        apikey: SUPABASE_KEY,
        Authorization: `Bearer ${SUPABASE_KEY}`,
      },
      body: JSON.stringify({ nome: cliente.nome, email: cliente.email, codice: cliente.id }),
    })
      .then(async (res) => {
        const dati = await res.json().catch(() => ({}));
        if (!res.ok || dati.errore) {
          throw new Error(dati.errore || `Errore ${res.status}`);
        }
        setMessaggioEmail({ clienteId: cliente.id, testo: `Tessera inviata a ${cliente.email}` });
      })
      .catch((err) => {
        setMessaggioEmail({ clienteId: cliente.id, testo: `Invio non riuscito: ${err.message}`, errore: true });
      });
  }

  function gestisciInvioCodice(e) {
    // Il lettore barcode "digita" il codice e preme Invio da solo: intercettiamo
    // l'Invio per passare automaticamente al campo importo, senza click extra.
    if (e.key === "Enter") {
      e.preventDefault();
      importoRef.current?.focus();
    }
  }

  // --- Modalità automatica: abbinamento per sequenza temporale -------------
  // Simula il servizio di rete che intercetta i dati dalla stampante non
  // fiscale (Milestone). In produzione questa logica gira su un piccolo
  // servizio sempre acceso (es. Raspberry Pi), non nel browser.

  function fermaAttesa() {
    clearTimeout(attesaTimerRef.current);
    clearInterval(countdownRef.current);
    clearInterval(pollingScontriniRef.current);
    setClienteInAttesa(null);
    setSecondiRimasti(0);
  }

  function avviaAttesa(codice) {
    const cliente = clienti.find((c) => c.id === normalizzaCodiceCliente(codice));
    if (!cliente) {
      setMessaggioCassa({ tipo: "errore", testo: "Codice cliente non trovato." });
      return;
    }
    fermaAttesa();
    setClienteInAttesa(cliente);
    setSecondiRimasti(ATTESA_SECONDI);
    setLogListener((prev) => [{ tipo: "attesa", testo: `In attesa scontrino per ${cliente.nome}`, ora: nowLabel() }, ...prev].slice(0, 8));

    // Segniamo l'istante esatto in cui parte l'attesa: verranno accettati
    // solo scontrini ricevuti da questo momento in poi, mai quelli vecchi
    // rimasti in sospeso da prove o clienti precedenti.
    const inizioAttesa = new Date().toISOString();

    countdownRef.current = setInterval(() => {
      setSecondiRimasti((s) => (s > 0 ? s - 1 : 0));
    }, 1000);

    attesaTimerRef.current = setTimeout(() => {
      setLogListener((prev) => [{ tipo: "scaduto", testo: `Attesa scaduta per ${cliente.nome} — nessun abbinamento`, ora: nowLabel() }, ...prev].slice(0, 8));
      fermaAttesa();
    }, ATTESA_SECONDI * 1000);

    // Controlla ogni 2 secondi se il listener di rete ha mandato un vero
    // scontrino non ancora abbinato — questo collega il programma sul PC
    // di cassa a questa schermata, senza bisogno di azioni manuali.
    pollingScontriniRef.current = setInterval(async () => {
      try {
        const righe = await supaFetch(
          `scontrini_ricevuti?abbinato=eq.false&ricevuto_il=gt.${encodeURIComponent(inizioAttesa)}&order=ricevuto_il.asc&limit=1&select=*`
        );
        if (righe && righe.length > 0) {
          const scontrino = righe[0];
          clearInterval(pollingScontriniRef.current);
          const importo = Number(scontrino.importo) || 0;
          const puntiGuadagnati = Math.round(importo * PUNTI_PER_EURO);
          registraMovimento(cliente.id, {
            importo,
            punti: puntiGuadagnati,
            tipo: "acquisto",
            scontrino: scontrino.testo,
          });
          setLogListener((prev) => [{ tipo: "abbinato", testo: `Scontrino € ${importo.toFixed(2)} abbinato a ${cliente.nome}: +${puntiGuadagnati} pt`, ora: nowLabel() }, ...prev].slice(0, 8));
          // Segna lo scontrino come abbinato, cosi' non venga riusato
          supaFetch(`scontrini_ricevuti?id=eq.${scontrino.id}`, {
            method: "PATCH",
            body: JSON.stringify({ abbinato: true }),
            prefer: "return=minimal",
          }).catch(() => {});
          fermaAttesa();
        }
      } catch (err) {
        // Errore di rete/connessione: non blocchiamo l'attesa, riproviamo
        // al prossimo giro
      }
    }, 2000);
  }

  function nowLabel() {
    return new Date().toLocaleTimeString("it-IT", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
  }

  const clientiFiltrati = clienti.filter((c) => {
    const q = ricercaCliente.trim().toLowerCase();
    if (!q) return true;
    return (
      c.nome.toLowerCase().includes(q) ||
      c.id.toLowerCase().includes(q) ||
      (c.telefono || "").toLowerCase().includes(q) ||
      (c.email || "").toLowerCase().includes(q)
    );
  });

  return (
    <div style={styles.app}>
      <header style={styles.header}>
        <div>
          <div style={styles.eyebrow}>Supermercato</div>
          <h1 style={styles.titolo}>Fidelity Digitale</h1>
        </div>
        <nav style={styles.nav}>
          <NavButton icon={<LayoutDashboard size={16} />} label="Clienti" active={vista === "dashboard"} onClick={() => setVista("dashboard")} />
          <NavButton icon={<UserPlus size={16} />} label="Nuovo cliente" active={vista === "nuovo"} onClick={() => setVista("nuovo")} />
          <NavButton icon={<ScanLine size={16} />} label="Cassa" active={vista === "cassa"} onClick={() => setVista("cassa")} />
        </nav>
      </header>

      <main style={styles.main}>
        {vista === "dashboard" && (
          <div>
            <div style={styles.rigaTitolo}>
              <h2 style={styles.h2}>Clienti registrati ({clienti.length})</h2>
            </div>
            {erroreCaricamento && (
              <div style={{ ...styles.messaggio, ...styles.messaggioErrore, marginBottom: 12 }}>
                Connessione al database non riuscita: {erroreCaricamento}
              </div>
            )}
            <div style={styles.ricercaBox}>
              <Search size={16} style={styles.ricercaIcona} />
              <input
                style={styles.inputRicerca}
                value={ricercaCliente}
                onChange={(e) => setRicercaCliente(e.target.value)}
                placeholder="Cerca per nome, telefono o codice tessera..."
              />
              {ricercaCliente && (
                <button type="button" style={styles.ricercaClear} onClick={() => setRicercaCliente("")}>
                  <X size={14} />
                </button>
              )}
            </div>
            {caricamentoClienti && (
              <p style={styles.vuoto}>
                <Loader2 size={14} className="animate-spin" style={{ verticalAlign: "-2px", marginRight: 6 }} />
                Caricamento clienti...
              </p>
            )}
            <div style={styles.listaClienti}>
              {!caricamentoClienti && clientiFiltrati.map((c) => (
                <button
                  key={c.id}
                  style={styles.rigaCliente}
                  onClick={() => {
                    setClienteSelezionato(c);
                    setVista("scheda");
                  }}
                >
                  <div>
                    <div style={styles.nomeCliente}>{c.nome}</div>
                    <div style={styles.codiceCliente}>{c.id}</div>
                  </div>
                  <div style={c.punti >= SOGLIA_SCONTO ? styles.puntiBadgeSconto : styles.puntiBadge}>
                    {c.punti >= SOGLIA_SCONTO ? `Sconto pronto` : `${c.punti} pt`}
                  </div>
                </button>
              ))}
              {!caricamentoClienti && clienti.length === 0 && <p style={styles.vuoto}>Nessun cliente ancora. Registrane uno nuovo.</p>}
              {!caricamentoClienti && clienti.length > 0 && clientiFiltrati.length === 0 && <p style={styles.vuoto}>Nessun cliente trovato per "{ricercaCliente}".</p>}
            </div>
          </div>
        )}

        {vista === "nuovo" && (
          <div style={styles.cardForm}>
            <h2 style={styles.h2}>Registra nuovo cliente</h2>
            <form onSubmit={registraCliente} style={styles.form}>
              <label style={styles.label}>
                Nome e cognome
                <input style={styles.input} value={formNome} onChange={(e) => setFormNome(e.target.value)} placeholder="Es. Maria Rossi" />
              </label>
              <label style={styles.label}>
                Telefono (per promozioni)
                <input style={styles.input} value={formTelefono} onChange={(e) => setFormTelefono(e.target.value)} placeholder="Es. 333 1234567" />
              </label>
              <label style={styles.label}>
                Email (per inviare la tessera)
                <input style={styles.input} type="email" value={formEmail} onChange={(e) => setFormEmail(e.target.value)} placeholder="Es. mario.rossi@esempio.it" />
              </label>
              <button type="submit" style={styles.bottonePrimario}>
                <Plus size={16} /> Crea tessera virtuale
              </button>
            </form>
            <p style={styles.hintPiccolo}>
              Alla creazione, la tessera con QR viene inviata automaticamente all'indirizzo email indicato.
            </p>
          </div>
        )}

        {vista === "scheda" && clienteSelezionato && (
          <div style={styles.cardForm}>
            <button style={styles.bottoneIndietro} onClick={() => setVista("dashboard")}>
              <ArrowLeft size={14} /> Torna ai clienti
            </button>
            <div style={styles.schedaHeader}>
              <div>
                <h2 style={styles.h2}>{clienteSelezionato.nome}</h2>
                <div style={styles.codiceCliente}>{clienteSelezionato.id}</div>
                <button
                  type="button"
                  style={styles.bottoneEmail}
                  disabled={!clienteSelezionato.email}
                  onClick={() => inviaTesseraEmail(clienteSelezionato)}
                  title={!clienteSelezionato.email ? "Nessuna email registrata per questo cliente" : undefined}
                >
                  <Mail size={14} /> Invia tessera via email
                </button>
                <button
                  type="button"
                  style={styles.bottoneUsaCassa}
                  onClick={() => {
                    setModalitaCassa("manuale");
                    setInputManuale(true);
                    setCodiceCassa(clienteSelezionato.id);
                    setImportoCassa("");
                    setMessaggioCassa(null);
                    setVista("cassa");
                  }}
                >
                  <ScanLine size={14} /> Usa tessera in cassa
                </button>
              </div>
              <div style={styles.qrBox}>
                <TesseraQR codice={clienteSelezionato.id} />
              </div>
            </div>
            {messaggioEmail && clienteSelezionato && messaggioEmail.clienteId === clienteSelezionato.id && (
              <div style={{ ...styles.messaggio, ...(messaggioEmail.errore ? styles.messaggioErrore : styles.messaggioSuccesso), marginTop: -6, marginBottom: 14 }}>
                {messaggioEmail.testo}
              </div>
            )}
            <div style={styles.puntiGrande}>{clienteSelezionato.punti} <span style={styles.puntiLabel}>punti</span></div>

            {clienteSelezionato.punti >= SOGLIA_SCONTO ? (
              <div style={styles.scontoBox}>
                <div>
                  <div style={styles.scontoTitolo}>Sconto disponibile</div>
                  <div style={styles.scontoValore}>{VALORE_SCONTO}€ di sconto sulla spesa</div>
                </div>
                <button style={styles.bottonePrimario} onClick={() => usaSconto(clienteSelezionato)}>
                  <Gift size={16} /> Riscatta punti
                </button>
              </div>
            ) : (
              <div style={styles.progressoBox}>
                <div style={styles.progressoTesto}>
                  Mancano {SOGLIA_SCONTO - clienteSelezionato.punti} punti a {VALORE_SCONTO}€ di sconto
                </div>
                <div style={styles.progressoSfondo}>
                  <div style={{ ...styles.progressoBarra, width: `${Math.min(100, (clienteSelezionato.punti / SOGLIA_SCONTO) * 100)}%` }} />
                </div>
              </div>
            )}

            <h3 style={styles.h3}>Storico acquisti</h3>
            {caricamentoStorico && <p style={styles.vuoto}><Loader2 size={14} className="animate-spin" style={{ verticalAlign: "-2px", marginRight: 6 }} />Caricamento storico...</p>}
            {!caricamentoStorico && storicoSelezionato.length === 0 && <p style={styles.vuoto}>Nessun acquisto registrato.</p>}
            {!caricamentoStorico && storicoSelezionato.map((s, i) => (
              <RigaStoricoConScontrino key={s.id || i} riga={s} />
            ))}
          </div>
        )}

        {vista === "cassa" && (
          <div style={styles.cardForm}>
            <h2 style={styles.h2}>
              <ScanLine size={20} style={{ marginRight: 8, verticalAlign: "-3px" }} />
              Registra acquisto
            </h2>

            <div style={styles.toggleModalita}>
              <button
                type="button"
                style={{ ...styles.toggleBtn, ...(modalitaCassa === "manuale" ? styles.toggleBtnAttivo : {}) }}
                onClick={() => { setModalitaCassa("manuale"); fermaAttesa(); }}
              >
                Manuale
              </button>
              <button
                type="button"
                style={{ ...styles.toggleBtn, ...(modalitaCassa === "automatica" ? styles.toggleBtnAttivo : {}) }}
                onClick={() => { setModalitaCassa("automatica"); fermaScanner(); setInputManuale(false); setCodiceCassa(""); }}
              >
                Automatica (rete)
              </button>
            </div>

            {modalitaCassa === "manuale" && (
              <>
                {!codiceCassa && !scannerAttivo && !inputManuale && (
                  <div style={styles.scannerAvvio}>
                    <p style={styles.hint}>Inquadra il QR sul telefono del cliente per identificarlo.</p>
                    <button type="button" style={styles.bottonePrimario} onClick={avviaScanner}>
                      <Camera size={16} /> Avvia fotocamera
                    </button>
                    <button type="button" style={styles.bottoneSecondario} onClick={() => setInputManuale(true)}>
                      <Keyboard size={16} /> Digita o scansiona con lettore barcode
                    </button>
                  </div>
                )}

                {scannerAttivo && (
                  <div style={styles.scannerBox}>
                    <video ref={videoRef} muted playsInline style={styles.video} />
                    <div style={styles.mirino} />
                    <button type="button" style={styles.bottoneAnnulla} onClick={fermaScanner}>
                      <X size={14} /> Annulla scansione
                    </button>
                  </div>
                )}
                <canvas ref={canvasRef} style={{ display: "none" }} />

                {erroreScanner && <div style={{ ...styles.messaggio, ...styles.messaggioErrore }}>{erroreScanner}</div>}

                {(codiceCassa || inputManuale) && !scannerAttivo && (
                  <form onSubmit={registraAcquisto} style={styles.form}>
                    <label style={styles.label}>
                      Codice cliente
                      <input
                        style={styles.input}
                        value={codiceCassa}
                        onChange={(e) => setCodiceCassa(normalizzaCodiceCliente(e.target.value))}
                        onKeyDown={gestisciInvioCodice}
                        placeholder="Es. SM-A1B2C3 (o scansiona col lettore)"
                        autoFocus={inputManuale}
                      />
                    </label>
                    {codiceCassa && !inputManuale && (
                      <div style={styles.chipRilevato}>QR rilevato: {codiceCassa}</div>
                    )}
                    <label style={styles.label}>
                      Importo scontrino (€)
                      <input ref={importoRef} style={styles.input} type="number" step="0.01" value={importoCassa} onChange={(e) => setImportoCassa(e.target.value)} placeholder="Es. 24.50" />
                    </label>
                    <button type="submit" style={styles.bottonePrimario}>
                      <Gift size={16} /> Accredita punti
                    </button>
                    <button
                      type="button"
                      style={styles.bottoneSecondario}
                      onClick={() => {
                        setCodiceCassa("");
                        setInputManuale(false);
                        setMessaggioCassa(null);
                      }}
                    >
                      Cambia cliente
                    </button>
                  </form>
                )}

                {messaggioCassa && (
                  <div style={{ ...styles.messaggio, ...(messaggioCassa.tipo === "errore" ? styles.messaggioErrore : styles.messaggioSuccesso) }}>
                    {messaggioCassa.testo}
                  </div>
                )}
              </>
            )}

            {modalitaCassa === "automatica" && (
              <div>
                <p style={styles.hint}>
                  Scansiona la tessera del cliente prima di battere la spesa. Il sistema resta in attesa
                  del primo scontrino valido dalla stampante non fiscale (le comande vengono ignorate) per
                  al massimo {Math.floor(ATTESA_SECONDI / 60)} minuti.
                </p>

                {!clienteInAttesa && (
                  <form
                    style={styles.form}
                    onSubmit={(e) => { e.preventDefault(); avviaAttesa(codiceCassa); setCodiceCassa(""); }}
                  >
                    <label style={styles.label}>
                      Codice cliente
                      <input
                        style={styles.input}
                        value={codiceCassa}
                        onChange={(e) => setCodiceCassa(normalizzaCodiceCliente(e.target.value))}
                        placeholder="Es. SM-A1B2C3 (scansiona QR o barcode)"
                        autoFocus
                      />
                    </label>
                    <button type="submit" style={styles.bottonePrimario}>
                      <ScanLine size={16} /> Metti cliente in attesa
                    </button>
                  </form>
                )}

                {messaggioCassa && !clienteInAttesa && (
                  <div style={{ ...styles.messaggio, ...(messaggioCassa.tipo === "errore" ? styles.messaggioErrore : styles.messaggioSuccesso) }}>
                    {messaggioCassa.testo}
                  </div>
                )}

                {clienteInAttesa && (
                  <div style={styles.attesaBox}>
                    <div style={styles.attesaNome}>{clienteInAttesa.nome}</div>
                    <div style={styles.attesaCountdown}>
                      In attesa scontrino — {Math.floor(secondiRimasti / 60)}:{String(secondiRimasti % 60).padStart(2, "0")}
                    </div>
                    <button type="button" style={styles.bottoneAnnullaAttesa} onClick={fermaAttesa}>
                      <X size={14} /> Annulla attesa
                    </button>
                  </div>
                )}

                {logListener.length > 0 && (
                  <div style={styles.logBox}>
                    {logListener.map((l, i) => (
                      <div key={i} style={{ ...styles.logRiga, ...(l.tipo === "abbinato" ? styles.logAbbinato : l.tipo === "scartato" || l.tipo === "scaduto" ? styles.logScartato : styles.logAttesa) }}>
                        <span style={styles.logOra}>{l.ora}</span> {l.testo}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        )}
      </main>
    </div>
  );
}

function NavButton({ icon, label, active, onClick }) {
  return (
    <button onClick={onClick} style={{ ...styles.navBtn, ...(active ? styles.navBtnAttivo : {}) }}>
      {icon}
      {label}
    </button>
  );
}

function TesseraQR({ codice, dimensione = 96 }) {
  const matrice = React.useMemo(() => {
    try {
      return costruisciMatriceQR(codice);
    } catch (e) {
      return null;
    }
  }, [codice]);

  if (!matrice) return <div style={{ width: dimensione, height: dimensione }} />;

  const n = matrice.length;
  const margine = 2; // moduli di quiet zone
  const cella = dimensione / (n + margine * 2);

  return (
    <svg width={dimensione} height={dimensione} viewBox={`0 0 ${dimensione} ${dimensione}`}>
      <rect x={0} y={0} width={dimensione} height={dimensione} fill="#ffffff" />
      {matrice.map((riga, r) =>
        riga.map((scuro, c) =>
          scuro ? (
            <rect
              key={`${r}-${c}`}
              x={(c + margine) * cella}
              y={(r + margine) * cella}
              width={cella}
              height={cella}
              fill="#1F2318"
            />
          ) : null
        )
      )}
    </svg>
  );
}

function RigaStoricoConScontrino({ riga }) {
  const [aperto, setAperto] = useState(false);
  const haScontrino = !!riga.scontrino;
  const importoNum = Number(riga.importo) || 0;
  const dataLeggibile = riga.data
    ? new Date(riga.data).toLocaleDateString("it-IT", { day: "2-digit", month: "2-digit", year: "numeric" })
    : "";
  return (
    <div style={styles.blocchettoStorico}>
      <button
        type="button"
        style={{ ...styles.rigaStorico, cursor: haScontrino ? "pointer" : "default" }}
        onClick={() => haScontrino && setAperto((a) => !a)}
      >
        <span>{dataLeggibile}</span>
        <span>{riga.tipo === "sconto" ? "Sconto usato" : `€ ${importoNum.toFixed(2)}`}</span>
        <span style={riga.punti < 0 ? styles.puntiStoricoNegativo : styles.puntiStorico}>
          {riga.punti > 0 ? "+" : ""}{riga.punti} pt {haScontrino && (aperto ? "▲" : "▼")}
        </span>
      </button>
      {aperto && haScontrino && <pre style={styles.scontrinoTesto}>{riga.scontrino}</pre>}
    </div>
  );
}

const styles = {
  app: { fontFamily: "'Inter', system-ui, sans-serif", background: "#F7F5F0", minHeight: "100vh", color: "#1F2318" },
  header: { display: "flex", justifyContent: "space-between", alignItems: "center", padding: "20px 24px", borderBottom: "1px solid #E3E0D6", background: "#1A1414", flexWrap: "wrap", gap: 12 },
  eyebrow: { fontSize: 11, letterSpacing: "0.1em", textTransform: "uppercase", color: "#E38A8F", fontWeight: 600 },
  titolo: { fontSize: 22, margin: "2px 0 0", fontWeight: 700, color: "#FFFFFF" },
  nav: { display: "flex", gap: 8 },
  navBtn: { display: "flex", alignItems: "center", gap: 6, padding: "8px 12px", borderRadius: 8, border: "1px solid #E3E0D6", background: "#fff", cursor: "pointer", fontSize: 13, color: "#4A4A40" },
  navBtnAttivo: { background: "#C41E2F", color: "#fff", borderColor: "#C41E2F" },
  main: { maxWidth: 640, margin: "0 auto", padding: "24px 16px" },
  h2: { fontSize: 18, fontWeight: 700, margin: "0 0 12px" },
  h3: { fontSize: 14, fontWeight: 700, margin: "20px 0 8px", color: "#5A5A4E" },
  rigaTitolo: { marginBottom: 8 },
  ricercaBox: { position: "relative", marginBottom: 14 },
  ricercaIcona: { position: "absolute", left: 12, top: "50%", transform: "translateY(-50%)", color: "#B0AC9C" },
  inputRicerca: { width: "100%", padding: "10px 36px", borderRadius: 8, border: "1px solid #DAD6C8", fontSize: 14, fontFamily: "inherit", boxSizing: "border-box" },
  ricercaClear: { position: "absolute", right: 8, top: "50%", transform: "translateY(-50%)", background: "none", border: "none", color: "#B0AC9C", cursor: "pointer", padding: 4 },
  listaClienti: { display: "flex", flexDirection: "column", gap: 8 },
  rigaCliente: { display: "flex", justifyContent: "space-between", alignItems: "center", padding: "14px 16px", background: "#fff", border: "1px solid #E3E0D6", borderRadius: 10, cursor: "pointer", textAlign: "left", width: "100%" },
  nomeCliente: { fontWeight: 600, fontSize: 14 },
  codiceCliente: { fontSize: 12, color: "#8A8A7C", fontFamily: "monospace" },
  puntiBadge: { background: "#FBE5E7", color: "#C41E2F", fontWeight: 700, fontSize: 13, padding: "4px 10px", borderRadius: 20 },
  vuoto: { color: "#8A8A7C", fontSize: 14 },
  cardForm: { background: "#fff", border: "1px solid #E3E0D6", borderRadius: 12, padding: 20 },
  form: { display: "flex", flexDirection: "column", gap: 14 },
  label: { display: "flex", flexDirection: "column", gap: 6, fontSize: 13, fontWeight: 600, color: "#4A4A40" },
  input: { padding: "10px 12px", borderRadius: 8, border: "1px solid #DAD6C8", fontSize: 14, fontFamily: "inherit" },
  bottonePrimario: { display: "flex", alignItems: "center", justifyContent: "center", gap: 6, background: "#C41E2F", color: "#fff", border: "none", padding: "12px", borderRadius: 8, fontSize: 14, fontWeight: 600, cursor: "pointer", marginTop: 4 },
  bottoneIndietro: { display: "flex", alignItems: "center", gap: 6, background: "none", border: "none", color: "#9A4A50", fontSize: 13, cursor: "pointer", padding: 0, marginBottom: 14 },
  schedaHeader: { display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12, flexWrap: "wrap" },
  qrBox: { padding: 10, background: "#fff", border: "1px solid #E3E0D6", borderRadius: 8 },
  puntiGrande: { fontSize: 40, fontWeight: 800, color: "#C41E2F", margin: "16px 0" },
  puntiLabel: { fontSize: 16, fontWeight: 500, color: "#8A8A7C" },
  rigaStorico: { display: "flex", justifyContent: "space-between", padding: "8px 0", borderBottom: "1px solid #F0EEE5", fontSize: 13, width: "100%", background: "none", border: "none", borderBottomWidth: 1, borderBottomStyle: "solid", borderBottomColor: "#F0EEE5", textAlign: "left", fontFamily: "inherit" },
  puntiStorico: { color: "#C41E2F", fontWeight: 600 },
  hint: { fontSize: 13, color: "#8A8A7C", marginBottom: 16 },
  hintPiccolo: { fontSize: 12, color: "#B0AC9C", marginTop: 10, textAlign: "center" },
  messaggio: { marginTop: 14, padding: "10px 12px", borderRadius: 8, fontSize: 13, fontWeight: 600 },
  messaggioSuccesso: { background: "#FBE5E7", color: "#C41E2F" },
  messaggioErrore: { background: "#FBEAE8", color: "#B23B2E" },
  scannerAvvio: { display: "flex", flexDirection: "column", gap: 10 },
  bottoneSecondario: { display: "flex", alignItems: "center", justifyContent: "center", gap: 6, background: "#fff", color: "#4A4A40", border: "1px solid #DAD6C8", padding: "11px", borderRadius: 8, fontSize: 14, fontWeight: 600, cursor: "pointer" },
  scannerBox: { position: "relative", borderRadius: 10, overflow: "hidden", background: "#000", marginBottom: 12 },
  video: { width: "100%", display: "block", aspectRatio: "4/3", objectFit: "cover" },
  mirino: { position: "absolute", top: "50%", left: "50%", width: "60%", aspectRatio: "1/1", transform: "translate(-50%, -50%)", border: "2px solid #FFFFFF", borderRadius: 12, boxShadow: "0 0 0 999px rgba(0,0,0,0.35)", pointerEvents: "none" },
  bottoneAnnulla: { position: "absolute", bottom: 12, left: "50%", transform: "translateX(-50%)", display: "flex", alignItems: "center", gap: 6, background: "rgba(0,0,0,0.6)", color: "#fff", border: "none", padding: "8px 14px", borderRadius: 20, fontSize: 13, cursor: "pointer" },
  chipRilevato: { fontSize: 12, color: "#C41E2F", background: "#FBE5E7", padding: "6px 10px", borderRadius: 6, fontWeight: 600, marginTop: -6 },
  puntiBadgeSconto: { background: "#F5D97A", color: "#6B4E00", fontWeight: 700, fontSize: 12, padding: "4px 10px", borderRadius: 20 },
  scontoBox: { display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, background: "#FFF8E6", border: "1px solid #F5D97A", borderRadius: 10, padding: "14px 16px", marginBottom: 16, flexWrap: "wrap" },
  scontoTitolo: { fontSize: 12, fontWeight: 700, color: "#6B4E00", textTransform: "uppercase", letterSpacing: "0.04em" },
  scontoValore: { fontSize: 14, fontWeight: 600, color: "#4A3A00" },
  progressoBox: { marginBottom: 16 },
  progressoTesto: { fontSize: 12, color: "#8A8A7C", marginBottom: 6 },
  progressoSfondo: { height: 8, background: "#EDEAE0", borderRadius: 20, overflow: "hidden" },
  progressoBarra: { height: "100%", background: "#C41E2F", borderRadius: 20, transition: "width 0.3s" },
  puntiStoricoNegativo: { color: "#B23B2E", fontWeight: 600 },
  toggleModalita: { display: "flex", gap: 6, marginBottom: 16, background: "#F0EEE5", padding: 4, borderRadius: 10 },
  toggleBtn: { flex: 1, padding: "8px 10px", border: "none", background: "transparent", borderRadius: 7, fontSize: 13, fontWeight: 600, color: "#7A7A6C", cursor: "pointer" },
  toggleBtnAttivo: { background: "#fff", color: "#1F2318", boxShadow: "0 1px 3px rgba(0,0,0,0.1)" },
  attesaBox: { textAlign: "center", background: "#FFF8E6", border: "1px solid #F5D97A", borderRadius: 10, padding: "20px 16px", marginBottom: 16 },
  attesaNome: { fontSize: 16, fontWeight: 700, color: "#1F2318" },
  attesaCountdown: { fontSize: 13, color: "#6B4E00", marginTop: 4, fontVariantNumeric: "tabular-nums" },
  bottoneAnnullaAttesa: { display: "inline-flex", alignItems: "center", gap: 6, background: "none", border: "1px solid #DAD6C8", color: "#8A8A7C", fontSize: 12, padding: "6px 12px", borderRadius: 20, cursor: "pointer", marginTop: 10 },
  simulaRiga: { display: "flex", flexDirection: "column", gap: 8, marginTop: 8, paddingTop: 16, borderTop: "1px dashed #E3E0D6" },
  simulaLabel: { fontSize: 11, textTransform: "uppercase", letterSpacing: "0.06em", color: "#B0AC9C", fontWeight: 700 },
  logBox: { marginTop: 14, display: "flex", flexDirection: "column", gap: 6 },
  logRiga: { fontSize: 12, padding: "8px 10px", borderRadius: 6, background: "#F7F5F0" },
  logOra: { fontFamily: "monospace", color: "#B0AC9C", marginRight: 6 },
  logAbbinato: { background: "#FBE5E7", color: "#C41E2F" },
  logScartato: { background: "#F0EEE5", color: "#8A8A7C" },
  logAttesa: { background: "#FFF8E6", color: "#6B4E00" },
  blocchettoStorico: { display: "flex", flexDirection: "column" },
  scontrinoTesto: { background: "#F7F5F0", border: "1px solid #E3E0D6", borderRadius: 8, padding: "12px 14px", fontSize: 11, lineHeight: 1.6, color: "#4A4A40", whiteSpace: "pre-wrap", margin: "0 0 8px", fontFamily: "monospace" },
  bottoneEmail: { display: "inline-flex", alignItems: "center", gap: 6, background: "none", border: "1px solid #DAD6C8", color: "#C41E2F", fontSize: 12, fontWeight: 600, padding: "6px 12px", borderRadius: 20, cursor: "pointer", marginTop: 8 },
  bottoneUsaCassa: { display: "inline-flex", alignItems: "center", gap: 6, background: "#C41E2F", border: "1px solid #C41E2F", color: "#fff", fontSize: 12, fontWeight: 600, padding: "6px 12px", borderRadius: 20, cursor: "pointer", marginTop: 8, marginLeft: 8 },
};
