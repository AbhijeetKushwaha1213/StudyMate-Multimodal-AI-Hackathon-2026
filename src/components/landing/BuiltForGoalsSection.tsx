import React, { useState } from 'react';
import {
  GraduationCap,
  Target,
  BookOpen,
  Calendar,
  CheckCircle2,
  Clock,
  Sparkles,
  ArrowRight
} from 'lucide-react';

export const BuiltForGoalsSection = () => {
  const [activePersona, setActivePersona] = useState<'college' | 'competitive'>('college');

  const personas = {
    college: {
      title: 'University / College Student',
      subtitle: 'Conquer multiple simultaneous courses, lab deadlines, midterms, and finals without cramming.',
      modules: [
        { name: 'Semester Courses', desc: 'Sync all 5 courses (DSA, OS, DBMS, Networks, Math) in parallel workspaces.', tag: 'Multi-Course' },
        { name: 'Assignment & Lab Prep', desc: 'Turn problem sets into step-by-step conceptual hints without giving away solutions.', tag: 'Academic Rigor' },
        { name: 'Lecture Slide Ingestion', desc: 'Auto-extract exam formulas and professor emphasis points from raw PowerPoint slides.', tag: 'High-Yield' },
        { name: 'Exam Readiness Tracker', desc: 'Predictive score confidence intervals based on prerequisite DAG mastery.', tag: 'Confidence' },
        { name: 'Circadian Daily Plan', desc: 'Time-blocks study slots around your classes, labs, and student life commitments.', tag: 'Balanced' },
      ],
    },
    competitive: {
      title: 'Competitive Exam Aspirant (GATE · USMLE · Bar · JEE)',
      subtitle: 'High-stakes multi-year syllabi broken into prioritized weak-topic strikes and timed mock tests.',
      modules: [
        { name: 'Complete Syllabus Indexing', desc: 'Exhaustive syllabus mapping against historical 10-year question papers (PYQs).', tag: 'Exhaustive' },
        { name: 'Precision Weak Topic Targeting', desc: 'Algorithmic identification of high-weightage topics with low personal retention.', tag: 'Targeted' },
        { name: 'Strict Spaced Revision (SM-2)', desc: 'Automated 48h, 7d, and 30d recall cycles ensuring zero memory decay on test day.', tag: 'Retention' },
        { name: 'Adaptive Question Drill', desc: '10,000+ calibrated MCQs scaling difficulty based on real-time accuracy.', tag: 'Adaptive' },
        { name: 'Full-Length Timed Mock Tests', desc: 'Real exam simulator with percentile ranking and cognitive pacing breakdown.', tag: 'Simulated' },
      ],
    },
  };

  const current = personas[activePersona];

  return (
    <section
      id="personas"
      className="py-20 lg:py-28 px-4 sm:px-6 lg:px-8 bg-[#f6fbf3] dark:bg-background border-b border-[#dfe4dd]/60 dark:border-border/60 scroll-mt-20 relative overflow-hidden"
    >
      <div className="max-w-7xl mx-auto">
        
        {/* Section Header */}
        <div className="text-center max-w-2xl mx-auto mb-12">
          <div className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-full bg-[#e8f3ed] dark:bg-emerald-950/40 border border-[#165034]/20 dark:border-emerald-800/30 text-[#165034] dark:text-emerald-300 text-xs font-bold uppercase tracking-wider mb-4">
            <GraduationCap className="w-3.5 h-3.5" />
            <span>Tailored Learning Modes</span>
          </div>

          <h2 className="font-serif text-3xl sm:text-4xl lg:text-5xl font-normal text-[#002313] dark:text-foreground tracking-tight mb-3">
            Built around <span className="italic font-serif text-[#165034] dark:text-emerald-400">your learning.</span>
          </h2>

          <p className="text-sm sm:text-base text-[#2d4a3e] dark:text-muted-foreground">
            The platform adapts its knowledge graph and daily pacing whether you're taking semester exams or competitive trials.
          </p>
        </div>

        {/* Persona Switcher Toggle */}
        <div className="flex justify-center mb-10">
          <div className="p-1.5 rounded-2xl bg-white dark:bg-card border border-[#dfe4dd] dark:border-border shadow-xs flex items-center gap-2">
            <button
              onClick={() => setActivePersona('college')}
              className={`flex items-center gap-2 px-5 py-2.5 rounded-xl text-xs sm:text-sm font-semibold transition-all ${
                activePersona === 'college'
                  ? 'bg-[#002313] dark:bg-emerald-600 text-white shadow-xs'
                  : 'text-[#52796f] dark:text-muted-foreground hover:text-[#002313] dark:hover:text-foreground'
              }`}
            >
              <GraduationCap className="w-4 h-4" />
              <span>College Student</span>
            </button>

            <button
              onClick={() => setActivePersona('competitive')}
              className={`flex items-center gap-2 px-5 py-2.5 rounded-xl text-xs sm:text-sm font-semibold transition-all ${
                activePersona === 'competitive'
                  ? 'bg-[#002313] dark:bg-emerald-600 text-white shadow-xs'
                  : 'text-[#52796f] dark:text-muted-foreground hover:text-[#002313] dark:hover:text-foreground'
              }`}
            >
              <Target className="w-4 h-4" />
              <span>Competitive Exam Student</span>
            </button>
          </div>
        </div>

        {/* Persona Display Cards */}
        <div className="max-w-4xl mx-auto bg-white dark:bg-card/90 rounded-2xl border border-[#dfe4dd] dark:border-border shadow-premium p-6 sm:p-8 space-y-6">
          <div className="pb-4 border-b border-[#dfe4dd] dark:border-border">
            <h3 className="font-serif text-2xl font-bold text-[#002313] dark:text-foreground">
              {current.title}
            </h3>
            <p className="text-sm text-[#2d4a3e] dark:text-muted-foreground mt-1">
              {current.subtitle}
            </p>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-3.5">
            {current.modules.map((mod, i) => (
              <div
                key={i}
                className="p-4 rounded-xl bg-[#f6fbf3] dark:bg-muted/40 border border-[#dfe4dd] dark:border-border flex flex-col justify-between hover:border-[#165034]/40 dark:hover:border-emerald-500/40 transition-colors"
              >
                <div>
                  <div className="flex items-center justify-between mb-2">
                    <span className="w-2 h-2 rounded-full bg-[#165034] dark:bg-emerald-400" />
                    <span className="text-[10px] font-mono font-bold px-2 py-0.5 rounded bg-white dark:bg-card text-[#165034] dark:text-emerald-400 border border-[#dfe4dd] dark:border-border">
                      {mod.tag}
                    </span>
                  </div>
                  <div className="font-serif font-bold text-sm text-[#002313] dark:text-foreground">
                    {mod.name}
                  </div>
                  <p className="text-xs text-[#52796f] dark:text-muted-foreground mt-1.5 leading-relaxed">
                    {mod.desc}
                  </p>
                </div>
              </div>
            ))}
          </div>

          <div className="pt-3 border-t border-[#dfe4dd] dark:border-border flex flex-wrap items-center justify-between text-xs text-[#52796f] dark:text-muted-foreground">
            <span>Ming automatically configures its SM-2 intervals according to your exam deadline.</span>
            <span className="text-[#165034] dark:text-emerald-400 font-semibold">Zero Friction Setup</span>
          </div>
        </div>
      </div>
    </section>
  );
};

