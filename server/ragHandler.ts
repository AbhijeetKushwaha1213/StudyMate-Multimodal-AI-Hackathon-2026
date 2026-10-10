import { execFile } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs/promises';
import crypto from 'node:crypto';
import { prisma, ensureResourceSchema, ensureAssessmentSchema, ensureLearnerSchema, upsertIngestionRecord, updateIngestionStatus, getIngestionRecord } from './prisma.ts';
import { validateUploadedBuffer, validateFileOnDisk, sanitizeAndAssertPath, ValidationError } from './fileValidator.ts';
import { updateMasteryFromEvidence, getTopicLearnerMastery } from './bktService.ts';
import { processAssessmentIntelligence, getUserMisconceptions, getAttemptDiagnostic } from './assessmentIntelligenceService.ts';
import { learnerHandler } from './learnerHandler.ts';
import { studyAgentHandler } from './studyAgentHandler.ts';
import { evaluationHandler } from './evaluationHandler.ts';
import { resolveContextUser, checkRateLimit } from './authMiddleware.ts';
import { serverReadCache } from './serverCache.ts';
import { verifyGroundedAnswer, buildCanonicalEvidenceIndex } from './citationVerifier.ts';
import { verifyNumericalQuestion, normalizeCorrectAnswer, computeNumericalFingerprint } from './numericalVerifier.ts';
import { validateQuestionIntegrity } from './robustAnswerVerifier.ts';
import { validateHardenedQuestionBatch, computeQuestionFingerprint } from './questionQualityValidator.ts';
import type { NumericalQuestion } from './assessmentTypes.ts';
import { DEFAULT_TOLERANCE } from './assessmentTypes.ts';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PROJECT_ROOT = path.resolve(__dirname, '..');
const PYTHON_PATH = path.join(PROJECT_ROOT, '.venv', 'bin', 'python');
const RAG_ENGINE_PATH = path.join(PROJECT_ROOT, 'server', 'rag_engine.py');
const UPLOADS_DIR = path.join(PROJECT_ROOT, 'server', 'uploads');

export function computeDocumentFingerprint(userId: string, content: string, version = 'v1'): string {
  const hash = crypto.createHash('sha256').update(content).digest('hex');
  return `${userId}:${hash}:${version}`;
}

type HeaderValue = string | string[] | undefined;

export type RagApiRequest = {
  method?: string;
  headers: Record<string, HeaderValue>;
  query?: Record<string, string | undefined>;
  url?: string;
  body?: any;
};

export type RagApiResponse = {
  status: (code: number) => RagApiResponse;
  json: (body: unknown) => void;
  setHeader: (name: string, value: string) => void;
  end: (body?: string) => void;
};

const RAG_TIMEOUT_MS = Number(process.env.RAG_TIMEOUT_MS || 45000);

/**
 * Concurrency limiter queue for heavy child processes.
 * Prevents OS process table exhaustion and CPU/memory starvation under load.
 */
export class ProcessConcurrencyLimiter {
  private maxConcurrent: number;
  private maxQueueSize: number;
  private running = 0;
  private queue: Array<{
    task: () => Promise<any>;
    resolve: (val: any) => void;
    reject: (err: any) => void;
    enqueuedAt: number;
  }> = [];
  private totalProcessed = 0;
  private totalRejected = 0;

  constructor(maxConcurrent = 8, maxQueueSize = 64) {
    this.maxConcurrent = maxConcurrent;
    this.maxQueueSize = maxQueueSize;
  }

  getStats() {
    return {
      running: this.running,
      queued: this.queue.length,
      maxConcurrent: this.maxConcurrent,
      maxQueueSize: this.maxQueueSize,
      totalProcessed: this.totalProcessed,
      totalRejected: this.totalRejected,
    };
  }

  async run<T>(task: () => Promise<T>): Promise<T> {
    if (this.running < this.maxConcurrent) {
      this.running++;
      try {
        const result = await task();
        this.totalProcessed++;
        return result;
      } finally {
        this.running--;
        this.dispatchNext();
      }
    }

    if (this.queue.length >= this.maxQueueSize) {
      this.totalRejected++;
      throw new Error(`Process concurrency capacity exceeded: queue limit of ${this.maxQueueSize} reached`);
    }

    return new Promise<T>((resolve, reject) => {
      this.queue.push({
        task,
        resolve,
        reject,
        enqueuedAt: Date.now(),
      });
    });
  }

  private dispatchNext() {
    if (this.running >= this.maxConcurrent || this.queue.length === 0) {
      return;
    }
    const nextItem = this.queue.shift();
    if (!nextItem) return;

    this.running++;
    nextItem.task()
      .then((val) => {
        this.totalProcessed++;
        nextItem.resolve(val);
      })
      .catch((err) => {
        nextItem.reject(err);
      })
      .finally(() => {
        this.running--;
        this.dispatchNext();
      });
  }

