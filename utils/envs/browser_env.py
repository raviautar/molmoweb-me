"""
Browser environments for web agent evaluation.

Two concrete implementations:
  - BrowserbaseEnv: connects to Browserbase (cloud, stealth proxies, CAPTCHA solving)
  - LocalBrowserEnv: launches a local Chromium (headless or headed, no proxies)

Both share the same interface:
  env = BrowserbaseEnv(start_url=..., goal=...)  # or LocalBrowserEnv(...)
  obs, info = env.reset()
  obs = env.step(action)
  env.close()

Observations include screenshot, axtree, and extra_element_properties when
extract_axtree=True (default). Set extract_axtree=False for visual-only agents.
"""
import asyncio
import base64
import logging
import os
import subprocess
import sys
import time
from abc import ABC, abstractmethod
from io import BytesIO
from typing import Any

import numpy as np
from PIL import Image
from playwright.sync_api import TimeoutError as PlaywrightTimeoutError
from playwright.sync_api import sync_playwright

from agent.actions import ALL_ACTIONS, BrowserNav, MouseClick, SendMsgToUser
from utils.envs.action_executor import execute_action
from utils.axtree import extract_axtree, extract_screenshot, MarkingError, EXTRACT_OBS_MAX_TRIES

logger = logging.getLogger(__name__)


def _start_playwright():
    asyncio._set_running_loop(None)
    try:
        asyncio.get_event_loop()
    except RuntimeError:
        asyncio.set_event_loop(asyncio.new_event_loop())
    return sync_playwright().start()


def _wait_ready(page, timeout_ms: int = 10000):
    try:
        page.wait_for_load_state("networkidle", timeout=timeout_ms)
        return
    except PlaywrightTimeoutError:
        pass
    try:
        page.wait_for_load_state("load", timeout=timeout_ms)
    except PlaywrightTimeoutError:
        pass


def _take_screenshot(page) -> np.ndarray:
    try:
        cdp = page.context.new_cdp_session(page)
        result = cdp.send("Page.captureScreenshot", {"format": "png"})
        cdp.detach()
        raw = base64.b64decode(result["data"])
    except Exception:
        raw = page.screenshot(timeout=10000, animations="disabled")
    return np.array(Image.open(BytesIO(raw)).convert("RGB"))


