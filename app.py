"""CodeAnatomy: focused Python complexity analysis."""

from __future__ import annotations

import ast
import json
import os
import re

from dotenv import load_dotenv
from flask import Flask, jsonify, render_template, request
from google import genai
from google.genai import errors, types

load_dotenv()

app = Flask(__name__)

GEMINI_MODEL = os.environ.get("GEMINI_MODEL") or "gemini-2.5-flash"
MAX_INPUT = 60_000
_PLACEHOLDERS = ("your_", "add_your_", "replace_")


def _get_key_pool() -> list[str]:
    """Collect configured model keys without exposing their values."""
    keys: list[str] = []

    single = (os.environ.get("GEMINI_API_KEY") or "").strip()
    if single:
        keys.append(single)

    index = 1
    misses = 0
    while misses < 3:
        value = (os.environ.get(f"GEMINI_API_KEY_{index}") or "").strip()
        if value:
            keys.append(value)
            misses = 0
        else:
            misses += 1
        index += 1

    clean: list[str] = []
    for key in keys:
        if any(key.lower().startswith(prefix) for prefix in _PLACEHOLDERS):
            continue
        if key not in clean:
            clean.append(key)
    return clean


class ModelUnavailable(RuntimeError):
    """The configured model could not produce a result."""


def extract_text(response) -> str:
    """Read a non-empty text response."""
    try:
        text = response.text
    except (AttributeError, ValueError):
        text = ""

    text = (text or "").strip()
    if not text:
        raise ModelUnavailable("No result was generated. Try a smaller snippet.")
    return text


def call_gemini(
    prompt: str,
    system: str,
    max_tokens: int,
    response_mime_type: str | None = None,
) -> str:
    """Send one request through Gemini, trying configured keys in order."""
    pool = _get_key_pool()
    if not pool:
        raise ModelUnavailable("The analysis service is not configured on the server.")

    config = types.GenerateContentConfig(
        system_instruction=system,
        max_output_tokens=max_tokens,
        temperature=0.15,
        response_mime_type=response_mime_type,
    )

    for key in pool:
        try:
            with genai.Client(
                api_key=key,
                http_options=types.HttpOptions(
                    timeout=50_000,
                    retry_options=types.HttpRetryOptions(attempts=1),
                ),
            ) as client:
                response = client.models.generate_content(
                    model=GEMINI_MODEL,
                    contents=prompt,
                    config=config,
                )
            return extract_text(response)
        except ModelUnavailable:
            raise
        except errors.APIError as exc:
            app.logger.warning("Model request failed with status %s", exc.code)
            if exc.code in (400, 401, 403, 429):
                continue
            raise ModelUnavailable(
                "The analysis service is temporarily unavailable. Please try again."
            ) from None
        except Exception as exc:
            app.logger.warning("Model request failed (%s)", type(exc).__name__)
            raise ModelUnavailable(
                "The analysis service could not be reached. Please try again."
            ) from None

    raise ModelUnavailable(
        "The analysis service could not process the request. Check the server "
        "configuration and try again."
    )


SYSTEM_COMPLEXITY = """\
You are a senior Python performance reviewer. Analyze the exact Python source,
not a generic pattern that resembles it.

Return one JSON object and nothing else. Do not use markdown fences.

Schema:
{
  "language": "python",
  "summary": "one concise sentence describing the computation",
  "time": {
    "best": {"bound": "O(...)", "reason": "specific path and line numbers"},
    "average": {"bound": "O(...)", "reason": "specific path and line numbers"},
    "worst": {"bound": "O(...)", "reason": "specific path and line numbers"}
  },
  "space": {"bound": "O(...)", "reason": "auxiliary space excluding input"},
  "drivers": [
    {"kind": "loop|recursion|allocation|call",
     "where": "line number or construct",
     "cost": "O(...)",
     "note": "why this construct drives cost"}
  ],
  "notes": ["only important assumptions or caveats"]
}

Rules:
- Trace actual loops, recursion, calls, comprehensions, sorting, allocations, and
  early exits. Do not infer complexity from the function name.
- Use the source line numbers in every reason and driver where possible.
- Define every variable used in a bound, such as n, m, k, or the bit length of an
  integer. Distinguish input size from the number of iterations.
- For Python, account for built-in operations such as sorted, membership checks,
  slicing, string concatenation, and list/dict operations when they matter.
- If behavior depends on input types or a library implementation, state the
  assumption briefly instead of inventing certainty.
- Keep notes short. Do not repeat the summary or fill the response with generic
  performance advice."""


