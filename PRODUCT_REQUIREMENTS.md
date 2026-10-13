
## Pay by Weight (Asjad, Oct 13 2026)
- Some users are paid by WEIGHT (per tonne), not by hour.
- Ticket OCR must extract weight fields: Gross, Tare, Net, and "Received Today" total.
- App needs "Pay by Weight" as a pay mode in Preferences (alongside "Pay by Hour").
- When pay mode is "by weight", the revenue calculation uses Net weight × rate per tonne.
- BURNCO ticket example: Net 12.18 (per load), Received Today 100.22 t (daily total).
- Ticket photo is the source of truth for weight-based pay (like foreman ticket is for hour-based).

## Multiple Tickets Per Day (Asjad, Oct 13 2026)
- Drivers can have MULTIPLE haul cards/tickets per day (Asjad had 2 on Oct 13).
- The app must support adding multiple tickets for the same date.
- Total paid hours = SUM of (foreman hours from each ticket) + travel bonus.
- Example: Ticket 1 (4 hours) + Ticket 2 (3.5 hours) + 1 hour travel bonus = 8.5 hours total.
- The daily manifest/invoice must show the breakdown per ticket, not just a single total.
- Ticket OCR must be run on EACH ticket photo, and the app sums the hours.

## Dispatch Custom Fields (Asjad, Oct 13 2026)
- The 6-field dispatch OCR (time, equipment, site, location, instructions, coordinates) is for ASJAD's use case.
- Other users/companies have 100s of different fields: PO number, order number, reference number, etc.
- The dispatch FORM must support CUSTOM FIELDS:
  - Users can add their own fields (text, number, date).
  - Fields can be marked as required/optional.
  - Custom field templates per company/account type.
- The OCR should extract the 6 core fields, but the form must allow manual entry of any additional fields.
- Future: Train OCR to recognize custom field labels per user (v27+).

## Self-Evolving OCR (Asjad, Oct 13 2026) - ROADMAP v27+
- The OCR must LEARN from user corrections and improve over time.
- When a user corrects a misread field, the system saves: (1) the image, (2) the OCR output, (3) the user correction.
- This becomes training data for future model improvements.
- The system adapts to each user's specific document formats (their company's tickets, their handwriting style).
- v26: Save corrections as training data (foundation).
- v27+: Use the training data to fine-tune/customize the OCR per user.
- Long-term: The app gets smarter the more you use it. "Snap a photo, app handles the rest" — and it gets better every time.

## Timer Background Bug (Asjad, Oct 13 2026) - CRITICAL
- BUG: The work timer PAUSES when the app is closed. Asjad cannot keep accurate work time.
- EXPECTED: Timer keeps running in background, even when app is closed.
- FIX: Save timer start TIMESTAMP (not just elapsed seconds) to persistent storage.
  - When running: store {status:'running', startTime: timestamp, accumulated: seconds}.
  - On app pause/close: save lastSaved timestamp.
  - On resume: if was running, accumulated += (now - lastSaved)/1000.
  - If was paused, do NOT add closed duration.
- This must work in the native Android WebView (handle onPause/onResume).
- For true background (even if Android kills the WebView), consider a native foreground service or WorkManager in future. For v26, the timestamp-calculation approach is sufficient.
