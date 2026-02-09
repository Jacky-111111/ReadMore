# ReadMore

A small web app for discovering books and getting content-based recommendations. Built with **FastAPI** (backend) and a simple **HTML/CSS/vanilla JS** frontend. Uses the [Open Library](https://openlibrary.org) public API (no API key required).

## Features

- **Search** — Find books by title, author, or topic via Open Library.
- **Like / Dislike / Save** — Build a profile from your preferences (stored in `localStorage`).
- **For You** — Content-based recommendations based on your liked subjects and authors, with short explanations.

## Run locally

```bash
python -m venv venv
source venv/bin/activate   # On Windows: venv\Scripts\activate
pip install -r requirements.txt
uvicorn main:app --reload
```

Then open: **http://127.0.0.1:8000**

## Project structure

- `main.py` — FastAPI app: serves frontend, `/api/search`, `/api/work/{work_id}`, `/api/recommend` (POST).
- `services/openlibrary.py` — Open Library HTTP client with in-memory caching (60s TTL) and response normalization.
- `templates/index.html` — Single-page UI.
- `static/app.js` — Frontend logic (search, cards, profile updates, recommendations).
- `static/styles.css` — Fireplace-themed, pixel-style styling.

## API (JSON)

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/search?q=...&limit=20` | Search books (normalized list). |
| GET | `/api/work/{work_id}` | Get work details by ID. |
| POST | `/api/recommend` | Get recommendations; body: `{ likedWorks, dislikedWorks, savedWorks, profile }`. |

Recommendations are scored from your profile (subjects, authors, era) and exclude already liked/disliked/saved works.
