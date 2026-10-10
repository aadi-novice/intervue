import { chromium, type Browser, type BrowserContext, type Page } from "playwright";

export interface LaunchedBrowser {
  page: Page;
  close(): Promise<void>;
}

export const CHROMIUM_ARGS = [
  "--use-fake-ui-for-media-stream", // auto-accept the mic/camera permission prompt
  "--use-fake-device-for-media-stream", // fake devices (we turn them off in the UI anyway)
  "--autoplay-policy=no-user-gesture-required",
  "--disable-blink-features=AutomationControlled",
  "--disable-features=Translate,MediaRouter",
  "--disable-notifications",
  "--no-first-run",
  "--no-default-browser-check",
  "--window-size=1280,720",
  "--window-position=0,0",
];

/**
 * Launches Chromium (headful under Xvfb by default, so Meet behaves as for a normal user).
 * Audio output goes to PulseAudio's default sink; PULSE_SINK pins it to our null sink.
 */
export async function launchBrowser(opts: { headless: boolean; pulseSink: string }): Promise<LaunchedBrowser> {
  const browser: Browser = await chromium.launch({
    headless: opts.headless,
    args: CHROMIUM_ARGS,
    ignoreDefaultArgs: ["--mute-audio", "--enable-automation"],
    env: { ...process.env, PULSE_SINK: opts.pulseSink },
  });
  let context: BrowserContext | undefined;
  try {
    context = await browser.newContext({
      viewport: { width: 1280, height: 720 },
      locale: "en-US", // selectors match English UI texts
      timezoneId: "UTC",
      permissions: ["microphone", "camera", "notifications"],
      extraHTTPHeaders: { "Accept-Language": "en-US,en;q=0.9" },
    });
    const page = await context.newPage();
    return {
      page,
      close: async () => {
        await context?.close().catch(() => undefined);
        await browser.close().catch(() => undefined);
      },
    };
  } catch (err) {
    await browser.close().catch(() => undefined);
    throw err;
  }
}
