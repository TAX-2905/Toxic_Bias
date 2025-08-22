export type Issue = {
  start: number; // inklizif
  end: number;   // eksklizif
  quote: string;
  offense:
    | "toxicity" | "harassment" | "hate" | "violence" | "sexual"
    | "self-harm" | "bullying" | "spam" | "misinformation" | "bias" | "stereotype";
  severity: 0 | 1 | 2 | 3;
  rationale: string;
};

export type AnalysisResult = {
  overall_label: "safe" | "risky" | "unsafe";
  issues: Issue[];
};

// Schema JSON pou sorti struktire (bizwin met additionalProperties: false)
export const schema = {
  type: "object",
  additionalProperties: false,
  properties: {
    overall_label: { type: "string", enum: ["safe", "risky", "unsafe"] },
    issues: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          start: { type: "integer" },
          end: { type: "integer" },
          quote: { type: "string" },
          offense: {
            type: "string",
            enum: [
              "toxicity",
              "harassment",
              "hate",
              "violence",
              "sexual",
              "self-harm",
              "bullying",
              "spam",
              "misinformation",
              "bias",
              "stereotype",
            ],
          },
          severity: { type: "integer", enum: [0, 1, 2, 3] },
          rationale: { type: "string" },
        },
        required: ["start", "end", "quote", "offense", "severity", "rationale"],
      },
    },
  },
  required: ["overall_label", "issues"],
} as const;
