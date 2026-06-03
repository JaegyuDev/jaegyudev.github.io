// `links` is defined in links.js, which must be loaded before this file.
const fmt = slug => (slug === '/' ? '~' : '~' + slug);

const path = document.body.dataset.path || '/';
const pageIndex = Math.max(0, links.findIndex(l => l.slug === path)); // the page you're on, gets the *
let current = pageIndex;                                              // where the ❯ selector sits

const menu = document.getElementById('menu');
const chevron = '❯';

// move the selector; only re-render when it actually changes (prevents a hover re-render loop)
function select(i) {
    if (i !== current) { current = i; render(); }
}

function render() {
    menu.innerHTML = links.map((link, i) => {
        const active = i === current;
        const here = i === pageIndex;
        const external = link.url.startsWith('http');
        return `<a class="row${active ? ' active' : ''}" href="${link.url}"` +
            (here ? ' aria-current="page"' : '') +
            (external ? ' target="_blank" rel="noopener"' : '') + '>' +
            `<span class="row-arrow" aria-hidden="true">${chevron}</span>` +
            `<span class="row-slug">${fmt(link.slug)}</span>` +
            (here ? `<span class="row-star">*</span>` : '') +
            (active ? `<div class="cursor"></div>` : '') +
            `</a>`;
    }).join('');
}

const STEP = { ArrowDown: 1, ArrowUp: -1 };

addEventListener('keydown', e => {
    if (e.key in STEP) {
        e.preventDefault();
        select((current + STEP[e.key] + links.length) % links.length);
    } else if (e.key === 'Enter' && !menu.contains(document.activeElement)) {
        // arrow-key model: activate the highlighted row (browser handles Enter if a row is focused)
        menu.children[current]?.click();
    }
});

// pointer follows the chevron: hover moves the selector, leaving returns it to the current page
menu.addEventListener('mouseover', e => {
    const row = e.target.closest('.row');
    if (row) select([...menu.children].indexOf(row));
});
menu.addEventListener('mouseleave', () => select(pageIndex));

render();