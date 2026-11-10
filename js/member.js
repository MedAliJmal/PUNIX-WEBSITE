(() => {
  const status = document.getElementById("public-member-status");
  const card = document.getElementById("public-member-card");
  const errorPanel = document.getElementById("public-member-error");
  const errorText = document.getElementById("public-member-error-text");
  const setStatus = (message, isError = false) => {
    status.classList.toggle("error", isError);
    status.innerHTML = "<span></span> " + message;
  };
  const showError = (message) => {
    setStatus("MEMBER PROFILE UNAVAILABLE", true);
    errorText.textContent = message;
    errorPanel.hidden = false;
  };
  const safeUrl = (value) => {
    if (!value) return null;
    try {
      const parsed = new URL(value);
      return parsed.protocol === "https:" ? parsed.href : null;
    } catch { return null; }
  };
  const platformHost = {
    Twitch: "twitch.tv", Kick: "kick.com", YouTube: "youtube.com", TikTok: "tiktok.com"
  };

  async function init() {
    const memberId = new URLSearchParams(window.location.search).get("id");
    if (!memberId) { showError("No member was selected. Return to the directory and choose a profile."); return; }

    const config = window.PUNIX_SUPABASE_CONFIG;
    if (!window.supabase || !config?.url || !config?.publishableKey) {
      showError("The profile connection is not configured. Please try again later.");
      return;
    }

    const client = window.supabase.createClient(config.url, config.publishableKey);
    const { data, error } = await client.from("public_member_directory")
      .select("id,display_name,avatar_url,bio,twitch_url,kick_url,youtube_url,tiktok_url,directory_division,created_at")
      .eq("id", memberId).maybeSingle();

    if (error) {
      console.error("PUNIX public profile:", error.message);
      showError("We couldn't load this profile right now. Please return to the roster and try again.");
      return;
    }
    if (!data) { showError("This profile is not public or no longer exists."); return; }

    const name = (data.display_name || "PUNIX MEMBER").trim();
    document.title = `${name} — PUNIX`;
    document.getElementById("public-member-name").textContent = name;
    document.getElementById("public-member-bio").textContent = data.bio?.trim() || "A member of the PUNIX network. More about this member coming soon.";
    const division = data.directory_division === "competitive" ? "COMPETITIVE PLAYER" :
      data.directory_division === "management" ? "MANAGEMENT" : "CREATOR / STREAMER";
    document.getElementById("public-member-division").textContent = division;

    const avatarUrl = safeUrl(data.avatar_url);
    const avatar = document.getElementById("public-member-avatar");
    const initial = document.getElementById("public-member-initial");
    initial.textContent = name.charAt(0).toUpperCase();
    if (avatarUrl) {
      avatar.src = avatarUrl;
      avatar.alt = `${name} profile avatar`;
      avatar.addEventListener("load", () => { avatar.hidden = false; initial.hidden = true; }, { once:true });
      avatar.addEventListener("error", () => { avatar.hidden = true; initial.hidden = false; }, { once:true });
    }

    const socials = document.getElementById("public-member-socials");
    const platforms = [["Twitch",data.twitch_url],["Kick",data.kick_url],["YouTube",data.youtube_url],["TikTok",data.tiktok_url]];
    platforms.forEach(([label, value]) => {
      const url = safeUrl(value);
      if (!url) return;
      const link = document.createElement("a");
      link.href = url; link.target = "_blank"; link.rel = "noopener noreferrer";
      const title = document.createElement("strong"); title.textContent = label.toUpperCase();
      const arrow = document.createElement("span"); arrow.textContent = "↗";
      link.append(title, arrow); socials.appendChild(link);
    });
    if (!socials.children.length) document.getElementById("public-member-no-socials").hidden = false;

    if (data.created_at) {
      const date = new Date(data.created_at);
      if (!Number.isNaN(date.getTime())) {
        document.getElementById("public-member-since").textContent =
          `MEMBER SINCE ${date.toLocaleDateString("en-GB", { month:"short", year:"numeric" }).toUpperCase()}`;
      }
    }
    card.hidden = false;
    status.hidden = true;
  }

  init().catch((error) => {
    console.error("PUNIX profile load failed:", error);
    showError("An unexpected error occurred while loading this profile.");
  });
  const year = document.getElementById("year");
  if (year) year.textContent = new Date().getFullYear();
})();