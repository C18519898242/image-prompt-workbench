# Image Prompt Workbench

This repository contains the foundation vertical slice for Image Prompt Workbench: a FastAPI backend and a React/Vite frontend protected by one shared password.

## Local development

Install the backend dependencies and generate the password hash:

```bash
# 1. Install the backend dependencies
cd backend
python -m pip install -r requirements.txt

# 2. Generate a hash and create the ignored root .env
python -m app.cli hash-password
```

Copy the printed hash into a root `.env` file:

```env
AUTH_PASSWORD_HASH='your-generated-argon2id-hash'
```

`AUTH_PASSWORD_HASH` is the only required application secret. Keep the generated hash single-quoted because it contains `$` characters that Docker Compose would otherwise interpolate. The CLI hides password input, asks for confirmation, accepts no plaintext password command-line argument, and does not write `.env` automatically.

Start the backend in one terminal:

```bash
cd backend
uvicorn app.main:app --reload --port 8000
```

Start the frontend development server in another terminal:

```bash
cd frontend
npm install
npm run dev
```

The Vite development server proxies same-origin `/api` requests to the backend.

## Test and build

```bash
# 3. Test the backend
cd backend
python -m pytest -q

# 4. Build the frontend
cd ../frontend
npm install
npm test -- --run
npm run build
```

The build output is `frontend/dist/` and is intentionally not committed.

## Docker Compose and host Nginx deployment

Build the frontend on the host, create the ignored root `.env` as above, then start the backend container from the repository root:

```bash
# 5. Start the backend container from the repository root
cd ..
docker compose up -d --build
```

The backend image command is:

```text
uvicorn app.main:app --host 0.0.0.0 --port 8000 --workers 1
```

Compose binds the container only to `127.0.0.1:8000:8000` and mounts `./data:/app/data`. `data/` holds persistent runtime state, including the prepared SQLite and local image directories. Do not commit runtime SQLite files or generated images.

Use the existing host Nginx rather than adding Nginx to the backend image:

1. Copy `deploy/nginx/image-prompt-workbench.conf.example` into the host Nginx configuration.
2. Replace `prompt.example.com` with the deployed domain.
3. Ensure `root` points to the deployed `frontend/dist/` directory (the example uses `/srv/image-prompt-workbench/frontend/dist`).
4. Enable HTTPS for the site and reload Nginx.

The host configuration serves the frontend and reverse-proxies `/api/` to `http://127.0.0.1:8000`, keeping frontend and backend on the same domain. Confirm the deployment through that public domain:

```bash
# 6. Inspect the public health endpoint through the host Nginx domain
curl https://prompt.example.com/api/health
```

Only one Uvicorn worker and one backend replica are supported. Authentication uses one in-memory bearer token, so every backend container restart invalidates existing tokens.
