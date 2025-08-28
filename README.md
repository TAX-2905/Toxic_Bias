# 🛡️ MorisGuard — Real-time Text Moderation (Kreol Morisien)

Minimal Next.js app that flags harmful spans in user text.
Powered by **NLP** + **Generative AI** (Google Gemini) with a normalization & lexicon pre-pass tuned for Mauritian Creole/French.

## ✨ Main features

* 🔍 **Span highlights** with severity **0–3** + tooltips
* 🧭 **Overall label**: *safe • risky • unsafe*
* 🏷️ **Categories**: toxicity, harassment, hate, violence, sexual, self-harm, bullying, spam, misinformation, bias, stereotype
* 🧠 **Hint-aided detection** (Unicode normalization, abbreviation heuristics, stereotype window) → refined by **Generative AI**
* 🧩 **Overlap merge** (keeps highest severity, aggregates rationales)
* 🇲🇺 **Localized UI** (Kreol Morisien), Tailwind styling

## ⚙️ How it works (high level)

* 🧱 **NLP pre-processing** proposes candidate spans (“hints”)
* 🤖 **Gemini** returns structured findings; server validates, realigns quotes, merges overlaps
* ⚡ UI segments text efficiently to keep typing responsive

## 🧰 Requirements

* Node.js 18+
* **GEMINI\_API\_KEY** (optional **GEMINI\_MODEL**, default `gemini-2.5-flash`)

## 🚀 Quick start

1. Install deps
2. Create `.env.local` with `GEMINI_API_KEY`
3. Run dev server and open the local URL

## 📝 Notes

* Test Version only — not a complete moderation system
* Ensure compliance with API terms & data-handling requirements


