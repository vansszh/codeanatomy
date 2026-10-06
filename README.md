# CodeAnatomy

CodeAnatomy is a focused complexity tool. Paste a function and get
best, average, and worst-case time, auxiliary space, cost drivers, and the
assumptions behind the result.

## What it does

| Route | Purpose |
| --- | --- |
| `/` | Landing page |
| `/analysis` | Python time and space complexity analysis |

Only Python is accepted. The source is parsed before it is sent for analysis,
so invalid Python receives a useful validation message instead of a vague
model error.

## Running it

```bash
python -m venv .venv
.venv/Scripts/activate        # macOS and Linux: source .venv/bin/activate
pip install -r requirements.txt

cp .env.example .env          # then add a Gemini key
python app.py
```

The server listens on `http://127.0.0.1:5000`. Set `PORT` to change that and
`FLASK_DEBUG=1` for the reloader.

## Configuration

| Variable | Required | Meaning |
| --- | --- | --- |
| `GEMINI_API_KEY` | for analysis | The Gemini key |
| `GEMINI_API_KEY_1` ... `_N` | optional | Additional keys tried in order |
| `GEMINI_MODEL` | no | Defaults to `gemini-2.5-flash` |
| `PORT` | no | Defaults to `5000` |

Keys belong in `.env`, which is gitignored, or in the host's environment
settings. `.env.example` contains placeholders only.

## Endpoint

```text
POST /api/complexity -> {ok, language, report}
GET  /api/health     -> {ok, model, keys_configured, language}
```

The complexity request takes `{"code": "...", "language": "python"}` and
input is capped at 60,000 characters.

## Layout

```text
app.py                  Flask app, Python validation, and Gemini calls
api/index.py            WSGI entry point for serverless hosts
vercel.json             Serverless rewrite configuration

templates/
  base.html             Shared shell and navigation
  index.html            Focused landing page
  analysis.html         Complexity workspace
  404.html              Not-found page

static/css/
  tokens.css            Black palette, type, spacing, and motion tokens
  base.css              Reset and shared primitives
  home.css              Landing page
  tool.css              Python code workspace and report

static/js/
  lib/motion.js         Small shared interaction helpers
  lib/studio.js         Workspace request and state handling
  home.js               Landing page interactions
  analysis.js           Report rendering and code editor controls
```

There is no build step. Templates are server-rendered and the browser loads the
small ES modules directly.
