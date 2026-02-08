/**
 * Readmore — frontend: search, results, recommendations, localStorage profile
 */

const API = "";
const MAX_PROFILE_ENTRIES = 50;

// ---------- Storage ----------

function loadState() {
  try {
    return {
      likedWorks: JSON.parse(localStorage.getItem("readmore_likedWorks") || "[]"),
      dislikedWorks: JSON.parse(localStorage.getItem("readmore_dislikedWorks") || "[]"),
      savedWorks: JSON.parse(localStorage.getItem("readmore_savedWorks") || "[]"),
      savedBooks: JSON.parse(localStorage.getItem("readmore_savedBooks") || "[]"),
      profile: JSON.parse(localStorage.getItem("readmore_profile") || "{}"),
    };
  } catch {
    return {
      likedWorks: [],
      dislikedWorks: [],
      savedWorks: [],
      savedBooks: [],
      profile: { subjects: {}, authors: {}, length: {}, era: {} },
    };
  }
}

function saveState(state) {
  localStorage.setItem("readmore_likedWorks", JSON.stringify(state.likedWorks));
  localStorage.setItem("readmore_dislikedWorks", JSON.stringify(state.dislikedWorks));
  localStorage.setItem("readmore_savedWorks", JSON.stringify(state.savedWorks));
  localStorage.setItem("readmore_savedBooks", JSON.stringify(state.savedBooks));
  localStorage.setItem("readmore_profile", JSON.stringify(state.profile));
}

function trimProfile(profile) {
  const cap = (obj) => {
    if (!obj || typeof obj !== "object") return obj;
    const entries = Object.entries(obj)
      .filter(([, v]) => v != null && Number(v) !== 0)
      .sort((a, b) => (b[1] || 0) - (a[1] || 0))
      .slice(0, MAX_PROFILE_ENTRIES);
    return Object.fromEntries(entries);
  };
  return {
    subjects: cap(profile.subjects),
    authors: cap(profile.authors),
    length: profile.length || {},
    era: cap(profile.era),
  };
}

function normalizeSubject(s) {
  return String(s).toLowerCase().trim();
}

// ---------- Profile updates ----------

function applyLike(state, book) {
  const workId = (book.work_id || "").trim();
  if (!workId) return state;

  let { likedWorks, dislikedWorks, profile } = state;
  likedWorks = likedWorks.filter((id) => id !== workId);
  likedWorks.push(workId);
  dislikedWorks = dislikedWorks.filter((id) => id !== workId);

  profile = profile || {};
  profile.subjects = profile.subjects || {};
  profile.authors = profile.authors || {};
  profile.era = profile.era || {};

  for (const sub of book.subjects || []) {
    const s = normalizeSubject(sub);
    if (s) profile.subjects[s] = (profile.subjects[s] || 0) + 2;
  }
  for (const a of book.authors || []) {
    const key = (a.key || "").trim();
    if (key) profile.authors[key] = (profile.authors[key] || 0) + 3;
  }
  const year = book.first_publish_year;
  if (year != null) {
    if (year < 1980) profile.era.classic = (profile.era.classic || 0) + 1;
    else profile.era.modern = (profile.era.modern || 0) + 1;
  }

  profile = trimProfile(profile);
  return { ...state, likedWorks, dislikedWorks, profile };
}

function applyDislike(state, book) {
  const workId = (book.work_id || "").trim();
  if (!workId) return state;

  let { likedWorks, dislikedWorks, profile } = state;
  dislikedWorks = dislikedWorks.filter((id) => id !== workId);
  dislikedWorks.push(workId);
  likedWorks = likedWorks.filter((id) => id !== workId);

  profile = profile || {};
  profile.subjects = profile.subjects || {};
  profile.authors = profile.authors || {};

  for (const sub of book.subjects || []) {
    const s = normalizeSubject(sub);
    if (s) profile.subjects[s] = (profile.subjects[s] || 0) - 1;
  }
  for (const a of book.authors || []) {
    const key = (a.key || "").trim();
    if (key) profile.authors[key] = (profile.authors[key] || 0) - 2;
  }

  profile = trimProfile(profile);
  return { ...state, likedWorks, dislikedWorks, profile };
}

function applySave(state, book) {
  const workId = (book.work_id || "").trim();
  if (!workId) return state;

  let { savedWorks, savedBooks, profile } = state;
  savedBooks = savedBooks || [];
  if (savedWorks.includes(workId)) return state;
  savedWorks = [...savedWorks, workId];
  savedBooks = savedBooks.filter((b) => (b.work_id || "").trim() !== workId);
  savedBooks.push({
    work_id: book.work_id,
    title: book.title,
    authors: book.authors,
    first_publish_year: book.first_publish_year,
    subjects: book.subjects,
    cover_url: book.cover_url,
    isbn: book.isbn || [],
  });

  profile = profile || {};
  profile.subjects = profile.subjects || {};
  for (const sub of book.subjects || []) {
    const s = normalizeSubject(sub);
    if (s) profile.subjects[s] = (profile.subjects[s] || 0) + 1;
  }
  profile = trimProfile(profile);
  return { ...state, savedWorks, savedBooks, profile };
}

