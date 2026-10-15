# Parchi demo video: voiceover script

`video/parchi-demo.mp4` is a finished 4:23 video (1080p, captions on screen, silent audio track). It covers the problem, the build (architecture and code), a live demo, scalability and the business model.

**Best result:** record yourself reading this over the video. In iMovie, drag the video onto the timeline, click the microphone icon, press Record and read along. Then export at 1080p and upload to YouTube (Public or Unlisted). If you're short on time, the silent captioned video works on its own.

---

### 0:00 · Cover (10 s)
> Hi, I'm Shreyans. This is Parchi: chat orders in, invoices out. An order desk for wholesalers.

### 0:10 · The problem (30 s)
> Small retailers order from wholesalers the way they talk: a WhatsApp message in Spanish, a voice note, Arabic with Arabic numerals, or a photo of a handwritten slip. At the wholesaler, someone decodes every one and retypes it into billing software. QuickBooks and Xero make great invoices, but they assume someone already did that retyping.

### 0:40 · Live demo (71 s, follow the captions)
**0:40**
> Here's a Spanish order in Parchi, read in milliseconds. Quantities in blue, items underlined, sizes and colours in yellow, and every line matched to a real product.

**0:48**
> Gift wrap is short, so it bills what's in stock and backorders the rest. The invoice builds itself.

**0:56**
> A voice note in Hindi trade slang: pechkas is a screwdriver, plaas is pliers, taala is a padlock.

**1:03**
> A photo of a handwritten slip. Claude reads it; the rules do the rest.

**1:10**
> Arabic, with Arabic numerals. Two cartons of bulbs is a hundred pieces, and because it's an export, the invoice is zero-rated.

**1:17**
> Now a messy one with typos. Parchi fixes the spelling, but "Steplar" could be either stapler, so instead of guessing, it asks. One click settles it.

**1:32**
> Confirm. The invoice is stamped, stock drops, and a reply is ready in the customer's own language.

**1:41**
> Short items go onto the next supplier order, and the week view shows value, channels and languages.

### 1:51 · How it works (24 s)
> Rules first, model only on doubt. A tokenizer, an extractor built from language packs, and a matcher that scores every product. Only unsure lines go to Claude, in one call per order. It's pure TypeScript, so the same code runs in the browser and on the server.

### 2:15 · Code: language packs (16 s)
> Each language is a pack: number words, units, colours, sizes and fillers. Adding a market means adding a pack, not rewriting the engine.

### 2:31 · Code: the matcher (16 s)
> Text similarity is capped, so two staplers tie on the word "stapler" and only the spec, 24/6, can push one ahead. Real ties are broken by the customer's past orders.

### 2:47 · Code: invoicing and tests (16 s)
> Tax is charged at each item's rate, exports are zero-rated, and currency and tax rates are settings. Thirty-one tests, all passing.

### 3:03 · Scalability (28 s)
> Most lines are read for free, so cost grows with confusion, not volume. In production it's Postgres with row-level security on every table. The WhatsApp webhook just stores and queues each message, so morning rushes never block. Trigram search handles big catalogs, and invoice numbers and stock update in one transaction.

### 3:31 · Business model (38 s)
> We price per shop, like a phone plan. Free for forty orders a month, nineteen dollars for a shop that bills every day, fifty-nine for a warehouse with the WhatsApp Business inbox. Because most lines never touch a model, our cost per order stays close to zero. Every invoice goes back to a retailer on WhatsApp, and that's how the next wholesaler hears about us.

### 4:09 · Close (14 s)
> Parchi: chat orders in, invoices out. Next are pilots with wholesale distributors. You can try it at the link below. Thank you.
