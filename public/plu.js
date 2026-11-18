// Data: IFPS PLU database (ifpsglobal.com), exported to plu.json as {c: commodities, r: notes, d: [plu, commodity, variety, size, note]}.
const $ = id => document.getElementById(id);
const MAX = 40;
let rows = [], organic = false;

const esc = s => s.replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);

function search(q) {
    q = q.trim().toLowerCase();
    if (!q) return [];
    if (/^\d+$/.test(q)) {
        const code = q.length === 5 && q[0] === '9' ? q.slice(1) : q; // 94011 is organic 4011
        return rows.filter(r => String(r.plu).startsWith(code));
    }
    const terms = q.split(/\s+/);
    // whole-word matches first (gala apples before galangal), then commodity prefix, then the rest; retailer-assigned last
    const word = (r, t) => r.words.some(w => w === t || w === t + 's');
    const score = r => (terms.every(t => word(r, t)) ? 0 : r.com.toLowerCase().startsWith(terms[0]) ? 1 : 2) + (r.ra ? 3 : 0);
    return rows.filter(r => terms.every(t => r.hay.includes(t)))
        .map(r => [score(r), r]).sort((a, b) => a[0] - b[0]).map(x => x[1]); // stable: ties stay in code order
}

function render() {
    const q = $('q').value;
    const hits = search(q);
    const org = organic || (/^9\d{4}$/.test(q.trim()));
    $('meta').textContent = !q.trim() ? `${rows.length} codes`
        : hits.length > MAX ? `showing ${MAX} of ${hits.length}`
        : `${hits.length} result${hits.length === 1 ? '' : 's'}`;
    $('results').innerHTML = hits.slice(0, MAX).map(r =>
        `<div class="plu-row${r.ra ? ' dim' : ''}"><span class="plu-code">${org ? 9 : ''}${r.plu}</span>` +
        `<span class="plu-name">${esc(r.com)}` +
        (r.variety || r.size ? `<small>${esc([r.variety, r.size].filter(Boolean).join(' · '))}</small>` : '') +
        (r.note ? `<small class="note">${esc(r.note)}</small>` : '') +
        `</span></div>`).join('');
}

$('q').addEventListener('input', render);
$('org').addEventListener('click', () => {
    organic = !organic;
    $('org').textContent = `❯ organic: ${organic ? 'on' : 'off'}`;
    render();
    $('q').focus();
});

fetch('plu.json').then(r => r.json()).then(j => {
    rows = j.d.map(([plu, c, variety, size, n]) => ({
        plu, com: j.c[c], variety, size, note: n ? j.r[n - 1] : '',
        ra: /^retailer assigned/i.test(variety),
        hay: `${j.c[c]} ${variety} ${size}`.toLowerCase(),
        words: `${j.c[c]} ${variety} ${size}`.toLowerCase().split(/[^a-z0-9]+/),
    }));
    render();
}).catch(() => { $('meta').textContent = 'could not load plu.json'; });