def _json_only(text: str) -> dict:
    """Parse JSON even if a model accidentally wraps it in a code fence."""
    fence = re.search(r"```(?:json)?\s*(.*?)```", text, re.DOTALL)
    if fence:
        text = fence.group(1)

    text = text.strip()
    try:
        parsed = json.loads(text)
        if not isinstance(parsed, dict):
            raise ValueError("The report must be a JSON object.")
        return parsed
    except json.JSONDecodeError:
        start = text.find("{")
        end = text.rfind("}")
        if start == -1 or end <= start:
            raise ValueError("The model did not return parseable JSON.") from None
        parsed = json.loads(text[start : end + 1])
        if not isinstance(parsed, dict):
            raise ValueError("The report must be a JSON object.")
        return parsed


def _read_python() -> str:
    """Validate a request and ensure the submitted source is Python."""
    payload = request.get_json(silent=True) or {}
    code = (payload.get("code") or "").strip()
    if not code:
        raise ValueError("Paste some Python code first.")
    if len(code) > MAX_INPUT:
        raise ValueError(
            f"That input is {len(code):,} characters. The limit is "
            f"{MAX_INPUT:,}; try a smaller function."
        )

    requested_language = (payload.get("language") or "").strip().lower()
    if requested_language and requested_language not in ("python", "py"):
        raise ValueError("Only Python is supported.")

    try:
        ast.parse(code)
    except SyntaxError as exc:
        raise ValueError(f"That is not valid Python: {exc.msg}.") from None
    return code


def _fail(message: str, status: int = 400):
    return jsonify({"ok": False, "error": message}), status


# --------------------------------------------------------------------------
# Pages
# --------------------------------------------------------------------------


@app.route("/")
def home():
    return render_template("index.html", active="home")


@app.route("/analysis")
def analysis():
    return render_template("analysis.html", active="analysis")


# --------------------------------------------------------------------------
# Analysis
# --------------------------------------------------------------------------


@app.post("/api/complexity")
def api_complexity():
    try:
        code = _read_python()
    except ValueError as exc:
        return _fail(str(exc))

    prompt = (
        "Analyze this exact Python source. Trace the real execution paths, then "
        "return the requested JSON. Do not include generic advice.\n\n"
        f"PYTHON SOURCE:\n{code}"
    )
    try:
        text = call_gemini(
            prompt,
            SYSTEM_COMPLEXITY,
            max_tokens=12_000,
            response_mime_type="application/json",
        )
    except ModelUnavailable as exc:
        return _fail(str(exc), 503)

    try:
        report = _json_only(text)
    except (ValueError, json.JSONDecodeError):
        return _fail("The complexity report came back malformed. Try again.", 502)

    report["language"] = "python"
    return jsonify({"ok": True, "language": "python", "report": report})


@app.get("/api/health")
def api_health():
    return jsonify(
        {
            "ok": True,
            "model": GEMINI_MODEL,
            "keys_configured": len(_get_key_pool()),
            "language": "python",
        }
    )


@app.errorhandler(404)
def not_found(_):
    return render_template("404.html", active=None), 404


if __name__ == "__main__":
    app.run(
        host="127.0.0.1",
        port=int(os.environ.get("PORT", 5000)),
        debug=os.environ.get("FLASK_DEBUG") == "1",
    )
