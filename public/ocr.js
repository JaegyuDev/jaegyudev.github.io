// OCR in the browser with Tesseract.js (Apache-2.0), self-hosted under vendor/tesseract.
// "tote" mode finds tote IDs (letter + 5 digits) on the orange-striped labels: it levels the photo using the
// stripe, reads it at several sizes with and without thresholding, and votes across the passes.
const $ = id => document.getElementById(id);
const bar = f => { $('bar').style.width = (f * 100) + '%'; };
const say = s => { $('meta').textContent = s; };
const abs = p => new URL(p, location.href).href; // the worker is built from a blob, so relative paths would break
const MAX_SIDE = 2000;
const MODES = ['tote', 'auto', 'sparse']; // auto: psm 3 page layout, sparse: psm 11 scattered text
let worker, mode = 0, busy = false, track = m => say(m.status);

async function getWorker() {
    if (worker) return worker;
    worker = await Tesseract.createWorker('eng', 1, {
        workerPath: abs('vendor/tesseract/worker.min.js'),
        corePath: abs('vendor/tesseract/core'),
        langPath: abs('vendor/tesseract'),
        logger: m => track(m),
    });
    return worker;
}

// ---- image helpers ----
function draw(bmp, side) { // bitmap scaled down so its longest side is at most `side`
    const s = Math.min(1, side / Math.max(bmp.width, bmp.height));
    const c = document.createElement('canvas');
    c.width = Math.round(bmp.width * s);
    c.height = Math.round(bmp.height * s);
    const g = c.getContext('2d', { willReadFrequently: true });
    g.imageSmoothingQuality = 'high';
    g.drawImage(bmp, 0, 0, c.width, c.height);
    return g.getImageData(0, 0, c.width, c.height);
}

function stretch(gr) { // contrast stretch, 1%..99%
    const hist = new Uint32Array(256);
    for (const v of gr) hist[v]++;
    const pct = p => { let n = 0; for (let v = 0; v < 256; v++) if ((n += hist[v]) >= gr.length * p) return v; return 255; };
    const lo = pct(0.01), hi = Math.max(pct(0.99), lo + 1);
    for (let i = 0; i < gr.length; i++) gr[i] = (gr[i] - lo) * 255 / (hi - lo);
}

function canvasOf(gr, w, h, ang = 0) { // gray array -> canvas, rotated counter-clockwise by `ang` degrees
    const c = document.createElement('canvas');
    c.width = w; c.height = h;
    const g = c.getContext('2d'), img = g.createImageData(w, h);
    for (let i = 0; i < gr.length; i++) img.data.set([gr[i], gr[i], gr[i], 255], i * 4);
    g.putImageData(img, 0, 0);
    if (!ang) return c;
    const t = ang * Math.PI / 180, cs = Math.abs(Math.cos(t)), sn = Math.abs(Math.sin(t));
    const r = document.createElement('canvas');
    r.width = Math.ceil(w * cs + h * sn);
    r.height = Math.ceil(w * sn + h * cs);
    const x = r.getContext('2d');
    x.fillStyle = '#fff';
    x.fillRect(0, 0, r.width, r.height);
    x.imageSmoothingQuality = 'high';
    x.translate(r.width / 2, r.height / 2);
    x.rotate(-t);
    x.drawImage(c, -w / 2, -h / 2);
    return r;
}

function plain(bmp) { // luminance gray + contrast stretch, for auto and sparse
    const img = draw(bmp, MAX_SIDE), d = img.data, gr = new Uint8ClampedArray(d.length / 4);
    for (let i = 0, j = 0; i < d.length; i += 4, j++) gr[j] = (d[i] * 77 + d[i + 1] * 150 + d[i + 2] * 29) >> 8;
    stretch(gr);
    return canvasOf(gr, img.width, img.height);
}

// ---- tote mode ----
function redGray(bmp, side) { // red channel: the orange stripe turns white, so text printed over it stays readable
    const img = draw(bmp, side), d = img.data, gr = new Uint8ClampedArray(d.length / 4);
    for (let i = 0, j = 0; i < d.length; i += 4, j++) gr[j] = d[i];
    stretch(gr);
    return { gr, w: img.width, h: img.height };
}

