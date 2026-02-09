# ReadMore

A small web app for discovering books and getting content-based recommendations. Built with **FastAPI** (backend) and a simple **HTML/CSS/vanilla JS** frontend. Uses the [Open Library](https://openlibrary.org) public API (no API key required).

## Features

- **Search** — Find books by title, author, or topic via Open Library. Results appear in a panel that can overlay the reading timer.
- **Like / Dislike / Save** — Build a profile from your preferences (stored in `localStorage`). Add books to **My Collection** (Shelf).
- **Recommendations** — Content-based “For You” list from your liked subjects and authors, with short reasons and scores. Use the **↻** button to refresh; list is paginated (8 per page, up to 60 recommendations).
- **Reading timer** — Bottom-of-page timer with two visuals (fireplace / candle). Choose duration (10 min, 30 min, 1 hr) and start; when results are open, the results panel covers the timer.

## Run locally

```bash
python -m venv venv
source venv/bin/activate   # On Windows: venv\Scripts\activate
pip install -r requirements.txt
uvicorn main:app --reload
```

Then open: **http://127.0.0.1:8000**

## Tech stack

| Layer   | Stack |
|---------|--------|
| Backend | Python 3, FastAPI, Pydantic, httpx |
| Frontend | HTML5, CSS3, vanilla JavaScript (no framework) |
| Data     | Open Library public API; user preferences in browser `localStorage` |
| Server  | Uvicorn (ASGI) |

## Deployment

From the project root (with dependencies installed):

```bash
python main.py
```

This starts the app on **http://0.0.0.0:8000** (all interfaces). For production you can run it behind a reverse proxy (e.g. Nginx) or use a process manager (e.g. systemd, Supervisor). No database or env vars are required; the app only talks to Open Library and serves static assets.

Optional: run with hot-reload during development:

```bash
uvicorn main:app --reload
```

## Project structure

- `main.py` — FastAPI app: serves frontend, `/api/search`, `/api/work/{work_id}`, `/api/recommend` (POST).
- `services/openlibrary.py` — Open Library HTTP client with in-memory caching (60s TTL) and response normalization.
- `templates/index.html` — Single-page UI (search, results, shelf, recommendations, reading timer).
- `static/app.js` — Frontend logic (search, cards, profile, recommendations with pagination, timer).
- `static/styles.css` — Fireplace-themed, pixel-style styling.

## API (JSON)

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/search?q=...&limit=20` | Search books (normalized list). |
| GET | `/api/work/{work_id}` | Get work details by ID. |
| POST | `/api/recommend` | Get recommendations; body: `{ likedWorks, dislikedWorks, savedWorks, profile }`. Returns up to 60 items. |

Recommendations are scored from your profile (subjects, authors, era) and exclude already liked/disliked/saved works.
