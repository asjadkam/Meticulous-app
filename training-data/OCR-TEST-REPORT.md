# Tesseract.js Ticket OCR — Training & Test Report
**Date:** Oct 13, 2026  
**Engine:** Tesseract.js v5 (on-device, offline, free — no Google Vision)

## Training Data

### 1. BURNCO Aggregate Scale Ticket
- **Image:** `training-data/scale-tickets/burnco-2026-09-30.jpg`
- **Fields:** `training-data/scale-tickets/burnco-2026-09-30.json`
- **Source:** Real ticket from Asjad, Sep 30 2026

### 2. Dispatch Screenshot (WhatsApp)
- **Image:** `workspace/user/files/63185_23_vreu.jpg`
- **Source:** Asjad's dispatch message

### 3. AECON Daily Truck Haul Card (Foreman Ticket)
- **Image:** `training-data/haul-cards/aecon-2026-10-13.jpg`
- **Fields:** `training-data/haul-cards/aecon-2026-10-13.json`
- **Source:** Real blank card from Asjad, Oct 13 2026

## Test Results

### BURNCO Scale Ticket: 13/13 PASS
| Field | Expected | Got | Status |
|-------|----------|-----|--------|
| ticketNo | 1026538139 | 1026538139 | ✅ |
| date | 9/30/2026 | 9/30/2026 | ✅ |
| time | 12:10:03PM | 12:10:03PM | ✅ |
| gross | 22.42 | 22.42 | ✅ |
| tare | 10.24 | 10.24 | ✅ |
| net | 12.18 | 12.18 | ✅ |
| product | 40MM CRUSHED ROCK | 40MM CRUSHED ROCK | ✅ |
| job | A01728 | A01728 | ✅ |
| po | 4500753853 | 4500753853 | ✅ |
| vehicleType | Tandem - T | Tandem - T | ✅ |
| receivedToday | 100.22 t | 100.22 t | ✅ |
| weighmaster | NR | NR | ✅ |
| siteId | 13026 | 13026 | ✅ |

**Key challenges solved:**
- Ticket appears twice (two copies) — dedupe via longest clean digit run
- "1026538139 6" column bleed — fixed by taking first contiguous digit run
- Customer field bleed-through — truncated at field boundaries
- "t" OCR'd as "1" in "100.22 t" — unit made optional, normalized
- Copy 1 noisy vs Copy 2 clean — prefer last match for siteId

### Dispatch Screenshot: 6/6 PASS
| Field | Expected | Got | Status |
|-------|----------|-----|--------|
| time | Tomorrow 8:00am | Tomorrow 8:00am | ✅ |
| equipment | Tandem | Tandem | ✅ |
| site | Aecon Inf | Aecon Inf | ✅ |
| locationCode | A2-L20 | A2-L20 | ✅ |
| instructions | Go Empty To | Go Empty To | ✅ |
| coordinates | 50°57'59.4"N 114°01'54.4"W | 50°57'59.4"N 114°01'54.4"W | ✅ |

### AECON Haul Card: Detected, Handwriting Limitation Confirmed
| Capability | Status |
|------------|--------|
| Form detection ("DAILY TRUCK HAUL CARD") | ✅ |
| Card number (23141, printed) | ✅ |
| Payment unit options (known) | ✅ HOUR, TONNE, TONNE/KM, OTHER |
| Handwritten Project ("A01728") | ❌ OCR: "ROI7 26" |
| Handwritten Date ("Oct 13, 2026") | ❌ OCR: "Cut 12 2006" |
| Handwritten Material ("Clay") | ❌ OCR: "(ls" |
| Handwritten Start Time ("8:30 AM") | ❌ OCR: missing |
| Checkbox states | ❌ Requires image analysis, not OCR |

**Design decision:** Parser returns `needsReview[]` listing 9 fields that the app must prompt the user to confirm. **Never guess handwritten values** — wrong hours = wrong pay.

### Multi-Ticket Aggregation: PASS
- **Test:** 2 haul cards (4h + 3.5h) + 1h travel bonus
- **Result:** 8.5h paid ✅ (matches Asjad's requirement example exactly)
- **Weight mode:** 2 scale tickets (12.18t + 11.95t) = 24.13t ✅

## Implementation

**New file:** `js/ticket-ocr.js`
- `TicketOCR.recognize(image)` — Tesseract.js wrapper
- `TicketOCR.parseScaleTicket(text)` — BURNCO format
- `TicketOCR.parseDispatch(text)` — dispatch screenshots
- `TicketOCR.parseHaulCard(text)` — AECON foreman tickets
- `TicketOCR.parse(text)` — auto-detect
- `TicketOCR.toDispatchForm(parsed)` — map to form fields
- `TicketOCR.summarizeTickets(tickets, travelBonus)` — multi-ticket totals

**Modified:**
- `modules/dispatch.js` — multi-ticket UI, OCR integration, weight-aware revenue
- `modules/revenue.js` — `tons` preserved, tonnes input for Weight entries, auto-calc
- `modules/preferences.js` — travel bonus field (default 1h)
- `modules/manifest.js` — per-ticket breakdown
- `index.html` — Tesseract.js CDN + ticket-ocr.js

## Pay by Weight Mode
- **Preferences:** "Weight" payment standard (already existed), Rate = $/tonne, Travel bonus field added
- **OCR:** Captures Gross, Tare, Net, Received Today from scale tickets
- **Revenue:** `net tonnes × rate/tonne` (existing `payFor` logic, now wired end-to-end)
- **Dispatch completion:** Auto-calculates from ticket weights when in Weight mode
