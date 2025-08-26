// app/lib/kmu-lexicon.ts
// Map each bucket to the Issue["offense"] you want to emit as a hint.
export const OFFENSE_FOR_BUCKET = {
  insults: "harassment",
  threats: "violence",
  violence: "violence",
  slur_bias: "hate",
} as const;

export type Bucket = keyof typeof OFFENSE_FOR_BUCKET;

// Seed words (normalized: no accents, lowercased, singular where possible)
export const LEXICON: Record<Bucket, string[]> = {
  insults: [
    "bet", "bete", "kouyon", "koyon", "kretin", "bourik", "idiot",
    "stupide", "moron", "perdant", "loser", "sal", "malprop", "trash", "garbag", "clueless"
  ],
  threats: [
    "touy", "tue", "kill", "bat", "bate", "atake", "attack", "brile", "burn",
    "tir", "tire", "shoot", "detwi", "detruire", "destroy", "menas", "menace"
  ],
  violence: ["vyolans", "violence", "mor", "lamor", "mori", "die", "death", "lynch", "linch"],
  slur_bias: [
  "falourmama", "gogote", "pilone", "madras", "nation", "lascar", "torma", "torpa", "morma", "morpa", "liki", "likimama", "kkliki", "bachara"
  ],
};
