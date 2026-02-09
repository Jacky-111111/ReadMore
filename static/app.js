/**
 * ReadMore — frontend: search, results, recommendations, localStorage profile
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

function applyRemoveLike(state, workId) {
  workId = (workId || "").trim();
  if (!workId) return state;
  const likedWorks = (state.likedWorks || []).filter((id) => id !== workId);
  return { ...state, likedWorks };
}

function applyRemoveDislike(state, workId) {
  workId = (workId || "").trim();
  if (!workId) return state;
  const dislikedWorks = (state.dislikedWorks || []).filter((id) => id !== workId);
  return { ...state, dislikedWorks };
}

// ---------- DOM ----------

const searchInput = document.getElementById("searchInput");
const searchBtn = document.getElementById("searchBtn");
const searchError = document.getElementById("searchError");
const resultsPanel = document.getElementById("resultsPanel");
const resultsList = document.getElementById("resultsList");
const resultsEmpty = document.getElementById("resultsEmpty");
const shelfList = document.getElementById("shelfList");
const shelfEmpty = document.getElementById("shelfEmpty");
const recommendList = document.getElementById("recommendList");
const recommendMessage = document.getElementById("recommendMessage");
const recommendPagination = document.getElementById("recommendPagination");
const recommendRefresh = document.getElementById("recommendRefresh");

const RECOMMEND_PAGE_SIZE = 8;
let currentRecommendations = [];
let currentRecommendPage = 1;

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
  const rateWrap = document.createElement("div");
  rateWrap.className = "rate-buttons";
  if (onLike !== false) {
    const likeBtn = document.createElement("button");
    likeBtn.type = "button";
    likeBtn.className = "btn btn-like btn-icon" + (liked ? " active" : "");
    likeBtn.textContent = "👍";
    likeBtn.title = liked ? "You liked this book (click to cancel)" : "Like this book";
    likeBtn.addEventListener("click", () => { onLike && onLike(book); });
    rateWrap.appendChild(likeBtn);
  }
  if (onDislike !== false) {
    const disBtn = document.createElement("button");
    disBtn.type = "button";
    disBtn.className = "btn btn-dislike btn-icon" + (disliked ? " active" : "");
    disBtn.textContent = "👎";
    disBtn.title = disliked ? "You disliked this book (click to cancel)" : "Dislike this book";
    disBtn.addEventListener("click", () => { onDislike && onDislike(book); });
    rateWrap.appendChild(disBtn);
  }
  if (rateWrap.children.length) actions.appendChild(rateWrap);
  if (onSave !== false) {
    const saveBtn = document.createElement("button");
    saveBtn.type = "button";
    saveBtn.className = "btn btn-save";
    saveBtn.textContent = "✅ Add to collection";
    saveBtn.disabled = saved;
    saveBtn.addEventListener("click", (e) => { e.stopPropagation(); onSave && onSave(book); });
    actions.appendChild(saveBtn);
  }

  div.classList.add("clickable");
  div.addEventListener("click", (e) => {
    if (e.target.closest(".card-actions")) return;
    openBookDetail(book);
  });
  rateWrap.querySelectorAll("button").forEach((btn) => btn.addEventListener("click", (e) => e.stopPropagation()));

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
      <button type="button" class="btn btn-remove">Remove</button>
    </div>
  `;
  const removeBtn = div.querySelector(".btn-remove");
  if (removeBtn) {
    removeBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      updateStateAndUI(removeFromShelf(loadState(), book.work_id));
    });
  }
  div.classList.add("clickable");
  div.addEventListener("click", () => openBookDetail(book));
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
  resultsPanel.classList.remove("collapsed");
  resultsPanel.setAttribute("aria-hidden", "false");
  document.body.classList.add("results-open");
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
        onLike: () => {
          const s = loadState();
          if ((s.likedWorks || []).includes(book.work_id)) updateStateAndUI(applyRemoveLike(s, book.work_id));
          else updateStateAndUI(applyLike(s, book));
        },
        onDislike: () => {
          const s = loadState();
          if ((s.dislikedWorks || []).includes(book.work_id)) updateStateAndUI(applyRemoveDislike(s, book.work_id));
          else updateStateAndUI(applyDislike(s, book));
        },
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
    const liked = (state.likedWorks || []).includes(workId);
    const disliked = (state.dislikedWorks || []).includes(workId);
    if (likeBtn) {
      likeBtn.classList.toggle("active", liked);
      likeBtn.title = liked ? "You liked this book (click to cancel)" : "Like this book";
    }
    if (disBtn) {
      disBtn.classList.toggle("active", disliked);
      disBtn.title = disliked ? "You disliked this book (click to cancel)" : "Dislike this book";
    }
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
      currentRecommendations = [];
      currentRecommendPage = 1;
      if (recommendPagination) recommendPagination.classList.add("hidden");
      return;
    }
    const recs = data.recommendations || [];
    currentRecommendations = recs;
    currentRecommendPage = 1;
    renderRecommendPage();
  } catch (e) {
    recommendMessage.textContent = e.message || "Could not load recommendations.";
    recommendMessage.classList.remove("hidden");
    recommendList.innerHTML = "";
    currentRecommendations = [];
    if (recommendPagination) recommendPagination.classList.add("hidden");
  }
}

function renderRecommendPage() {
  const total = currentRecommendations.length;
  const totalPages = Math.max(1, Math.ceil(total / RECOMMEND_PAGE_SIZE));
  const page = Math.min(Math.max(1, currentRecommendPage), totalPages);
  currentRecommendPage = page;
  const start = (page - 1) * RECOMMEND_PAGE_SIZE;
  const slice = currentRecommendations.slice(start, start + RECOMMEND_PAGE_SIZE);

  recommendList.innerHTML = "";
  for (const book of slice) {
    const card = renderCard(book, {
      showReasons: true,
      showScore: true,
      onLike: false,
      onDislike: false,
      onSave: () => { updateStateAndUI(applySave(loadState(), book)); },
    });
    recommendList.appendChild(card);
  }

  if (recommendPagination) {
    if (totalPages <= 1) {
      recommendPagination.classList.add("hidden");
      recommendPagination.innerHTML = "";
      return;
    }
    recommendPagination.classList.remove("hidden");
    recommendPagination.innerHTML = "";
    const prevBtn = document.createElement("button");
    prevBtn.type = "button";
    prevBtn.className = "btn btn-page";
    prevBtn.textContent = "‹ Prev";
    prevBtn.disabled = page <= 1;
    prevBtn.addEventListener("click", () => { currentRecommendPage = page - 1; renderRecommendPage(); });
    const nextBtn = document.createElement("button");
    nextBtn.type = "button";
    nextBtn.className = "btn btn-page";
    nextBtn.textContent = "Next ›";
    nextBtn.disabled = page >= totalPages;
    nextBtn.addEventListener("click", () => { currentRecommendPage = page + 1; renderRecommendPage(); });
    const info = document.createElement("span");
    info.className = "page-info";
    info.textContent = `Page ${page} / ${totalPages}`;
    recommendPagination.appendChild(prevBtn);
    recommendPagination.appendChild(info);
    recommendPagination.appendChild(nextBtn);
  }
}

// ---------- Info modal ----------

const infoBtn = document.getElementById("infoBtn");
const infoOverlay = document.getElementById("infoOverlay");
const infoClose = document.getElementById("infoClose");

if (infoBtn && infoOverlay) {
  infoBtn.addEventListener("click", () => {
    infoOverlay.classList.add("visible");
    infoOverlay.setAttribute("aria-hidden", "false");
  });
}
if (infoClose && infoOverlay) {
  infoClose.addEventListener("click", () => {
    infoOverlay.classList.remove("visible");
    infoOverlay.setAttribute("aria-hidden", "true");
  });
}
if (infoOverlay) {
  infoOverlay.addEventListener("click", (e) => {
    if (e.target === infoOverlay) {
      infoOverlay.classList.remove("visible");
      infoOverlay.setAttribute("aria-hidden", "true");
    }
  });
}
document.addEventListener("keydown", (e) => {
  if (e.key !== "Escape") return;
  if (bookDetailOverlay && bookDetailOverlay.classList.contains("visible")) {
    closeBookDetail();
  } else if (infoOverlay && infoOverlay.classList.contains("visible")) {
    infoOverlay.classList.remove("visible");
    infoOverlay.setAttribute("aria-hidden", "true");
  }
});

// ---------- Book detail modal ----------

const bookDetailOverlay = document.getElementById("bookDetailOverlay");
const bookDetailCover = document.getElementById("bookDetailCover");
const bookDetailTitle = document.getElementById("bookDetailTitle");
const bookDetailMeta = document.getElementById("bookDetailMeta");
const bookDetailIsbn = document.getElementById("bookDetailIsbn");
const bookDetailGenre = document.getElementById("bookDetailGenre");
const bookDetailDescription = document.getElementById("bookDetailDescription");
const bookDetailClose = document.getElementById("bookDetailClose");

function fillBookDetail(book) {
  if (!bookDetailTitle || !bookDetailCover) return;
  bookDetailTitle.textContent = book.title || "Unknown";
  if (bookDetailMeta) bookDetailMeta.textContent = [
    authorNames(book.authors),
    book.first_publish_year ? "First published " + book.first_publish_year : "",
  ].filter(Boolean).join(" · ");
  if (bookDetailIsbn) bookDetailIsbn.textContent = (book.isbn && book.isbn.length)
    ? "ISBN: " + book.isbn.join(", ")
    : "ISBN: —";
  if (bookDetailGenre) bookDetailGenre.textContent = (book.subjects && book.subjects.length)
    ? "Genre / subjects: " + book.subjects.join(", ")
    : "";
  if (bookDetailDescription) bookDetailDescription.textContent = book.description || "Loading…";
  bookDetailCover.innerHTML = "";
  if (book.cover_url) {
    const img = document.createElement("img");
    img.src = book.cover_url;
    img.alt = "";
    bookDetailCover.appendChild(img);
  } else {
    bookDetailCover.textContent = "No cover";
  }
}

function openBookDetail(book) {
  if (!book || !book.work_id) return;
  fillBookDetail(book);
  if (bookDetailOverlay) {
    bookDetailOverlay.classList.add("visible");
    bookDetailOverlay.setAttribute("aria-hidden", "false");
  }
  fetch(`${API}/api/work/${encodeURIComponent(book.work_id)}`)
    .then((res) => res.json())
    .then((data) => {
      const merged = {
        ...book,
        description: data.description ?? book.description,
        isbn: (data.isbn && data.isbn.length) ? data.isbn : (book.isbn || []),
        subjects: (data.subjects && data.subjects.length) ? data.subjects : (book.subjects || []),
        first_publish_year: data.first_publish_year ?? book.first_publish_year,
        cover_url: data.cover_url || book.cover_url,
      };
      fillBookDetail(merged);
    })
    .catch(() => {
      if (bookDetailDescription) bookDetailDescription.textContent = book.description || "No description available.";
    });
}

function closeBookDetail() {
  if (bookDetailOverlay) {
    bookDetailOverlay.classList.remove("visible");
    bookDetailOverlay.setAttribute("aria-hidden", "true");
  }
}

if (bookDetailClose && bookDetailOverlay) {
  bookDetailClose.addEventListener("click", closeBookDetail);
}
if (bookDetailOverlay) {
  bookDetailOverlay.addEventListener("click", (e) => {
    if (e.target === bookDetailOverlay) closeBookDetail();
  });
}

// ---------- Reading timer ----------

const timerPrev = document.getElementById("timerPrev");
const timerNext = document.getElementById("timerNext");
const timerScene = document.getElementById("timerScene");
const pixelFireplace = document.getElementById("pixelFireplace");
const pixelCandle = document.getElementById("pixelCandle");
const candleWax = document.getElementById("candleWax");
const timerDuration = document.getElementById("timerDuration");
const timerDisplay = document.getElementById("timerDisplay");
const timerStart = document.getElementById("timerStart");

let timerMode = "fireplace";
let timerRunning = false;
let timerInterval = null;
let timerElapsed = 0;
let timerRemaining = 0;
let timerTotalCandle = 600;

function formatTime(seconds) {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return m + ":" + (s < 10 ? "0" : "") + s;
}

function showTimerMode() {
  if (!pixelFireplace || !pixelCandle) return;
  if (timerMode === "fireplace") {
    pixelFireplace.classList.remove("hidden");
    pixelCandle.classList.add("hidden");
    if (timerDuration) timerDuration.classList.add("hidden");
  } else {
    pixelFireplace.classList.add("hidden");
    pixelCandle.classList.remove("hidden");
    if (timerDuration) timerDuration.classList.remove("hidden");
    updateCandleHeight();
  }
}

function updateCandleHeight() {
  if (!candleWax || timerTotalCandle <= 0) return;
  const pct = timerRunning ? (timerRemaining / timerTotalCandle) * 100 : 100;
  candleWax.style.height = pct + "%";
}

function updateTimerDisplay() {
  if (!timerDisplay) return;
  if (timerMode === "fireplace") {
    timerDisplay.textContent = formatTime(timerElapsed);
  } else {
    timerDisplay.textContent = formatTime(timerRemaining);
    if (timerRunning) updateCandleHeight();
  }
}

function timerTick() {
  if (timerMode === "fireplace") {
    timerElapsed++;
    updateTimerDisplay();
  } else {
    timerRemaining--;
    updateTimerDisplay();
    if (timerRemaining <= 0) {
      stopTimer();
      timerDisplay.textContent = "0:00";
    }
  }
}

function startTimer() {
  if (timerRunning) return;
  timerRunning = true;
  if (timerMode === "fireplace") {
    timerElapsed = 0;
    if (pixelFireplace) pixelFireplace.classList.add("burning");
  } else {
    timerRemaining = timerTotalCandle;
    if (candleWax) candleWax.style.height = "100%";
  }
  updateTimerDisplay();
  if (timerStart) {
    timerStart.textContent = "Stop";
  }
  timerInterval = setInterval(timerTick, 1000);
}

function stopTimer() {
  timerRunning = false;
  if (timerInterval) {
    clearInterval(timerInterval);
    timerInterval = null;
  }
  if (pixelFireplace) pixelFireplace.classList.remove("burning");
  if (timerStart) timerStart.textContent = "Start reading";
  updateCandleHeight();
}

function cycleTimerMode(delta) {
  if (timerRunning) return;
  timerMode = timerMode === "fireplace" ? "candle" : "fireplace";
  showTimerMode();
  if (timerMode === "fireplace") {
    timerDisplay.textContent = formatTime(0);
  } else {
    timerTotalCandle = getCandleSeconds();
    timerRemaining = timerTotalCandle;
    timerDisplay.textContent = formatTime(timerRemaining);
  }
}

function getCandleSeconds() {
  const active = timerDuration && timerDuration.querySelector(".btn-dur.active");
  const min = active ? parseInt(active.dataset.min, 10) : 10;
  return min * 60;
}

if (timerPrev) {
  timerPrev.addEventListener("click", () => cycleTimerMode(-1));
}
if (timerNext) {
  timerNext.addEventListener("click", () => cycleTimerMode(1));
}
if (timerStart) {
  timerStart.addEventListener("click", () => {
    if (timerRunning) stopTimer();
    else startTimer();
  });
}
if (timerDuration) {
  timerDuration.querySelectorAll(".btn-dur").forEach((btn) => {
    btn.addEventListener("click", () => {
      if (timerRunning) return;
      timerDuration.querySelectorAll(".btn-dur").forEach((b) => b.classList.remove("active"));
      btn.classList.add("active");
      if (timerMode === "candle") {
        timerTotalCandle = parseInt(btn.dataset.min, 10) * 60;
        timerRemaining = timerTotalCandle;
        updateTimerDisplay();
        updateCandleHeight();
      }
    });
  });
}

showTimerMode();
if (timerDisplay) timerDisplay.textContent = "0:00";

// ---------- Init ----------

searchBtn.addEventListener("click", doSearch);
searchInput.addEventListener("keydown", (e) => { if (e.key === "Enter") doSearch(); });

const resultsClose = document.getElementById("resultsClose");
if (resultsClose && resultsPanel) {
  resultsClose.addEventListener("click", () => {
    resultsPanel.classList.add("collapsed");
    resultsPanel.setAttribute("aria-hidden", "true");
    document.body.classList.remove("results-open");
  });
}

if (recommendRefresh) {
  recommendRefresh.addEventListener("click", () => refreshRecommendations());
}

(function init() {
  refreshShelf();
  refreshRecommendations();
})();
