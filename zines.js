// ── Junki zines ──────────────────────────────────────────────────────
// One list, used by the home page hero and by the catalog.
// Add, remove or edit entries here.
//
//   slug          used in links: catalog.html?zine=<slug>
//   title         shown in the hero meta block and on the catalog card
//   issue         printed on the cover ("Nº 01")
//   year          leave null until known (shows "—")
//   contributors  names, shown stacked in the hero
//   price         euro price, e.g. '€5'
//   priceDkk      Danish kroner price, e.g. '37 kr'; shown next to the euro price
//   description   catalog card text
//   front / back  optional image paths for real cover scans. When empty,
//                 a riso-style placeholder cover is generated.
//   inks          two riso ink colours for the generated cover
//   paper         'uncoated' (matte) or 'glossy'
//   kind          'set' for the box set (a slipcase with all the zines, poster and
//                 stickers); it is shown last in the carousel
//   contents      for the box set: what's inside, shown instead of contributors
//   format        shown in the home page table; defaults to 'A5, stapled'
//
// Optional, used on the zine's own page (index.html?zine=<slug>):
//   intro         paragraph under the hero (falls back to description)
//   formats       little round chips in the details table, e.g. ['A5', '24 pp']
//   spreads       photos for the ribbon gallery (click to enlarge), e.g. ['img/issue-01/spread-1.jpg', ...]
//                 any shape works: wide spreads, single pages, photos. Until then it shows
//                 placeholder images built from the covers
//
// Everything below is placeholder copy. Replace it with the real issues.
window.JUNKI_ZINES = [
  { slug: 'issue-01', title: 'Issue 01', issue: 'Nº 01', year: null, contributors: ['Contributor A', 'Contributor B'], price: '€5', priceDkk: '37 kr', description: 'Placeholder description for issue 01.', front: '', back: '', inks: ['#FF48B0', '#0078BF'], paper: 'uncoated' },
  { slug: 'issue-02', title: 'Issue 02', issue: 'Nº 02', year: null, contributors: ['Contributor A', 'Contributor C'], price: '€5', priceDkk: '37 kr', description: 'Placeholder description for issue 02.', front: '', back: '', inks: ['#FFE800', '#FF48B0'], paper: 'uncoated' },
  { slug: 'issue-03', title: 'Issue 03', issue: 'Nº 03', year: null, contributors: ['Contributor B'], price: '€5', priceDkk: '37 kr', description: 'Placeholder description for issue 03.', front: '', back: '', inks: ['#00A95C', '#FF6C2F'], paper: 'glossy' },
  { slug: 'issue-04', title: 'Issue 04', issue: 'Nº 04', year: null, contributors: ['Contributor D', 'Contributor E', 'Contributor F'], price: '€5', priceDkk: '37 kr', description: 'Placeholder description for issue 04.', front: '', back: '', inks: ['#0078BF', '#FFE800'], paper: 'uncoated' },
  { slug: 'issue-05', title: 'Issue 05', issue: 'Nº 05', year: null, contributors: ['Contributor A'], price: '€5', priceDkk: '37 kr', description: 'Placeholder description for issue 05.', front: '', back: '', inks: ['#FF6C2F', '#765BA7'], paper: 'uncoated' },
  { slug: 'issue-06', title: 'Issue 06', issue: 'Nº 06', year: null, contributors: ['Contributor C', 'Contributor G'], price: '€5', priceDkk: '37 kr', description: 'Placeholder description for issue 06.', front: '', back: '', inks: ['#765BA7', '#00A95C'], paper: 'glossy' },
  // The box set: always keep it last.
  { slug: 'box-set', kind: 'set', title: 'Box Set', issue: 'Nº 07', year: null, contributors: [], contents: ['Issues Nº 01–06', 'Poster', 'Stickers'], format: 'Slipcase, poster & stickers', formats: ['Slipcase', 'Poster', 'Stickers'], price: '€25', priceDkk: '186 kr', description: 'All six Junki zines in one slipcase, with a poster and a sheet of stickers.', front: '', back: '', inks: ['#FF48B0', '#0078BF'], paper: 'uncoated' },
];

// "€5 / 37 kr": how a price is shown everywhere on the site
window.junkiPrice = z => [z && z.price, z && z.priceDkk].filter(Boolean).join(' / ');