class BrowserEnv(ABC):
    """Base browser environment."""

    def __init__(
        self,
        start_url: str = "about:blank",
        goal: str = "",
        viewport_width: int = 1280,
        viewport_height: int = 720,
        extract_axtree: bool = False,
        robust_navigation: bool = False,
    ):
        self.start_url = start_url
        self.goal = goal
        self.viewport_width = viewport_width
        self.viewport_height = viewport_height
        self.extract_axtree = extract_axtree
        self.robust_navigation = robust_navigation

        self.playwright = None
        self.browser = None
        self.context = None
        self.page = None
        self.last_action_error = ""
        self.step_count = 0

    @abstractmethod
    def _launch(self):
        """Launch browser and set self.playwright, self.browser, self.context, self.page."""

    def reset(self, start_url: str | None = None, goal: str | None = None) -> tuple[dict, dict]:
        if start_url is not None:
            self.start_url = start_url
        if goal is not None:
            self.goal = goal

        self.close()
        self._launch()

        self.page.set_viewport_size({"width": self.viewport_width, "height": self.viewport_height})
        self.page.set_default_timeout(120000)

        self.goal = self._navigate_to_start(self.start_url, self.goal)

        _wait_ready(self.page)
        self.last_action_error = ""
        self.step_count = 0

        obs = self._get_obs()
        info = self._get_info()
        return obs, info

    def _navigate_to_start(self, url: str, goal: str) -> str:
        """Navigate to start_url with fallbacks. Returns (possibly modified) goal."""
        if not self.robust_navigation:
            self.page.goto(url, timeout=60000, wait_until="domcontentloaded")
            return goal

        # Attempt 1: direct goto
        try:
            self.page.goto(url, timeout=60000, wait_until="domcontentloaded")
            return goal
        except Exception as e:
            logger.warning(f"goto failed for {url}: {e}")

        # Attempt 2: warm up via bing.com then retry. Establishing a real
        # HTTP/2 connection first helps with sites that reject cold connections
        # from automated browsers.
        try:
            logger.info(f"Warming up via bing.com before retrying {url}")
            self.page.goto("https://www.bing.com/", timeout=30000, wait_until="domcontentloaded")
            time.sleep(2)
            self.page.goto(url, timeout=60000, wait_until="domcontentloaded")
            return goal
        except Exception as e:
            logger.warning(f"Bing warmup + goto failed for {url}: {e}")

        # Both attempts failed -- let the agent navigate there itself
        logger.warning(f"All navigation attempts failed for {url}. Agent will navigate manually.")
        return f"First, navigate to {url}\n\n{goal}"

    def step(self, action: ALL_ACTIONS) -> dict:
        self.step_count += 1

        new_page = self._execute_with_tab_detection(action)
        if new_page:
            self.page = new_page

        # 1. Wait for JS events / callbacks to fire
        time.sleep(0.5)
        # 2. Wait for domcontentloaded on ALL open pages and frames
        for p in self.context.pages:
            try:
                p.wait_for_load_state("domcontentloaded", timeout=3000)
            except Exception:
                pass
            for frame in p.frames:
                try:
                    frame.wait_for_load_state("domcontentloaded", timeout=3000)
                except Exception:
                    pass
        # 3. Final domcontentloaded on active page + extra buffer
        try:
            self.page.wait_for_load_state("domcontentloaded", timeout=5000)
        except Exception:
            pass
        time.sleep(0.5)

        return self._get_obs()

    def _execute_with_tab_detection(self, action: ALL_ACTIONS):
        """Execute action, detecting if it opens a new tab."""
        might_open_tab = isinstance(action, MouseClick) or (
            isinstance(action, BrowserNav) and action.nav_type == "new_tab"
        )

        new_page = None
        if might_open_tab:
            try:
                with self.context.expect_page(timeout=2000) as new_page_info:
                    success, error = execute_action(self.page, action)
                new_page = new_page_info.value
                try:
                    new_page.wait_for_load_state("domcontentloaded", timeout=5000)
                except Exception:
                    pass
                new_page.bring_to_front()
            except PlaywrightTimeoutError:
                new_page = None
        else:
            success, error = execute_action(self.page, action)

            if isinstance(action, BrowserNav) and action.nav_type == "tab_focus":
                pages = self.context.pages
                if 0 <= action.index < len(pages):
                    new_page = pages[action.index]

        self.last_action_error = error if not success else ""
        return new_page

    def _get_obs(self) -> dict[str, Any]:
        screenshot = _take_screenshot(self.page)

        obs = {
            "screenshot": screenshot,
            "url": self.page.url,
            "goal": self.goal,
            "open_pages_titles": [],
            "open_pages_urls": [],
            "active_page_index": [0],
            "last_action_error": self.last_action_error,
            "axtree_object": {},
            "extra_element_properties": {},
        }

        for i, p in enumerate(self.context.pages):
            try:
                obs["open_pages_titles"].append(p.title())
                obs["open_pages_urls"].append(p.url)
                if p == self.page:
                    obs["active_page_index"] = [i]
            except Exception:
                obs["open_pages_titles"].append("Unknown")
                obs["open_pages_urls"].append("")

        if self.extract_axtree:
            for retries in reversed(range(EXTRACT_OBS_MAX_TRIES)):
                try:
                    axtree, extra = extract_axtree(self.page, lenient=(retries == 0))
                    obs["axtree_object"] = axtree
                    obs["extra_element_properties"] = extra
                    break
                except (MarkingError, Exception) as e:
                    if retries > 0:
                        logger.debug(f"AXTree extraction retry ({retries} left): {e}")
                        time.sleep(0.5)
                    else:
                        logger.warning(f"AXTree extraction failed after all retries: {e}")

        return obs

    @abstractmethod
    def _get_info(self) -> dict[str, Any]:
        """Return env-specific info dict."""

    def close(self):
        try:
            if self.browser:
                self.browser.close()
        except Exception:
            pass
        try:
            if self.playwright:
                self.playwright.stop()
        except Exception:
            pass
        self.playwright = None
        self.browser = None
        self.context = None
        self.page = None


