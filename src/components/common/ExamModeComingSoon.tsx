import React from 'react';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { 
  GraduationCap, 
  Target, 
  Sparkles, 
  BookOpen, 
  ArrowRight, 
  ArrowLeft,
  CheckCircle2,
  Clock
} from 'lucide-react';

export interface ExamModeComingSoonProps {
  /**
   * Action triggered when user clicks "Go to College Mode".
   */
  onGoToCollegeMode: () => void | Promise<void>;
  /**
   * Optional action triggered when user clicks the secondary back button.
   */
  onBack?: () => void;
  /**
   * Label for the secondary action (defaults to "Back to mode selection").
   */
  backLabel?: string;
  /**
   * Whether the primary button is in a loading state.
   */
  isLoading?: boolean;
  /**
   * Optional custom title override.
   */
  title?: string;
}

export const ExamModeComingSoon: React.FC<ExamModeComingSoonProps> = ({
  onGoToCollegeMode,
  onBack,
  backLabel = 'Back to mode selection',
  isLoading = false,
  title = 'Exam Preparation Mode',
}) => {
  return (
    <div 
      className="w-full max-w-2xl mx-auto px-4 py-8 md:py-12 flex flex-col items-center justify-center min-h-[500px]"
      role="region"
      aria-label="Exam Preparation Mode Coming Soon Notice"
    >
      <Card className="w-full p-6 sm:p-10 border border-border/80 shadow-lg bg-card/95 backdrop-blur-sm rounded-2xl relative overflow-hidden">
        {/* Subtle accent glow in brand colors */}
        <div 
          className="absolute -top-24 -right-24 w-48 h-48 bg-emerald-500/10 rounded-full blur-3xl pointer-events-none" 
          aria-hidden="true" 
        />
        <div 
          className="absolute -bottom-24 -left-24 w-48 h-48 bg-blue-500/10 rounded-full blur-3xl pointer-events-none" 
          aria-hidden="true" 
        />

        <div className="flex flex-col items-center text-center space-y-6">
          {/* Header Icon & Status Badge */}
          <div className="space-y-3 flex flex-col items-center">
            <div className="w-16 h-16 sm:w-20 sm:h-20 rounded-2xl bg-gradient-to-br from-emerald-500/20 to-teal-500/20 border border-emerald-500/30 flex items-center justify-center shadow-inner">
              <Target className="w-8 h-8 sm:w-10 sm:h-10 text-emerald-600 dark:text-emerald-400" />
            </div>

            <div className="flex items-center gap-2">
              <Badge 
                variant="outline" 
                className="bg-amber-500/10 text-amber-700 dark:text-amber-400 border-amber-500/30 px-3 py-1 font-semibold text-xs tracking-wide uppercase flex items-center gap-1.5"
              >
                <Clock className="w-3.5 h-3.5" />
                Coming Soon
              </Badge>
            </div>
          </div>

          {/* Heading & Description */}
          <div className="space-y-3 max-w-lg">
            <h1 className="text-2xl sm:text-3xl font-bold tracking-tight text-foreground font-serif">
              {title}
            </h1>
            <p className="text-sm sm:text-base text-muted-foreground leading-relaxed">
              We're working on a more complete exam preparation experience with focused study plans,
              practice assessments, and exam-oriented learning tools. For now, College Mode is available to explore.
            </p>
          </div>

          {/* Planned Features Highlight Cards */}
          <div className="w-full grid grid-cols-1 sm:grid-cols-3 gap-3 pt-2 text-left">
            <div className="p-3.5 rounded-xl bg-muted/40 border border-border/60 space-y-1.5">
              <div className="flex items-center gap-1.5 text-xs font-semibold text-foreground">
                <CheckCircle2 className="w-4 h-4 text-emerald-500 shrink-0" />
                <span>Targeted Syllabi</span>
              </div>
              <p className="text-xs text-muted-foreground leading-normal">
                Structured coverage for JEE, NEET, GATE, and competitive exams.
              </p>
            </div>

            <div className="p-3.5 rounded-xl bg-muted/40 border border-border/60 space-y-1.5">
              <div className="flex items-center gap-1.5 text-xs font-semibold text-foreground">
                <CheckCircle2 className="w-4 h-4 text-blue-500 shrink-0" />
                <span>Mock Assessments</span>
              </div>
              <p className="text-xs text-muted-foreground leading-normal">
                Timed test simulators with negative-marking verification.
              </p>
            </div>

            <div className="p-3.5 rounded-xl bg-muted/40 border border-border/60 space-y-1.5">
              <div className="flex items-center gap-1.5 text-xs font-semibold text-foreground">
                <CheckCircle2 className="w-4 h-4 text-purple-500 shrink-0" />
                <span>Revision Cycles</span>
              </div>
              <p className="text-xs text-muted-foreground leading-normal">
                Bayesian Knowledge Tracing tailored for high-stakes test readiness.
              </p>
            </div>
          </div>

          {/* Action Buttons */}
          <div className="w-full pt-4 flex flex-col sm:flex-row items-center justify-center gap-3">
            <Button
              type="button"
              onClick={onGoToCollegeMode}
              disabled={isLoading}
              className="w-full sm:w-auto min-w-[200px] h-11 px-6 font-semibold bg-primary hover:bg-primary/90 text-primary-foreground shadow-md transition-all gap-2"
              aria-label="Continue with College Mode"
            >
              <GraduationCap className="w-5 h-5" />
              <span>Go to College Mode</span>
              <ArrowRight className="w-4 h-4" />
            </Button>

            {onBack && (
              <Button
                type="button"
                variant="outline"
                onClick={onBack}
                disabled={isLoading}
                className="w-full sm:w-auto h-11 px-5 border-border hover:bg-muted text-foreground transition-all gap-2"
                aria-label={backLabel}
              >
                <ArrowLeft className="w-4 h-4" />
                <span>{backLabel}</span>
              </Button>
            )}
          </div>
        </div>
      </Card>
    </div>
  );
};
