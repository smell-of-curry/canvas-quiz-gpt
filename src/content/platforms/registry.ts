import type { PlatformAdapter, PlatformRegistryEntry } from "./types.js";

/**
 * Registry of all supported quiz platform adapters.
 * New platforms can be added by registering an adapter with this registry.
 */
class PlatformRegistry {
  private readonly entries: PlatformRegistryEntry[] = [];

  /**
   * Register a platform adapter.
   * @param adapter - The platform adapter to register.
   * @param urlPatterns - URL patterns this adapter matches against.
   * @param hostPatterns - Host patterns for manifest.json configuration.
   */
  register(
    adapter: PlatformAdapter,
    urlPatterns: RegExp[],
    hostPatterns: string[]
  ): void {
    this.entries.push({ adapter, urlPatterns, hostPatterns });
  }

  /**
   * Detect and return the appropriate platform adapter for the current page.
   * @returns The matching platform adapter, or undefined if no adapter matches.
   */
  detect(): PlatformAdapter | undefined {
    for (const entry of this.entries) {
      // First, check URL patterns
      const urlMatches = entry.urlPatterns.some((pattern) =>
        pattern.test(window.location.href)
      );
      if (!urlMatches) continue;

      // Then, ask the adapter to confirm it can handle this page
      if (entry.adapter.isQuizPage()) {
        return entry.adapter;
      }
    }

    return undefined;
  }

  /**
   * Get all registered platform adapters.
   * @returns Array of all registered adapters.
   */
  getAll(): readonly PlatformRegistryEntry[] {
    return this.entries;
  }

  /**
   * Get all host patterns for manifest.json configuration.
   * @returns Array of all unique host patterns.
   */
  getAllHostPatterns(): string[] {
    const patterns = new Set<string>();
    for (const entry of this.entries) {
      for (const pattern of entry.hostPatterns) {
        patterns.add(pattern);
      }
    }
    return Array.from(patterns);
  }
}

/**
 * Global platform registry instance.
 */
export const platformRegistry = new PlatformRegistry();
