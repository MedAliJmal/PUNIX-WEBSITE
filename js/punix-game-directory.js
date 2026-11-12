/* Game Hub filters: this page is a static game directory, not a live news feed. */
document.addEventListener('DOMContentLoaded', () => {
  const cards = [...document.querySelectorAll('.pnx-game-card')];
  const buttons = [...document.querySelectorAll('[data-game-filter]')];
  const search = document.getElementById('game-search');
  const empty = document.getElementById('game-empty');
  if (!cards.length || !search || !empty) return;
  let platform = 'all';
  function filter() {
    const query = search.value.trim().toLowerCase();
    let visible = 0;
    cards.forEach(card => {
      const platforms = (card.dataset.platform || '').split(/\s+/);
      const matchesPlatform = platform === 'all' || platforms.includes(platform);
      const matchesSearch = !query || (card.dataset.search + ' ' + card.textContent).toLowerCase().includes(query);
      const show = matchesPlatform && matchesSearch;
      card.hidden = !show;
      if (show) visible++;
    });
    empty.hidden = visible > 0;
  }
  buttons.forEach(button => button.addEventListener('click', () => {
    platform = button.dataset.gameFilter;
    buttons.forEach(item => item.classList.toggle('is-active', item === button));
    filter();
  }));
  search.addEventListener('input', filter);
});
