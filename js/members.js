(() => {
  const menuButton = document.querySelector(".menu-toggle");
  const navigation = document.querySelector(".main-nav");
  if (menuButton && navigation) {
    menuButton.addEventListener("click", () => {
      const isOpen = navigation.classList.toggle("open");
      menuButton.setAttribute("aria-expanded", String(isOpen));
    });
  }

  const status = document.getElementById("directory-status");
  const search = document.getElementById("member-search");
  const tabs = [...document.querySelectorAll(".directory-tab")];
  const sections = [...document.querySelectorAll(".division-block")];
  let members = [];
  let activeFilter = "all";

  const divisionName = value => value === "competitive" ? "Competitive Players" : "Creators / Streamers";
  const setStatus = (text, error = false) => {
    status.textContent = text;
    status.classList.toggle("directory-error", error);
  };

  function makeCard(member) {
    const card = document.createElement("article");
    card.className = "public-roster-card";

    const avatar = document.createElement("div");
    avatar.className = "roster-avatar";
    if (member.avatar_url) {
      const img = document.createElement("img");
      img.src = member.avatar_url;
      img.alt = `${member.display_name} avatar`;
      img.loading = "lazy";
      img.referrerPolicy = "no-referrer";
      avatar.appendChild(img);
    } else {
      avatar.textContent = (member.display_name || "P").trim().charAt(0).toUpperCase();
    }

    const meta = document.createElement("div");
    meta.className = "roster-meta";
    const division = document.createElement("span");
    division.textContent = divisionName(member.directory_division);
    const name = document.createElement("h4");
    name.textContent = member.display_name || "PUNIX MEMBER";
    const bio = document.createElement("p");
    bio.textContent = member.bio || "PUNIX member";
    meta.append(division, name, bio);

    const link = document.createElement("a");
    link.className = "roster-open";
    link.href = `member.html?id=${encodeURIComponent(member.id)}`;
    link.textContent = "VIEW PROFILE ↗";

    card.append(avatar, meta, link);
    return card;
  }

  function render() {
    const query = search.value.trim().toLowerCase();
    const filtered = members.filter(member => {
      const divisionMatch = activeFilter === "all" || member.directory_division === activeFilter;
      const searchMatch = !query || [member.display_name, member.bio, divisionName(member.directory_division)]
        .some(value => (value || "").toLowerCase().includes(query));
      return divisionMatch && searchMatch;
    });

    sections.forEach(section => {
      const division = section.dataset.division;
      const matches = filtered.filter(member => member.directory_division === division);
      section.hidden = activeFilter !== "all" && activeFilter !== division;
      const oldGrid = section.querySelector(".public-roster-grid");
      const empty = section.querySelector(".member-empty-card");
      if (oldGrid) oldGrid.remove();
      if (matches.length) {
        empty.hidden = true;
        const grid = document.createElement("div");
        grid.className = "public-roster-grid";
        matches.forEach(member => grid.appendChild(makeCard(member)));
        section.appendChild(grid);
      } else {
        empty.hidden = false;
        const message = empty.querySelector("p");
        if (message) message.textContent = query ? "No matching public profiles in this division." : "No public profiles in this division yet.";
      }
    });

    const total = filtered.length;
    setStatus(`${total} PUBLIC ${total === 1 ? "MEMBER" : "MEMBERS"} FOUND · ${members.length} LISTED IN THE PUNIX NETWORK`);
  }

  tabs.forEach(button => button.addEventListener("click", () => {
    activeFilter = button.dataset.filter;
    tabs.forEach(tab => {
      const active = tab === button;
      tab.classList.toggle("active", active);
      tab.setAttribute("aria-pressed", String(active));
    });
    render();
  }));
  search.addEventListener("input", render);

  async function init() {
    const config = window.PUNIX_SUPABASE_CONFIG;
    if (!window.supabase || !config?.url || !config?.publishableKey) {
      setStatus("DIRECTORY CONNECTION IS NOT CONFIGURED. CHECK THE EXISTING SUPABASE CONFIGURATION.", true);
      return;
    }
    const client = window.supabase.createClient(config.url, config.publishableKey);
    const { data, error } = await client.from("public_member_directory")
      .select("id,display_name,avatar_url,bio,twitch_url,kick_url,youtube_url,tiktok_url,directory_division,created_at")
      .order("display_name", { ascending: true });
    if (error) {
      setStatus("COULD NOT LOAD THE PUBLIC ROSTER. CHECK THE SUPABASE DIRECTORY MIGRATION.", true);
      console.error("PUNIX public directory:", error.message);
      return;
    }
    members = data || [];
    render();
  }

  const year = document.getElementById("year");
  if (year) year.textContent = new Date().getFullYear();
  init().catch(error => {
    setStatus("COULD NOT LOAD THE PUBLIC ROSTER.", true);
    console.error(error);
  });
})();
