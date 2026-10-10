import React, { useState, useEffect, useMemo } from 'react';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import {
  Brain,
  Sparkles,
  BookOpen,
  FileQuestion,
  Loader2,
  Trophy,
  ShieldCheck,
  CheckCircle2,
  Clock,
  History,
  FileText,
  Presentation,
  Video,
  AlertCircle,
  ExternalLink,
  UploadCloud,
  TrendingUp,
  RotateCcw,
} from 'lucide-react';
import { useAuth } from '@/components/auth/AuthProvider';
import { useToast } from '@/hooks/use-toast';
import { generateAssessment, getAssessmentHistory, getDiagnosticAttempt, AssessmentQuestion, DiagnosticReport } from '@/api/assessmentAPI';
import { listResources } from '@/api/resourceAPI';
import { getAllPages } from '@/api/pageAPI';
import { exportPageToMarkdown } from '@/api/exportAPI';
import { ingestSource } from '@/api/ragAPI';
import { cleanAiResponseToReadableNotes } from '@/utils/notesFormatter';
import { QuizViewer } from '@/components/flashcards/QuizViewer';
import { navigateToTab } from '@/utils/navigation';
import { AssessmentAnalyticsModal, AssessmentAttemptGroup } from './AssessmentAnalyticsModal';

export interface AssessmentSourceItem {
  id: string;
  pageId?: string;
  title: string;
  rawTitle: string;
  parentTitle?: string;
  type: string;
  icon?: string;
  isNotionPage: boolean;
  pageData?: any;
  resourceData?: any;
}

function extractPageContentText(page: any): string {
  if (!page) return '';
  if (typeof page.content === 'string') return page.content;
  if (!Array.isArray(page.content)) return '';

  const chunks: string[] = [];
  if (page.title) chunks.push(`# ${page.title}`);

  for (const block of page.content) {
    if (!block) continue;
    if (typeof block === 'string') {
      chunks.push(block);
      continue;
    }
    if (block.content) {
      if (typeof block.content === 'string') {
        chunks.push(block.content);
      } else if (block.content.text) {
        chunks.push(block.content.text);
      }
    }
    if (Array.isArray(block.items)) {
      for (const item of block.items) {
        if (typeof item === 'string') chunks.push(item);
        else if (item?.text) chunks.push(item.text);
      }
    }
  }

  return chunks.join('\n\n');
}

