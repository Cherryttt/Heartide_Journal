# Heartide Journal

Heartide Journal is an emotion-aware journaling app with a React web client,
a FastAPI backend, and a Capacitor Android shell. It helps users record moods,
build visual journals, manage reading notes, and get AI-assisted reflection and
recommendations.

The repository is currently private and contains the complete app source for
local web development, backend API development, Android builds, and Docker-based
deployment.

## Features

- Emotion journal entries with local emotion classification.
- AI-assisted writing, image understanding, collage generation, and agent chat.
- Bookshelf, reading notes, word finder, and recommendation flows.
- React Three Fiber scene backgrounds and companion interactions.
- Account-based sync for journal data, bookshelf data, and user settings.
- FastAPI backend with SQLite for local development and PostgreSQL for
  production-style deployments.
- Capacitor Android project with debug and release build scripts.

## Tech Stack

- Frontend: React 18, TypeScript, Vite, Tailwind CSS, Zustand.
- Visuals: Three.js, React Three Fiber, Drei, Framer Motion.
- Backend: FastAPI, SQLAlchemy, Alembic, Pydantic, NumPy.
- ML: scikit-learn, joblib, optional transformer training scripts.
- Mobile: Capacitor 8 Android.
- Deployment: Docker Compose, Caddy, PostgreSQL, MinIO, Prometheus.

## Project Layout

```text
.
├── src/                 # React app source
├── public/              # Static assets, scenes, and 3D models
├── backend/             # FastAPI backend, database models, ML, tests
├── android/             # Capacitor Android project
├── deploy/              # Caddy and Prometheus configuration
├── scripts/             # Report/build/demo helper scripts
├── docker-compose.yml   # Production-style local stack
└── package.json         # Web and Android scripts
```

## Prerequisites

- Node.js 20 or newer.
- Python 3.11 or newer.
- Git.
- Android Studio and Android SDK, only if building the Android app.
- Docker Desktop, only if using Docker Compose.

## Backend Setup

Create and configure the backend environment:

```powershell
cd backend
python -m venv venv
.\venv\Scripts\python -m pip install -r requirements.txt
Copy-Item .env.example .env
```

Edit `backend/.env` and fill in the values you need. For local development,
SQLite is used when `DATABASE_URL` is empty.

Start the backend:

```powershell
.\run.bat
```

Health check:

```text
http://localhost:8000/api/health
```

## Frontend Setup

Install dependencies and start Vite:

```powershell
npm install
npm run dev
```

Open:

```text
http://localhost:5173
```

The frontend expects the backend at `http://localhost:8000` by default.

## Android

After installing Android Studio and the Android SDK, sync the web build into the
native Android project:

```powershell
npm run android:sync
npm run android:open
```

Run on an emulator or connected device:

```powershell
npm run android:run
```

Build a debug APK:

```powershell
npm run android:apk
```

The debug APK is written to:

```text
android\app\build\outputs\apk\debug\app-debug.apk
```

For testing on a physical phone, copy `.env.android.example` to
`.env.production` and set `VITE_API_URL` to the backend address reachable from
the phone, for example:

```env
VITE_API_URL=http://192.168.1.10:8000
```

## Docker Compose

To run the production-style local stack:

```powershell
docker compose up --build
```

This starts PostgreSQL, MinIO, the backend, the web app, Caddy, and Prometheus.

## Tests and Checks

Backend tests:

```powershell
cd backend
$env:PYTHONUTF8 = "1"
.\venv\Scripts\python -m pytest -q
```

Frontend production build:

```powershell
npm run build
```

GitHub Actions runs backend tests and the frontend build on push and pull
request.

## Environment Notes

- Do not commit real `.env` files or API keys.
- `backend/.env.example` documents the available backend settings.
- The default lightweight emotion model is `backend/ml/model.pkl`.
- Optional transformer training and export scripts live in `backend/ml/`.
- Generated Android assets, local Gradle output, Python virtual environments,
  logs, and local databases are ignored by Git.

## GitHub

Remote repository:

```text
https://github.com/Cherryttt/Heartide_Journal
```