function removeFromShelf(state, workId) {
  workId = (workId || "").trim();
  if (!workId) return state;
  const savedWorks = (state.savedWorks || []).filter((id) => id !== workId);
  const savedBooks = (state.savedBooks || []).filter((b) => (b.work_id || "").trim() !== workId);
  return { ...state, savedWorks, savedBooks };
}

// ---------- DOM ----------

const searchInput = document.getElementById("searchInput");
const searchBtn = document.getElementById("searchBtn");
const searchError = document.getElementById("searchError");
const resultsList = document.getElementById("resultsList");
const resultsEmpty = document.getElementById("resultsEmpty");
const shelfList = document.getElementById("shelfList");
const shelfEmpty = document.getElementById("shelfEmpty");
const recommendList = document.getElementById("recommendList");
const recommendMessage = document.getElementById("recommendMessage");

function clearError() {
  searchError.textContent = "";
  searchError.classList.add("hidden");
}

function showError(msg) {
  searchError.textContent = msg;
  searchError.classList.remove("hidden");
}

function authorNames(authors) {
  if (!authors || !authors.length) return "Unknown";
  return authors.map((a) => a.name || "Unknown").join(", ");
}

function renderCard(book, options = {}) {
  const { showReasons = false, showScore = false, showDetail = false, onLike, onDislike, onSave } = options;
  const state = loadState();
  const liked = (state.likedWorks || []).includes(book.work_id);
  const disliked = (state.dislikedWorks || []).includes(book.work_id);
  const saved = (state.savedWorks || []).includes(book.work_id);

  const isbnLine = (book.isbn && book.isbn.length) ? "ISBN: " + book.isbn.slice(0, 3).join(", ") : "";
  const genreLine = (book.subjects && book.subjects.length) ? book.subjects.slice(0, 5).join(", ") : "";

  const div = document.createElement("div");
  div.className = "card" + (showReasons ? " recommend-card" : "");
  if (book.work_id) div.dataset.workId = book.work_id;
  div.innerHTML = `
    <div class="card-cover">
      ${book.cover_url ? `<img src="${book.cover_url}" alt="" loading="lazy" />` : "No cover"}
    </div>
    <div class="card-body">
      <div class="card-title">${escapeHtml(book.title || "Unknown")}</div>
      <div class="card-meta">${escapeHtml(authorNames(book.authors))}${book.first_publish_year ? " · First published " + book.first_publish_year : ""}</div>
      ${genreLine ? `<div class="card-subjects"><span class="card-label">Genre</span> ${escapeHtml(genreLine)}</div>` : ""}
      ${isbnLine && showDetail ? `<div class="card-isbn"><span class="card-label">ISBN</span> ${escapeHtml(isbnLine)}</div>` : ""}
      ${showReasons && book.reasons && book.reasons.length ? `<ul class="recommend-reasons">${book.reasons.map((r) => `<li>${escapeHtml(r)}</li>`).join("")}</ul>` : ""}
      ${showScore && book.score != null ? `<span class="score-badge">score ${book.score}</span>` : ""}
      <div class="card-actions"></div>
    </div>
  `;

  const actions = div.querySelector(".card-actions");
  if (onLike !== false) {
    const likeBtn = document.createElement("button");
    likeBtn.type = "button";
    likeBtn.className = "btn btn-like";
    likeBtn.textContent = "👍 Like";
    likeBtn.disabled = liked;
    likeBtn.addEventListener("click", () => { onLike && onLike(book); });
    actions.appendChild(likeBtn);
  }
  if (onDislike !== false) {
    const disBtn = document.createElement("button");
    disBtn.type = "button";
    disBtn.className = "btn btn-dislike";
    disBtn.textContent = "👎 Dislike";
    disBtn.disabled = disliked;
    disBtn.addEventListener("click", () => { onDislike && onDislike(book); });
    actions.appendChild(disBtn);
  }
  if (onSave !== false) {
    const saveBtn = document.createElement("button");
    saveBtn.type = "button";
    saveBtn.className = "btn btn-save";
    saveBtn.textContent = "✅ Add to collection";
    saveBtn.disabled = saved;
    saveBtn.addEventListener("click", () => { onSave && onSave(book); });
    actions.appendChild(saveBtn);
  }

  return div;
}

