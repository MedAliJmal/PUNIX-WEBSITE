/* Adds a Media Manager shortcut to the existing verified admin sidebar. */
(() => {
  const addLink = () => {
    const sidebar = document.querySelector('.pnx-admin-sidebar');
    if (!sidebar || sidebar.querySelector('[data-media-manager-link]')) return !!sidebar;
    const link = document.createElement('a');
    link.className = 'pnx-admin-nav-item';
    link.href = 'admin-media.html';
    link.dataset.mediaManagerLink = 'true';
    link.innerHTML = '<span>04</span> Media Manager';
    link.style.display = 'flex';
    link.style.alignItems = 'center';
    link.style.textDecoration = 'none';
    sidebar.appendChild(link);
    return true;
  };
  if (addLink()) return;
  const app = document.getElementById('admin-app');
  if (!app) return;
  const observer = new MutationObserver(() => { if (addLink()) observer.disconnect(); });
  observer.observe(app, {attributes:true, childList:true, subtree:true});
})();
