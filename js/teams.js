(() => {
  const cfg = window.PUNIX_SUPABASE_CONFIG;
  const status = document.getElementById('teams-status');
  const groups = document.getElementById('teams-groups');
  const count = document.getElementById('teams-count');
  const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const safeUrl = value => { try { const u = new URL(value); return u.protocol === 'https:' ? u.href : ''; } catch { return ''; } };
  if (!window.supabase || !cfg?.url || !cfg?.publishableKey) { status.textContent = 'Website connection is not configured.'; return; }
  const client = window.supabase.createClient(cfg.url, cfg.publishableKey);
  const division = {men:"MEN'S TEAM",women:"WOMEN'S TEAM",mixed:'MIXED TEAM',open:'OPEN DIVISION'};
  const role = {captain:'CAPTAIN',player:'PLAYER',coach:'COACH',manager:'MANAGER',substitute:'SUBSTITUTE'};
  async function load() {
    const {data: teams, error} = await client.from('public_teams').select('*').order('game_name').order('display_order').order('team_name');
    if (error) { status.textContent = 'Could not load teams. Make sure the PUNIX teams database migration has been run.'; return; }
    if (!teams?.length) { status.textContent = 'No teams have been published yet. Check back soon.'; count.textContent = '0 ACTIVE TEAMS'; return; }
    const ids = teams.map(t=>t.id);
    const {data: members, error: memberError} = await client.from('public_team_roster').select('*').in('team_id',ids).order('display_order');
    if (memberError) { status.textContent = 'Teams loaded, but their rosters could not be displayed.'; return; }
    const grouped = new Map(); teams.forEach(t=>{const key=t.game_name; if(!grouped.has(key)) grouped.set(key,[]); grouped.get(key).push(t);});
    count.textContent = `${teams.length} ${teams.length===1?'TEAM':'TEAMS'} · ${grouped.size} ${grouped.size===1?'GAME':'GAMES'}`;
    status.hidden = true;
    groups.innerHTML = [...grouped.entries()].map(([game, list], index)=>`<section class="game-group"><div class="game-group-heading"><span class="game-number">${String(index+1).padStart(2,'0')}</span><h2>${esc(game)}</h2><span class="game-team-count">${list.length} ${list.length===1?'ROSTER':'ROSTERS'}</span></div><div class="team-cards">${list.map(team=>{const roster=(members||[]).filter(m=>m.team_id===team.id);const logo=safeUrl(team.logo_url);return `<article class="public-team-card"><div class="public-team-top"><div class="public-team-mark">${logo?`<img src="${esc(logo)}" alt="${esc(team.team_name)} logo">`:'<span>PX</span>'}</div><div class="public-team-meta"><span>${esc(division[team.division]||'COMPETITIVE TEAM')}</span><h3>${esc(team.team_name)}</h3><small class="team-state ${team.status==='recruiting'?'recruiting':''}">${team.status==='recruiting'?'RECRUITING':'ACTIVE ROSTER'}</small></div></div>${team.description?`<p class="public-team-description">${esc(team.description)}</p>`:''}<div class="roster-heading"><span>OFFICIAL ROSTER</span><span>${roster.length} ${roster.length===1?'MEMBER':'MEMBERS'}</span></div>${roster.length?`<div class="public-roster">${roster.map(m=>`<div class="public-roster-member"><div class="roster-avatar">${safeUrl(m.avatar_url)?`<img src="${esc(safeUrl(m.avatar_url))}" alt="">`:`<span>${esc((m.display_name||'P').slice(0,1).toUpperCase())}</span>`}</div><div class="roster-member-name">${esc(m.display_name)}</div><span class="roster-member-role">${esc(role[m.member_role]||'PLAYER')}</span></div>`).join('')}</div>`:'<p class="empty-roster">Roster announcement coming soon.</p>'}</article>`}).join('')}</div></section>`).join('');
  }
  const toggle=document.querySelector('.menu-toggle'); const nav=document.querySelector('.main-nav'); if(toggle&&nav) toggle.addEventListener('click',()=>{const open=nav.classList.toggle('open');toggle.setAttribute('aria-expanded',String(open));});
  load();
})();