function adaptive({ gr, w, h }, block = 51, C = 15) { // local-mean threshold via an integral image
    const W = w + 1, I = new Float64Array(W * (h + 1)), r = block >> 1;
    for (let y = 0; y < h; y++) {
        let row = 0;
        for (let x = 0; x < w; x++) { row += gr[y * w + x]; I[(y + 1) * W + x + 1] = I[y * W + x + 1] + row; }
    }
    const out = new Uint8ClampedArray(gr.length);
    for (let y = 0; y < h; y++) {
        const y0 = Math.max(0, y - r), y1 = Math.min(h, y + r + 1);
        for (let x = 0; x < w; x++) {
            const x0 = Math.max(0, x - r), x1 = Math.min(w, x + r + 1);
            const mean = (I[y1 * W + x1] - I[y0 * W + x1] - I[y1 * W + x0] + I[y0 * W + x0]) / ((x1 - x0) * (y1 - y0));
            out[y * w + x] = gr[y * w + x] > mean - C ? 255 : 0;
        }
    }
    return { gr: out, w, h };
}

// tilt of the label in degrees (0 if no stripe found): long thin orange blob, direction from its principal axis
function stripeAngle(bmp) {
    const { data: d, width: w, height: h } = draw(bmp, 500);
    const mask = new Uint8Array(w * h);
    for (let i = 0, j = 0; i < d.length; i += 4, j++) {
        const r = d[i], g = d[i + 1], b = d[i + 2], mx = Math.max(r, g, b), df = mx - Math.min(r, g, b);
        if (!df || mx < 80 || 255 * df / mx < 140) continue;
        let hue = mx === r ? (g - b) / df * 60 : mx === g ? 120 + (b - r) / df * 60 : 240 + (r - g) / df * 60;
        if (hue < 0) hue += 360;
        hue /= 2;
        if (hue >= 3 && hue <= 15) mask[j] = 1;
    }
    const stack = new Int32Array(w * h);
    let best = null;
    for (let s = 0; s < mask.length; s++) {
        if (mask[s] !== 1) continue;
        let sp = 0, n = 0, sx = 0, sy = 0, sxx = 0, syy = 0, sxy = 0;
        const push = q => { if (mask[q] === 1) { mask[q] = 2; stack[sp++] = q; } };
        push(s);
        while (sp) {
            const p = stack[--sp], x = p % w, y = (p / w) | 0;
            n++; sx += x; sy += y; sxx += x * x; syy += y * y; sxy += x * y;
            if (x > 0) push(p - 1);
            if (x < w - 1) push(p + 1);
            if (y > 0) push(p - w);
            if (y < h - 1) push(p + w);
        }
        if (n < 75) continue;
        const mx = sx / n, my = sy / n, cxx = sxx / n - mx * mx, cyy = syy / n - my * my, cxy = sxy / n - mx * my;
        const tr = cxx + cyy, disc = Math.sqrt(Math.max(tr * tr / 4 - (cxx * cyy - cxy * cxy), 0));
        const aspect = Math.sqrt((tr / 2 + disc) / Math.max(tr / 2 - disc, 1e-6));
        const ang = 0.5 * Math.atan2(2 * cxy, cxx - cyy) * 180 / Math.PI;
        if (aspect >= 6 && Math.abs(ang) <= 40 && (!best || n * aspect > best.score)) best = { score: n * aspect, ang };
    }
    return best ? best.ang : 0;
}

const TOTE = /(?<![A-Z0-9])[A-Z][0-9OIlSBZ]{5}(?![0-9A-Za-z])/g; // letter + 5 digits, tolerating common digit look-alikes
const FIX = { O: '0', I: '1', l: '1', S: '5', B: '8', Z: '2' };
function toteIds(text) {
    const ids = [];
    for (const [m] of text.matchAll(TOTE)) {
        if (m.slice(1).replace(/\D/g, '').length < 3) continue; // mostly digits, so not a word
        ids.push(m[0] + m.slice(1).replace(/[OIlSBZ]/g, c => FIX[c]));
    }
    return ids;
}

const ranked = t => Object.entries(t).sort((a, b) => b[1] - a[1]);
const clear = t => { const r = ranked(t); return r.length > 0 && r[0][1] >= 2 && (r.length === 1 || r[0][1] - r[1][1] >= 2); };

