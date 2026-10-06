"""Background worker that calls PING_URL on a fixed interval (default every 10 minutes).

Typical use on Render's free tier: point PING_URL at this app's own /api/health so the
instance never idles long enough to be spun down. Leave PING_URL empty and nothing runs.
"""
import asyncio
import logging
import os
import urllib.request
from urllib.parse import urlparse

DEFAULT_INTERVAL_SECONDS = 10 * 60
REQUEST_TIMEOUT_SECONDS = 30

# uvicorn's logger, so messages show up in the server (and Render) logs without extra setup
log = logging.getLogger("uvicorn.error")


def config_from_env() -> tuple[str, float] | None:
    """(url, interval) when PING_URL is set to an http(s) URL, otherwise None (worker stays off)."""
    url = os.getenv("PING_URL", "").strip()
    if not url:
        return None
    parsed = urlparse(url)
    if parsed.scheme not in {"http", "https"} or not parsed.netloc:
        log.warning("PING_URL %r is not an http(s) URL; background pinger disabled", url)
        return None
    # PING_INTERVAL_SECONDS is optional and mainly useful for testing
    raw = os.getenv("PING_INTERVAL_SECONDS", "").strip()
    try:
        interval = float(raw) if raw else DEFAULT_INTERVAL_SECONDS
    except ValueError:
        log.warning("PING_INTERVAL_SECONDS %r is not a number; using %ss", raw, DEFAULT_INTERVAL_SECONDS)
        interval = DEFAULT_INTERVAL_SECONDS
    return url, max(interval, 0.1)


def _ping(url: str) -> int:
    request = urllib.request.Request(url, headers={"User-Agent": "solo-levelling-pinger/1.0"})
    with urllib.request.urlopen(request, timeout=REQUEST_TIMEOUT_SECONDS) as response:
        return response.status


async def run(url: str, interval: float) -> None:
    """Ping `url` every `interval` seconds until cancelled. Failures are logged, never raised."""
    log.info("Background pinger started: GET %s every %ss", url, interval)
    while True:
        await asyncio.sleep(interval)
        try:
            # urllib blocks, so keep it off the event loop that serves requests
            status = await asyncio.to_thread(_ping, url)
            log.info("Pinger: %s responded HTTP %s", url, status)
        except asyncio.CancelledError:
            raise
        except Exception as exc:  # HTTPError (4xx/5xx), timeouts, DNS failures...
            log.warning("Pinger: request to %s failed: %s", url, exc)