class BrowserbaseEnv(BrowserEnv):
    """Browser environment using Browserbase (cloud, stealth, CAPTCHA solving)."""

    def __init__(
        self,
        start_url: str = "about:blank",
        goal: str = "",
        viewport_width: int = 1280,
        viewport_height: int = 720,
        extract_axtree: bool = False,
        api_key: str | None = None,
        project_id: str | None = None,
        native_polyfill: bool = False,
        robust_navigation: bool = False,
    ):
        super().__init__(start_url, goal, viewport_width, viewport_height, extract_axtree, robust_navigation)
        self.api_key = api_key or os.getenv("BROWSERBASE_API_KEY")
        self.project_id = project_id or os.getenv("BROWSERBASE_PROJECT_ID")
        self.native_polyfill = native_polyfill
        self.bb = None
        self.bb_session = None

    def _launch(self):
        from browserbase import Browserbase

        if not self.api_key or not self.project_id:
            raise ValueError("BROWSERBASE_API_KEY and BROWSERBASE_PROJECT_ID required")

        self.bb = Browserbase(api_key=self.api_key)
        browser_settings = {"advanced_stealth": True}
        if self.native_polyfill:
            browser_settings["enableNativeSelectPolyfill"] = False
        self.bb_session = self.bb.sessions.create(
            project_id=self.project_id,
            proxies=True,
            browser_settings=browser_settings,
        )
        logger.info(f"BB session: {self.bb_session.id}")

        self.playwright = _start_playwright()
        cdp_url = f"wss://connect.browserbase.com?sessionId={self.bb_session.id}&apiKey={self.api_key}"
        self.browser = self.playwright.chromium.connect_over_cdp(cdp_url)

        if self.browser.contexts:
            self.context = self.browser.contexts[0]
            self.page = self.context.pages[0] if self.context.pages else self.context.new_page()
        else:
            self.context = self.browser.new_context(
                viewport={"width": self.viewport_width, "height": self.viewport_height}
            )
            self.page = self.context.new_page()

    def _get_info(self) -> dict[str, Any]:
        info = {"bb_session_id": self.bb_session.id if self.bb_session else None}
        if self.bb and self.bb_session:
            try:
                debug = self.bb.sessions.debug(self.bb_session.id)
                if hasattr(debug, "pages") and debug.pages:
                    info["live_view_url"] = debug.pages[0].debugger_fullscreen_url
            except Exception:
                pass
        return info

    def close(self):
        if self.bb and self.bb_session:
            try:
                self.bb.sessions.update(self.bb_session.id, status="REQUEST_RELEASE")
            except Exception:
                pass
        super().close()
        self.bb = None
        self.bb_session = None


class SimpleEnv(BrowserEnv):
    """Browser environment using a local Chromium instance."""

    STEALTH_ARGS = ["--disable-blink-features=AutomationControlled"]

    def __init__(
        self,
        start_url: str = "about:blank",
        goal: str = "",
        viewport_width: int = 1280,
        viewport_height: int = 720,
        extract_axtree: bool = False,
        headless: bool = True,
        channel: str | None = None,
    ):
        super().__init__(start_url, goal, viewport_width, viewport_height, extract_axtree)
        self.headless = headless
        self.channel = channel

    def _launch(self):
        self.playwright = _start_playwright()
        launch_opts: dict = {
            "headless": self.headless,
            "args": self.STEALTH_ARGS,
        }
        if self.channel:
            launch_opts["channel"] = self.channel
        self.browser = self.playwright.chromium.launch(**launch_opts)
        self.context = self.browser.new_context(
            viewport={"width": self.viewport_width, "height": self.viewport_height}
        )
        self.page = self.context.new_page()

    def _get_info(self) -> dict[str, Any]:
        return {}


