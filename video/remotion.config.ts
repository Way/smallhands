import { Config } from '@remotion/cli/config';

// Reuse the same Chromium the capture step uses (CHROME_PATH), instead of
// letting Remotion download its own headless shell.
if (process.env.CHROME_PATH) Config.setBrowserExecutable(process.env.CHROME_PATH);
Config.setOverwriteOutput(true);
Config.setVideoImageFormat('jpeg');
