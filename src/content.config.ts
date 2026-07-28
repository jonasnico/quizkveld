import { defineCollection } from "astro:content";
import { file } from "astro/loaders";

import { QuizDataSchema, type QuizData } from "../pipeline/schema.js";

/**
 * Content Layer bindings for the generated dataset.
 *
 * `data/quizzes.json` is a single document with two arrays plus metadata, so each
 * collection gets its own parser that slices the part it needs out of the same file.
 *
 * Validation happens here with the pipeline's own Zod schemas rather than through a
 * collection `schema`. Astro 7 ships Zod 4 internally while the pipeline is on Zod 3, and
 * handing a Zod 3 object across the `defineCollection` boundary is exactly the kind of
 * thing that breaks on a patch release. Parsing in the loader keeps the pipeline contract
 * authoritative and version-independent; `src/lib/data.ts` re-attaches the pipeline's
 * TypeScript types on the way out.
 */

function readQuizData(text: string): QuizData {
  return QuizDataSchema.parse(JSON.parse(text));
}

const venues = defineCollection({
  loader: file("data/quizzes.json", {
    parser: (text) => readQuizData(text).venues,
  }),
});

const quizzes = defineCollection({
  loader: file("data/quizzes.json", {
    parser: (text) => readQuizData(text).quizzes,
  }),
});

/**
 * Provenance for the whole dataset. A single-entry collection is the least awkward way to
 * expose it, since the Content Layer only deals in collections of identified entries.
 */
const meta = defineCollection({
  loader: file("data/quizzes.json", {
    parser: (text) => {
      const data = readQuizData(text);
      return [
        {
          id: "meta",
          generatedAt: data.generatedAt,
          sourceUpdatedAt: data.sourceUpdatedAt,
        },
      ];
    },
  }),
});

export const collections = { venues, quizzes, meta };
