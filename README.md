# 🏆 ARENA // Real-Time Leaderboard System

A modern, full-stack, responsive **Real-Time Leaderboard Web Application** built with a Python **FastAPI** backend, **SQLAlchemy ORM** with **SQLite** persistence, **WebSockets** for live multi-client broadcasting, and a glassmorphic **Tailwind CSS + Vanilla JS** frontend.

![Version](https://img.shields.io/badge/version-1.0.0-indigo.svg)
![Python](https://img.shields.io/badge/python-3.11%20%7C%203.12%20%7C%203.13-blue.svg)
![FastAPI](https://img.shields.io/badge/FastAPI-0.110%2B-009688.svg)
![Docker](https://img.shields.io/badge/Docker-Ready-2496ED.svg)
![License](https://img.shields.io/badge/license-MIT-green.svg)

---

## ✨ Features

- **⚡ Real-Time Multi-Client Synchronization**: Powered by WebSockets with automatic reconnection. Score increments, ranking shifts, and challenger registrations propagate across all open tabs and screens instantly.
- **🥇 Olympic Top-3 Podium**: 3D-styled Olympic podium highlighting Gold (1st, with floating crown & glowing halo), Silver (2nd), and Bronze (3rd) top performers.
- **📈 Dynamic Automatic Ranking**: Scores are automatically sorted descending in real time with smooth CSS transitions, rank trend badges (▲ Rose / ▼ Fell), and floating score change indicators (`+10`, `-5`).
- **🎛️ Dynamic Score Adjustments**: Quick score buttons (`+10`, `+5`, `+1`, `-1`, `-5`) directly on each row, plus an exact score modal (`🎯 Set`).
- **🔍 Instant Search & Category Filtering**: Real-time query search highlighting matches across names and categories, with dynamic category count pills (e.g., Engineering, Design, Data Science, Product, Security).
- **💾 Production Data Persistence**: SQLite database managed via **SQLAlchemy ORM** with WAL (`Write-Ahead Logging`) mode enabled for ultra-fast concurrent transactions.
- **🔊 Zero-Asset Synthetic Sound FX**: Interactive sound chimes generated entirely in-browser using the Web Audio API (ascending chime on score up, downward tone on score down, fanfare triad on podium updates).
- **📥 Data Export**: Instant one-click export to **JSON** or **CSV** formats.
- **🌐 Dual-Mode Deployment**:
  - **Full-Stack Mode**: FastAPI + SQLite + WebSockets (Docker, Render, Railway, Fly.io).
  - **Static / GitHub Pages Mode**: Gracefully runs standalone with in-browser persistent store and live fallback.

---

## 📁 Project Architecture & File Structure

```text
d:/Pyhton WebApp/
├── index.html                  # Responsive dashboard UI (Tailwind CSS, glassmorphism, dark mode)
├── app.py                      # FastAPI application, SQLAlchemy ORM, WebSockets, REST endpoints
├── main.py                     # Entry point alias for uvicorn/python runners
├── static/
│   ├── css/
│   │   └── style.css           # Glassmorphism, podium styling, animations, floating deltas
│   └── js/
│       └── app.js              # WebSocket client, DOM rendering, audio synth, fallback engine
├── data/
│   ├── leaderboard.db          # SQLite persistent database (WAL mode)
│   ├── leaderboard.json        # Seed dataset & JSON export sample
│   └── .gitkeep                # Tracks data directory
├── Dockerfile                  # Production multi-stage slim Docker image with healthcheck
├── docker-compose.yml          # Container orchestration with data volume persistence
├── .dockerignore               # Docker build exclusions
├── render.yaml                 # Render Blueprint configuration for 1-click cloud deploy
├── Procfile                    # Heroku / Railway / Render web service entrypoint
├── vercel.json                 # Vercel serverless deployment configuration
├── .github/workflows/
│   └── deploy.yml              # CI/CD pipeline (Tests + GitHub Pages static deploy)
├── requirements.txt            # Minimal Python dependencies
├── .gitignore                  # Python, SQLite, OS, and env ignores
└── README.md                   # Comprehensive documentation
```

---

## 🚀 Quick Start (Local Development)

### Prerequisites
- Python 3.10+ (Python 3.12 or 3.13 recommended)
- `pip` package manager

### 1. Clone & Set Up Virtual Environment

```bash
# Clone the repository
git clone https://github.com/your-username/realtime-leaderboard.git
cd realtime-leaderboard

# Create virtual environment
python -m venv .venv

# Activate virtual environment
# Windows (PowerShell):
.venv\Scripts\Activate.ps1
# macOS/Linux:
source .venv/bin/activate
```

### 2. Install Dependencies

```bash
pip install -r requirements.txt
```

### 3. Run the Application

```bash
# Start server with auto-reload
python app.py
# Or run with uvicorn directly:
uvicorn app:app --host 0.0.0.0 --port 8000 --reload
```

Open your browser and navigate to **`http://localhost:8000`**.

---

## 🐳 Containerization with Docker

The project includes an optimized Dockerfile and `docker-compose.yml` with SQLite volume persistence.

### Option 1: Docker Compose (Recommended)

```bash
# Build and run the container in the background
docker compose up -d --build

# View logs
docker compose logs -f

# Stop the container
docker compose down
```

The application will be accessible at **`http://localhost:8000`**, and your database in `./data` is persisted between container restarts!

### Option 2: Docker CLI

```bash
# Build the Docker image
docker build -t realtime-leaderboard .

# Run container with volume mount for data persistence
docker run -d -p 8000:8000 -v $(pwd)/data:/app/data --name arena-leaderboard realtime-leaderboard
```

---

## ☁️ Deployment Guide

### Option A: Render (Free Web Service)
1. Push your repository to GitHub.
2. Sign in to [Render](https://render.com).
3. Click **New +** -> **Blueprint**, and select your repository (`render.yaml` will auto-configure everything).
4. Alternatively, create a **Web Service**:
   - **Environment**: Python
   - **Build Command**: `pip install -r requirements.txt`
   - **Start Command**: `uvicorn app:app --host 0.0.0.0 --port $PORT`
   - Add a persistent disk mounted to `/app/data`.

### Option B: Railway
1. Connect your GitHub repository to [Railway](https://railway.app).
2. Railway will automatically detect the `Procfile` and `requirements.txt`.
3. Add a persistent volume mounted to `/app/data` to retain the SQLite database.

### Option C: GitHub Pages (Option A Static Mode)
The repository is equipped with a GitHub Actions workflow (`.github/workflows/deploy.yml`):
1. In your GitHub repository settings, navigate to **Pages**.
2. Under **Build and deployment**, set the source to **GitHub Actions**.
3. Push to `main` — GitHub Actions will test the backend and deploy the frontend directly to GitHub Pages!
4. The client will automatically operate in static offline/local-storage mode with full interactivity.

---

## 🔌 API Reference

### REST Endpoints

| Method | Endpoint | Description |
|---|---|---|
| `GET` | `/` | Serves dashboard UI (`index.html`) |
| `GET` | `/api/health` | Healthcheck endpoint |
| `GET` | `/api/participants` | List participants sorted by score desc (`?category=&search=`) |
| `POST` | `/api/participants` | Register challenger (`name`, `category`, `initial_score`, `badge`) |
| `PATCH` | `/api/participants/{id}/score` | Update score (`mode`: `increment`\|`decrement`\|`set`, `delta`, `value`) |
| `PUT` | `/api/participants/{id}` | Edit participant attributes (`name`, `category`, `badge`, `avatar`) |
| `DELETE` | `/api/participants/{id}` | Remove participant from arena |
| `POST` | `/api/reset` | Reset leaderboard back to demo state |
| `GET` | `/api/stats` | Aggregated statistics (total competitors, top score, average, division) |
| `GET` | `/api/export` | Download leaderboard data (`?format=json` or `?format=csv`) |

### WebSocket Endpoint

```text
ws://localhost:8000/ws
```
- **Incoming events**: `snapshot`, `score_updated`, `participant_added`, `participant_updated`, `participant_deleted`, `leaderboard_reset`, `viewer_count`.
- **Heartbeat**: Sends `{ "action": "ping" }` / receives `{ "event": "pong" }`.

---

## 🧪 Testing

To test all endpoints locally:

```bash
python -c "
import urllib.request, json
with urllib.request.urlopen('http://localhost:8000/api/health') as r:
    print('Health:', json.loads(r.read().decode()))
with urllib.request.urlopen('http://localhost:8000/api/participants') as r:
    data = json.loads(r.read().decode())
    print('Participants loaded:', len(data))
"
```

---

## 📄 License
This project is licensed under the MIT License.
