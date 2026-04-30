/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect } from "react";
import { 
  Search, 
  FileText, 
  Users, 
  Mail, 
  ChevronRight, 
  Cpu, 
  ExternalLink,
  Code2,
  Sparkles,
  Clipboard,
  CheckCircle2,
  Loader2,
  SendHorizontal,
  LogOut,
  History,
  X
} from "lucide-react";
import { motion, AnimatePresence } from "motion/react";
import { cn } from "./lib/utils";
import { supabase } from "./lib/supabase";
import type { Session } from "@supabase/supabase-js";

interface JDResult {
  id: number;
  title: string;
  skills: string[];
  preferred?: string[];
  experience: string;
  keywords?: string[];
  xrayQuery: string;
  jdText?: string;
  createdAt?: string;
}

interface Candidate {
  id: number;
  title: string;
  link: string;
  snippet: string;
  status?: string;
  score?: number;
  alignmentAnalysis?: string;
  isLinkInvalid?: boolean;
  searchPath?: string;
}

export default function App() {
  const [activeTab, setActiveTab] = useState<"jd" | "search" | "outreach" | "dashboard">("dashboard");
  const [jd, setJd] = useState("");
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [jdResult, setJdResult] = useState<JDResult | null>(null);
  const [candidates, setCandidates] = useState<Candidate[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [selectedCandidate, setSelectedCandidate] = useState<Candidate | null>(null);
  const [outreachMsg, setOutreachMsg] = useState<{ subject: string; body: string } | null>(null);
  const [isGeneratingOutreach, setIsGeneratingOutreach] = useState(false);
  const [pastJobs, setPastJobs] = useState<JDResult[]>([]);
  const [selectedDashboardJob, setSelectedDashboardJob] = useState<JDResult | null>(null);
  const [profilePreview, setProfilePreview] = useState<Candidate | null>(null);
  const [isSent, setIsSent] = useState(false);
  const [session, setSession] = useState<Session | null>(null);
  const [isAuthLoading, setIsAuthLoading] = useState(true);
  const [searchError, setSearchError] = useState<string | null>(null);

  // Phase 2: Load History from FastAPI
  const fetchHistory = async () => {
    try {
      const resp = await fetch("/api/jobs");
      const data = await resp.json();
      setPastJobs(data);
    } catch (err) {
      console.error("Failed to fetch history:", err);
    }
  };

  useEffect(() => {
    fetchHistory();
  }, []);

  // Load candidates when a job is selected
  useEffect(() => {
    if (selectedDashboardJob?.id) {
      const fetchCandidates = async () => {
        try {
          const resp = await fetch(`/api/jobs/${selectedDashboardJob.id}/candidates`);
          const data = await resp.json();
          setCandidates(data);
        } catch (err) {
          console.error("Failed to fetch candidates:", err);
        }
      };
      fetchCandidates();
    }
  }, [selectedDashboardJob]);

  const analyzeJD = async () => {
    if (!jd) return;
    setIsAnalyzing(true);
    try {
      const resp = await fetch("/api/parse-jd", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: jd })
      });
      const data = await resp.json();
      setJdResult(data);
      fetchHistory(); // Refresh list
      setActiveTab("jd");
    } catch (err) {
      console.error(err);
      alert("Error parsing JD. Please check your backend connection.");
    } finally {
      setIsAnalyzing(false);
    }
  };

  const handleLogin = async () => {
  await supabase.auth.signInWithOAuth({ 
    provider: "google",
    options: {
      redirectTo: "window.location.origin"
    }
  });
};

  const handleSignOut = async () => {
    try {
      await supabase.auth.signOut();
      setSession(null);
    } catch (err) {
      console.error("Sign out failed:", err);
    }
  };

  useEffect(() => {
    // Check session on load and stop loading
    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session);
      setIsAuthLoading(false);
    });

    // Listen for changes and stop loading
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      setSession(session);
      setIsAuthLoading(false);
    });

    return () => subscription.unsubscribe();
  }, []);

  const runSearch = async () => {
    if (!jdResult?.id) return;
    setIsSearching(true);
    setSearchError(null);
    setActiveTab("search");
    try {
      // Step 1: Search via Backend
      const searchResp = await fetch("/api/search", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ 
          job_id: jdResult.id,
          query: jdResult.xrayQuery 
        })
      });
      if (!searchResp.ok) {
        const errorText = await searchResp.text();
        throw new Error(`Search failed (${searchResp.status}): ${errorText}`);
      }
      const searchData = await searchResp.json();
      const rawCandidates = searchData.organic_results || [];

      if (rawCandidates.length === 0) {
        throw new Error("No candidates found for this search query.");
      }

      // Step 2: AI Analysis via Backend
      const analysisResp = await fetch("/api/analyze-candidates", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ 
          candidates: rawCandidates,
          jd: jdResult
        })
      });
      if (!analysisResp.ok) {
        const errorText = await analysisResp.text();
        throw new Error(`Analysis failed (${analysisResp.status}): ${errorText}`);
      }
      const analysisResults = await analysisResp.json();
      
      // Step 3: Save results to PostgreSQL
      const savedCandidates: Candidate[] = [];
      for (const analysis of analysisResults) {
        const raw = rawCandidates[analysis.index];
        if (!raw) continue;
        
        const saveResp = await fetch("/api/candidates", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            job_id: jdResult.id,
            title: raw.title,
            link: raw.link,
            snippet: raw.snippet,
            score: analysis.score,
            alignmentAnalysis: analysis.alignmentAnalysis,
            isLinkInvalid: false, // Initial state
            searchPath: `LinkedIn "${raw.title.split(" - ")[0]}"`
          })
        });
        if (!saveResp.ok) {
          const errorText = await saveResp.text();
          throw new Error(`Save failed (${saveResp.status}): ${errorText}`);
        }
        const saved = await saveResp.json();
        savedCandidates.push({
          ...saved,
          alignmentAnalysis: analysis.alignmentAnalysis,
          isLinkInvalid: saved.is_link_invalid || false,
          searchPath: saved.search_path || saved.searchPath
        });
      }
      
      setCandidates(savedCandidates.sort((a, b) => (b.score || 0) - (a.score || 0)));
    } catch (err) {
      console.error(err);
      if (err instanceof Error && err.message === "No candidates found for this search query.") {
        setSearchError("No candidates were found for this search query.");
      } else if (err instanceof Error && /(failed \(5\d{2}\)|Rate limit|Analysis failed|Search failed|Save failed)/i.test(err.message)) {
        setSearchError("Rate limit reached or analysis failed. Please wait a minute and try again.");
      } else {
        setSearchError("Search or analysis failed. Ensure SerpAPI and Gemini keys are configured on the backend.");
      }
    } finally {
      setIsSearching(false);
    }
  };

  const generateOutreach = async (candidate: Candidate) => {
    if (!jdResult) return;
    setSelectedCandidate(candidate);
    setIsGeneratingOutreach(true);
    setActiveTab("outreach");
    try {
      const resp = await fetch("/api/generate-outreach", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          candidate_snippet: candidate.snippet,
          job_title: jdResult.title,
          skills: jdResult.skills
        })
      });
      const data = await resp.json();
      setOutreachMsg(data);
    } catch (err) {
      console.error(err);
      alert("Failed to generate outreach message.");
    } finally {
      setIsGeneratingOutreach(false);
    }
  };

  const sendEngagement = async () => {
    if (!selectedCandidate || !outreachMsg) return;
    setIsSent(true);
    try {
      await navigator.clipboard.writeText(outreachMsg.body);
    } catch (err) {
      console.error("Failed to copy to clipboard:", err);
    }
    window.open(selectedCandidate.link, '_blank');
  };

  const exportToCSV = () => {
    if (!candidates.length) return;
    
    const headers = ["Candidate Name", "LinkedIn Link", "Source Snippet", "Status"];
    const rows = candidates.map(c => [
      `"${c.title.replace(/"/g, '""')}"`,
      `"${c.link}"`,
      `"${c.snippet.replace(/"/g, '""')}"`,
      `"${c.status || 'new'}"`
    ]);

    const csvContent = [headers.join(","), ...rows.map(r => r.join(","))].join("\n");
    const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.setAttribute("href", url);
    link.setAttribute("download", `talent_radar_${jdResult?.title || "export"}.csv`);
    link.style.visibility = "hidden";
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  if (isAuthLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50 px-6">
        <div className="rounded-3xl border border-slate-200 bg-white p-10 shadow-xl text-center">
          <div className="flex items-center justify-center mb-6">
            <Loader2 size={32} className="animate-spin text-indigo-600" />
          </div>
          <p className="text-slate-600 text-sm">Checking authentication status...</p>
        </div>
      </div>
    );
  }

  if (!session) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50 px-6">
        <div className="w-full max-w-md rounded-3xl border border-slate-200 bg-white p-10 shadow-xl">
          <div className="flex flex-col items-center gap-6 text-center">
            <div className="flex h-16 w-16 items-center justify-center rounded-full bg-slate-100 text-slate-600">
              <Users size={28} />
            </div>
            <div>
              <h1 className="text-3xl font-bold text-slate-900">Sign in to TalentFlow</h1>
              <p className="mt-3 text-sm text-slate-500">Use Google to access your talent sourcing dashboard.</p>
            </div>
            <button
              onClick={handleLogin}
              className="inline-flex items-center justify-center gap-2 rounded-2xl bg-slate-900 px-6 py-3 text-sm font-bold text-white shadow-xl shadow-slate-900/10 hover:bg-slate-800 transition-all"
            >
              <Search size={18} />
              Sign in with Google
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900 font-sans flex overflow-hidden">
      {/* Sidebar Navigation */}
      <aside className="w-68 bg-slate-900 flex flex-col border-r border-slate-800 text-slate-300">
        <div className="p-6">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 bg-indigo-600 rounded-lg flex items-center justify-center text-white font-bold shadow-lg shadow-indigo-600/20">
              <Cpu size={20} />
            </div>
            <span className="text-white font-bold text-xl tracking-tight">TalentFlow AI</span>
          </div>
        </div>

        <nav className="flex-1 px-4 py-4 space-y-1">
          <div className="text-slate-500 text-[10px] uppercase tracking-wider font-bold px-3 py-2">Platform Modules</div>
          <NavItem 
            active={activeTab === "dashboard"} 
            onClick={() => setActiveTab("dashboard")}
            icon={<History size={18} />}
            label="Dashboard"
          />
          <NavItem 
            active={activeTab === "jd"} 
            onClick={() => {
              setJdResult(null);
              setCandidates([]);
              setJd("");
              setActiveTab("jd");
            }}
            icon={<FileText size={18} />}
            label="New Scan"
          />
          <NavItem 
            active={activeTab === "search"} 
            onClick={() => setActiveTab("search")}
            icon={<Search size={18} />}
            label="Active Radar"
            disabled={!jdResult}
          />
          <NavItem 
            active={activeTab === "outreach"} 
            onClick={() => setActiveTab("outreach")}
            icon={<Mail size={18} />}
            label="Outreach"
            disabled={!selectedCandidate}
          />

          <div className="pt-6">
            <div className="text-slate-500 text-[10px] uppercase tracking-wider font-bold px-3 py-2">Quick Access</div>
            <div className="space-y-1 px-2">
              {pastJobs.slice(0, 8).map(job => (
                <button 
                  key={job.id} 
                  onClick={() => {
                    setJdResult(job);
                    setJd(job.jdText || "");
                    setSelectedDashboardJob(job);
                    setActiveTab("dashboard");
                  }}
                  className={cn(
                    "w-full text-left px-3 py-2 rounded-md transition-all text-[11px] group truncate",
                    selectedDashboardJob?.id === job.id ? "bg-slate-800 text-white font-semibold" : "text-slate-400 hover:bg-slate-800 hover:text-slate-200"
                  )}
                >
                  {job.title}
                </button>
              ))}
            </div>
          </div>
        </nav>

        <div className="p-6 mt-auto border-t border-slate-800">
          <div className="bg-slate-800/50 rounded-xl p-4 border border-slate-700/50 hover:bg-slate-800 transition-colors">
            <div className="flex items-center gap-3 mb-3">
              {session?.user?.user_metadata?.avatar_url ? (
                <img
                  src={session.user.user_metadata.avatar_url}
                  alt="User avatar"
                  className="w-8 h-8 rounded-full border border-slate-600 object-cover"
                />
              ) : (
                <div className="w-8 h-8 rounded-full bg-slate-700 overflow-hidden border border-slate-600 flex items-center justify-center text-xs font-bold text-white">
                  {session?.user?.email?.[0]?.toUpperCase() ?? "U"}
                </div>
              )}
              <div className="min-w-0">
                <p className="text-[12px] font-bold text-white truncate max-w-[120px]">
                  {session?.user?.user_metadata?.full_name || session?.user?.email?.split("@")[0] || "User"}
                </p>
                <p className="text-xs text-slate-400 truncate max-w-[120px]">{session?.user?.email}</p>
              </div>
            </div>
            <button
              onClick={handleSignOut}
              className="w-full rounded-xl bg-slate-700 px-3 py-2 text-[11px] font-bold uppercase tracking-[0.2em] text-slate-200 hover:bg-slate-600 transition-all"
            >
              <span className="inline-flex items-center justify-center gap-2">
                <LogOut size={14} /> Sign Out
              </span>
            </button>
          </div>
        </div>
      </aside>

      {/* Main Content Area */}
      <main className="flex-1 flex flex-col h-full overflow-hidden relative bg-slate-50/50">
        <header className="h-16 border-b border-slate-200 bg-white flex items-center justify-between px-10 shrink-0 shadow-sm z-10">
          <div className="flex items-center gap-4">
            <h1 className="text-lg font-bold text-slate-800 flex items-center gap-3">
              Talent Sourcing Dashboard
              <span className="font-medium text-slate-400 text-xs py-1 px-2 bg-slate-100 rounded border border-slate-200">
                ACTIVE SESSION: {activeTab.toUpperCase()}
              </span>
            </h1>
          </div>
          <div className="flex items-center gap-4">
            <div className="flex -space-x-2">
              {["JD", "XR", "SR", "EX", "OT"].map((step, i) => (
                <div 
                  key={step} 
                  className={cn(
                    "w-8 h-8 rounded-full border-2 border-white flex items-center justify-center text-[10px] font-black tracking-tighter shadow-sm",
                    i < 3 ? "bg-indigo-600 text-white" : "bg-slate-200 text-slate-400"
                  )}
                >
                  {step}
                </div>
              ))}
            </div>
            <button 
              onClick={exportToCSV}
              disabled={!candidates.length}
              className="px-4 py-2 bg-indigo-600 text-white rounded-md text-sm font-bold hover:bg-indigo-700 shadow-lg shadow-indigo-600/20 active:scale-95 transition-all disabled:opacity-30 disabled:grayscale disabled:cursor-not-allowed"
            >
              Export Analysis
            </button>
          </div>
        </header>

        <div className="flex-1 overflow-y-auto p-10">
          <div className="max-w-6xl mx-auto">
            <AnimatePresence mode="wait">
              {activeTab === "dashboard" && (
                <motion.div 
                  key="dashboard-tab"
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -10 }}
                  className="space-y-8"
                >
                  <div className="grid grid-cols-4 gap-6">
                    <DashboardStat label="Total Scans" value={pastJobs.length} icon={<FileText size={20} className="text-indigo-600" />} />
                    <DashboardStat label="Talent Pool" value={pastJobs.length * 15} icon={<Users size={20} className="text-emerald-600" />} />
                    <DashboardStat label="Avg. Match" value="88%" icon={<Sparkles size={20} className="text-amber-600" />} />
                    <DashboardStat label="Lead Response" value="12%" icon={<Mail size={20} className="text-rose-600" />} />
                  </div>

                  <div className="grid grid-cols-12 gap-8">
                    <div className={cn("col-span-12 transition-all duration-500", selectedDashboardJob ? "lg:col-span-4" : "lg:col-span-12")}>
                      <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
                        <div className="px-6 py-4 border-b border-slate-200 flex justify-between items-center bg-slate-50/50">
                          <h3 className="text-xs font-black uppercase text-slate-400 tracking-widest">Historical Scans</h3>
                          <button onClick={() => setActiveTab("jd")} className="text-indigo-600 text-[10px] font-bold uppercase tracking-widest hover:underline">+ New Search</button>
                        </div>
                        <div className="divide-y divide-slate-100 overflow-y-auto max-h-[600px]">
                          {pastJobs.map(job => (
                            <div 
                              key={job.id} 
                              onClick={() => {
                                setSelectedDashboardJob(job);
                                setJdResult(job);
                              }}
                              className={cn(
                                "px-6 py-4 cursor-pointer transition-all hover:bg-slate-50 relative",
                                selectedDashboardJob?.id === job.id ? "bg-indigo-50/50 border-l-4 border-indigo-600" : ""
                              )}
                            >
                              <div className="font-bold text-slate-900 group-hover:text-indigo-600 transition-colors text-sm">{job.title}</div>
                              <div className="flex items-center gap-3 mt-1.5">
                                <span className="text-[10px] text-slate-400 font-bold uppercase tracking-tighter">
                                  {job.skills.slice(0, 2).join(", ")} {job.skills.length > 2 && `+${job.skills.length - 2} more`}
                                </span>
                                <div className="w-1 h-1 rounded-full bg-slate-300" />
                                <span className="text-[9px] text-slate-400 uppercase font-black tracking-widest">15 Candidates</span>
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    </div>

                    {selectedDashboardJob && (
                      <motion.div 
                        initial={{ opacity: 0, x: 20 }}
                        animate={{ opacity: 1, x: 0 }}
                        className="col-span-12 lg:col-span-8 space-y-6"
                      >
                        <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
                          <div className="px-8 py-6 border-b border-slate-200 bg-slate-900 text-white flex justify-between items-center">
                            <div>
                              <h2 className="text-xl font-bold tracking-tight">{selectedDashboardJob.title}</h2>
                              <p className="text-[10px] font-black uppercase text-indigo-400 tracking-widest mt-1">Refining matching for {selectedDashboardJob.experience} level</p>
                            </div>
                            <div className="flex gap-3">
                              <button 
                                type="button"
                                onClick={runSearch}
                                className="px-4 py-2 bg-indigo-600 hover:bg-indigo-500 text-white rounded-lg text-[10px] font-black uppercase tracking-widest shadow-xl shadow-indigo-600/20 active:scale-95 transition-all"
                              >
                                Re-Scan Pool
                              </button>
                            </div>
                          </div>
                          
                          <div className="divide-y divide-slate-100 max-h-[600px] overflow-y-auto">
                            {candidates.length > 0 ? [...candidates].sort((a,b) => (b.score || 0) - (a.score || 0)).map((c, i) => (
                              <div key={i} className="px-8 py-6 hover:bg-slate-50 transition-all flex items-center justify-between group">
                                <div className="space-y-1 pr-8 flex-1">
                                  <div className="flex items-center gap-3">
                                    <div className={cn(
                                      "w-10 h-10 rounded-full flex items-center justify-center text-[10px] font-black border-2",
                                      (c.score || 0) >= 90 ? "bg-emerald-50 text-emerald-600 border-emerald-200" :
                                      (c.score || 0) >= 75 ? "bg-amber-50 text-amber-600 border-amber-200" :
                                      "bg-slate-50 text-slate-400 border-slate-200"
                                    )}>
                                      {c.score || 0}%
                                    </div>
                                    <div>
                                      <div className="flex items-center gap-2">
                                        <h4 className="font-bold text-slate-900 group-hover:text-indigo-600 transition-colors">{c.title}</h4>
                                        <span className={cn(
                                          "px-1.5 py-0.5 rounded text-[7px] font-black uppercase tracking-widest border",
                                          c.status === "new" ? "bg-emerald-50 text-emerald-600 border-emerald-100" : "bg-indigo-50 text-indigo-600 border-indigo-100"
                                        )}>
                                          {c.status || 'new'}
                                        </span>
                                      </div>
                                      <div className="flex items-center gap-2">
                                        <p className="text-[10px] text-slate-400 font-medium line-clamp-1">{c.alignmentAnalysis}</p>
                                        <a 
                                          href={c.link} 
                                          target="_blank" 
                                          rel="noopener noreferrer" 
                                          className="text-indigo-500 hover:text-indigo-700 transition-colors inline-block"
                                          title="View LinkedIn Profile"
                                        >
                                          <ExternalLink size={10} />
                                        </a>
                                      </div>
                                    </div>
                                  </div>
                                  <p className="text-xs text-slate-500 line-clamp-2 leading-relaxed italic mt-2">{c.snippet}</p>
                                </div>
                                <div className="flex gap-2">
                                  <button onClick={() => { setSelectedCandidate(c); setOutreachMsg(null); setActiveTab("outreach"); }} className="p-2.5 bg-slate-50 text-slate-400 hover:text-indigo-600 hover:bg-indigo-50 rounded-lg transition-all border border-slate-200">
                                    <Mail size={16} />
                                  </button>
                                  <a href={c.link} target="_blank" rel="noopener noreferrer" className="p-2.5 bg-slate-50 text-slate-400 hover:text-slate-900 rounded-lg transition-all border border-slate-200">
                                    <ExternalLink size={16} />
                                  </a>
                                </div>
                              </div>
                            )) : (
                              <div className="py-24 text-center space-y-4">
                                <div className="text-slate-200 flex justify-center"><Users size={48} /></div>
                                <p className="text-xs font-black uppercase text-slate-300 tracking-[0.2em] italic">Initializing candidate identification pipeline...</p>
                                <button type="button" onClick={runSearch} className="px-6 py-2 bg-indigo-600 text-white rounded-lg text-[10px] font-black uppercase tracking-widest shadow-lg">Run Initial Radar Scan</button>
                              </div>
                            )}
                          </div>
                        </div>
                      </motion.div>
                    )}
                  </div>
                </motion.div>
              )}

              {activeTab === "jd" && (
                <motion.div 
                  key="jd-tab"
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -10 }}
                  className="grid grid-cols-12 gap-8"
                >
                  <div className="col-span-12 lg:col-span-7 space-y-6">
                    <div className="bg-white rounded-2xl border border-slate-200 p-8 shadow-sm">
                      <div className="flex items-center justify-between mb-6">
                        <h2 className="text-xs font-black uppercase text-slate-400 tracking-[0.2em] flex items-center gap-2">
                          <FileText size={14} className="text-indigo-500" /> Source Job Description
                        </h2>
                        <span className="text-[10px] font-bold text-slate-400 bg-slate-50 px-2 py-1 rounded border border-slate-100 uppercase tracking-widest">Auto-Parsing Enabled</span>
                      </div>
                      <textarea 
                        value={jd}
                        onChange={(e) => setJd(e.target.value)}
                        placeholder="Paste your JD or technical requirements here..."
                        className="w-full h-[400px] bg-slate-50/50 border border-slate-200 rounded-xl p-6 text-slate-800 text-sm leading-relaxed focus:outline-none focus:ring-4 focus:ring-indigo-600/5 transition-all resize-none font-medium"
                      />
                      <div className="mt-8 flex justify-end">
                        <button 
                          onClick={analyzeJD}
                          disabled={isAnalyzing || !jd}
                          className="flex items-center gap-3 px-8 py-3.5 bg-slate-900 hover:bg-black text-white rounded-xl font-bold transition-all shadow-xl active:scale-95 disabled:opacity-30 disabled:grayscale"
                        >
                          {isAnalyzing ? (
                            <><Loader2 className="animate-spin" size={18} /> Processing Logic...</>
                          ) : (
                            <><Sparkles size={18} className="text-indigo-400" /> Parse & Generate Search</>
                          )}
                        </button>
                      </div>
                    </div>
                  </div>

                  <div className="col-span-12 lg:col-span-5 space-y-6">
                    {jdResult ? (
                      <motion.div 
                        initial={{ opacity: 0, x: 20 }}
                        animate={{ opacity: 1, x: 0 }}
                        className="space-y-6"
                      >
                        <div className="bg-white rounded-2xl border border-slate-200 p-8 shadow-sm space-y-6">
                          <div className="flex justify-between items-center pb-4 border-b border-slate-100">
                            <h3 className="text-xs font-black uppercase text-slate-400 tracking-widest">JD Intelligence Output</h3>
                            <span className="px-2 py-0.5 bg-green-100 text-green-700 text-[10px] font-black rounded border border-green-200 uppercase tracking-tighter">Success</span>
                          </div>
                          
                          <div className="space-y-6">
                            <div>
                              <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest mb-2">Target Title</label>
                              <div className="text-xl font-bold text-slate-900 tracking-tight">{jdResult.title}</div>
                              <div className="mt-2 text-xs font-semibold text-indigo-600 uppercase tracking-wider">{jdResult.experience}</div>
                            </div>
                            
                            <div>
                              <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest mb-3">Extracted Skills</label>
                              <div className="flex flex-wrap gap-1.5">
                                {jdResult.skills.map(s => (
                                  <span key={s} className="px-3 py-1 bg-slate-50 border border-slate-200 text-slate-700 rounded-lg text-xs font-bold shadow-sm whitespace-nowrap">
                                    {s}
                                  </span>
                                ))}
                              </div>
                            </div>
                          </div>
                        </div>

                        <div className="bg-slate-900 rounded-2xl border border-slate-800 p-8 shadow-xl space-y-6">
                          <div className="flex justify-between items-center">
                            <h2 className="text-xs font-black uppercase tracking-wider text-slate-500">X-Ray Algorithm Generator</h2>
                            <button className="text-indigo-400 text-[10px] font-bold uppercase tracking-widest hover:text-indigo-300 transition-colors">Optimize</button>
                          </div>
                          <div className="bg-slate-950 rounded-xl p-4 font-mono text-xs leading-relaxed text-indigo-300 border border-slate-800 shadow-inner italic">
                            {jdResult.xrayQuery}
                          </div>
                          <button 
                            type="button"
                            onClick={runSearch}
                            disabled={isSearching}
                            className={cn(
                              "w-full flex items-center justify-center gap-3 px-6 py-4 rounded-xl font-bold transition-all shadow-xl shadow-indigo-600/20 active:scale-[0.98]",
                              isSearching ? "bg-slate-500 text-white disabled:opacity-70 disabled:cursor-not-allowed" : "bg-indigo-600 hover:bg-indigo-500 text-white"
                            )}
                          >
                            {isSearching ? (
                              <>
                                <Loader2 className="animate-spin" size={18} /> Initializing Radar Scan...
                              </>
                            ) : (
                              <>
                                <Search size={18} /> Execute Search Sequence
                              </>
                            )}
                          </button>
                        </div>
                      </motion.div>
                    ) : (
                      <div className="h-[500px] border-2 border-dashed border-slate-200 rounded-2xl flex flex-col items-center justify-center text-slate-300 bg-white/50 space-y-4">
                        <div className="p-6 bg-slate-50 rounded-full border border-slate-100 shadow-inner">
                          <Cpu size={48} className="opacity-40" />
                        </div>
                        <p className="text-xs font-black uppercase tracking-widest italic opacity-60">Waiting for intelligence report</p>
                      </div>
                    )}
                  </div>
                </motion.div>
              )}

              {(activeTab === "search" || activeTab === "history") && (
                <motion.div 
                  key="search-tab"
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -10 }}
                  className="space-y-8"
                >
                  <header className="flex items-center justify-between">
                    <div>
                      <h1 className="text-3xl font-bold text-slate-900 tracking-tight mb-1">Radar Results</h1>
                      <div className="flex items-center gap-2 text-[10px] font-bold uppercase text-slate-400 tracking-widest">
                        <div className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
                        Showing AI-matched talent for <span className="text-indigo-600">{jdResult?.title}</span>
                      </div>
                    </div>
                    <div className="flex gap-4">
                       <div className="relative group">
                         <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                            <Search size={14} className="text-slate-400" />
                         </div>
                         <input type="text" placeholder="Filter talent pool..." className="bg-white border border-slate-200 rounded-lg pl-9 pr-4 py-2 text-xs text-slate-700 focus:outline-none focus:ring-4 focus:ring-indigo-600/5 shadow-sm transition-all w-64" />
                       </div>
                       <button type="button" onClick={runSearch} disabled={isSearching || !jdResult} className="px-6 py-2 bg-white border border-slate-200 text-slate-700 rounded-lg hover:bg-slate-50 transition-all font-bold text-xs uppercase tracking-widest shadow-sm flex items-center gap-2">
                        {isSearching && <Loader2 size={14} className="animate-spin text-indigo-500" />} Refresh Feed
                       </button>
                    </div>
                  </header>

                  {searchError && (
                    <div className="bg-rose-50 border border-rose-200 rounded-lg p-4 text-rose-800 text-sm">
                      {searchError}
                    </div>
                  )}

                  <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
                    <table className="w-full border-collapse">
                      <thead className="bg-slate-50/80 border-b border-slate-200">
                        <tr className="text-left text-[10px] text-slate-500 uppercase font-black tracking-[0.2em]">
                          <th className="px-8 py-5">Identified Talent</th>
                          <th className="px-8 py-5">Match Score</th>
                          <th className="px-8 py-5">Alignment Insight</th>
                          <th className="px-8 py-5 text-right">Engagement</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100">
                        {isSearching ? (
                          Array(6).fill(0).map((_, i) => (
                            <tr key={i} className="animate-pulse">
                              <td className="px-8 py-6 space-y-2"><div className="h-4 bg-slate-100 rounded w-1/2" /><div className="h-2 bg-slate-50 rounded w-1/4" /></td>
                              <td className="px-8 py-6"><div className="h-6 bg-slate-100 rounded w-16" /></td>
                              <td className="px-8 py-6 space-y-2"><div className="h-3 bg-slate-100 rounded w-3/4" /><div className="h-3 bg-slate-100 rounded w-2/3" /></td>
                              <td className="px-8 py-6 text-right"><div className="h-8 bg-slate-100 rounded w-24 ml-auto" /></td>
                            </tr>
                          ))
                        ) : candidates?.length === 0 ? (
                          <tr>
                            <td colSpan={4} className="px-8 py-16">
                              <div className="mx-auto max-w-xl rounded-3xl border border-slate-200 bg-slate-50 p-10 text-center flex flex-col items-center gap-4">
                                <div className="flex h-16 w-16 items-center justify-center rounded-full bg-slate-100 text-slate-500">
                                  <Search size={24} />
                                </div>
                                <div>
                                  <p className="text-lg font-bold text-slate-900">No candidates found.</p>
                                  <p className="mt-2 text-sm text-slate-500">Try broadening your search criteria.</p>
                                </div>
                              </div>
                            </td>
                          </tr>
                        ) : candidates?.length ? (
                          candidates
                            ?.slice()
                            .sort((a,b) => (b.score || 0) - (a.score || 0)).map((c, i) => (
                            <tr key={i} className="group hover:bg-slate-50/50 transition-colors">
                              <td className="px-8 py-6">
                                <button 
                                  onClick={() => setProfilePreview(c)}
                                  className="font-bold text-slate-900 hover:text-indigo-600 transition-colors cursor-pointer text-left block"
                                >
                                  {c?.title?.split(" - ")[0] ?? "Candidate"}
                                </button>
                                <div className="flex items-center gap-2 mt-0.5">
                                  <a 
                                    href={c?.link ?? "#"} 
                                    target="_blank" 
                                    rel="noopener noreferrer" 
                                    className={`text-[10px] truncate max-w-[180px] transition-colors block font-medium underline-offset-2 hover:underline ${c?.isLinkInvalid ? 'text-rose-500 italic' : 'text-slate-400 hover:text-indigo-600'}`}
                                  >
                                    {c?.link ?? "Unavailable"}
                                  </a>
                                  {c?.isLinkInvalid && (
                                    <span className="text-[8px] px-1.5 py-0.5 bg-rose-100 text-rose-600 rounded-full font-black uppercase tracking-tighter">Broken</span>
                                  )}
                                </div>
                                <div className="flex items-center gap-2 mt-2">
                                  <a 
                                    href={c?.link ?? "#"} 
                                    target="_blank" 
                                    rel="noopener noreferrer" 
                                    className="px-3 py-1 bg-white border border-slate-200 text-slate-600 rounded-md text-[9px] font-black uppercase tracking-widest hover:bg-slate-50 transition-all flex items-center gap-1.5"
                                  >
                                    <ExternalLink size={10} /> Profile
                                  </a>
                                  <a 
                                    href={`https://www.linkedin.com/search/results/people/?keywords=${encodeURIComponent(c?.title?.split(" - ")[0] ?? "")}`}
                                    target="_blank" 
                                    rel="noopener noreferrer" 
                                    className="px-3 py-1 bg-indigo-50 text-indigo-600 rounded-md text-[9px] font-black uppercase tracking-widest hover:bg-indigo-100 transition-all flex items-center gap-1.5"
                                  >
                                    <Search size={10} /> Search Name
                                  </a>
                                </div>
                                {c?.isLinkInvalid && (
                                  <button 
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      navigator.clipboard.writeText(c?.searchPath || "");
                                    }}
                                    className="mt-1 text-[9px] font-black uppercase text-indigo-600 hover:text-indigo-800 flex items-center gap-1 cursor-pointer"
                                  >
                                    Copy Search Path <Search size={8} />
                                  </button>
                                )}
                              </td>
                              <td className="px-8 py-6">
                                <div className="flex items-center gap-3">
                                  <div className={cn(
                                    "px-2 py-1 rounded text-[10px] font-black border min-w-[45px] text-center",
                                    (c?.score || 0) >= 90 ? "bg-emerald-50 text-emerald-600 border-emerald-100" :
                                    (c?.score || 0) >= 75 ? "bg-amber-50 text-amber-600 border-amber-100" :
                                    "bg-slate-50 text-slate-500 border-slate-100"
                                  )}>
                                    {c?.score || 0}%
                                  </div>
                                  <div className="w-16 h-1.5 bg-slate-100 rounded-full overflow-hidden border border-slate-200">
                                    <div 
                                      className={cn(
                                        "h-full transition-all duration-1000",
                                        (c?.score || 0) >= 90 ? "bg-emerald-500" : (c?.score || 0) >= 75 ? "bg-amber-500" : "bg-indigo-500"
                                      )}
                                      style={{ width: `${c?.score || 0}%` }}
                                    />
                                  </div>
                                </div>
                              </td>
                              <td className="px-8 py-6">
                                <div className="max-w-xl">
                                  <p className="text-[11px] text-slate-700 font-semibold leading-relaxed mb-1 italic">"{c?.alignmentAnalysis ?? "No alignment details available."}"</p>
                                  <p className="text-[10px] text-slate-400 line-clamp-1">{c?.snippet ?? "No summary available."}</p>
                                </div>
                              </td>
                              <td className="px-8 py-6 text-right">
                                <button 
                                  onClick={() => generateOutreach(c)}
                                  className="px-4 py-2 bg-slate-900 text-white rounded-lg text-[10px] font-black uppercase tracking-widest shadow-lg hover:bg-indigo-600 transition-all hover:scale-105 active:scale-95 group-hover:shadow-indigo-600/20"
                                >
                                  Draft Outreach
                                </button>
                              </td>
                            </tr>
                          ))
                        ) : (
                          <tr>
                            <td colSpan={4} className="px-8 py-32 text-center text-slate-300 italic font-medium uppercase tracking-[0.2em]">
                               Initialize radar to identify matching talent
                            </td>
                          </tr>
                        )}
                      </tbody>
                    </table>
                  </div>
                </motion.div>
              )}

              {activeTab === "outreach" && (
                <motion.div 
                  key="outreach-tab"
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  className="space-y-8"
                >
                  <header>
                    <h1 className="text-3xl font-bold text-slate-900 tracking-tight mb-2">Message Automation Hub</h1>
                    <div className="text-[10px] font-black uppercase text-slate-400 tracking-[0.3em] flex items-center gap-2 italic">
                       Synthesis of Engagement for <span className="text-indigo-600 font-bold not-italic">{selectedCandidate?.title.split(" - ")[0]}</span>
                    </div>
                  </header>

                  <div className="bg-white rounded-[2.5rem] border border-slate-200 overflow-hidden shadow-2xl">
                    <div className="p-12 border-b border-slate-100 bg-slate-50/50 flex justify-between items-center">
                      <div className="flex items-center gap-8">
                        <div className="w-20 h-20 bg-indigo-600 rounded-[2rem] flex items-center justify-center text-3xl font-black text-white shadow-2xl shadow-indigo-600/30">
                          {selectedCandidate?.title[0]}
                        </div>
                        <div className="space-y-1">
                          <div className="text-2xl font-black text-slate-900 tracking-tight">{selectedCandidate?.title.split(" - ")[0]}</div>
                          <a 
                            href={selectedCandidate?.link} 
                            target="_blank" 
                            rel="noopener noreferrer" 
                            className="text-[10px] text-indigo-600 font-bold truncate max-w-sm mt-0.5 hover:text-indigo-800 transition-colors flex items-center gap-1 hover:underline"
                          >
                            {selectedCandidate?.link}
                            <ExternalLink size={10} />
                          </a>
                        </div>
                      </div>
                      <div className="flex gap-4">
                         <button 
                           onClick={() => setSelectedCandidate(null)}
                           className="px-8 py-3.5 border border-slate-200 bg-white text-slate-500 rounded-xl hover:bg-slate-50 transition-all text-[11px] font-black uppercase tracking-widest shadow-sm"
                         >
                           Dismiss
                         </button>
                         <button 
                           onClick={sendEngagement}
                           className={cn(
                             "px-10 py-3.5 text-white rounded-xl transition-all shadow-xl text-[11px] font-black uppercase tracking-[0.2em] flex items-center gap-3 active:scale-95 group",
                             isSent 
                               ? "bg-green-500 hover:bg-green-600 shadow-green-600/20" 
                               : "bg-indigo-600 hover:bg-indigo-700 shadow-indigo-600/20"
                           )}
                         >
                           <SendHorizontal size={18} className="group-hover:translate-x-1 transition-transform" /> Send Engagement
                         </button>
                      </div>
                    </div>

                    <div className="p-16">
                      {isGeneratingOutreach ? (
                        <div className="space-y-10 py-24 flex flex-col items-center justify-center bg-slate-50/50 rounded-[3rem] border-2 border-dashed border-slate-200">
                          <div className="relative">
                            <div className="absolute inset-0 bg-indigo-500/20 blur-2xl rounded-full" />
                            <Loader2 size={64} className="text-indigo-600 animate-spin relative" />
                          </div>
                          <div className="text-center">
                            <p className="text-2xl font-black text-slate-800 mb-2">Engaging Talent Intelligence</p>
                            <p className="text-xs text-slate-400 uppercase tracking-[0.4em] font-bold animate-pulse">Running semantic profile matching...</p>
                          </div>
                        </div>
                      ) : outreachMsg ? (
                        <div className="max-w-4xl mx-auto space-y-10 animate-in fade-in slide-in-from-bottom-5 duration-700">
                          <div className="space-y-4">
                            <label className="text-[10px] font-black uppercase text-slate-400 tracking-[0.5em] px-2">Outreach Subject Line</label>
                            <div className="p-6 bg-slate-900 border border-slate-800 rounded-2xl text-indigo-400 font-bold text-lg tracking-tight shadow-xl">
                              {outreachMsg.subject}
                            </div>
                          </div>
                          <div className="space-y-4">
                            <label className="text-[10px] font-black uppercase text-slate-400 tracking-[0.5em] px-2">Personalized Message Blueprint</label>
                            <div className="p-12 bg-white border border-slate-200 rounded-[3rem] shadow-sm text-slate-700 leading-relaxed font-medium text-lg whitespace-pre-wrap selection:bg-indigo-100 italic">
                              {outreachMsg.body}
                            </div>
                          </div>
                          <div className="flex gap-3 justify-center items-center pt-8">
                             <span className="px-3 py-1 bg-slate-100 text-slate-400 text-[10px] font-bold rounded uppercase tracking-widest border border-slate-200">Technical Focus</span>
                             <span className="px-3 py-1 bg-slate-100 text-slate-400 text-[10px] font-bold rounded uppercase tracking-widest border border-slate-200">Personalized Match</span>
                             <span className="px-3 py-1 bg-slate-100 text-slate-400 text-[10px] font-bold rounded uppercase tracking-widest border border-slate-200">LinkedIn Priority</span>
                          </div>
                        </div>
                      ) : (
                        <div className="text-center py-32 text-slate-200 italic font-black uppercase tracking-[0.5em]">
                          Selection Required from radar
                        </div>
                      )}
                    </div>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>

            <AnimatePresence>
              {profilePreview && (
                <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/60 backdrop-blur-sm">
                  <motion.div 
                    initial={{ opacity: 0, scale: 0.95, y: 20 }}
                    animate={{ opacity: 1, scale: 1, y: 0 }}
                    exit={{ opacity: 0, scale: 0.95, y: 20 }}
                    className="bg-white rounded-[2rem] shadow-2xl w-full max-w-lg overflow-hidden border border-slate-200"
                  >
                    <div className="p-8 pb-4 flex justify-between items-start">
                      <div className="flex items-center gap-4">
                        <div className="w-16 h-16 bg-indigo-600 rounded-2xl flex items-center justify-center text-2xl font-black text-white shadow-xl shadow-indigo-600/20">
                          {profilePreview.linkedinMetadata?.image ? (
                            <img 
                              src={profilePreview.linkedinMetadata.image} 
                              alt={profilePreview.title} 
                              className="w-full h-full object-cover rounded-2xl"
                              referrerPolicy="no-referrer"
                              onError={(e) => {
                                (e.target as any).style.display = 'none';
                              }}
                            />
                          ) : profilePreview.title[0]}
                        </div>
                        <div>
                          <h3 className="text-xl font-black text-slate-900 tracking-tight">{profilePreview.title.split(" - ")[0]}</h3>
                          <p className="text-[10px] font-black uppercase text-slate-400 tracking-widest">{profilePreview.title.split(" - ").slice(1).join(" - ")}</p>
                        </div>
                      </div>
                      <button 
                        onClick={() => setProfilePreview(null)}
                        className="p-2 hover:bg-slate-100 rounded-lg transition-colors text-slate-400"
                      >
                        <X size={20} />
                      </button>
                    </div>

                    <div className="px-8 py-6 space-y-6">
                      {profilePreview.linkedinMetadata?.description && (
                        <div className="space-y-2">
                          <h4 className="text-[10px] font-black uppercase text-indigo-600 tracking-[0.2em]">Profile Synopsis</h4>
                          <p className="text-sm text-slate-600 leading-relaxed font-medium italic">
                            "{profilePreview.linkedinMetadata.description}"
                          </p>
                        </div>
                      )}

                      <div className="space-y-2">
                        <h4 className="text-[10px] font-black uppercase text-indigo-600 tracking-[0.2em]">Sourcing Snippet</h4>
                        <p className="text-sm text-slate-500 leading-relaxed">
                          {profilePreview.snippet}
                        </p>
                      </div>

                      <div className="bg-slate-50 rounded-2xl p-6 border border-slate-100 space-y-3">
                        <div className="flex items-center justify-between">
                          <h4 className="text-[10px] font-black uppercase text-slate-500 tracking-[0.2em]">Alignment Score</h4>
                          <span className="text-lg font-black text-indigo-600">{profilePreview.score}%</span>
                        </div>
                        <p className="text-xs text-slate-600 leading-relaxed font-medium">
                          {profilePreview.alignmentAnalysis}
                        </p>
                      </div>

                      {profilePreview.isLinkInvalid && (
                         <div className="bg-rose-50 rounded-2xl p-6 border border-rose-100 space-y-2">
                           <h4 className="text-[10px] font-black uppercase text-rose-600 tracking-[0.2em]">Broken Profile Detection</h4>
                           <p className="text-xs text-rose-600 font-medium">
                             The original LinkedIn URL returned an error (Page Not Found). Use the search phrase below to find this candidate manually.
                           </p>
                           <div className="flex items-center gap-2 mt-2">
                             <input 
                               readOnly 
                               value={profilePreview.searchPath} 
                               className="flex-1 bg-white border border-rose-200 rounded-lg px-3 py-2 text-[10px] font-mono text-rose-700" 
                             />
                             <button 
                               onClick={() => navigator.clipboard.writeText(profilePreview.searchPath || "")}
                               className="p-2 bg-rose-600 text-white rounded-lg hover:bg-rose-700 transition-colors"
                             >
                               <History size={14} />
                             </button>
                           </div>
                         </div>
                      )}
                    </div>

                    <div className="p-8 bg-slate-50/80 border-t border-slate-100 flex flex-col gap-4">
                      <div className="flex gap-4">
                        <a 
                          href={profilePreview.link}
                          target="_blank"
                          rel="noopener noreferrer"
                          className={cn(
                            "flex-1 px-6 py-3 rounded-xl text-xs font-black uppercase tracking-widest text-center shadow-xl transition-all flex items-center justify-center gap-2",
                            profilePreview.isLinkInvalid 
                              ? "bg-slate-200 text-slate-400 cursor-not-allowed" 
                              : "bg-indigo-600 text-white shadow-indigo-600/20 hover:bg-indigo-500"
                          )}
                          onClick={(e) => profilePreview.isLinkInvalid && e.preventDefault()}
                        >
                          Visit Profile <ExternalLink size={14} />
                        </a>
                        <a 
                          href={`https://www.linkedin.com/search/results/people/?keywords=${encodeURIComponent(profilePreview.title.split(" - ")[0])}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="flex-1 px-6 py-3 bg-white border border-slate-200 text-slate-900 rounded-xl text-xs font-black uppercase tracking-widest text-center hover:bg-slate-50 transition-all flex items-center justify-center gap-2"
                        >
                          Search Name <Search size={14} />
                        </a>
                      </div>
                      <button 
                         onClick={() => {
                           generateOutreach(profilePreview);
                           setProfilePreview(null);
                         }}
                         className="w-full px-6 py-4 bg-slate-900 text-white rounded-xl text-xs font-black uppercase tracking-widest hover:bg-slate-800 transition-all"
                      >
                        Draft Outreach
                      </button>
                    </div>
                  </motion.div>
                </div>
              )}
            </AnimatePresence>
          </div>
        </div>
      </main>
    </div>
  );
}

function DashboardStat({ label, value, icon }: { label: string; value: string | number; icon: React.ReactNode }) {
  return (
    <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm flex items-center gap-4">
      <div className="p-3 bg-slate-50 rounded-xl border border-slate-100">
        {icon}
      </div>
      <div>
        <div className="text-[10px] font-black uppercase text-slate-400 tracking-widest">{label}</div>
        <div className="text-xl font-bold text-slate-900">{value}</div>
      </div>
    </div>
  );
}

function NavItem({ 
  active, 
  onClick, 
  icon, 
  label, 
  disabled = false 
}: { 
  active: boolean; 
  onClick: () => void; 
  icon: React.ReactNode; 
  label: string;
  disabled?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={cn(
        "w-full flex items-center gap-3.5 px-4 py-3 rounded-md transition-all duration-300 relative group truncate",
        active ? "bg-indigo-600/10 text-indigo-400 border border-indigo-500/20 shadow-[0_0_15px_rgba(99,102,241,0.1)]" : "text-slate-400 hover:bg-slate-800 hover:text-slate-200",
        disabled && "opacity-20 cursor-not-allowed grayscale"
      )}
    >
      <span className={cn("transition-colors duration-300", active ? "text-indigo-400" : "text-slate-500 group-hover:text-slate-300")}>{icon}</span>
      <span className="font-semibold text-xs tracking-tight uppercase tracking-wider">{label}</span>
      {active && (
        <div className="ml-auto w-1.5 h-1.5 rounded-full bg-indigo-500 shadow-[0_0_8px_rgba(99,102,241,0.8)]" />
      )}
    </button>
  );
}


