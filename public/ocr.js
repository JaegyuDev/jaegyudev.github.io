// OCR in the browser with Tesseract.js (Apache-2.0), self-hosted under vendor/tesseract.
const $ = id => document.getElementById(id);
const bar = f => { $('bar').style.width = (f * 100) + '%'; };
const say = s => { $('meta').textContent = s; };
const abs = p => new URL(p, location.href).href; // the worker is built from a blob, so relative paths would break
const MAX_SIDE = 2000;
const MODES = [['auto', '3'], ['sparse', '11']]; // psm 3: page layout, psm 11: scattered text (labels, signs)
let worker, mode = 0, busy = false;

async function getWorker() {
    if (worker) return worker;
    worker = await Tesseract.createWorker('eng', 1, {
        workerPath: abs('vendor/tesseract/worker.min.js'),
        corePath: abs('vendor/tesseract/core'),
        langPath: abs('vendor/tesseract'),
        logger: m => {
            say(m.status);
            if (m.status === 'recognizing text') bar(m.progress);
        },
    });
    return worker;
}

// downscale phone-sized photos, then grayscale and stretch contrast (1%..99%) so dim shots read better
async function prep(file) {
    const bmp = await createImageBitmap(file, { imageOrientation: 'from-image' });
    const s = Math.min(1, MAX_SIDE / Math.max(bmp.width, bmp.height));
    const c = document.createElement('canvas');
    c.width = Math.round(bmp.width * s);
    c.height = Math.round(bmp.height * s);
    const g = c.getContext('2d', { willReadFrequently: true });
    g.drawImage(bmp, 0, 0, c.width, c.height);
    const img = g.getImageData(0, 0, c.width, c.height), d = img.data;
    const gray = new Uint8Array(d.length / 4), hist = new Uint32Array(256);
    for (let i = 0, j = 0; i < d.length; i += 4, j++) {
        gray[j] = (d[i] * 77 + d[i + 1] * 150 + d[i + 2] * 29) >> 8;
        hist[gray[j]]++;
    }
    const pct = p => { let n = 0; for (let v = 0; v < 256; v++) if ((n += hist[v]) >= gray.length * p) return v; return 255; };
    const lo = pct(0.01), hi = Math.max(pct(0.99), lo + 1);
    for (let i = 0, j = 0; i < d.length; i += 4, j++) {
        d[i] = d[i + 1] = d[i + 2] = Math.max(0, Math.min(255, (gray[j] - lo) * 255 / (hi - lo)));
    }
    g.putImageData(img, 0, 0);
    return c;
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
        say('preparing image');
        const canvas = await prep(file);
        say('loading ocr engine (first run downloads about 7 MB)');
        const w = await getWorker();
        await w.setParameters({ tessedit_pageseg_mode: MODES[mode][1] });
        const { data } = await w.recognize(canvas);
        const text = data.text.trim();
        $('out').value = text;
        say(text ? `done, ${text.length} characters` : 'no text found, try the other mode or a closer photo');
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
    $('mode').textContent = `❯ mode: ${MODES[mode][0]}`;
};
for (const id of ['f-cam', 'f-file']) {
    $(id).onchange = e => { run(e.target.files[0]); e.target.value = ''; };
}
$('copy').onclick = copy;
$('clear').onclick = () => { $('out').value = ''; $('prev').hidden = true; bar(0); say('pick, drop or paste an image.'); };

addEventListener('paste', e => run([...e.clipboardData.files][0]));
addEventListener('dragover', e => e.preventDefault());
addEventListener('drop', e => { e.preventDefault(); run(e.dataTransfer.files[0]); });