export const AdaptiveAssessmentGenerator: React.FC = () => {
  const { user } = useAuth();
  const { toast } = useToast();

  const [topic, setTopic] = useState(() => {
    return localStorage.getItem('studymate-assessment-prefill-topic') || '';
  });
  const [subtopic, setSubtopic] = useState('');
  const [subject, setSubject] = useState<string>(() => {
    return localStorage.getItem('studymate_generator_subject') || (user?.branch || user?.examType || 'Computer Science');
  });
  const [difficulty, setDifficulty] = useState<'easy' | 'medium' | 'hard'>('medium');
  const [count, setCount] = useState<number>(5);
  const [questionType, setQuestionType] = useState<'MCQ' | 'SHORT_ANSWER' | 'NUMERICAL' | 'MIXED'>('MCQ');
  const [selectedSourceId, setSelectedSourceId] = useState<string>('all');
  const [availableSources, setAvailableSources] = useState<AssessmentSourceItem[]>([]);

  const [isGenerating, setIsGenerating] = useState(false);
  const [activeQuestions, setActiveQuestions] = useState<AssessmentQuestion[] | null>(null);
  const [history, setHistory] = useState<any[]>([]);
  const [generationNotice, setGenerationNotice] = useState<string | null>(null);

  const [analyticsModalGroup, setAnalyticsModalGroup] = useState<AssessmentAttemptGroup | null>(null);
  const [analyticsModalAttempt, setAnalyticsModalAttempt] = useState<any | null>(null);
  const [isAnalyticsOpen, setIsAnalyticsOpen] = useState(false);

  useEffect(() => {
    const handlePrefill = (e: any) => {
      if (e.detail?.params?.topic) {
        setTopic(e.detail.params.topic);
      }
    };
    window.addEventListener('studymate-navigate', handlePrefill);
    window.addEventListener('studymate-subtab', handlePrefill);
    return () => {
      window.removeEventListener('studymate-navigate', handlePrefill);
      window.removeEventListener('studymate-subtab', handlePrefill);
    };
  }, []);

  // Fetch student's course materials (Both Notion workspace pages and uploaded course files)
  useEffect(() => {
    async function loadSources() {
      try {
        const combinedSources: AssessmentSourceItem[] = [];
        const seenKeys = new Set<string>();

        // 1. Fetch student's Notion workspace pages (Resources tab)
        try {
          const pages = await getAllPages();
          if (Array.isArray(pages) && pages.length > 0) {
            const pageMap = new Map<string, any>();
            pages.forEach((p) => pageMap.set(p.id, p));

            for (const page of pages) {
              if (page.deleted_at) continue;
              const parent = page.parent_id ? pageMap.get(page.parent_id) : null;
              const parentTitle = parent?.title?.trim();
              const pageTitle = (page.title || 'Untitled').trim();
              const displayTitle = parentTitle ? `${parentTitle} / ${pageTitle}` : pageTitle;

              const dedupeKey = `page::${displayTitle.toLowerCase()}`;
              if (!seenKeys.has(dedupeKey)) {
                seenKeys.add(dedupeKey);
                combinedSources.push({
                  id: `notion_page_${page.id}`,
                  pageId: page.id,
                  title: displayTitle,
                  rawTitle: pageTitle,
                  parentTitle: parentTitle || undefined,
                  type: parent ? 'SUBPAGE' : 'PAGE',
                  icon: page.icon || (parent ? '↳' : '📄'),
                  isNotionPage: true,
                  pageData: page,
                });
              }
            }
          }
        } catch (pageErr) {
          console.warn('Could not load Notion pages for assessment dropdown:', pageErr);
        }

        // 2. Fetch Uploaded Course Files from /api/resources
        try {
          let fileList: any[] = [];
          try {
            const resList = await listResources();
            if (Array.isArray(resList) && resList.length > 0) {
              fileList = resList;
            }
          } catch {
            // fallback
          }

          if (fileList.length === 0) {
            const effectiveUserId = user?.user_id || user?.id || 'default_user';
            const res = await fetch(`/api/resources?userId=${encodeURIComponent(effectiveUserId)}`);
            if (res.ok) {
              const data = await res.json();
              fileList = Array.isArray(data) ? data : Array.isArray(data?.resources) ? data.resources : [];
            }
          }

          for (const item of fileList) {
            const title = (item.title || 'Document').trim();
            const dedupeKey = `file::${title.toLowerCase()}::${(item.type || '').toLowerCase()}`;
            if (!seenKeys.has(dedupeKey)) {
              seenKeys.add(dedupeKey);
              combinedSources.push({
                id: item.id || `file_${title}`,
                title: title,
                rawTitle: title,
                type: item.type || 'DOCUMENT',
                icon: item.type === 'PDF' ? '📕' : item.type === 'VIDEO' ? '🎥' : '📑',
                isNotionPage: false,
                resourceData: item,
              });
            }
          }
        } catch (fileErr) {
          console.warn('Could not load uploaded course files for assessment dropdown:', fileErr);
        }

        setAvailableSources(combinedSources);
      } catch (err) {
        console.warn('Could not load course resources for assessment dropdown:', err);
      }
    }
    loadSources();

    const handleRefresh = () => loadSources();
    window.addEventListener('studymate-resource-added', handleRefresh);
    window.addEventListener('studymate-resources-changed', handleRefresh);
    window.addEventListener('studymate-resources-updated', handleRefresh);
    window.addEventListener('studymate-page-created', handleRefresh);
    window.addEventListener('studymate-page-updated', handleRefresh);
    window.addEventListener('studymate-page-deleted', handleRefresh);
    window.addEventListener('focus', handleRefresh);
    return () => {
      window.removeEventListener('studymate-resource-added', handleRefresh);
      window.removeEventListener('studymate-resources-changed', handleRefresh);
      window.removeEventListener('studymate-resources-updated', handleRefresh);
      window.removeEventListener('studymate-page-created', handleRefresh);
      window.removeEventListener('studymate-page-updated', handleRefresh);
      window.removeEventListener('studymate-page-deleted', handleRefresh);
      window.removeEventListener('focus', handleRefresh);
    };
  }, [user]);

  // Fetch assessment history
  useEffect(() => {
    async function loadHistory() {
      const effectiveUserId = user?.user_id || user?.id || 'default_user';
      try {
        const res = await getAssessmentHistory(effectiveUserId);
        if (res.success && res.history) {
          setHistory(res.history);
        }
      } catch {
        // Fallback
      }
    }
    loadHistory();

    const handleRefresh = () => loadHistory();
    window.addEventListener('studymate-bkt-refresh', handleRefresh);
    window.addEventListener('focus', handleRefresh);
    return () => {
      window.removeEventListener('studymate-bkt-refresh', handleRefresh);
      window.removeEventListener('focus', handleRefresh);
    };
  }, [user, activeQuestions]);

  // Logically group assessment attempts by normalized title & topic
  const attemptGroups: AssessmentAttemptGroup[] = useMemo(() => {
    const map = new Map<string, AssessmentAttemptGroup>();

    history.forEach((att) => {
      const normTitle = (att.title || 'Course Assessment').trim();
      const normTopic = (att.topic || '').trim().toLowerCase();
      const key = `${normTitle.toLowerCase()}:::${normTopic}`;

      if (!map.has(key)) {
        map.set(key, {
          key,
          title: normTitle,
          topic: att.topic,
          subtopic: att.subtopic,
          difficulty: att.difficulty,
          bestScore: att.percentage,
          latestScore: att.percentage,
          totalQuestions: att.totalQuestions,
          attempts: [att],
          latestAttempt: att,
        });
      } else {
        const group = map.get(key)!;
        group.attempts.push(att);
        if (att.percentage > group.bestScore) {
          group.bestScore = att.percentage;
        }
      }
    });

    map.forEach((group) => {
      group.attempts.sort((a, b) => new Date(b.completedAt).getTime() - new Date(a.completedAt).getTime());
      group.latestAttempt = group.attempts[0];
      group.latestScore = group.attempts[0].percentage;
    });

    return Array.from(map.values());
  }, [history]);

  const handleOpenAnalytics = (group: AssessmentAttemptGroup, attempt?: any) => {
    setAnalyticsModalGroup(group);
    setAnalyticsModalAttempt(attempt || group.latestAttempt);
    setIsAnalyticsOpen(true);
  };

  const handleRetakeAssessment = async (group: AssessmentAttemptGroup, attempt?: any) => {
    const targetAttempt = attempt || group.latestAttempt;
    setIsGenerating(true);
    setGenerationNotice(null);

    // 1. First, try to retrieve the original attempt's questions so the student retakes the exact same assessment items
    try {
      if (targetAttempt?.id) {
        const diagData = await getDiagnosticAttempt(targetAttempt.id, user?.user_id || user?.id || 'default_user');
        if (diagData && Array.isArray(diagData.questions) && diagData.questions.length > 0) {
          setActiveQuestions(diagData.questions);
          setTopic(targetAttempt.topic || group.topic);
          setSubtopic(targetAttempt.subtopic || group.subtopic || '');
          setDifficulty((targetAttempt.difficulty as any) || (group.difficulty as any) || 'medium');
          setIsGenerating(false);
          toast({
            title: 'Retaking Assessment',
            description: `Starting new attempt for ${group.title}. Previous attempt scores are preserved.`,
          });
          return;
        }
      }
    } catch (e) {
      console.warn('Could not load cached questions for retake, generating new attempt questions:', e);
    }

    // 2. Fallback: Generate fresh grounded questions using the exact same parameters
    try {
      const result = await generateAssessment({
        userId: user?.user_id || user?.id || 'default_user',
        topic: targetAttempt.topic || group.topic,
        subtopic: targetAttempt.subtopic || group.subtopic || undefined,
        difficulty: (targetAttempt.difficulty as any) || (group.difficulty as any) || 'medium',
        count: targetAttempt.totalQuestions || 5,
        questionType: 'MCQ',
      });

      if (result.questions && result.questions.length > 0) {
        setActiveQuestions(result.questions);
        setTopic(targetAttempt.topic || group.topic);
        setSubtopic(targetAttempt.subtopic || group.subtopic || '');
        setDifficulty((targetAttempt.difficulty as any) || (group.difficulty as any) || 'medium');
        toast({
          title: 'Retaking Assessment',
          description: `Generated fresh items for ${group.title}. Previous attempt scores are preserved.`,
        });
        return;
      }
    } catch (err: any) {
      // 3. Client offline fallback
      const diagQuestions = generateClientTopicQuestions(
        targetAttempt.topic || group.topic,
        targetAttempt.subtopic || group.subtopic || '',
        (targetAttempt.difficulty as any) || 'medium',
        targetAttempt.totalQuestions || 5,
        'MCQ'
      );
      setActiveQuestions(diagQuestions);
      setTopic(targetAttempt.topic || group.topic);
      setSubtopic(targetAttempt.subtopic || group.subtopic || '');
      toast({
        title: 'Retaking Assessment',
        description: `Starting new diagnostic attempt for ${group.title}.`,
      });
    } finally {
      setIsGenerating(false);
    }
  };

  // Client-side subject-faithful diagnostic generator (Used when offline or as instant fallback)
  const generateClientTopicQuestions = (
    cSubject: string,
    cTopic: string,
    cSubtopic: string,
    cDiff: 'easy' | 'medium' | 'hard',
    cCount: number,
    cType: string
  ): AssessmentQuestion[] => {
    const norm = (cSubject + ' ' + cTopic + ' ' + cSubtopic).toLowerCase();
    let bank: Array<{
      subtopic: string;
      question: string;
      options: string[];
      correct_answer: string;
      explanation: string;
      type?: 'MCQ' | 'SHORT_ANSWER' | 'NUMERICAL';
    }> = [];

    if (norm.includes('linear') || norm.includes('eigen') || norm.includes('matrix') || norm.includes('vector')) {
      bank = [
        {
          subtopic: 'Eigenvalues & Eigenvectors',
          question: `For a square matrix A and non-zero vector v, what condition defines v as an eigenvector of A with eigenvalue λ?`,
          options: ['A v = λ v', 'A v = v + λ', 'A + λ I = v', 'A v = λ^2 I'],
          correct_answer: 'A v = λ v',
          explanation: `An eigenvector is a non-zero vector that changes at most by a scalar factor λ (the eigenvalue) when linear transformation A is applied: Av = λv.`,
        },
        {
          subtopic: 'Characteristic Equation',
          question: `Which equation is solved to find the eigenvalues λ of an n × n square matrix A?`,
          options: ['det(A - λ I) = 0', 'trace(A - λ I) = 0', 'A - λ I = 0', 'det(A) - λ = 0'],
          correct_answer: 'det(A - λ I) = 0',
          explanation: `The condition (A - λI)v = 0 has non-trivial solutions v ≠ 0 if and only if the matrix (A - λI) is singular, meaning det(A - λI) = 0.`,
        },
        {
          subtopic: 'Spectral Theorem',
          question: `According to the Spectral Theorem, what property is guaranteed for any real symmetric matrix A (where A = A^T)?`,
          options: [
            'All of its eigenvalues are real, and eigenvectors corresponding to distinct eigenvalues are orthogonal',
            'All of its eigenvalues are purely imaginary numbers',
            'Its determinant is always guaranteed to be zero',
            'It cannot be diagonalized under any basis transformation',
          ],
          correct_answer:
            'All of its eigenvalues are real, and eigenvectors corresponding to distinct eigenvalues are orthogonal',
          explanation: `The Spectral Theorem guarantees that any real symmetric matrix has exclusively real eigenvalues and can be orthogonally diagonalized by a matrix of orthonormal eigenvectors.`,
        },
        {
          subtopic: 'Trace and Determinant Invariants',
          question: `For an n × n square matrix A with eigenvalues λ_1, ..., λ_n, how does the trace of A relate to its eigenvalues?`,
          options: [
            'trace(A) = λ_1 + λ_2 + ... + λ_n (the sum of the eigenvalues)',
            'trace(A) = λ_1 · λ_2 · ... · λ_n (the product of the eigenvalues)',
            'trace(A) = max(λ_1, ..., λ_n) - min(λ_1, ..., λ_n)',
            'trace(A) = 1 / (λ_1 + λ_2 + ... + λ_n)',
          ],
          correct_answer: 'trace(A) = λ_1 + λ_2 + ... + λ_n (the sum of the eigenvalues)',
          explanation: `The trace of a matrix is invariant under similarity transformations and identically equals the sum of its eigenvalues (counted with algebraic multiplicity).`,
        },
        {
          subtopic: 'Matrix Invertibility',
          question: `Which statement regarding an n × n matrix A and its determinant det(A) is equivalent to A being invertible?`,
          options: [
            'det(A) ≠ 0 and zero is not an eigenvalue of A',
            'det(A) = 0 and at least one eigenvalue is zero',
            'trace(A) > 0 and all row sums equal 1',
            'rank(A) < n and the nullity is non-zero',
          ],
          correct_answer: 'det(A) ≠ 0 and zero is not an eigenvalue of A',
          explanation: `A square matrix is invertible if and only if det(A) ≠ 0, its rank is n, and 0 is not an eigenvalue.`,
        },
      ];
    } else if (norm.includes('data mining') || norm.includes('machine learning') || norm.includes('neural') || norm.includes('cluster') || norm.includes('apriori')) {
      bank = [
        {
          subtopic: 'Association Rule Mining',
          question: `In association rule mining, what does the 'Support' of an itemset X denote?`,
          options: [
            'The fraction of total transactions in the database that contain itemset X',
            'The conditional probability of transaction containing Y given it contains X',
            'The ratio of observed joint occurrence to expected independent occurrence',
            'The total computational memory allocated to frequent itemset trees',
          ],
          correct_answer: 'The fraction of total transactions in the database that contain itemset X',
          explanation: `Support measures the frequency of occurrence of an itemset in the dataset: Support(X) = count(X) / total_transactions.`,
        },
        {
          subtopic: 'Apriori Property',
          question: `What fundamental anti-monotonicity property forms the basis of the Apriori algorithm?`,
          options: [
            'If an itemset is infrequent, all of its supersets must also be infrequent',
            'All subsets of an infrequent itemset are guaranteed to be frequent',
            'The support of an itemset increases monotonically with each added item',
            'Rules with high confidence must always have minimum support of 100%',
          ],
          correct_answer: 'If an itemset is infrequent, all of its supersets must also be infrequent',
          explanation: `The Apriori property holds that any subset of a frequent itemset must be frequent; conversely, if an itemset is infrequent, none of its supersets can be frequent.`,
        },
        {
          subtopic: 'Supervised vs Unsupervised Learning',
          question: `What is the primary operational distinction between Supervised Learning and Unsupervised Learning?`,
          options: [
            'Supervised learning trains on input data with target ground-truth labels, while unsupervised learning discovers intrinsic patterns without labels',
            'Supervised learning operates without algorithms, while unsupervised learning requires manual feature weights',
            'Supervised learning only handles numerical values, while unsupervised learning only handles text',
            'Unsupervised learning always produces zero prediction error on unseen data',
          ],
          correct_answer:
            'Supervised learning trains on input data with target ground-truth labels, while unsupervised learning discovers intrinsic patterns without labels',
          explanation: `Supervised models learn a mapping function from labeled training pairs (X, y), whereas unsupervised algorithms (like K-Means or PCA) identify cluster structures or representations without target labels.`,
        },
        {
          subtopic: 'Overfitting & Regularization',
          question: `What mathematical effect distinguishes L1 Regularization (Lasso) from L2 Regularization (Ridge)?`,
          options: [
            'L1 regularization adds the absolute sum of weights inducing sparsity, while L2 adds squared weights shrinking coefficients smoothly',
            'L2 regularization eliminates features completely by driving weights exactly to zero',
            'L1 regularization requires infinite training epochs to converge',
            'L2 regularization is applicable only to decision tree models',
          ],
          correct_answer:
            'L1 regularization adds the absolute sum of weights inducing sparsity, while L2 adds squared weights shrinking coefficients smoothly',
          explanation: `L1 norm regularization (Lasso) penalizes |w|, driving irrelevant feature weights to exactly 0 to create sparse models. L2 norm (Ridge) penalizes w^2, shrinking weights toward zero without setting them exactly to zero.`,
        },
        {
          subtopic: 'Classification Evaluation Metrics',
          question: `In binary classification, how is the 'Precision' metric defined?`,
          options: [
            'True Positives / (True Positives + False Positives)',
            'True Positives / (True Positives + False Negatives)',
            '(True Positives + True Negatives) / Total Samples',
            'False Positives / (False Positives + True Negatives)',
          ],
          correct_answer: 'True Positives / (True Positives + False Positives)',
          explanation: `Precision measures the accuracy of positive predictions (of all instances predicted positive, how many were truly positive), whereas Recall measures True Positives / (True Positives + False Negatives).`,
        },
      ];
    } else if (norm.includes('operating') || norm.includes('os') || norm.includes('kernel') || norm.includes('deadlock') || norm.includes('virtual memory') || norm.includes('synchronization') || norm.includes('concurrency') || norm.includes('semaphore') || norm.includes('mutex')) {
      if (norm.includes('synchronization') || norm.includes('sync') || norm.includes('mutex') || norm.includes('semaphore') || norm.includes('critical section') || norm.includes('race condition') || norm.includes('monitor') || norm.includes('lock') || norm.includes('concurrency')) {
        bank = [
          {
            subtopic: 'Critical Section Problem',
            question: 'Which set of three requirements must any valid solution to the critical-section problem strictly satisfy in an operating system?',
            options: [
              'Mutual Exclusion, Progress, and Bounded Waiting',
              'Preemption, Hold-and-Wait, and Starvation',
              'Mutual Exclusion, Infinite Buffering, and Busy Waiting',
              'Shortest Job First, Aging, and Context Switching',
            ],
            correct_answer: 'Mutual Exclusion, Progress, and Bounded Waiting',
            explanation: 'Every valid solution to the critical-section problem must guarantee Mutual Exclusion (only one process in the critical section at a time), Progress (processes waiting to enter participate in the decision, not postponed indefinitely), and Bounded Waiting (a bound exists on the number of times others enter before a waiting process is granted access).',
          },
          {
            subtopic: 'Counting vs Binary Semaphores',
            question: 'In operating systems synchronization, what distinguishes a counting semaphore from a binary semaphore (mutex)?',
            options: [
              'A counting semaphore manages an integer value over an unrestricted domain of resource instances, whereas a binary semaphore is strictly constrained to 0 and 1',
              'A counting semaphore permits multiple threads into the same critical section simultaneously without restriction',
              'A binary semaphore automatically detects and resolves circular-wait deadlocks at compile time',
              'A counting semaphore can only be accessed through non-atomic arithmetic increment instructions',
            ],
            correct_answer: 'A counting semaphore manages an integer value over an unrestricted domain of resource instances, whereas a binary semaphore is strictly constrained to 0 and 1',
            explanation: 'Counting semaphores control access to a finite pool of identical resource units using an integer counter. Binary semaphores act strictly as mutex locks with integer values restricted to 0 (locked) and 1 (unlocked).',
          },
          {
            subtopic: 'Race Conditions',
            question: 'What is the defining characteristic of a race condition in concurrent software systems?',
            options: [
              'The final state of shared memory depends non-deterministically on the exact order or timing of thread execution',
              'Two threads execute on different CPU sockets without accessing any shared memory variables',
              'A process runs indefinitely in a CPU-bound compute loop without issuing system calls',
              'The operating system scheduler assigns higher priority to I/O-bound tasks',
            ],
            correct_answer: 'The final state of shared memory depends non-deterministically on the exact order or timing of thread execution',
            explanation: 'A race condition occurs when two or more threads access shared mutable data concurrently, and the final state depends on the unpredictable interleaving or relative execution timing of the threads.',
          },
          {
            subtopic: 'Mutex Locks vs Spinlocks',
            question: 'Under which operational condition is a spinlock generally preferred over a standard blocking mutex lock?',
            options: [
              'On multi-core processors when the expected critical-section duration is shorter than the overhead of two thread context switches',
              'On single-core uniprocessor systems where threads perform long blocking disk I/O inside the critical section',
              'Whenever priority inversion must be completely eliminated without operating system kernel intervention',
              'When memory consumption must be strictly minimized on virtualized network interfaces',
            ],
            correct_answer: 'On multi-core processors when the expected critical-section duration is shorter than the overhead of two thread context switches',
            explanation: 'Spinlocks avoid the high cost of putting a thread to sleep and performing two context switches (sleep and wake). On multi-core systems, busy waiting for a short duration is more efficient than context switching.',
          },
          {
            subtopic: 'Monitors and Condition Variables',
            question: 'What is the operational function of the wait() operation on a condition variable inside an operating system monitor?',
            options: [
              'The invoking thread releases the monitor lock and suspends its execution until another thread signals the condition',
              'The invoking thread increments an internal integer counter and continues executing inside the monitor',
              'The invoking thread forcibly aborts all competing threads currently waiting in the entry queue',
              'The operating system restarts the entire user process from main() with refreshed page tables',
            ],
            correct_answer: 'The invoking thread releases the monitor lock and suspends its execution until another thread signals the condition',
            explanation: 'Condition variables inside monitors provide synchronization without mutual exclusion semantics. Calling wait() atomically releases the monitor mutex and places the calling thread on the condition\'s wait queue until signal() is called.',
          },
        ];
      } else {
        bank = [
          {
            subtopic: 'Process Lifecycle & State Transitions',
            question: `In ${cTopic}, which state transition occurs when an executing process issues an I/O request and must wait for completion?`,
            options: ['Running to Blocked/Waiting', 'Blocked to Running', 'Ready to Terminated', 'Running to Ready'],
            correct_answer: 'Running to Blocked/Waiting',
            explanation: `When an executing process issues a blocking I/O request or system call, it moves from the Running state to the Blocked/Waiting state until the I/O operation completes.`,
          },
          {
            subtopic: 'Deadlock Characterization & Prevention',
            question: `Which of the following conditions is NOT one of the four essential Coffman conditions required for a deadlock to occur?`,
            options: ['Preemptive Resource Allocation', 'Mutual Exclusion', 'Hold and Wait', 'Circular Wait'],
            correct_answer: 'Preemptive Resource Allocation',
            explanation: `Deadlock requires No Preemption (resources cannot be forcibly taken from a process holding them), along with Mutual Exclusion, Hold and Wait, and Circular Wait.`,
          },
          {
            subtopic: 'Virtual Memory & Address Translation',
            question: `What is the primary role of the Translation Lookaside Buffer (TLB) in ${cTopic} memory management?`,
            options: [
              'To cache recent virtual-to-physical address translations for fast lookup',
              'To store secondary disk swap partitions for backing storage',
              'To allocate CPU execution slices to user-level threads',
              'To encrypt process memory spaces during hardware context switching',
            ],
            correct_answer: 'To cache recent virtual-to-physical address translations for fast lookup',
            explanation: `The TLB is a high-speed associative hardware cache that stores recently used page table mappings to avoid repeated memory access delays.`,
          },
          {
            subtopic: 'CPU Scheduling Algorithms',
            question: `Which CPU scheduling algorithm provides the theoretical minimum average waiting time for a stationary set of processes?`,
            options: ['Shortest Job First (SJF)', 'First-Come, First-Served (FCFS)', 'Round Robin (RR)', 'Multilevel Feedback Queue without priority aging'],
            correct_answer: 'Shortest Job First (SJF)',
            explanation: `Shortest Job First (SJF) is provably optimal with respect to minimizing average waiting time for a given set of stationary jobs.`,
          },
          {
            subtopic: 'File System Architecture & Inodes',
            question: `In a standard UNIX file system architecture, which data is stored inside an inode?`,
            options: [
              'File metadata, permissions, owner ID, size, and data block pointers (excluding the file name)',
              'The human-readable file name and its parent directory path only',
              'The raw unstructured payload bytes stored contiguously on the platter',
              'The operating system kernel symbol lookup table',
            ],
            correct_answer: 'File metadata, permissions, owner ID, size, and data block pointers (excluding the file name)',
            explanation: `An inode stores all file metadata (file size, permissions, owner, timestamps, and pointers to disk blocks), while the file name is stored separately in the directory table.`,
          },
        ];
      }
    } else {
      // Fail-closed safe fallback: Never synthesize generic boilerplate phrases or circular definitions!
      bank = [];
    }

    return bank.slice(0, cCount).map((item, idx) => {
      let shuffledOptions = [...item.options];
      if (item.options && item.options.length > 1) {
        for (let i = shuffledOptions.length - 1; i > 0; i--) {
          const j = Math.floor(Math.random() * (i + 1));
          [shuffledOptions[i], shuffledOptions[j]] = [shuffledOptions[j], shuffledOptions[i]];
        }
      }
      return {
        question_id: `q_diag_${Date.now()}_${idx}`,
        type: (item.type || (cType === 'MIXED' ? 'MCQ' : cType)) as any,
        topic: cTopic,
        subtopic: item.subtopic,
        difficulty: cDiff,
        question: item.question,
        options: shuffledOptions,
        correct_answer: item.correct_answer,
        explanation: item.explanation,
        source_id: 'src_curriculum_standard',
        citation_label: `Curriculum Diagnostic (${cTopic})`,
      };
    });
  };

  const handleGenerateBaseline = async () => {
    const currentTopic = topic.trim() || 'Course Diagnostic';
    setIsGenerating(true);
    setGenerationNotice(null);

    try {
      const result = await generateAssessment({
        userId: user?.user_id || user?.id || 'default_user',
        topic: currentTopic,
        subtopic: subtopic.trim() || undefined,
        subject: subject.trim() || undefined,
        difficulty,
        count,
        questionType,
      });

      if (result.questions && result.questions.length > 0) {
        setActiveQuestions(result.questions);
        toast({
          title: 'Diagnostic Assessment Ready',
          description: `Generated ${result.questions.length} diagnostic questions for ${currentTopic}.`,
        });
        return;
      }
    } catch (apiErr) {
      console.warn('Backend baseline API fallback to client generation:', apiErr);
    } finally {
      setIsGenerating(false);
    }

    const fallbackQuestions = generateClientTopicQuestions(
      subject.trim(),
      currentTopic,
      subtopic.trim(),
      difficulty,
      count,
      questionType
    );
    if (fallbackQuestions.length > 0) {
      setActiveQuestions(fallbackQuestions);
      toast({
        title: 'Topic Diagnostic Assessment',
        description: `Generated ${fallbackQuestions.length} diagnostic questions tailored for ${currentTopic}.`,
      });
    } else {
      toast({
        title: 'Questions Unavailable',
        description: `Could not generate reliable questions for ${subject ? `${subject} → ` : ''}${currentTopic}. Please upload course materials or try a narrower subtopic.`,
        variant: 'destructive',
      });
    }
  };

  const handleGenerate = async () => {
    if (!topic.trim()) {
      toast({
        title: 'Topic Required',
        description: 'Please specify the course topic for this assessment.',
        variant: 'destructive',
      });
      return;
    }

    setIsGenerating(true);
    setGenerationNotice(null);

    const selectedSource = availableSources.find((s) => s.id === selectedSourceId);
    let effectiveSourceId: string | undefined = selectedSourceId !== 'all' ? selectedSourceId : undefined;

    // If a Notion workspace page is selected, ingest its notes content into ChromaDB first so questions are 100% grounded in the student's actual notes
    if (selectedSource?.isNotionPage && selectedSource.pageData) {
      try {
        let pageText = '';
        try {
          pageText = await exportPageToMarkdown(selectedSource.pageData.id, true);
        } catch {
          pageText = extractPageContentText(selectedSource.pageData);
        }

        if (pageText) {
          const cleanText = cleanAiResponseToReadableNotes(pageText);
          const ingestRes = await ingestSource({
            text: cleanText,
            title: selectedSource.title,
            topic: topic.trim(),
            subtopic: subtopic.trim() || undefined,
            userId: user?.user_id || user?.id || 'default_user',
            sourceType: 'NOTE',
            sourceId: selectedSource.pageData.id,
            documentId: selectedSource.pageData.id,
          });
          if (ingestRes?.sourceId || ingestRes?.documentId) {
            effectiveSourceId = ingestRes.sourceId || ingestRes.documentId;
          } else {
            effectiveSourceId = selectedSource.pageData.id;
          }
        }
      } catch (ingestErr) {
        console.warn('Could not ingest Notion page for grounded assessment:', ingestErr);
        effectiveSourceId = selectedSource.pageData.id;
      }
    }

    try {
      const result = await generateAssessment({
        userId: user?.user_id || user?.id || 'default_user',
        topic: topic.trim(),
        subtopic: subtopic.trim() || undefined,
        subject: subject.trim() || undefined,
        difficulty,
        count,
        questionType,
        sourceId: effectiveSourceId,
      });

      if (!result.questions || result.questions.length === 0) {
        const diagQuestions = generateClientTopicQuestions(
          subject.trim(),
          topic.trim(),
          subtopic.trim(),
          difficulty,
          count,
          questionType
        );
        if (diagQuestions.length > 0) {
          setActiveQuestions(diagQuestions);
          setGenerationNotice(null);
          toast({
            title: 'Curriculum Diagnostic Assessment',
            description: `No local materials uploaded for this topic. Generated ${diagQuestions.length} curriculum diagnostic questions for ${topic.trim()}.`,
          });
          return;
        }

        toast({
          title: 'Assessment Unavailable',
          description: `Could not generate enough reliable questions for ${subject ? `${subject} → ` : ''}${topic.trim()}. Try adding course notes or retrying with a narrower subtopic.`,
          variant: 'destructive',
        });
        return;
      }

      setActiveQuestions(result.questions);
      setGenerationNotice(null);
      toast({
        title: 'Assessment Ready',
        description: `Generated and verified ${result.questions.length} grounded questions for ${topic.trim()}.`,
      });
    } catch (err: any) {
      const diagQuestions = generateClientTopicQuestions(
        subject.trim(),
        topic.trim(),
        subtopic.trim(),
        difficulty,
        count,
        questionType
      );
      if (diagQuestions.length > 0) {
        setActiveQuestions(diagQuestions);
        setGenerationNotice(null);
        toast({
          title: 'Topic Diagnostic Assessment',
          description: `Generated ${diagQuestions.length} diagnostic questions for ${topic.trim()}.`,
        });
      } else {
        toast({
          title: 'Assessment Generation Failed',
          description: err.message || `Could not generate reliable questions for ${subject ? `${subject} → ` : ''}${topic.trim()}. Try adding course notes or retrying with a narrower subtopic.`,
          variant: 'destructive',
        });
      }
    } finally {
      setIsGenerating(false);
    }
  };

  if (activeQuestions && activeQuestions.length > 0) {
    return (
      <div className="space-y-6">
        <QuizViewer
          questions={activeQuestions as any}
          title={`${topic} Adaptive Assessment`}
          difficulty={difficulty}
          topic={topic}
          subtopic={subtopic}
          userId={user?.user_id || 'default_user'}
          onClose={() => setActiveQuestions(null)}
          onComplete={() => {
            // refresh history
            if (user?.user_id) {
              getAssessmentHistory(user.user_id).then((res) => {
                if (res.history) setHistory(res.history);
              });
            }
          }}
        />
      </div>
    );
  }

  return (
    <div className="space-y-8">

      {/* Configuration Form */}
      <Card className="p-6 space-y-6">
        <h3 className="text-lg font-semibold text-foreground flex items-center gap-2">
          <Brain className="w-5 h-5 text-indigo-600" />
          Configure Assessment Parameters
        </h3>

        {availableSources.length === 0 && (
          <div className="p-3.5 rounded-xl bg-amber-500/10 border border-amber-500/20 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 text-xs">
            <div className="flex items-center gap-2 text-amber-800 dark:text-amber-200">
              <AlertCircle className="w-4 h-4 text-amber-600 flex-shrink-0" />
              <span>
                <strong>No course materials uploaded yet:</strong> You can take a standard curriculum diagnostic assessment, or upload textbooks, slides, and videos in Resources to generate questions citing exact pages and timestamps.
              </span>
            </div>
            <Button
              size="sm"
              variant="outline"
              type="button"
              onClick={() => navigateToTab('resources')}
              className="border-amber-300 dark:border-amber-700 text-amber-900 dark:text-amber-100 hover:bg-amber-100 dark:hover:bg-amber-900/40 text-xs h-7 px-2.5 flex-shrink-0"
            >
              <UploadCloud className="w-3.5 h-3.5 mr-1" />
              Upload Materials in Resources ↗
            </Button>
          </div>
        )}

        {generationNotice && (
          <div className="p-4 rounded-xl bg-rose-500/10 border border-rose-500/20 space-y-2.5">
            <div className="flex items-center gap-2 text-xs font-semibold text-rose-700 dark:text-rose-300">
              <AlertCircle className="w-4 h-4 flex-shrink-0" />
              <span>{generationNotice}</span>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <Button
                size="sm"
                type="button"
                onClick={() => navigateToTab('resources')}
                className="bg-indigo-600 hover:bg-indigo-700 text-white text-xs h-8 px-3 gap-1.5 shadow-xs"
              >
                <UploadCloud className="w-3.5 h-3.5" />
                Upload Course Materials in Resources ↗
              </Button>
              <Button
                size="sm"
                type="button"
                variant="outline"
                onClick={handleGenerateBaseline}
                className="text-xs h-8 px-3 gap-1.5 border-rose-300 dark:border-rose-700 hover:bg-rose-100/50"
              >
                <Sparkles className="w-3.5 h-3.5 text-amber-500" />
                Take Standard Diagnostic Assessment Now
              </Button>
            </div>
          </div>
        )}

        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {/* Source / Course Selection */}
          <div className="space-y-2">
            <label className="text-sm font-medium text-foreground">Course Source Material</label>
            <Select
              value={selectedSourceId}
              onValueChange={(val) => {
                setSelectedSourceId(val);
                if (val !== 'all') {
                  const src = availableSources.find((s) => s.id === val);
                  if (src) {
                    if (src.isNotionPage) {
                      if (src.parentTitle) {
                        setTopic(src.parentTitle);
                        setSubtopic(src.rawTitle);
                      } else {
                        setTopic(src.rawTitle);
                        setSubtopic('');
                      }
                    } else {
                      if (src.resourceData?.folder) {
                        setTopic(src.resourceData.folder);
                      } else if (src.rawTitle) {
                        setTopic(src.rawTitle);
                      }
                    }
                  }
                }
              }}
            >
              <SelectTrigger>
                <SelectValue placeholder="All Uploaded Materials & Notes" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">
                  All Uploaded Course Sources{availableSources.length > 0 ? ` (${availableSources.length})` : ''}
                </SelectItem>
                {availableSources.map((s) => (
                  <SelectItem key={s.id} value={s.id}>
                    <span className="flex items-center gap-1.5">
                      <span>{s.icon || (s.isNotionPage ? '📄' : '📑')}</span>
                      <span>{s.title}</span>
                      <span className="text-[10px] text-muted-foreground uppercase font-mono ml-1">
                        ({s.type})
                      </span>
                    </span>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {availableSources.length === 0 ? (
              <p className="text-xs text-amber-600 dark:text-amber-400 flex items-center gap-1">
                <span>0 sources uploaded.</span>
                <button
                  type="button"
                  onClick={() => navigateToTab('resources')}
                  className="font-medium underline hover:text-amber-700 dark:hover:text-amber-300 inline-flex items-center gap-0.5"
                >
                  Upload textbooks/slides in Resources <ExternalLink className="w-2.5 h-2.5" />
                </button>
              </p>
            ) : (
              <p className="text-xs text-muted-foreground flex items-center gap-1">
                <span className="text-emerald-600 font-semibold">{availableSources.length} source{availableSources.length > 1 ? 's' : ''} available</span>
                <span>• Choose a specific material or keep 'All Uploaded Course Sources'.</span>
              </p>
            )}
          </div>

          {/* Subject / Discipline */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <label className="text-sm font-medium text-foreground flex items-center gap-1.5">
                <BookOpen className="w-4 h-4 text-emerald-600" />
                Subject / Discipline
              </label>
              <span className="text-xs text-muted-foreground">Select or type subject</span>
            </div>
            <div className="flex flex-wrap gap-1.5 mb-1.5">
              {[
                'Operating Systems',
                'Computer Networks',
                'Programming',
                'Machine Learning & AI',
                'Data Structures & Algorithms',
                'Database Management',
                'Mathematics',
                'Physics',
                'Chemistry',
                'Graphic Design'
              ].map((subj) => (
                <Badge
                  key={subj}
                  variant={subject === subj ? 'default' : 'outline'}
                  className={`cursor-pointer text-xs py-1 px-2.5 transition-all ${
                    subject === subj
                      ? 'bg-emerald-600 text-white hover:bg-emerald-700 font-semibold shadow-xs'
                      : 'hover:bg-muted text-muted-foreground hover:text-foreground'
                  }`}
                  onClick={() => {
                    setSubject(subj);
                    localStorage.setItem('studymate_generator_subject', subj);
                    if (!topic) setTopic(subj);
                  }}
                >
                  {subj}
                </Badge>
              ))}
            </div>
            <Input
              value={subject}
              onChange={(e) => {
                setSubject(e.target.value);
                localStorage.setItem('studymate_generator_subject', e.target.value);
              }}
              placeholder="e.g. Operating Systems, Computer Science, Physics..."
            />
          </div>

          {/* Topic */}
          <div className="space-y-2">
            <label className="text-sm font-medium text-foreground">Topic *</label>
            <Input
              value={topic}
              onChange={(e) => setTopic(e.target.value)}
              placeholder="e.g. Operating Systems, Thermodynamics, Linear Algebra..."
            />
            <p className="text-xs text-muted-foreground">The primary subject area to retrieve chunks from.</p>
          </div>

          {/* Subtopic */}
          <div className="space-y-2">
            <label className="text-sm font-medium text-foreground">Subtopic (Optional)</label>
            <Input
              value={subtopic}
              onChange={(e) => setSubtopic(e.target.value)}
              placeholder="e.g. Deadlocks, Banker's Algorithm, Carnot Cycle..."
            />
            <p className="text-xs text-muted-foreground">Optional subtopic to narrow chunk vector similarity search.</p>
          </div>

          {/* Number of Questions */}
          <div className="space-y-2">
            <label className="text-sm font-medium text-foreground">Question Count</label>
            <Select value={String(count)} onValueChange={(val) => setCount(Number(val))}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="3">3 Questions (Quick Knowledge Check)</SelectItem>
                <SelectItem value="5">5 Questions (Standard Diagnostic)</SelectItem>
                <SelectItem value="10">10 Questions (Comprehensive Exam Prep)</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {/* Difficulty */}
          <div className="space-y-2">
            <label className="text-sm font-medium text-foreground">Difficulty Level</label>
            <div className="grid grid-cols-3 gap-2">
              {(['easy', 'medium', 'hard'] as const).map((diff) => (
                <Button
                  key={diff}
                  type="button"
                  variant={difficulty === diff ? 'default' : 'outline'}
                  onClick={() => setDifficulty(diff)}
                  className={`capitalize text-xs h-9 ${
                    difficulty === diff
                      ? diff === 'easy'
                        ? 'bg-emerald-600 hover:bg-emerald-700 text-white'
                        : diff === 'hard'
                        ? 'bg-rose-600 hover:bg-rose-700 text-white'
                        : 'bg-indigo-600 hover:bg-indigo-700 text-white'
                      : ''
                  }`}
                >
                  {diff}
                </Button>
              ))}
            </div>
          </div>

          {/* Question Type */}
          <div className="space-y-2">
            <label className="text-sm font-medium text-foreground">Question Format</label>
            <div className="grid grid-cols-2 gap-2">
              {[
                { type: 'MCQ', label: 'Multiple Choice' },
                { type: 'SHORT_ANSWER', label: 'Short Answer' },
                { type: 'NUMERICAL', label: 'Numerical' },
                { type: 'MIXED', label: 'Mixed Format' },
              ].map((fmt) => (
                <Button
                  key={fmt.type}
                  type="button"
                  variant={questionType === fmt.type ? 'default' : 'outline'}
                  onClick={() => setQuestionType(fmt.type as any)}
                  className="text-xs h-9"
                >
                  {fmt.label}
                </Button>
              ))}
            </div>
          </div>
        </div>

        {/* Action Button */}
        <div className="pt-4 border-t flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
          <div className="text-xs text-muted-foreground flex items-center gap-1.5">
            <ShieldCheck className="w-4 h-4 text-emerald-600 flex-shrink-0" />
            <span>Passes automated verification to eliminate hallucinated questions and repeat duplicates.</span>
          </div>

          <div className="flex flex-wrap items-center gap-2 w-full sm:w-auto justify-end">
            <Button
              type="button"
              variant="outline"
              onClick={handleGenerateBaseline}
              size="lg"
              className="border-indigo-200 text-indigo-700 hover:bg-indigo-50 text-xs px-4 h-10 w-full sm:w-auto"
            >
              <Sparkles className="w-3.5 h-3.5 mr-1.5 text-amber-500" />
              Take Standard Diagnostic Baseline
            </Button>

            <Button
              onClick={handleGenerate}
              disabled={isGenerating || !topic.trim()}
              size="lg"
              className="bg-brand-gradient text-white shadow-glow hover:opacity-95 transition-opacity px-6 h-10 w-full sm:w-auto"
            >
              {isGenerating ? (
                <>
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  Retrieving Evidence & Verifying...
                </>
              ) : (
                <>
                  <Sparkles className="w-4 h-4 mr-2" />
                  Generate Grounded Assessment
                </>
              )}
            </Button>
          </div>
        </div>
      </Card>

      {/* Recent Assessment Attempts History */}
      {attemptGroups.length > 0 && (
        <Card className="p-6 space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="text-base font-semibold text-foreground flex items-center gap-2">
              <History className="w-4 h-4 text-indigo-600" />
              Recent Assessment History & Diagnostic Reports
            </h3>
            <Badge variant="outline" className="text-xs text-muted-foreground font-normal">
              {attemptGroups.length} Assessment{attemptGroups.length > 1 ? 's' : ''} ({history.length} Attempt{history.length > 1 ? 's' : ''})
            </Badge>
          </div>

          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            {attemptGroups.map((group) => {
              const isMultiple = group.attempts.length > 1;
              const latest = group.latestAttempt;

              return (
                <Card
                  key={group.key}
                  className="p-4 border bg-gray-50/60 dark:bg-card space-y-3 shadow-xs hover:border-indigo-300 transition-all flex flex-col justify-between"
                >
                  <div className="space-y-3">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0 flex-1">
                        <h4 className="font-semibold text-sm text-foreground truncate" title={group.title}>
                          {group.title}
                        </h4>
                        <p className="text-xs text-muted-foreground truncate">
                          {group.topic} {group.subtopic ? `• ${group.subtopic}` : ''}
                        </p>
                      </div>

                      {isMultiple ? (
                        <Badge
                          variant="outline"
                          className={
                            group.bestScore >= 80
                              ? 'border-emerald-300 text-emerald-700 bg-emerald-50 dark:bg-emerald-950/40 dark:text-emerald-300 text-xs font-semibold shrink-0'
                              : group.bestScore >= 60
                              ? 'border-amber-300 text-amber-700 bg-amber-50 dark:bg-amber-950/40 dark:text-amber-300 text-xs font-semibold shrink-0'
                              : 'border-rose-300 text-rose-700 bg-rose-50 dark:bg-rose-950/40 dark:text-rose-300 text-xs font-semibold shrink-0'
                          }
                        >
                          Best Score: {group.bestScore}%
                        </Badge>
                      ) : (
                        <Badge
                          variant="outline"
                          className={
                            latest.percentage >= 80
                              ? 'border-emerald-300 text-emerald-700 bg-emerald-50 dark:bg-emerald-950/40 dark:text-emerald-300 shrink-0'
                              : latest.percentage >= 60
                              ? 'border-amber-300 text-amber-700 bg-amber-50 dark:bg-amber-950/40 dark:text-amber-300 shrink-0'
                              : 'border-rose-300 text-rose-700 bg-rose-50 dark:bg-rose-950/40 dark:text-rose-300 shrink-0'
                          }
                        >
                          {latest.percentage}%
                        </Badge>
                      )}
                    </div>

                    {!isMultiple ? (
                      <div className="flex items-center justify-between text-xs text-muted-foreground pt-2 border-t border-border/60">
                        <span className="flex items-center gap-1 font-medium">
                          <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" />
                          Score: {latest.score}/{latest.totalQuestions}
                        </span>
                        <span className="text-[11px] text-muted-foreground">
                          Date: {new Date(latest.completedAt).toLocaleDateString()}
                        </span>
                      </div>
                    ) : (
                      <div className="pt-2 border-t border-border/60 space-y-1 text-xs">
                        <div className="space-y-1 max-h-28 overflow-y-auto pr-1">
                          {group.attempts.map((att, idx) => {
                            const attemptNumber = group.attempts.length - idx;
                            return (
                              <div
                                key={att.id}
                                onClick={() => handleOpenAnalytics(group, att)}
                                className="flex items-center justify-between py-1 px-1.5 rounded-md hover:bg-muted/80 cursor-pointer transition-colors text-muted-foreground text-[11px]"
                                title="Click to view analytics for this attempt"
                              >
                                <span className="font-medium text-foreground">
                                  Attempt {attemptNumber}
                                </span>
                                <div className="flex items-center gap-2">
                                  <span
                                    className={`font-semibold ${
                                      att.percentage >= 80
                                        ? 'text-emerald-600'
                                        : att.percentage >= 60
                                        ? 'text-amber-600'
                                        : 'text-rose-600'
                                    }`}
                                  >
                                    {att.percentage}%
                                  </span>
                                  <span>—</span>
                                  <span>{new Date(att.completedAt).toLocaleDateString()}</span>
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    )}
                  </div>

                  <div className="flex items-center gap-2 pt-2 border-t border-border/60 mt-auto">
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => handleOpenAnalytics(group, latest)}
                      className="flex-1 h-8 text-xs gap-1.5 hover:bg-indigo-50 hover:text-indigo-700 dark:hover:bg-indigo-950/40"
                    >
                      <TrendingUp className="w-3.5 h-3.5 text-indigo-600" />
                      View Analytics
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => handleRetakeAssessment(group, latest)}
                      className="flex-1 h-8 text-xs gap-1.5 hover:bg-primary/10 hover:text-primary"
                    >
                      <RotateCcw className="w-3.5 h-3.5 text-primary" />
                      Retake
                    </Button>
                  </div>
                </Card>
              );
            })}
          </div>
        </Card>
      )}

      {/* Dedicated Assessment Analytics Modal */}
      <AssessmentAnalyticsModal
        isOpen={isAnalyticsOpen}
        onClose={() => setIsAnalyticsOpen(false)}
        group={analyticsModalGroup}
        selectedAttempt={analyticsModalAttempt}
        userId={user?.user_id || user?.id || 'default_user'}
        onRetake={(att) => {
          if (analyticsModalGroup) {
            handleRetakeAssessment(analyticsModalGroup, att);
          }
        }}
      />
    </div>
  );
};