# ---- Custom: Reuse an existing Chrome profile (e.g. Gmail already logged in) ----
class ProfiledChromeEnv(BrowserEnv):
    """Browser environment that launches Chrome/Chromium against a user-specified
    profile directory so that any existing login sessions (e.g. Gmail) are already
    present without copying cookies.

    Playwright uses `launch_persistent_context` which opens the real on-disk profile.
    Note: The profile must NOT have another Chrome instance running against it at the
    same time, or Chrome will refuse the lock.  Close the real browser first.

    Args:
        profile_dir: Absolute path to a Chrome user-data directory, e.g.
                     ``/home/alice/.config/google-chrome`` or a custom path
                     like ``~/.config/chromium``.  The directory is used as-is;
                     Playwright will create it if it does not exist (fresh profile).
        channel:     Optional Chrome channel to use: ``"chrome"``, ``"chrome-beta"``,
                     ``"msedge"``, or ``None`` (plain Playwright Chromium build).
        headless:    Whether to start the browser without a visible window.  For
                     profile reuse, ``False`` is recommended during development so
                     you can see what is happening.
    """

    STEALTH_ARGS = ["--disable-blink-features=AutomationControlled"]

    def __init__(
        self,
        start_url: str = "about:blank",
        goal: str = "",
        viewport_width: int = 1280,
        viewport_height: int = 720,
        extract_axtree: bool = False,
        profile_dir: str = "",
        profile_name: str = "Default",
        channel: str | None = None,
        headless: bool = False,
    ):
        super().__init__(start_url, goal, viewport_width, viewport_height, extract_axtree)
        # Step 1: Resolve and expand the profile directory path.
        self.profile_dir = os.path.expanduser(profile_dir.strip()) if profile_dir.strip() else ""
        # Step 2: Chrome sub-profile name inside the user-data directory (almost always "Default").
        self.profile_name = profile_name.strip() or "Default"
        self.channel = channel
        # Step 3: Headless mode breaks authenticated sessions on most sites.
        # Override silently to headed so login cookies are honoured.
        if headless:
            logger.warning(
                "ProfiledChromeEnv: headless=True was requested but a Chrome profile is in use. "
                "Overriding to headless=False so existing login sessions are not discarded."
            )
        self.headless = False
        # Step 4: Holds a reference to a Xvfb subprocess started by _ensure_display().
        self._xvfb_proc: subprocess.Popen | None = None

    def _ensure_display(self) -> None:
        """On Linux, auto-start a virtual X server (Xvfb) when no $DISPLAY is set.
        This is required for headed Chrome launched inside a headless server environment.
        Does nothing on Windows or when a real display is already available.
        """
        # Step 1: Nothing to do on Windows — no X display concept.
        if sys.platform == "win32":
            return

        # Step 2: A display is already available; nothing to do.
        if os.environ.get("DISPLAY") or os.environ.get("WAYLAND_DISPLAY"):
            return

        # Step 3: Try to start Xvfb on a stable virtual display number.
        display_num = 99
        try:
            self._xvfb_proc = subprocess.Popen(
                ["Xvfb", f":{display_num}", "-screen", "0",
                 f"{self.viewport_width}x{self.viewport_height}x24", "-ac"],
                stdout=subprocess.DEVNULL,
                stderr=subprocess.DEVNULL,
            )
            time.sleep(0.8)  # give Xvfb a moment to bind the display
            os.environ["DISPLAY"] = f":{display_num}"
            logger.info(f"ProfiledChromeEnv: auto-started Xvfb on :{display_num} (pid {self._xvfb_proc.pid})")
        except FileNotFoundError:
            raise RuntimeError(
                "No X display found ($DISPLAY is not set) and Xvfb is not installed. "
                "Install it on the server with:  sudo apt-get install -y xvfb"
            ) from None

    def _launch(self):
        # Step 1: Validate that a profile directory was provided.
        if not self.profile_dir:
            raise ValueError(
                "ProfiledChromeEnv requires a non-empty profile_dir. "
                "Pass the path to your Chrome user-data directory, e.g. "
                "'/home/youruser/.config/google-chrome'."
            )

        # Step 2: Detect a Windows-style path being used on a Linux server.
        # The Playwright browser launches on the SERVER, not the user's local machine.
        # A Windows path like C:\Users\... cannot be opened from a Linux process.
        if sys.platform != "win32" and len(self.profile_dir) >= 3 and self.profile_dir[1] == ":":
            raise ValueError(
                f"Windows-style profile path detected: '{self.profile_dir}'\n"
                "The Playwright browser runs on the SERVER (Linux), not your local Windows machine. "
                "You have two options:\n"
                "  A) Copy your Chrome 'User Data' folder to the Linux server and provide that Linux path.\n"
                "  B) Leave 'Chrome Profile Dir' empty to use an isolated Chromium session instead."
            )

        # Step 3: Ensure a display is available; auto-start Xvfb when none is found.
        self._ensure_display()

        self.playwright = _start_playwright()

        # Step 4: Build the persistent-context launch options.
        # --profile-directory tells Chrome which sub-folder inside user-data-dir to open.
        # Without it Chrome picks an arbitrary profile and ignores the logged-in cookies.
        launch_opts: dict = {
            "headless": self.headless,
            "args": self.STEALTH_ARGS + [f"--profile-directory={self.profile_name}"],
            "viewport": {"width": self.viewport_width, "height": self.viewport_height},
        }
        if self.channel:
            launch_opts["channel"] = self.channel

        # Step 5: Open (or create) the persistent profile.  This is the key call that
        # makes Chrome reuse an existing on-disk login session.
        self.context = self.playwright.chromium.launch_persistent_context(
            self.profile_dir,
            **launch_opts,
        )

        # Step 6: Reuse an existing page if the profile already has one open, otherwise
        # create a fresh tab so the agent always has a page to work with.
        if self.context.pages:
            self.page = self.context.pages[0]
        else:
            self.page = self.context.new_page()

        # Step 7: launch_persistent_context does not expose a browser object the same
        # way launch() does.  Set self.browser to None so the base-class close()
        # logic still runs safely.
        self.browser = None

    def _get_info(self) -> dict[str, Any]:
        return {
            "profile_dir": self.profile_dir,
            "profile_name": self.profile_name,
            "channel": self.channel or "",
        }

    def close(self):
        # Step 1: Close the persistent context directly (no separate browser handle).
        try:
            if self.context is not None:
                self.context.close()
        except Exception:
            pass
        # Step 2: Stop Playwright runtime.
        try:
            if self.playwright is not None:
                self.playwright.stop()
        except Exception:
            pass
        self.playwright = None
        self.browser = None
        self.context = None
        self.page = None
        # Step 3: Terminate the Xvfb virtual display we started, if any.
        if self._xvfb_proc is not None:
            try:
                self._xvfb_proc.terminate()
                self._xvfb_proc.wait(timeout=3)
            except Exception:
                pass
            self._xvfb_proc = None