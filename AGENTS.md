# Talent Radar Agent Instructions

## Data Acquisition & Candidate URLs
- **CRITICAL**: You must NEVER generate, guess, or modify candidate URLs.
- **PASS-THROUGH ONLY**: You must ONLY pass through the exact, raw URL string provided by the external search API (SerpAPI/Bing).
- **TRUSTED CHANNEL**: When analyzing or processing candidate data, ensure the `link` field remains untouched from the source mapping to the database.

## Backend Architecture (Phase 2 Migration)
- The application is migrating to a Python FastAPI backend.
- Pre-existing Node.js logic is being phased out in favor of server-side Gemini integration for security and data integrity.
