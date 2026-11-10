import { z } from "zod";

export const MAX_VARIANT_BATCH = 50;

const optionSchema = z.object({
  optionId: z.string().cuid(),
  values: z.array(z.string().trim().min(1).max(80)).min(1).max(MAX_VARIANT_BATCH),
});

export const variantBatchOptionsSchema = z.array(optionSchema).min(1).max(20).superRefine((options, context) => {
  if (new Set(options.map(({ optionId }) => optionId)).size !== options.length) {
    context.addIssue({ code: "custom", message: "Each option can only be used once." });
  }
  for (const option of options) {
    if (new Set(option.values.map((value) => value.toLocaleLowerCase("en"))).size !== option.values.length) {
      context.addIssue({ code: "custom", message: "Option values must be unique." });
    }
  }
  if (options.reduce((count, option) => count * option.values.length, 1) > MAX_VARIANT_BATCH) {
    context.addIssue({ code: "custom", message: `Create at most ${MAX_VARIANT_BATCH} variants at a time.` });
  }
});

export type BatchOption = z.infer<typeof optionSchema>;
export type VariantOptionValue = { optionId: string; value: string };

export function variantOptionKey(values: VariantOptionValue[]) {
  return JSON.stringify(values
    .map(({ optionId, value }) => [optionId, value.trim().toLocaleLowerCase("en")])
    .sort(([left], [right]) => left.localeCompare(right)));
}

export function buildVariantCombinations(options: BatchOption[]): VariantOptionValue[][] {
  return options.reduce<VariantOptionValue[][]>(
    (combinations, option) => combinations.flatMap((combination) =>
      option.values.map((value) => [...combination, { optionId: option.optionId, value }])),
    [[]],
  );
}
