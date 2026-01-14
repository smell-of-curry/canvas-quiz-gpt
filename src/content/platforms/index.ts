/**
 * Platform adapters module.
 * This file registers all supported quiz platform adapters and exports the registry.
 *
 * To add a new platform:
 * 1. Create a new adapter class implementing PlatformAdapter in platforms/<platform>/index.ts
 * 2. Import and register it here with appropriate URL and host patterns
 * 3. Update static/manifest.json to include the new host patterns
 */

import { platformRegistry } from "./registry.js";
import { CanvasPlatformAdapter } from "./canvas/index.js";
import { WileyPlatformAdapter } from "./wiley/index.js";

// ─────────────────────────────────────────────────────────────────────────────
// Register Canvas LMS adapter
// ─────────────────────────────────────────────────────────────────────────────
platformRegistry.register(
  new CanvasPlatformAdapter(),
  [/instructure\.com/i, /canvas\./i],
  ["https://*.instructure.com/*"]
);

// ─────────────────────────────────────────────────────────────────────────────
// Register WileyPLUS adapter
// ─────────────────────────────────────────────────────────────────────────────
platformRegistry.register(
  new WileyPlatformAdapter(),
  [/education\.wiley\.com/i, /wileyplus\.com/i],
  ["https://education.wiley.com/*", "https://*.wileyplus.com/*"]
);

// ─────────────────────────────────────────────────────────────────────────────
// Future platform adapters can be registered here:
// ─────────────────────────────────────────────────────────────────────────────

// Example: ExpertTA
// import { ExpertTAPlatformAdapter } from "./expertta/index.js";
// platformRegistry.register(
//   new ExpertTAPlatformAdapter(),
//   [/theexpertta\.com/i],
//   ["https://*.theexpertta.com/*"]
// );

// ─────────────────────────────────────────────────────────────────────────────
// Exports
// ─────────────────────────────────────────────────────────────────────────────

export { platformRegistry } from "./registry.js";
export type {
  ChoiceKind,
  ParsedChoice,
  ParsedQuestion,
  PlatformAdapter,
  QuestionCallback,
} from "./types.js";
