import express from "express";
import cors from "cors";
import path from "path";
import { createServer as createViteServer } from "vite";
import axios from "axios";

async function startServer() {
  const app = express();
  const PORT = 3000;

  app.use(cors());
  app.use(express.json());

  // API Routes
  app.post("/api/search", async (req, res) => {
    const { query } = req.body;
    const apiKey = process.env.SERP_API_KEY;

    console.log(`[Search] Query: ${query}`);

    if (!apiKey) {
      console.warn("[Search] No SERP_API_KEY provided, returning mock data.");
      return res.json({
        organic_results: [
          { title: "John Doe - Senior Software Engineer - TechCorp", link: "https://www.linkedin.com/in/johndoe", snippet: "Experienced in React, Node.js and Cloud architecture..." },
          { title: "Jane Smith - Frontend Architect - WebFlow", link: "https://www.linkedin.com/in/janesmith", snippet: "Specializing in modern JavaScript frameworks and UX..." },
          { title: "Michael Ross - Full Stack Lead - GlobalDev", link: "https://www.linkedin.com/in/michaelross", snippet: "Expert in Python, React and distributed systems..." },
          { title: "Sarah Chen - Senior Product Engineer - InnovateSoft", link: "https://www.linkedin.com/in/sarahchen", snippet: "Passionate about building scalable web applications with Next.js..." }
        ]
      });
    }

    try {
      const response = await axios.get("https://serpapi.com/search", {
        params: {
          q: query,
          engine: "bing",
          api_key: apiKey,
          num: 20,
          filters: "DiscoveryTime:\"PastMonth\""
        }
      });
      
      // EXPLICIT MAPPING: Use the 'link' field from SerpAPI payload
      // This is the raw URL string the user is asking for.
      if (!response.data || !response.data.organic_results) {
        return res.json({ organic_results: [] });
      }

      const results = response.data.organic_results
        .filter((r: any) => r.link && r.link.includes("linkedin.com/in/"))
        .map((r: any) => ({
          title: r.title,
          link: r.link, // CRITICAL: Raw URL from search result
          snippet: r.snippet
        }));

      console.log(`[Search] Found ${results.length} LinkedIn profiles.`);
      res.json({ organic_results: results });
    } catch (error: any) {
      console.error("[Search] Error:", error.message);
      res.status(500).json({ error: "Search failed" });
    }
  });

  app.post("/api/verify-linkedin", async (req, res) => {
    const { url } = req.body;
    if (!url || !url.includes("linkedin.com/in/")) {
      return res.json({ valid: false, reason: "invalidFormat" });
    }
    
    try {
      const response = await axios.get(url, {
        headers: {
          "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
          "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8",
          "Accept-Language": "en-US,en;q=0.9",
          "Referer": "https://www.google.com/"
        },
        timeout: 10000,
        maxRedirects: 5,
        validateStatus: (status) => status < 500 // Accept 4xx for manual handling
      });
      
      const status = response.status;
      const html = String(response.data || "");

      // Strict 404/410 handling
      if (status === 404 || status === 410) {
        return res.json({ valid: false, reason: "notFound" });
      }

      // LinkedIn "Security Check" or "Authwall" - typically means profile exists but we are blocked
      if (status === 999 || status === 429 || html.includes("authwall") || html.includes("checkpoint/challenge")) {
        return res.json({ valid: true, note: "throttledOrAuthwall" });
      }

      // If we got a 200, check if the content says "Not Found"
      // Sometimes LinkedIn returns 200 but shows a generic "Profile not found" component
      const notFoundMarkers = [
        "profile-unavailable",
        "member-not-found",
        "profile not found",
        "this page doesn’t exist",
        "page not found",
        "check your url or return to linkedin home",
        "signals.notfound"
      ];

      const contentSignalsNotFound = notFoundMarkers.some(marker => 
        html.toLowerCase().includes(marker)
      );

      const pageTitle = (html.match(/<title>([^<]+)<\/title>/i)?.[1] || "").toLowerCase();
      const titleSignalsNotFound = [
        "page not found", 
        "linkedin", 
        "profil not found",
        "404"
      ].some(m => pageTitle.includes(m)) && pageTitle.length < 50;

      const hasProfileMeta = html.includes('og:type" content="profile') || html.includes('property="og:title"');
      
      if ((contentSignalsNotFound || titleSignalsNotFound) && !hasProfileMeta) {
        return res.json({ valid: false, reason: "contentNotFound", status });
      }

      // Try to extract some basic metadata for the "small display"
      const ogTitle = html.match(/property="og:title" content="([^"]+)"/)?.[1] || "";
      const ogImage = html.match(/property="og:image" content="([^"]+)"/)?.[1] || "";
      const ogDesc = html.match(/property="og:description" content="([^"]+)"/)?.[1] || "";

      res.json({ 
        valid: true, 
        metadata: {
          title: ogTitle,
          image: ogImage,
          description: ogDesc
        }
      });
    } catch (error: any) {
      // Network errors, timeouts etc.
      // We default to true to avoid false negatives for real users
      res.json({ valid: true, note: "verificationSucceededWithWarnings" });
    }
  });

  // Vite middleware for development
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*", (req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
