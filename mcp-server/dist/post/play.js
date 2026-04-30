import { spawn } from "node:child_process";
import { platform } from "node:os";
/**
 * Spawn a non-blocking native player. Fires and forgets — failures don't propagate.
 * macOS uses `afplay`. Other platforms are no-op for v1.
 */
export function autoPlay(filePath) {
    if (platform() !== "darwin")
        return;
    try {
        const proc = spawn("afplay", [filePath], { detached: true, stdio: "ignore" });
        proc.unref();
        proc.on("error", () => {
            // afplay missing or failed — silently ignore.
        });
    }
    catch {
        // ignore
    }
}