  clearQueue() {
    while (this.queue.length > 0) {
      const item = this.queue.shift();
      if (item) {
        this.totalRejected++;
        item.reject(new Error('Process queue cleared'));
      }
    }
  }
}

export const ragProcessLimiter = new ProcessConcurrencyLimiter(
  Number(process.env.RAG_MAX_CONCURRENT_PROCESSES || 8),
  Number(process.env.RAG_MAX_QUEUE_SIZE || 64)
);

export function runPythonCli(args: string[], timeoutMs = RAG_TIMEOUT_MS): Promise<any> {
  return ragProcessLimiter.run(() => {
    return new Promise((resolve, reject) => {
      execFile(
        PYTHON_PATH,
        [RAG_ENGINE_PATH, ...args],
        {
          cwd: PROJECT_ROOT,
          timeout: timeoutMs,
          env: {
            ...process.env,
            PYTHONUNBUFFERED: '1',
          },
          maxBuffer: 10 * 1024 * 1024,
        },
        (error, stdout, stderr) => {
          if (error) {
            if ((error as any).killed || error.signal === 'SIGTERM') {
              return reject(new Error(`RAG Engine execution timed out after ${timeoutMs}ms`));
            }
            console.error('RAG Engine error:', stderr || error.message);
            return reject(new Error(stderr || error.message));
          }

          try {
            // Extract JSON output (ignore warnings before JSON)
            const jsonStartIndex = stdout.indexOf('{');
            if (jsonStartIndex === -1) {
              return resolve({ raw: stdout.trim() });
            }
            const jsonText = stdout.slice(jsonStartIndex).trim();
            const parsed = JSON.parse(jsonText);
            resolve(parsed);
          } catch (parseError) {
            console.error('JSON parse error from RAG Engine output:', stdout);
            resolve({ raw: stdout.trim() });
          }
        }
      );
    });
  });
}


