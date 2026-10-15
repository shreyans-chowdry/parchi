# Devpost submission: Parchi

## Project name

```
Parchi: chat orders in, invoices out
```

## Elevator pitch

```
Parchi reads messy WhatsApp, voice-note and handwritten orders in 7 languages, from Spanish to Arabic, matches every line to the right product, checks stock and returns a ready invoice.
```

## About the project

```markdown
## Inspiration

Small retailers order from wholesalers the way they talk. Not through a portal or an order form, but in a chat message:

> *"Hola, necesito 2 cajas de grapadoras 24/6, 5 docenas de papel de regalo rojo, 10 paquetes de grapas 24/6 y 6 rollos de cinta de embalaje. Para mañana por favor"*

Others arrive as voice notes, as Arabic text with Arabic numerals (*"عايز ٢ كرتونة لمبة ليد 9W"*), as French with half the words abbreviated, or as a photo of a handwritten slip. At the wholesaler, someone reads every message, works out which of four staplers "grapadora" means, checks stock, and retypes the whole thing into billing software. QuickBooks, Xero and Zoho make good invoices, but they all assume a person has already done that retyping.

That retyping step is slow, error-prone and the same in every market, from Mexico City to Cairo to Jakarta. I wanted to build the first version of a company that removes it.

## What it does

**Parchi** (a word for the paper slip an order is written on) is an order desk for wholesalers:

- **Reads orders in 7 languages, the way they're actually written:** English, Spanish, Portuguese, French, Arabic, Indonesian and Hindi. It understands number words (*docena*, *dúzia*, *douzaine*, *عشرة*, *lusin*), trade units (*caja*, *caixa*, *carton*, *كرتونة*, *kotak*), different scripts and digits (٢, ५), and spelling mistakes (*sciccors*, *notbook*, *padlok*).
- **Shows its work.** Every quantity, item and size is highlighted on the original message. Hover over an invoice line and the exact words it came from light up.
- **Matches every line to a product** with a confidence score, choosing the right variant from specs (24/6 vs No.10 staples, 9 W vs 12 W bulbs, 6x8 vs 8x10 frames), colour and size.
- **Knows the customer.** When two variants are equally likely, the customer's past orders decide ("same as last time").
- **Asks instead of guessing.** Unclear lines are flagged for a one-click check, or sent to **Claude** in one batched call. Photos of handwritten slips are transcribed by Claude.
- **Checks stock**, and can bill what's available while backordering the rest.
- **Makes the invoice:** tax at each item's rate, zero-rated export sales, a tax summary, the amount in words, and yearly numbering (INV-2026-0143). Currency and tax rates are settings, so it works in any market.
- **Replies on WhatsApp in the customer's language.**
- **Runs the counter:** invoices and collections, live stock, a reorder list for the next supplier order, and a weekly view of order value, channels and languages.

## How we built it

**Rules first, model only on doubt.** The core is an order engine in pure TypeScript (no dependencies) that runs unchanged in the browser, in tests and in a Deno edge function.

1. **Tokenizer.** Keeps specs whole (`24/6`, `No.10`, `6x8`, `USB-C`), converts Arabic-Indic and other digits, normalises Arabic letter variants, strips French elision (*d'ampoules* → *ampoules*), and splits lines on commas, *and*, *y*, *e*, *et*, *dan* and the Arabic comma.
2. **Extractor.** A state machine over a lexicon built from **language packs**, one per language: number words, units, colours, sizes, filler words and deadline words (*mañana*, *amanhã*, *demain*, *بكرة*, *besok*). Adding a market means adding a pack, not rewriting the engine. It handles quantities before or after the item, compound numbers, elliptical lines (*25 large diapers and 10 small*) and slip formats (*Stapler No.10 - 2 box*).
3. **Matcher.** Each product gets an IDF-weighted fuzzy token score \\( s_{tok} \\) and a character-trigram score \\( s_{tri} \\), computed against hundreds of trade names in every supported language. The two are blended, then structured agreement is added on top:

$$ s = 0.8\,\big(0.6\,s_{tok} + 0.4\,s_{tri}\big) + \Delta_{spec} + \Delta_{colour} + \Delta_{size} $$

   Text similarity is capped at 0.8 on purpose. "Stapler" (or *grapadora*, or *دباسة*) matches two staplers equally well, so only agreeing on *24/6* should push one ahead. Contradictions (asking for 9 W, getting 12 W) cost more than a match earns. Confidence blends the top score with its lead over the runner-up:

$$ c = 0.82\,\min(1, s_1) + 0.6\,\min(s_1 - s_2,\ 0.3) $$

   Lines with \\( c \ge 0.66 \\) are ready, \\( 0.4 \le c < 0.66 \\) need a check, and anything lower is marked not found.
4. **Model on doubt.** Doubtful lines go to Claude in one JSON request per order. The request lists the candidate products, and the answer is checked against that list, so the model can only pick a real item. Handwritten slips go to Claude vision for transcription, then through the same rules.
5. **Invoicing.** Tax per line at the product's rate, zero-rating for cross-border sales, a summary by rate, merging of repeated items, and amounts in words.

**Stack.** React 18 and TypeScript, built with Vite into a single self-contained page. The design system is hand-built around the look of a paper ledger: a red double rule, blue carbon-copy ink on the invoice, a handwriting font for order slips, and right-to-left support for Arabic. Claude handles photos and doubtful lines. The production path is Supabase Postgres with row-level security, `pg_trgm`, `pgvector` and `pgmq`, plus Deno edge functions for parsing and the WhatsApp Cloud API webhook. 31 Vitest tests cover the tokenizer, extraction in every language, matching, units, invoicing and stock.

## Challenges we ran into

- **Words that collide across languages.** "dos" is two in Spanish, "do" is two in Hindi but "give" in *bhej do*, and "par" means "pair" in one language and "on" in another. Each language pack only adds a word if it doesn't break another language, and tests in every language keep it that way.
- **Variants that share a name.** Early versions picked the first stapler they saw. Capping text similarity and letting specs, colour and size decide fixed this, and made confidence honest: a genuine tie now asks the user.
- **Scripts and spelling.** Arabic writes the same word with different letter forms, French glues articles onto nouns, and Spanish and Portuguese plurals change the size words (*médias*, *pequeños*). All of it is normalised before matching.
- **Units nobody writes down.** *2 cartons* of bulbs is 100 pieces, *5 علب* of batteries is 50 packs, *2 lusin* of scissors is 24. Every conversion is shown on screen so the user can catch a wrong box size.

## Accomplishments that we're proud of

- A Spanish chat order, or an Arabic one with Arabic numerals, becomes a correct, stamped invoice in a few milliseconds, with every decision explained on screen.
- Adding a language takes one pack of words, not a new engine. Five languages were added in one sprint.
- The same engine runs in the browser, in tests and on the server without a single change.

## What we learned

The model should be the last resort, not the first. Being explicit about doubt (a confidence score, a reason, a one-click fix) earns more trust than a model that's right most of the time and silent when it's wrong. I also learned that trade language is very local: the hardest words were never the product names but the units and the fillers.

## What's next for Parchi

- Pilots with a handful of wholesale distributors.
- The WhatsApp Business inbox, so orders land in Parchi without copy and paste.
- Speech-to-text for voice notes in every supported language, and per-customer price lists.
- More language packs and local tax presets, plus export to QuickBooks, Xero and Zoho Books.

*The demo runs on sample data: a fictional distributor, fictional customer shops and sample stock.*
```

## Built with

```
react
typescript
vite
vitest
claude
anthropic
supabase
postgresql
pgvector
deno
whatsapp-cloud-api
css3
html5
playwright
```

## "Try it out" links

1. Live demo: `https://claude.ai/artifact/HiDLiNUbpPLqL7FykEkN2y` (turn on a public link in its Share menu first)
2. Code: your GitHub repo link
