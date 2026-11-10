// PUNIX homepage interactions
const menuButton = document.querySelector(".menu-toggle");
const navigation = document.querySelector(".main-nav");

menuButton.addEventListener("click", () => {
  const isOpen = navigation.classList.toggle("open");
  menuButton.setAttribute("aria-expanded", String(isOpen));
  menuButton.setAttribute("aria-label", isOpen ? "Close navigation" : "Open navigation");
});

navigation.querySelectorAll("a").forEach((link) => {
  link.addEventListener("click", () => {
    navigation.classList.remove("open");
    menuButton.setAttribute("aria-expanded", "false");
    menuButton.setAttribute("aria-label", "Open navigation");
  });
});

// Reveal sections as they enter the viewport.
const revealItems = document.querySelectorAll(".reveal");
if ("IntersectionObserver" in window) {
  const observer = new IntersectionObserver((entries, currentObserver) => {
    entries.forEach((entry) => {
      if (entry.isIntersecting) {
        entry.target.classList.add("visible");
        currentObserver.unobserve(entry.target);
      }
    });
  }, { threshold: 0.12 });
  revealItems.forEach((item) => observer.observe(item));
} else {
  revealItems.forEach((item) => item.classList.add("visible"));
}

// Keep the copyright year current.
document.querySelector("#year").textContent = new Date().getFullYear();


// ------------------------------------------------------------
// PUNIX KICK CONTENT SETUP
// Add real Kick usernames and video links in the two lists below.
// Do not add API secrets or access tokens to this public file.
// ------------------------------------------------------------

// Add one entry per PUNIX creator. Use the username from kick.com/USERNAME.
const PUNIX_KICK_CREATORS = [
  // Example:
  // { name: "Creator Display Name", username: "kick_username", game: "VALORANT" },
];

// Add recent videos manually. Use the Kick video URL and a thumbnail image URL.
// Example thumbnail: a publicly accessible image URL or a file in assets/images/.
const PUNIX_KICK_VIDEOS = [
  // Example:
  // {
  //   title: "Ranked grind — best moments",
  //   creator: "Creator Display Name",
  //   date: "NEW VIDEO",
  //   url: "https://kick.com/USERNAME/videos/VIDEO_ID",
  //   thumbnail: "assets/images/video-thumbnail.jpg"
  // },
];

function validKickUsername(username) {
  return typeof username === "string" &&
    /^[a-zA-Z0-9_]{1,25}$/.test(username) &&
    !["your_kick_username", "username"].includes(username.toLowerCase());
}

function renderKickHub() {
  const creatorList = document.querySelector("#kick-creator-list");
  const playerWrap = document.querySelector("#kick-player-wrap");
  const videoGrid = document.querySelector("#kick-video-grid");
  if (!creatorList || !playerWrap || !videoGrid) return;

  const creators = PUNIX_KICK_CREATORS.filter((creator) =>
    creator && creator.name && validKickUsername(creator.username)
  );

  if (creators.length) {
    creatorList.innerHTML = "";
    creators.forEach((creator, index) => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = `kick-creator-button${index === 0 ? " selected" : ""}`;
      button.innerHTML = `
        <span class="kick-avatar" aria-hidden="true">${creator.name.trim().charAt(0).toUpperCase()}</span>
        <span class="kick-creator-info">
          <strong>${escapeKickText(creator.name)}</strong>
          <small>${escapeKickText(creator.game || "PUNIX CREATOR")} · KICK</small>
        </span>
        <span class="kick-open-arrow" aria-hidden="true">↗</span>
      `;
      button.addEventListener("click", () => {
        creatorList.querySelectorAll(".kick-creator-button").forEach((item) => item.classList.remove("selected"));
        button.classList.add("selected");
        showKickPlayer(creator, playerWrap);
      });
      creatorList.appendChild(button);
    });
    showKickPlayer(creators[0], playerWrap);
  } else {
    creatorList.innerHTML = '<div class="kick-list-empty">No creator channels added yet. Add usernames in <code>js/main.js</code>.</div>';
    playerWrap.innerHTML = `
      <div class="kick-empty-state">
        <span class="live-dot"></span>
        <strong>YOUR PUNIX LIVE HUB</strong>
        <p>Add your creators' Kick usernames in <code>js/main.js</code> to display their livestreams here.</p>
      </div>`;
  }

  if (PUNIX_KICK_VIDEOS.length) {
    videoGrid.innerHTML = "";
    PUNIX_KICK_VIDEOS.forEach((video) => {
      if (!video || !video.title || !video.creator || !isSafeKickVideoUrl(video.url)) return;
      const card = document.createElement("a");
      card.className = "kick-video-card";
      card.href = video.url;
      card.target = "_blank";
      card.rel = "noopener noreferrer";
      const thumb = video.thumbnail ? `style="background-image:url('${escapeKickAttr(video.thumbnail)}')"` : "";
      card.innerHTML = `
        <div class="kick-video-thumb" ${thumb}><span class="kick-play-icon">▶</span></div>
        <div class="kick-video-details">
          <div class="kick-video-meta"><span>${escapeKickText(video.creator)}</span><span>${escapeKickText(video.date || "KICK VIDEO")}</span></div>
          <h3>${escapeKickText(video.title)}</h3>
          <p>WATCH ON KICK ↗</p>
        </div>`;
      videoGrid.appendChild(card);
    });
    if (!videoGrid.children.length) showEmptyVideos(videoGrid);
  } else {
    showEmptyVideos(videoGrid);
  }
}

function showKickPlayer(creator, container) {
  const iframe = document.createElement("iframe");
  iframe.src = `https://player.kick.com/${encodeURIComponent(creator.username)}?autoplay=false&muted=true`;
  iframe.title = `Kick livestream — ${creator.name}`;
  iframe.allow = "autoplay; fullscreen; picture-in-picture";
  iframe.allowFullscreen = true;
  iframe.loading = "lazy";
  iframe.referrerPolicy = "strict-origin-when-cross-origin";
  container.replaceChildren(iframe);
}

function showEmptyVideos(container) {
  container.innerHTML = `
    <div class="kick-videos-empty">
      <span class="empty-video-icon">▶</span>
      <strong>FRESH CONTENT, COMING UP.</strong>
      <p>Add recent Kick video links, titles and thumbnail images in <code>js/main.js</code>. They'll appear here automatically.</p>
    </div>`;
}

function isSafeKickVideoUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === "https:" && (url.hostname === "kick.com" || url.hostname.endsWith(".kick.com"));
  } catch {
    return false;
  }
}

function escapeKickText(value) {
  return String(value).replace(/[&<>"']/g, (char) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
  })[char]);
}
function escapeKickAttr(value) {
  return escapeKickText(value).replace(/`/g, "&#96;");
}

document.querySelectorAll("[data-watch-tab]").forEach((tab) => {
  tab.addEventListener("click", () => {
    const selected = tab.dataset.watchTab;
    document.querySelectorAll("[data-watch-tab]").forEach((item) => {
      const active = item === tab;
      item.classList.toggle("active", active);
      item.setAttribute("aria-selected", String(active));
    });
    document.querySelector("#live-panel").hidden = selected !== "live";
    document.querySelector("#videos-panel").hidden = selected !== "videos";
  });
});

renderKickHub();