function renderShelfBook(book) {
  const div = document.createElement("div");
  div.className = "shelf-book";
  div.dataset.workId = book.work_id || "";
  div.innerHTML = `
    <div class="shelf-book-cover">
      ${book.cover_url ? `<img src="${book.cover_url}" alt="" loading="lazy" />` : ""}
    </div>
    <div class="shelf-book-info">
      <div class="shelf-book-title">${escapeHtml(book.title || "Unknown")}</div>
      <div class="shelf-book-meta">${escapeHtml(authorNames(book.authors))}${book.first_publish_year ? " · " + book.first_publish_year : ""}</div>
      <button type="button" class="btn btn-remove">Remove from shelf</button>
    </div>
  `;
  div.querySelector(".btn-remove").addEventListener("click", () => {
    updateStateAndUI(removeFromShelf(loadState(), book.work_id));
  });
  return div;
}

function escapeHtml(s) {
  const el = document.createElement("span");
  el.textContent = s;
  return el.innerHTML;
}

// ---------- Search ----------

async function doSearch() {
  const q = (searchInput.value || "").trim();
  if (!q) return;
  clearError();
  resultsEmpty.classList.add("hidden");
  resultsList.innerHTML = "<span>Searching…</span>";

  try {
    const res = await fetch(`${API}/api/search?q=${encodeURIComponent(q)}&limit=20`);
    const data = await res.json();
    if (!res.ok) throw new Error(data.detail || res.statusText);

    resultsList.innerHTML = "";
    if (!data.results || !data.results.length) {
      resultsEmpty.textContent = "No results found.";
      resultsEmpty.classList.remove("hidden");
      return;
    }

    currentResults = data.results;
    for (const book of data.results) {
      const card = renderCard(book, {
        showDetail: true,
        onLike: () => { updateStateAndUI(applyLike(loadState(), book)); },
        onDislike: () => { updateStateAndUI(applyDislike(loadState(), book)); },
        onSave: () => { updateStateAndUI(applySave(loadState(), book)); },
      });
      resultsList.appendChild(card);
    }
  } catch (e) {
    showError(e.message || "Search failed.");
    resultsList.innerHTML = "";
    resultsEmpty.classList.remove("hidden");
    resultsEmpty.textContent = "Search for books to see results.";
  }
}

// ---------- Recommendations ----------

function updateStateAndUI(newState) {
  saveState(newState);
  refreshShelf();
  refreshRecommendations();
  refreshResultButtons();
}

function refreshShelf() {
  const state = loadState();
  const books = state.savedBooks || [];
  shelfList.innerHTML = "";
  if (books.length === 0) {
    shelfEmpty.classList.remove("hidden");
    return;
  }
  shelfEmpty.classList.add("hidden");
  for (const book of books) {
    shelfList.appendChild(renderShelfBook(book));
  }
}

function refreshResultButtons() {
  const state = loadState();
  resultsList.querySelectorAll(".card[data-work-id]").forEach((cardEl) => {
    const workId = cardEl.dataset.workId;
    if (!workId) return;
    const likeBtn = cardEl.querySelector(".btn-like");
    const disBtn = cardEl.querySelector(".btn-dislike");
    const saveBtn = cardEl.querySelector(".btn-save");
    if (likeBtn) likeBtn.disabled = (state.likedWorks || []).includes(workId);
    if (disBtn) disBtn.disabled = (state.dislikedWorks || []).includes(workId);
    if (saveBtn) saveBtn.disabled = (state.savedWorks || []).includes(workId);
  });
}

let currentResults = [];

async function refreshRecommendations() {
  const state = loadState();
  recommendList.innerHTML = "";
  if (
    !state.profile?.subjects ||
    !Object.keys(state.profile.subjects).length
  ) {
    recommendMessage.textContent = "Add books to your collection to get personalized recommendations.";
    recommendMessage.classList.remove("hidden");
    return;
  }

  recommendMessage.classList.add("hidden");
  recommendList.innerHTML = "<span>Loading recommendations…</span>";

  try {
    const res = await fetch(`${API}/api/recommend`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        likedWorks: state.likedWorks || [],
        dislikedWorks: state.dislikedWorks || [],
        savedWorks: state.savedWorks || [],
        profile: state.profile || {},
      }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.detail || res.statusText);

    recommendList.innerHTML = "";
    if (data.message) {
      recommendMessage.textContent = data.message;
      recommendMessage.classList.remove("hidden");
    }
    const recs = data.recommendations || [];
    for (const book of recs) {
      const card = renderCard(book, {
        showReasons: true,
        showScore: true,
        onLike: false,
        onDislike: false,
        onSave: () => { updateStateAndUI(applySave(loadState(), book)); },
      });
      recommendList.appendChild(card);
    }
  } catch (e) {
    recommendMessage.textContent = e.message || "Could not load recommendations.";
    recommendMessage.classList.remove("hidden");
    recommendList.innerHTML = "";
  }
}

// ---------- Init ----------

searchBtn.addEventListener("click", doSearch);
searchInput.addEventListener("keydown", (e) => { if (e.key === "Enter") doSearch(); });

(function init() {
  refreshShelf();
  refreshRecommendations();
})();