async function tote(bmp) {
    const w = await getWorker(), tally = {};
    let ang = stripeAngle(bmp);
    if (Math.abs(ang) < 2.5) ang = 0; // a tiny tilt is mostly noise, and resampling for it only blurs the text
    // stage 2 only runs when stage 1 has no clear winner: nudge the angle a little
    const stages = [{ sides: [1200, 1600, 2000], jit: [0] }, { sides: [1200, 2000], jit: [-3, 0, 3] }];
    let done = 0, total = 12;
    track = () => { };
    for (const [si, st] of stages.entries()) {
        if (si && clear(tally)) break;
        if (si) total += 24;
        for (const side of st.sides) {
            const base = redGray(bmp, side);
            for (const src of [base, adaptive(base)]) {
                for (const j of st.jit) {
                    const cv = canvasOf(src.gr, src.w, src.h, ang + j);
                    for (const psm of ['3', '11']) {
                        await w.setParameters({ tessedit_pageseg_mode: psm });
                        const { data } = await w.recognize(cv);
                        for (const id of new Set(toteIds(data.text))) tally[id] = (tally[id] || 0) + 1;
                        bar(++done / total);
                        say(`reading, pass ${done} of up to ${total}`);
                        if (clear(tally)) return { tally, done };
                    }
                }
            }
        }
    }
    return { tally, done };
}

function lock(on) {
    busy = on;
    for (const id of ['cam', 'pick', 'mode']) $(id).disabled = on;
}

async function run(file) {
    if (busy || !file || !file.type.startsWith('image/')) return;
    lock(true);
    bar(0);
    $('prev').src = URL.createObjectURL(file);
    $('prev').hidden = false;
    try {
        const bmp = await createImageBitmap(file, { imageOrientation: 'from-image' });
        say('loading ocr engine (first run downloads about 7 MB)');
        track = m => say(m.status);
        const w = await getWorker();
        if (MODES[mode] === 'tote') {
            const { tally, done } = await tote(bmp);
            const r = ranked(tally);
            if (r.length) {
                $('out').value = r[0][0];
                const more = r.slice(1, 4).map(([id, n]) => `${id} (${n})`).join(', ');
                say(`${r[0][0]}, seen in ${r[0][1]} of ${done} passes` + (more ? `. also seen: ${more}` : ''));
            } else {
                track = () => { };
                await w.setParameters({ tessedit_pageseg_mode: '3' });
                const { data } = await w.recognize(plain(bmp));
                $('out').value = data.text.trim();
                say('no tote id found, showing all the text instead');
            }
        } else {
            say('preparing image');
            const canvas = plain(bmp);
            track = m => { say(m.status); if (m.status === 'recognizing text') bar(m.progress); };
            await w.setParameters({ tessedit_pageseg_mode: mode === 1 ? '3' : '11' });
            const { data } = await w.recognize(canvas);
            const text = data.text.trim();
            $('out').value = text;
            say(text ? `done, ${text.length} characters` : 'no text found, try another mode or a closer photo');
        }
        bar(1);
    } catch (e) {
        say('failed: ' + (e.message || e));
    }
    lock(false);
}

async function copy() {
    const t = $('out').value;
    if (!t) return;
    try { await navigator.clipboard.writeText(t); } catch { $('out').select(); document.execCommand('copy'); }
    $('copy').textContent = '❯ copied';
    setTimeout(() => { $('copy').textContent = '❯ copy'; }, 1200);
}

$('cam').onclick = () => $('f-cam').click();
$('pick').onclick = () => $('f-file').click();
$('mode').onclick = () => {
    mode = (mode + 1) % MODES.length;
    $('mode').textContent = `❯ mode: ${MODES[mode]}`;
};
for (const id of ['f-cam', 'f-file']) {
    $(id).onchange = e => { run(e.target.files[0]); e.target.value = ''; };
}
$('copy').onclick = copy;
$('clear').onclick = () => { $('out').value = ''; $('prev').hidden = true; bar(0); say('pick, drop or paste an image.'); };

addEventListener('paste', e => run([...e.clipboardData.files][0]));
addEventListener('dragover', e => e.preventDefault());
addEventListener('drop', e => { e.preventDefault(); run(e.dataTransfer.files[0]); });
