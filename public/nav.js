const fmt = slug => (slug === '/' ? '~' : '~' + slug);
const chevron = '❯';

const path = document.body.dataset.path || '/';
const pageIndex = Math.max(0, links.findIndex(l => l.slug === path));
let current = pageIndex;

const menu = document.getElementById('menu');

function render() {
    menu.innerHTML = links.map((link, i) => {
        const active = i === current;
        const here = i === pageIndex;
        return `<div class="row${active ? ' active' : ''}"${here ? ' aria-current="page"' : ''}>` +
            `<span class="row-arrow" aria-hidden="true">${chevron}</span>` +
            `<span class="row-slug">${fmt(link.slug)}</span>` +
            (here ? `<span class="row-star">*</span>` : '') +
            (active ? `<div class="cursor"></div>` : '') +
            `</div>`;
    }).join('');
}

function navigate() {
    const { url } = links[current];
    if (url.startsWith('http')) window.open(url, '_blank', 'noopener');
    else window.location.href = url;
}

const STEP = { ArrowDown: 1, ArrowUp: -1 };

addEventListener('keydown', e => {
    if (e.key in STEP) {
        e.preventDefault();
        current = (current + STEP[e.key] + links.length) % links.length;
        render();
    } else if (e.key === 'Enter') {
        navigate();
    }
});

render();