export async function ragHandler(req: RagApiRequest, res: RagApiResponse) {
  const method = req.method?.toUpperCase() || 'GET';
  const urlObj = new URL(req.url || '/', 'http://127.0.0.1:3001');
  const pathname = urlObj.pathname.replace(/\/+$/, '');

  // 1. Ingest / Upload Source
  // POST /api/rag/ingest
  if (method === 'POST' && pathname === '/api/rag/ingest') {
    const rateCheck = checkRateLimit(req as any, 'ingest');
    if (!rateCheck.allowed) {
      res.setHeader('Retry-After', String(rateCheck.retryAfterSec));
      res.setHeader('X-RateLimit-Limit', String(rateCheck.limit));
      res.setHeader('X-RateLimit-Remaining', String(rateCheck.remaining));
      res.status(429).json({
        error: 'Rate limit exceeded for ingestion requests. Please try again later.',
        retryAfterSec: rateCheck.retryAfterSec,
      });
      return;
    }

    try {
      const body = req.body || {};
      const userId = await resolveContextUser(req);
      const topic = body.topic || 'General';
      const subtopic = body.subtopic || 'Main';
      let sourceType = (body.sourceType || body.type || 'TEXT').toUpperCase();
      let filePath = body.filePath || body.url || body.fileUrl;

      // Owner-scoped upload directory
      const userUploadsDir = path.join(UPLOADS_DIR, userId);
      await fs.mkdir(userUploadsDir, { recursive: true });

      const rawContentToHash = body.base64Data || body.text || body.url || filePath || '';
      const contentFingerprint = crypto.createHash('sha256').update(rawContentToHash).digest('hex').slice(0, 16);

      // Idempotency: Check if this user already uploaded this source
      await ensureResourceSchema();
      const existingResource = await prisma.resource.findFirst({
        where: {
          userId,
          title: body.title || (body.fileName ? body.fileName : undefined),
        },
      });

      if (existingResource && !body.forceReprocess && !body.base64Data) {
        const existingRecord = await getIngestionRecord(existingResource.id, userId);
        res.status(200).json({
          success: true,
          jobId: `existing_${existingResource.id}`,
          sourceId: existingResource.id,
          documentId: existingResource.id,
          sourceType: existingResource.type,
          topic,
          subtopic,
          chunkCount: existingRecord?.chunkCount || 0,
          isExisting: true,
          message: 'Source already ingested for this user (idempotent)',
          previewChunks: [],
          lifecycleStatus: existingRecord?.status || 'COMPLETED',
        });
        return;
      }

      // If binary or base64 file provided, perform strict magic-byte and MIME validation
      if (body.base64Data && body.fileName) {
        const buffer = Buffer.from(body.base64Data, 'base64');
        const validation = validateUploadedBuffer(buffer, body.fileName);
        sourceType = validation.sourceType;

        const safeFilename = path.basename(body.fileName).replace(/[^a-zA-Z0-9._-]/g, '_');
        const tempName = `${Date.now()}_${contentFingerprint.slice(0, 8)}_${safeFilename}`;
        filePath = sanitizeAndAssertPath(userUploadsDir, tempName);
        await fs.writeFile(filePath, buffer);
      } else if (body.text) {
        // Plain text ingestion
        const tempName = `text_${Date.now()}_${contentFingerprint.slice(0, 8)}.txt`;
        filePath = sanitizeAndAssertPath(userUploadsDir, tempName);
        await fs.writeFile(filePath, body.text, 'utf8');
        sourceType = 'TEXT';
      } else if (filePath && !filePath.startsWith('http')) {
        // Validate local file on disk
        const validation = await validateFileOnDisk(filePath, body.fileName);
        sourceType = validation.sourceType;
      }

      if (!filePath) {
        res.status(400).json({ error: 'Missing file, filePath, base64Data, or source url' });
        return;
      }

      const jobId = `job_${crypto.randomUUID().replace(/-/g, '').slice(0, 12)}`;
      const sourceId = body.sourceId || `src_${crypto.randomUUID().replace(/-/g, '').slice(0, 12)}`;
      const documentId = body.documentId || `doc_${crypto.randomUUID().replace(/-/g, '').slice(0, 12)}`;

      // Record lifecycle state as PROCESSING
      await upsertIngestionRecord({
        resourceId: documentId,
        userId,
        tenantType: 'USER_PRIVATE',
        documentId,
        sourceType,
        status: 'PROCESSING',
        contentHash: contentFingerprint,
      });

      // Save metadata in SQLite database via Prisma
      try {
        await ensureResourceSchema();
        await prisma.resource.create({
          data: {
            id: documentId,
            userId,
            title: body.title || path.basename(filePath),
            description: body.description || `Ingested ${sourceType} source for ${topic}`,
            type: sourceType,
            fileUrl: filePath.startsWith('http') ? filePath : null,
            storagePath: filePath,
            folder: topic,
            tagsJson: JSON.stringify([topic, subtopic, sourceType]),
          }
        });
      } catch (dbError) {
        console.warn('Could not record resource in database, continuing ingestion:', dbError);
      }

      // Execute ingestion
      const args = [
        'ingest',
        '--file', filePath,
        '--type', sourceType,
        '--user-id', userId,
        '--topic', topic,
        '--subtopic', subtopic,
        '--source-id', sourceId,
        '--document-id', documentId,
        '--job-id', jobId,
      ];

      if (body.transcript) {
        args.push('--transcript', String(body.transcript));
      }

      const result = await runPythonCli(args);
      const isSuccess = result.status === 'completed' || result.lifecycle_status === 'COMPLETED';
      const chunkCount = result.chunk_count || (result.document?.chunks?.length) || 0;
      const finalStatus = isSuccess ? (chunkCount > 0 ? 'COMPLETED' : 'PARTIAL') : 'FAILED';

      // Update canonical lifecycle state in DB
      await updateIngestionStatus(documentId, userId, finalStatus, {
        chunkCount,
        metricsJson: JSON.stringify(result.document?.metrics || result.metrics || {}),
        error: isSuccess ? null : (result.error || 'Ingestion completed with failures'),
      });

      if (isSuccess) {
        serverReadCache.invalidateUser(userId);
      }

      res.status(200).json({
        success: isSuccess,
        jobId,
        sourceId,
        documentId,
        sourceType,
        topic,
        subtopic,
        chunkCount,
        previewChunks: result.preview_chunks || [],
        lifecycleStatus: finalStatus,
        details: result,
      });
      return;
    } catch (err: any) {
      if (err instanceof ValidationError || err.name === 'ValidationError') {
        res.status(err.statusCode || 400).json({
          error: err.message,
          code: err.code || 'VALIDATION_ERROR',
        });
        return;
      }
      const isCapacityError = err.message && err.message.includes('capacity exceeded');
      const statusCode = isCapacityError ? 503 : 500;
      if (isCapacityError) {
        res.setHeader('Retry-After', '5');
      }
      console.error('Ingest error:', err);
      res.status(statusCode).json({ error: err.message || 'Ingestion failed' });
      return;
    }
  }

  // 1.1 Ingestion Lifecycle Status Record
  // GET /api/rag/lifecycle?resourceId=... or /api/rag/lifecycle/:id
  if (method === 'GET' && pathname.startsWith('/api/rag/lifecycle')) {
    try {
      const userId = await resolveContextUser(req);
      const segments = pathname.split('/').filter(Boolean);
      const resourceId = segments[3] || req.query?.resourceId || req.query?.id;
      if (!resourceId) {
        res.status(400).json({ error: 'resourceId parameter is required' });
        return;
      }
      const record = await getIngestionRecord(String(resourceId), userId);
      if (!record) {
        res.status(404).json({ error: 'Ingestion record not found for this tenant' });
        return;
      }
      res.status(200).json(record);
      return;
    } catch (err: any) {
      res.status(500).json({ error: err.message || 'Failed to retrieve lifecycle record' });
      return;
    }
  }

  // 2. Get Processing Status
  // GET /api/rag/status?jobId=... or /api/rag/status/:id
  if (method === 'GET' && pathname.startsWith('/api/rag/status')) {
    const segments = pathname.split('/').filter(Boolean);
    const jobId = segments[3] || req.query?.jobId || req.query?.id;
    if (!jobId) {
      res.status(400).json({ error: 'jobId query parameter is required' });
      return;
    }
    const statusData = await runPythonCli(['status', '--job-id', jobId]);
    res.status(200).json(statusData);
    return;
  }

  // 3. Search Relevant Chunks
  // POST /api/rag/search or GET /api/rag/search?query=...
  if ((method === 'POST' || method === 'GET') && pathname === '/api/rag/search') {
    const rateCheck = checkRateLimit(req as any, 'rag');
    if (!rateCheck.allowed) {
      res.setHeader('Retry-After', String(rateCheck.retryAfterSec));
      res.setHeader('X-RateLimit-Limit', String(rateCheck.limit));
      res.setHeader('X-RateLimit-Remaining', String(rateCheck.remaining));
      res.status(429).json({
        error: 'Rate limit exceeded for search requests. Please try again later.',
        retryAfterSec: rateCheck.retryAfterSec,
      });
      return;
    }

    const query = method === 'POST' ? req.body?.query : (req.query?.query || req.query?.q);
    if (!query) {
      res.status(400).json({ error: 'Query string is required' });
      return;
    }

    try {
      const userId = await resolveContextUser(req);
      const sourceId = method === 'POST' ? req.body?.sourceId : req.query?.sourceId;
      const topic = method === 'POST' ? req.body?.topic : req.query?.topic;
      const subtopic = method === 'POST' ? req.body?.subtopic : req.query?.subtopic;
      const topK = method === 'POST' ? (req.body?.topK || 5) : (Number(req.query?.topK || 5));
      const similarityThreshold = method === 'POST' 
        ? (req.body?.similarityThreshold ?? req.body?.minScore)
        : (req.query?.similarityThreshold ?? req.query?.minScore);
      const maxPerSource = method === 'POST' ? req.body?.maxPerSource : req.query?.maxPerSource;

      const args = ['search', '--query', String(query), '--top-k', String(topK)];
      if (userId) args.push('--user-id', String(userId));
      if (sourceId) args.push('--source-id', String(sourceId));
      if (topic) args.push('--topic', String(topic));
      if (subtopic) args.push('--subtopic', String(subtopic));
      if (similarityThreshold !== undefined && similarityThreshold !== null) {
        args.push('--similarity-threshold', String(similarityThreshold));
      }
      if (maxPerSource !== undefined && maxPerSource !== null) {
        args.push('--max-per-source', String(maxPerSource));
      }

      const searchResults = await runPythonCli(args);
      
      // Provide both snake_case and camelCase diagnostics
      const augmentedResults = {
        ...searchResults,
        candidateCount: searchResults?.candidate_count ?? searchResults?.results?.length ?? 0,
        finalEvidenceCount: searchResults?.final_evidence_count ?? searchResults?.results?.length ?? 0,
        similarityScores: searchResults?.similarity_scores ?? (searchResults?.results || []).map((r: any) => r.score),
        selectedSourceIds: searchResults?.selected_source_ids ?? [],
        discardedChunks: searchResults?.discarded_chunks ?? [],
      };

      res.status(200).json(augmentedResults);
      return;
    } catch (err: any) {
      const isCapacityError = err.message && err.message.includes('capacity exceeded');
      const statusCode = isCapacityError ? 503 : 500;
      if (isCapacityError) {
        res.setHeader('Retry-After', '5');
      }
      res.status(statusCode).json({ error: err.message || 'Search execution failed' });
      return;
    }
  }

  // 4. Return Specific Chunk Metadata
  // GET /api/rag/chunk?id=... or /api/rag/chunk/:chunkId
  if (method === 'GET' && pathname.startsWith('/api/rag/chunk')) {
    const segments = pathname.split('/').filter(Boolean);
    const chunkId = segments[3] || req.query?.id || req.query?.chunkId;
    if (!chunkId) {
      res.status(400).json({ error: 'chunkId parameter is required' });
      return;
    }
    const chunkData = await runPythonCli(['chunk', '--id', String(chunkId)]);
    res.status(chunkData.found ? 200 : 404).json(chunkData);
    return;
  }

  // 5. Retrieve Source Location
  // GET /api/rag/source-location?id=... or /api/rag/source-location/:chunkId
  if (method === 'GET' && pathname.startsWith('/api/rag/source-location')) {
    const segments = pathname.split('/').filter(Boolean);
    const chunkId = segments[3] || req.query?.id || req.query?.chunkId;
    if (!chunkId) {
      res.status(400).json({ error: 'chunkId parameter is required' });
      return;
    }
    const locationData = await runPythonCli(['source-location', '--id', String(chunkId)]);
    res.status(locationData.error ? 404 : 200).json(locationData);
    return;
  }

  // 6. Source-Grounded AI Tutor Chat
  // POST /api/rag/chat or GET /api/rag/chat
  if ((method === 'POST' || method === 'GET') && pathname === '/api/rag/chat') {
    const query = method === 'POST' ? (req.body?.query || req.body?.message) : (req.query?.query || req.query?.q);
    if (!query) {
      res.status(400).json({ error: 'Query or message string is required' });
      return;
    }

    const userId = await resolveContextUser(req);
    const topic = method === 'POST' ? req.body?.topic : req.query?.topic;
    const history = method === 'POST' ? (req.body?.conversationHistory || req.body?.history) : undefined;
    let learnerState = method === 'POST' ? (req.body?.learnerState || req.body?.learner_state) : undefined;

    if (!learnerState && userId && topic) {
      try {
        const masteryRec = await getTopicLearnerMastery(String(userId), String(topic));
        if (masteryRec) {
          learnerState = {
            topic: masteryRec.topic,
            mastery_probability: masteryRec.masteryProbability,
            mastery_percentage: masteryRec.masteryPercentage,
            attempts: masteryRec.attempts,
            confidence: masteryRec.confidence,
            status: masteryRec.status,
          };
        }
      } catch (err) {
        // Silently skip if DB not initialized
      }
    }

    const language = method === 'POST' ? (req.body?.language || req.body?.lang) : (req.query?.language || req.query?.lang);
    const sourceId = method === 'POST' ? (req.body?.sourceId || req.body?.source_id) : (req.query?.sourceId || req.query?.source_id);

    const args = ['chat', '--query', String(query)];
    if (userId) args.push('--user-id', String(userId));
    if (sourceId) args.push('--source-id', String(sourceId));
    if (topic) args.push('--topic', String(topic));
    if (history) args.push('--history', JSON.stringify(history));
    if (learnerState) args.push('--learner-state', JSON.stringify(learnerState));
    if (language) args.push('--language', String(language));

    const chatResponse = await runPythonCli(args);

    // Canonical Phase 3 Step 3: Deterministic Citation & Claim Verification Engine
    // Zero-trust server-side verification: Revalidates claims, coordinates, tenant isolation, and evidence references.
    if (chatResponse && chatResponse.response) {
      const retrievedItems = Array.isArray(chatResponse.evidence_index)
        ? chatResponse.evidence_index
        : Array.isArray(chatResponse.retrieved_chunks)
        ? chatResponse.retrieved_chunks
        : [];

      const evidenceIndex = buildCanonicalEvidenceIndex(retrievedItems, userId || 'system_public');
      const groundedContract = await verifyGroundedAnswer(
        {
          answer: chatResponse.response || '',
          proposedCitations: Array.isArray(chatResponse.citations) ? chatResponse.citations : [],
        },
        {
          authenticatedUserId: userId || 'system_public',
          evidenceIndex,
        }
      );

      chatResponse.grounded_contract = groundedContract;
      chatResponse.claims = groundedContract.claims;
      chatResponse.citations = groundedContract.citations;
      chatResponse.unsupported_claims = groundedContract.unsupported_claims;
      chatResponse.grounded = groundedContract.grounded;
      chatResponse.coverage_score = groundedContract.coverage_score;
      chatResponse.citation_verification = {
        totalCited: groundedContract.citations.length,
        verified: groundedContract.citations.filter((c: any) => c.verification_status === 'VERIFIED').length,
        dropped: groundedContract.citations.filter((c: any) => c.verification_status !== 'VERIFIED').length,
      };
    }

    res.status(200).json(chatResponse);
    return;
  }

  // 7. Grounded Adaptive Assessment Generation (Phase 3 & 7 Deduplication)
  // POST /api/rag/assessment/generate
  if (method === 'POST' && pathname === '/api/rag/assessment/generate') {
    try {
      await ensureAssessmentSchema();
      const body = req.body || {};
      const topic = body.topic;
      const userId = await resolveContextUser(req);
      if (!topic) {
        res.status(400).json({ error: 'Topic is required for assessment generation' });
        return;
      }

      const subtopic = body.subtopic;
      const subject = body.subject;
      const difficulty = body.difficulty || 'medium';
      const count = Number(body.count || 5);
      const questionType = body.questionType || body.type || 'MCQ';
      const sourceId = body.sourceId;
      const assessmentId = body.assessmentId || body.assessment_id || `asmt_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;

      // 1. Fetch existing question fingerprints and stems across all past assessments
      let existingFps: string[] = [];
      let existingQuestions: string[] = [];
      try {
        const rows: any[] = await prisma.$queryRawUnsafe(
          'SELECT fingerprint, question, normalizedQuestion FROM assessment_questions WHERE userId = ? AND topic = ?',
          userId,
          topic
        );
        existingFps = rows.map((r: any) => r.fingerprint).filter(Boolean);
        existingQuestions = rows.map((r: any) => r.normalizedQuestion || r.question).filter(Boolean);
      } catch (dbErr) {
        console.warn('Could not query existing questions from DB:', dbErr);
      }

      // 2. Call RAG engine with verification pass and deduplication
      const args = [
        'assessment-generate',
        '--topic',
        String(topic),
        '--user-id',
        String(userId),
        '--difficulty',
        String(difficulty),
        '--count',
        String(count),
        '--type',
        String(questionType),
        '--assessment-id',
        assessmentId,
      ];
      if (subject) args.push('--subject', String(subject));
      if (subtopic) args.push('--subtopic', String(subtopic));
      if (sourceId) args.push('--source-id', String(sourceId));
      if (existingFps.length > 0) args.push('--fingerprints', JSON.stringify(existingFps));
      if (existingQuestions.length > 0) args.push('--existing-questions', JSON.stringify(existingQuestions));

      const genResult = await runPythonCli(args);

      if (!genResult.success && genResult.error) {
        res.status(400).json(genResult);
        return;
      }

      // 3. Phase 4 Step 3: Server-side hardened question quality, ambiguity, topic relevance, and deduplication verification
      const rawQuestions = genResult.questions || [];
      const validationContext = {
        authenticated_user_id: String(userId),
        require_grounding: Boolean(sourceId),
        existing_fingerprints: existingFps,
        existing_questions: existingQuestions.map((q) => ({ question: q })),
        subject: subject ? String(subject) : undefined,
        topic: String(topic),
        subtopic: subtopic ? String(subtopic) : undefined,
      };

      const batchValidation = await validateHardenedQuestionBatch(rawQuestions, validationContext);
      const questions = batchValidation.valid_questions;
      const quarantined = batchValidation.quarantined_questions;

      if (quarantined.length > 0) {
        console.warn(`Phase 4 Step 3: Quarantined ${quarantined.length} question(s) failing quality/ambiguity/topic relevance validation:`,
          quarantined.map(r => ({
            q: r.question?.question?.substring(0, 60),
            status: r.validation?.status,
            errors: r.validation?.errors || [],
            warnings: r.validation?.warnings || []
          }))
        );
      }

      // If no valid, reliable questions remain, fail safely with an actionable error rather than delivering generic boilerplate
      if (questions.length === 0) {
        const topicPath = subject ? `${subject} → ${topic}` : topic;
        res.status(422).json({
          success: false,
          error: `Could not generate enough reliable questions for ${topicPath}. Try adding course notes or retrying with a narrower subtopic.`,
          questions: [],
        });
        return;
      }

      // 4. Persist valid generated questions into assessment_questions table with full deduplication metadata
      for (const q of questions) {
        try {
          await prisma.$executeRawUnsafe(
            `INSERT INTO assessment_questions (id, userId, assessmentId, fingerprint, normalizedQuestion, type, topic, subtopic, difficulty, sourceId, chunkId, pageNumber, slideNumber, timestampStart, timestampEnd, question, optionsJson, correctAnswer, explanation)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            q.question_id || `q_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
            userId,
            assessmentId,
            q.fingerprint || '',
            q.normalized_question || q.question.toLowerCase().trim(),
            q.type || 'MCQ',
            q.topic || topic,
            q.subtopic || null,
            q.difficulty || difficulty,
            q.source_id || null,
            q.chunk_id || null,
            q.page_number ?? null,
            q.slide_number ?? null,
            q.timestamp_start ?? null,
            q.timestamp_end ?? null,
            q.question,
            JSON.stringify(q.options || []),
            String(q.correct_answer),
            q.explanation || ''
          );
        } catch (insertErr) {
          console.warn('Could not save generated question record:', insertErr);
        }
      }

      res.status(200).json({
        success: true,
        assessmentId,
        topic,
        subtopic,
        difficulty,
        totalQuestions: questions.length,
        questions,
      });
      return;
    } catch (err: any) {
      console.error('Assessment generation error:', err);
      res.status(500).json({ error: 'Failed to generate assessment', details: err.message });
      return;
    }
  }

  // 8. Assessment Submission & Diagnostic Report Evaluation (Phase 9 Intelligence)
  // POST /api/rag/assessment/submit
  if (method === 'POST' && pathname === '/api/rag/assessment/submit') {
    try {
      await ensureAssessmentSchema();
      await ensureLearnerSchema();
      const body = req.body || {};
      const userId = await resolveContextUser(req);
      const title = body.title || 'Course Assessment';
      const topic = body.topic || 'General';
      const subtopic = body.subtopic;
      const difficulty = body.difficulty || 'medium';
      const questions: any[] = body.questions || [];
      const answers: any[] = Array.isArray(body.answers) ? body.answers : Object.values(body.answers || {});

      if (!questions.length) {
        res.status(400).json({ error: 'Questions array is required for assessment submission' });
        return;
      }

      // Zero-Trust: Resolve authoritative question data from database if stored,
      // preventing client tampering with answer keys, score, or options.
      const authoritativeQuestions = await Promise.all(
        questions.map(async (q) => {
          const qId = q.question_id || q.id;
          if (qId) {
            try {
              const dbRows: any[] = await prisma.$queryRawUnsafe(
                'SELECT * FROM assessment_questions WHERE id = ? AND userId = ? LIMIT 1',
                qId,
                userId
              );
              if (dbRows && dbRows.length > 0) {
                const row = dbRows[0];
                let opts = q.options;
                if (row.optionsJson) {
                  try { opts = JSON.parse(row.optionsJson); } catch {}
                }
                return {
                  ...q,
                  type: row.type || q.type,
                  question: row.question || q.question,
                  options: opts,
                  correct_answer: row.correctAnswer,
                  correctAnswer: row.correctAnswer,
                  explanation: row.explanation || q.explanation,
                  source_id: row.sourceId || q.source_id,
                  chunk_id: row.chunkId || q.chunk_id,
                  page_number: row.pageNumber ?? q.page_number,
                  slide_number: row.slideNumber ?? q.slide_number,
                  timestamp_start: row.timestampStart ?? q.timestamp_start,
                  timestamp_end: row.timestampEnd ?? q.timestamp_end,
                };
              }
            } catch {}
          }
          return q;
        })
      );

      const attemptId = `att_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
      const { results, diagnosticReport } = await processAssessmentIntelligence({
        userId,
        title,
        topic,
        subtopic,
        difficulty,
        questions: authoritativeQuestions,
        answers,
        attemptId,
      });

      // Persist attempt into assessment_attempts table
      try {
        await prisma.$executeRawUnsafe(
          `INSERT INTO assessment_attempts (id, userId, title, topic, subtopic, difficulty, score, totalQuestions, correctCount, percentage, questionsJson, answersJson, diagnosticJson)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          attemptId,
          userId,
          title,
          topic,
          subtopic || null,
          difficulty,
          diagnosticReport.correctCount,
          diagnosticReport.totalQuestions,
          diagnosticReport.correctCount,
          diagnosticReport.percentage,
          JSON.stringify(questions),
          JSON.stringify(answers),
          JSON.stringify(diagnosticReport)
        );
      } catch (dbErr) {
        console.warn('Could not persist assessment attempt into database:', dbErr);
      }

      res.status(200).json({
        success: true,
        attemptId,
        score: diagnosticReport.correctCount,
        totalQuestions: diagnosticReport.totalQuestions,
        percentage: diagnosticReport.percentage,
        results,
        diagnosticReport,
      });
      return;
    } catch (err: any) {
      console.error('Assessment evaluation error:', err);
      res.status(500).json({ error: 'Failed to evaluate assessment', details: err.message });
      return;
    }
  }

  // 8b. Active Misconceptions & Repeated Mistakes (Phase 9)
  // GET /api/rag/assessment/misconceptions?userId=...
  if (method === 'GET' && pathname === '/api/rag/assessment/misconceptions') {
    try {
      const userId = await resolveContextUser(req);
      const topic = req.query?.topic || urlObj.searchParams.get('topic') || undefined;
      const data = await getUserMisconceptions(userId, topic);
      res.status(200).json({ success: true, ...data });
      return;
    } catch (err: any) {
      res.status(500).json({ error: 'Failed to retrieve misconceptions', details: err.message });
      return;
    }
  }

  // 8c. Diagnostic Report by Attempt ID (Phase 9)
  // GET /api/rag/assessment/diagnostic?attemptId=... or /api/rag/assessment/diagnostic/:attemptId
  if (method === 'GET' && (pathname.startsWith('/api/rag/assessment/diagnostic') || pathname === '/api/rag/assessment/diagnostic')) {
    try {
      const parts = pathname.split('/');
      // /api/rag/assessment/diagnostic -> parts: ['', 'api', 'rag', 'assessment', 'diagnostic'] (length 5)
      // /api/rag/assessment/diagnostic/:attemptId -> parts: ['', 'api', 'rag', 'assessment', 'diagnostic', ':attemptId'] (length 6)
      const pathAttemptId = parts.length > 5 ? parts[5] : null;
      const attemptId = pathAttemptId || req.query?.attemptId || req.query?.id || urlObj.searchParams.get('attemptId') || urlObj.searchParams.get('id');
      if (!attemptId) {
        res.status(400).json({ error: 'attemptId is required' });
        return;
      }
      const userId = await resolveContextUser(req);
      const diagnostic = await getAttemptDiagnostic(attemptId, userId);
      if (!diagnostic) {
        res.status(404).json({ error: 'Assessment diagnostic not found' });
        return;
      }
      res.status(200).json({ success: true, ...diagnostic });
      return;
    } catch (err: any) {
      res.status(500).json({ error: 'Failed to retrieve diagnostic', details: err.message });
      return;
    }
  }

  // 9. Assessment History for Authenticated Student (Phase 3)
  // GET /api/rag/assessment/history?userId=...
  if (method === 'GET' && pathname === '/api/rag/assessment/history') {
    try {
      await ensureAssessmentSchema();
      const userId = await resolveContextUser(req);
      const rows: any[] = await prisma.$queryRawUnsafe(
        'SELECT * FROM assessment_attempts WHERE userId = ? ORDER BY completedAt DESC LIMIT 20',
        userId
      );

      const history = rows.map((r: any) => ({
        id: r.id,
        userId: r.userId,
        title: r.title,
        topic: r.topic,
        subtopic: r.subtopic,
        difficulty: r.difficulty,
        score: r.score,
        totalQuestions: r.totalQuestions,
        percentage: r.percentage,
        completedAt: r.completedAt,
        diagnosticReport: r.diagnosticJson ? JSON.parse(r.diagnosticJson) : null,
      }));

      res.status(200).json({ success: true, history });
      return;
    } catch (err: any) {
      res.status(500).json({ error: 'Failed to retrieve assessment history', details: err.message });
      return;
    }
  }

  // 10. Phase 4: Learner Model & Mastery Tracking APIs
  if (pathname.startsWith('/api/learner') || pathname.startsWith('/api/rag/learner')) {
    // Normalize url if it was prefixed with /api/rag/learner
    const normalizedReq = {
      ...req,
      url: req.url?.replace('/api/rag/learner', '/api/learner'),
    };
    await learnerHandler(normalizedReq, res);
    return;
  }

  // 11. Phase 5: AI Study Agent & Personalized Planning APIs
  if (pathname.startsWith('/api/agent') || pathname.startsWith('/api/rag/agent')) {
    const normalizedReq = {
      ...req,
      url: req.url?.replace('/api/rag/agent', '/api/agent'),
    };
    await studyAgentHandler(normalizedReq, res);
    return;
  }

  // 12. Phase 6: Ming Evaluation & Benchmarking APIs
  if (pathname.startsWith('/api/evaluation') || pathname.startsWith('/api/rag/evaluation')) {
    const normalizedReq = {
      ...req,
      url: req.url?.replace('/api/rag/evaluation', '/api/evaluation'),
    };
    await evaluationHandler(normalizedReq, res);
    return;
  }

  // 13. AI DAG Concept Graph Generation
  if (method === 'POST' && pathname === '/api/rag/dag/generate') {
    try {
      const body = req.body || {};
      const topic = body.topic;
      const subtopic = body.subtopic || '';
      const depth = body.depth || 'Standard';
      const targetCount = Number(body.targetCount || 8);
      const sourceId = body.sourceId;
      const sourceTitle = body.sourceTitle || 'Course Material';

      if (!topic) {
        res.status(400).json({ error: 'Topic is required for DAG generation' });
        return;
      }

      // Query chunks if sourceId is provided
      let evidenceText = '';
      if (sourceId) {
        try {
          const searchRes = await runPythonCli([
            'search',
            '--query',
            `${topic} ${subtopic}`.trim(),
            '--source-id',
            String(sourceId),
            '--top-k',
            '8',
          ]);
          if (searchRes && Array.isArray(searchRes.results)) {
            evidenceText = searchRes.results
              .map((r: any) => `[${r.chunk_id || 'chunk'} | ${r.location?.page_number ? `Page ${r.location.page_number}` : r.location?.slide_number ? `Slide ${r.location.slide_number}` : 'Excerpt'}]: ${r.text?.slice(0, 300) || ''}`)
              .join('\n\n');
          }
        } catch (searchErr) {
          console.warn('DAG generation chunk search notice:', searchErr);
        }
      }

      res.status(200).json({
        success: true,
        topic,
        subtopic,
        depth,
        sourceId,
        sourceTitle,
        evidenceAvailable: !!evidenceText,
      });
      return;
    } catch (err: any) {
      console.error('DAG generation error:', err);
      res.status(500).json({ error: 'Failed to generate DAG', details: err.message });
      return;
    }
  }

  res.status(404).json({ error: `RAG endpoint not found: ${method} ${pathname}` });


}

