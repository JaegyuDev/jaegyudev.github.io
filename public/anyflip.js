// SPDX-License-Identifier: GPL-3.0-or-later
// Browser port of Lofter1/anyflip-downloader (GPLv3).
// All AnyFlip requests go through the Cloudflare relay for CORS.

const RELAY = 'https://anyflip-relay.CHANGEME.workers.dev';
const RETRIES = 2, RETRY_DELAY = 1000;

const $ = id => document.getElementById(id);
const sleep = ms => new Promise(r => setTimeout(r, ms));
const bar = f => { $('bar').style.width = (f * 100) + '%'; };
function log(msg) {
    const l = $('log');
    l.textContent += msg + '\n';
    l.scrollTop = l.scrollHeight;
}

async function get(url) {
    let err;
    for (let i = 0; i <= RETRIES; i++) {
        try {
            const r = await fetch(`${RELAY}/?url=${encodeURIComponent(url)}`);
            if (r.ok) return r;
            err = new Error(`${r.status} for ${url}`);
            if (r.status < 500 && r.status !== 429) break; // a 404 won't fix itself
        } catch (e) { err = e; }
        await sleep(RETRY_DELAY);
    }
    throw err;
}

// "https://anyflip.com/abcd/efgh/anything" -> "/abcd/efgh"
function bookPath(input) {
    const u = new URL(input);
    if (!/(^|\.)anyflip\.com$/.test(u.hostname)) throw new Error('not an anyflip.com url');
    const seg = u.pathname.split('/').filter(Boolean);
    if (seg.length < 2) throw new Error('url should look like anyflip.com/<user>/<book>');
    return `/${seg[0]}/${seg[1]}`;
}

function unquote(s) {
    try { return JSON.parse(`"${s}"`); } catch { return s; } // handles \uXXXX escapes in titles
}

function parseConfig(js) {
    const count = js.match(/"?(?:bookConfig\.)?(?:total)?[Pp]ageCount"?[=:]"?(\d+)/);
    if (!count) throw new Error('page count not found in config.js');
    const title = js.match(/"?(?:bookConfig\.)?bookTitle"?=\s*"(.*?)"|"title":"(.*?)"/);
    const names = [...js.matchAll(/"n":\["(.*?)"\]/g)].map(m => m[1].split('","')[0]);
    return { count: +count[1], title: title ? unquote(title[1] ?? title[2]) : '', names };
}

// Resolves ../ and drops repeated path segments (files/files/...), same as the Go version.
function cleanURL(raw) {
    let s = raw;
    try { s = decodeURI(raw); } catch {}
    const u = new URL(s.replaceAll('\\', '/'));
    const seg = u.pathname.split('/');
    u.pathname = seg.filter((x, i) => i === 0 || (x && x !== seg[i - 1])).join('/');
    return u.href;
}

function pageURLs(path, cfg) {
    const base = 'https://online.anyflip.com' + path;
    const urls = cfg.names.length
        ? cfg.names.slice(0, cfg.count).map(n => `${base}/files/large/${n}`)
        : Array.from({ length: cfg.count }, (_, i) => `${base}/files/mobile/${i + 1}.jpg`);
    return urls.map(cleanURL);
}

async function fetchPages(urls, threads, onPage) {
    const out = new Array(urls.length);
    let next = 0;
    async function worker() {
        while (next < urls.length) {
            const i = next++;
            out[i] = new Uint8Array(await (await get(urls[i])).arrayBuffer());
            onPage();
        }
    }
    await Promise.all(Array.from({ length: Math.min(threads, urls.length) }, worker));
    return out;
}

// Sniff by magic bytes since the relay may not pass a useful content-type.
async function embed(pdf, b) {
    if (b[0] === 0xff && b[1] === 0xd8) return pdf.embedJpg(b);
    if (b[0] === 0x89 && b[1] === 0x50) return pdf.embedPng(b);
    const bmp = await createImageBitmap(new Blob([b])); // webp etc: re-encode as jpeg
    const c = new OffscreenCanvas(bmp.width, bmp.height);
    c.getContext('2d').drawImage(bmp, 0, 0);
    const jpg = await c.convertToBlob({ type: 'image/jpeg', quality: 0.92 });
    return pdf.embedJpg(new Uint8Array(await jpg.arrayBuffer()));
}

function safeName(s) {
    s = s.replace(/[\\/:*?"<>|\x00-\x1f]/g, '').trim().replace(/^\.+|\.+$/g, '');
    return s || 'anyflip-download';
}

function save(bytes, name) {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([bytes], { type: 'application/pdf' }));
    a.download = name;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 10000);
}

$('form').addEventListener('submit', async e => {
    e.preventDefault();
    $('go').disabled = true;
    $('log').textContent = '';
    bar(0);
    try {
        const path = bookPath($('url').value.trim());
        log(`book ${path}`);
        const cfg = parseConfig(await (await get(`https://online.anyflip.com${path}/mobile/javascript/config.js`)).text());
        const urls = pageURLs(path, cfg);
        const name = safeName($('title').value.trim() || cfg.title || path.split('/').pop());
        log(`${urls.length} pages, "${name}"`);

        let done = 0;
        const imgs = await fetchPages(urls, +$('threads').value || 6, () => bar(++done / urls.length));

        log('building pdf');
        const pdf = await PDFLib.PDFDocument.create();
        pdf.setTitle(name);
        for (let i = 0; i < imgs.length; i++) {
            const img = await embed(pdf, imgs[i]);
            imgs[i] = null;
            pdf.addPage([img.width, img.height]).drawImage(img, { x: 0, y: 0, width: img.width, height: img.height });
        }
        save(await pdf.save(), name + '.pdf');
        log('done');
    } catch (err) {
        log(`error: ${err.message}`);
    }
    $('go').disabled = false;
});
