// Code 128 generator: bars only, drawn to canvas. Subset C for digit runs, subset B for the rest.
const $ = id => document.getElementById(id);
const P = ('212222 222122 222221 121223 121322 131222 122213 122312 132212 221213 221312 231212 112232 122132 122231 113222 ' +
    '123122 123221 223211 221132 221231 213212 223112 312131 311222 321122 321221 312212 322112 322211 212123 212321 ' +
    '232121 111323 131123 131321 112313 132113 132311 211313 231113 231311 112133 112331 132131 113123 113321 133121 ' +
    '313121 211331 231131 213113 213311 213131 311123 311321 331121 312113 312311 332111 314111 221411 431111 111224 ' +
    '111422 121124 121421 141122 141221 112214 112412 122114 122411 142112 142211 241211 221114 413111 241112 134111 ' +
    '111242 121142 121241 114212 124112 124211 411212 421112 421211 212141 214121 412121 111143 111341 131141 114113 ' +
    '114311 411113 411311 113141 114131 311141 411131 211412 211214 211232 2331112').split(' ');
const START_B = 104, START_C = 105, TO_B = 100, TO_C = 99, STOP = 106;

function encode(s) {
    const out = [];
    let c = false, i = 0;
    const run = k => { let n = 0; while (k + n < s.length && s[k + n] >= '0' && s[k + n] <= '9') n++; return n; };
    const r0 = run(0);
    c = r0 >= 4 || (r0 === s.length && r0 >= 2 && r0 % 2 === 0);
    out.push(c ? START_C : START_B);
    while (i < s.length) {
        const r = run(i);
        if (c) {
            if (r >= 2) { out.push(+s.slice(i, i + 2)); i += 2; }
            else { out.push(TO_B); c = false; }
        } else if (r >= 6 || (r >= 4 && i + r === s.length)) {
            out.push(TO_C); c = true;
        } else { out.push(s.charCodeAt(i) - 32); i++; }
    }
    let sum = out[0];
    for (let k = 1; k < out.length; k++) sum += out[k] * k;
    out.push(sum % 103, STOP);
    return out.map(v => P[v]).join('');
}

const QUIET = 10; // modules of white on each side
function draw(text, avail) {
    const w = encode(text), mods = [...w].reduce((a, d) => a + +d, 0) + QUIET * 2;
    const m = Math.max(2, Math.min(4, Math.floor(avail / mods)));
    const cv = document.createElement('canvas');
    cv.width = mods * m;
    cv.height = Math.round(mods * m * 0.17) + 20;
    const g = cv.getContext('2d');
    g.fillStyle = '#fff';
    g.fillRect(0, 0, cv.width, cv.height);
    g.fillStyle = '#000';
    let x = QUIET * m;
    [...w].forEach((d, k) => { if (k % 2 === 0) g.fillRect(x, 10, d * m, cv.height - 20); x += d * m; });
    return cv;
}

function render() {
    const lines = $('ids').value.split('\n').map(l => l.trim()).filter(Boolean);
    const box = $('codes'), bad = [];
    box.textContent = '';
    const avail = Math.max(200, Math.min(innerWidth - 40, 700));
    for (const l of lines) {
        if (/[^\x20-\x7e]/.test(l)) { bad.push(l); continue; }
        const cv = draw(l, avail);
        cv.style.maxWidth = '100%';
        cv.style.display = 'block';
        cv.style.marginBottom = '0.6rem';
        box.append(cv);
    }
    $('meta').textContent = (lines.length ? `${lines.length - bad.length} barcode${lines.length - bad.length === 1 ? '' : 's'}` : 'type or paste ids, one per line.') +
        (bad.length ? `. skipped, unsupported characters: ${bad.join(', ')}` : '');
    try { localStorage.setItem('barcode-ids', $('ids').value); } catch { }
}

$('ids').addEventListener('input', render);
addEventListener('resize', render);
$('clear').onclick = () => { $('ids').value = ''; render(); $('ids').focus(); };
$('paste').onclick = async () => {
    try { $('ids').value = await navigator.clipboard.readText(); render(); } catch { $('ids').focus(); $('meta').textContent = 'clipboard blocked, long-press the box and paste.'; }
};
try { $('ids').value = localStorage.getItem('barcode-ids') || ''; } catch { }
render();
