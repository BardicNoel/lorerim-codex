import { VercelRequest, VercelResponse } from "@vercel/node";
import Fuse from "fuse.js";
import type { FuseResult } from "fuse.js";
import * as fs from "fs";
import * as path from "path";
import * as yaml from "js-yaml";
const DEFAULT_LIMIT = 5;

interface Trait {
  name: string;
  tags: string[];
  description: string;
  effects: Array<{
    type: string;
    value: string;
    scope?: string | string[];
    condition?: string;
    duration?: string;
    stacks?: number;
    note?: string;
  }>;
}

// Load and parse the YAML file
const loadTraits = () => {
  try {
    const traitsFilePath = path.join(
      process.cwd(),
      "data",
      "traits",
      "traits-2.yaml"
    );
    console.log("Loading traits from:", traitsFilePath);
    const traitsFileContent = fs.readFileSync(traitsFilePath, "utf8");
    const traitsData = yaml.load(traitsFileContent) as { traits: Trait[] };
    console.log(`Loaded ${traitsData.traits.length} traits`);
    return traitsData.traits;
  } catch (error) {
    console.error("Error loading traits:", error);
    throw error;
  }
};

const traits = loadTraits();

// Define search fields and their weights
const searchFields = {
  name: { weight: 2 },
  description: { weight: 1 },
  tags: { weight: 1.5 },
  effects: { weight: 1 },
};

// Initialize Fuse with advanced configuration
const createFuseInstance = (
  customKeys?: Array<{ name: string; weight: number }>
) => {
  return new Fuse<Trait>(traits, {
    keys:
      customKeys ||
      Object.entries(searchFields).map(([name, config]) => ({
        name,
        weight: config.weight,
      })),
    threshold: 0.3,
    useExtendedSearch: true,
    ignoreLocation: true,
    findAllMatches: true,
  });
};

// Default fuse instance for general search
const defaultFuse = createFuseInstance();

interface SearchParams {
  q?: string;
  name?: string;
  description?: string;
  tags?: string;
  effects?: string;
  limit?: number;
}

export default function handler(req: VercelRequest, res: VercelResponse) {
  try {
    // Handle CORS preflight
    if (req.method === "OPTIONS") {
      res.setHeader("Access-Control-Allow-Origin", "*");
      res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
      res.setHeader("Access-Control-Allow-Headers", "Content-Type");
      return res.status(200).end();
    }

    // Parse and validate search parameters
    const params: SearchParams = {
      q: req.query.q as string,
      name: req.query.name as string,
      description: req.query.description as string,
      tags: req.query.tags as string,
      effects: req.query.effects as string,
    };

    // Parse limit parameter, use DEFAULT_LIMIT if not specified
    const limit = req.query.limit
      ? parseInt(req.query.limit as string, 10)
      : DEFAULT_LIMIT;
    if (isNaN(limit) || limit < 1) {
      return res
        .status(400)
        .json({ error: "Invalid limit parameter: must be a positive number" });
    }

    // Check if at least one search parameter is provided
    if (
      !params.q &&
      !params.name &&
      !params.description &&
      !params.tags &&
      !params.effects
    ) {
      return res
        .status(400)
        .json({ error: "At least one search parameter is required" });
    }

    let results: FuseResult<Trait>[] = [];

    // Handle field-specific searches
    const fieldSearches = Object.entries(params)
      .filter(([key, value]) => key !== "q" && value)
      .map(([key, value]) => ({
        field: key,
        value: value as string,
      }));

    if (fieldSearches.length > 0) {
      // Create a Fuse instance for specific fields only
      const specificFields = fieldSearches.map((search) => ({
        name: search.field,
        weight: searchFields[search.field as keyof typeof searchFields].weight,
      }));

      const specificFuse = createFuseInstance(specificFields);

      // Combine results from all field-specific searches with OR operation
      results = fieldSearches.flatMap((search) =>
        specificFuse.search(search.value)
      );

      // Remove duplicates
      results = results.filter(
        (item, index, self) =>
          index === self.findIndex((t) => t.item.name === item.item.name)
      );
    }

    // Add general search results if "q" parameter is provided
    if (params.q) {
      const qResults = defaultFuse.search(params.q);

      // Merge with field-specific results if they exist
      if (results.length > 0) {
        results = [...results, ...qResults].filter(
          (item, index, self) =>
            index === self.findIndex((t) => t.item.name === item.item.name)
        );
      } else {
        results = qResults;
      }
    }

    // Apply limit
    const limitedResults = results.slice(0, limit);

    // Log search parameters and results
    console.log("Search params:", params);
    console.log(
      `Found ${results.length} results, returning ${limitedResults.length} (limit: ${limit})`
    );

    // Set CORS headers
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "GET");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type");

    return res.status(200).json({
      total: results.length,
      returned: limitedResults.length,
      params: params,
      results: limitedResults.map((r) => r.item),
    });
  } catch (error) {
    console.error("Error processing request:", error);
    return res.status(500).json({ error: "Internal server error" });
  }
}
