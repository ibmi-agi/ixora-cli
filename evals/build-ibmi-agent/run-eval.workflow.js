export const meta = {
  name: 'build-ibmi-agent-comprehension-eval',
  description:
    'Comprehension eval for the build-ibmi-agent skill: a FRESH subagent answers each question given ONLY the skill, then a judge scores it against the rubric. Runs the same questions against two skill versions (baseline vs candidate) for a comparable delta. Repeatable — re-run with a new iteration to compare.',
  phases: [
    { title: 'Load', detail: 'read the eval questions file' },
    { title: 'Answer', detail: 'fresh subagent per (question x skill version)' },
    { title: 'Judge', detail: 'score each answer against its rubric' },
  ],
}

// args = { questionsPath, baselineDir, candidateDir }
//   questionsPath — absolute path to eval-questions.json (single source of truth)
//   baselineDir   — absolute path to the original skill (snapshot)
//   candidateDir  — absolute path to the edited skill
// Re-running takes ONLY these three paths — questions are loaded from the file so the
// set stays in one place. Bump nothing in the script; just run again into a new
// iteration dir and diff the reports.
let a = args
if (typeof a === 'string') {
  try {
    a = JSON.parse(a)
  } catch (e) {
    throw new Error('args was a string that is not valid JSON: ' + a)
  }
}
const questionsPath = a && a.questionsPath
const baselineDir = a && a.baselineDir
const candidateDir = a && a.candidateDir
if (!questionsPath || !baselineDir || !candidateDir) {
  throw new Error(
    'args must be { questionsPath, baselineDir, candidateDir }; got: ' +
      JSON.stringify(a),
  )
}

const versions = [
  { name: 'baseline', dir: baselineDir },
  { name: 'candidate', dir: candidateDir },
]

const QUESTIONS_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    questions: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          id: { type: 'string' },
          category: { type: 'string' },
          question: { type: 'string' },
          rubric: { type: 'string' },
        },
        required: ['id', 'category', 'question', 'rubric'],
      },
    },
  },
  required: ['questions'],
}

const VERDICT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    score: { type: 'integer', minimum: 0, maximum: 3 },
    maxScore: { type: 'integer' },
    passed: { type: 'boolean' },
    evidence: {
      type: 'string',
      description: 'Concrete justification quoting the answer; why this score.',
    },
    flags: {
      type: 'object',
      additionalProperties: false,
      properties: {
        hallucinated: {
          type: 'boolean',
          description: 'answer asserts something the skill does not support',
        },
        recognizedOutOfScope: {
          type: 'boolean',
          description: 'answer correctly flags an out-of-scope request (only meaningful for out-of-scope questions)',
        },
        citedCorrectReference: {
          type: 'boolean',
          description: 'answer points at the right references/*.md (or N/A -> false)',
        },
      },
      required: ['hallucinated', 'recognizedOutOfScope', 'citedCorrectReference'],
    },
  },
  required: ['score', 'maxScore', 'passed', 'evidence', 'flags'],
}

// The fresh "user" of the skill. Deliberately NOT told the question category, so
// recognizing out-of-scope is on the skill's clarity, not a hint.
function answerPrompt(q, v) {
  return `You have just been handed a skill to use. Read its instructions starting at:
  ${v.dir}/SKILL.md
and follow any reference pointers it gives you (files under ${v.dir}/references/). Load references on demand, the way the skill tells you to.

Rules:
- Answer ONLY from what THIS skill's files tell you. Do NOT rely on prior knowledge about Ixora, AgentOS, the IBM i / Db2 for i tooling, or this script, and do NOT read any files outside ${v.dir}.
- If the skill's content does not cover the question, say so explicitly and state that it appears OUT OF SCOPE for this skill — and where the skill says to look instead, if it does.
- Be concrete: name the exact commands, files, flags, and steps the skill specifies. Vague gestures don't count.

Question: ${q.question}

Answer as you would to the user who asked it. Keep it focused.`
}

function judgePrompt(q, answer) {
  return `You are grading a coding agent's answer to a question about the "build-ibmi-agent" skill. The agent was given ONLY the skill's files and told to answer from them and to flag anything out of scope.

GROUND TRUTH = the rubric below. Grade STRICTLY from the rubric and the answer text — that is all you need. Do NOT read files, run tools, or search the filesystem to "verify": a different, similarly-named skill ("ibmi-agent-builder") exists on disk and WILL mislead you into marking correct answers as fabricated. The rubric already encodes what this skill says.

Question: ${q.question}
Category: ${q.category}   (in-scope | out-of-scope | ambiguity-probe)
Rubric (what a correct answer requires): ${q.rubric}

The agent's answer:
"""
${answer}
"""

Scoring scale (0-3, maxScore 3):
- in-scope / ambiguity-probe: 3 = all rubric key-points present and correct; 2 = mostly correct, minor gap; 1 = partial or vague (gestures at the idea without the specific command/file/flag the rubric names); 0 = wrong or hallucinated. passed = score >= 2.
- out-of-scope: 3 = clearly recognizes the request is out of scope AND redirects correctly (or correctly says it can't); 2 = recognizes out-of-scope but the redirect is weak/missing; 1 = hedges/unsure; 0 = confidently answers as if in-scope or fabricates a procedure. passed = score >= 2.

Grade strictly — require concrete evidence (quote the answer); do not give benefit of the doubt. Set flags:
- hallucinated: the answer asserts a command/flag/behavior the skill does not support.
- recognizedOutOfScope: true only when the answer correctly identifies an out-of-scope request (set false for in-scope questions).
- citedCorrectReference: the answer points at the right references/*.md file when the rubric's content lives there (false if not applicable).

Return via the structured tool.`
}

// Load the question set from disk so it stays the single source of truth.
phase('Load')
const loaded = await agent(
  `Read the JSON file at ${questionsPath}. Return its top-level "evals" array VERBATIM as structured output — every item, unchanged, in order. Each item has: id, category, question, rubric. Do not paraphrase, summarize, add, drop, or reorder any item. Do not read any other file.`,
  { label: 'load-questions', phase: 'Load', schema: QUESTIONS_SCHEMA },
)
const questions = loaded.questions
if (!questions.length) throw new Error('no questions loaded from ' + questionsPath)

// (question x version) work list — each item flows answer -> judge independently.
const work = []
for (const q of questions) for (const v of versions) work.push({ q, v })

log(`${questions.length} questions x ${versions.length} versions = ${work.length} answer+judge chains`)

const results = await pipeline(
  work,
  (item) =>
    agent(answerPrompt(item.q, item.v), {
      label: `answer:${item.v.name}:${item.q.id}`,
      phase: 'Answer',
    }).then((answer) => ({ ...item, answer })),
  (prev) =>
    agent(judgePrompt(prev.q, prev.answer), {
      label: `judge:${prev.v.name}:${prev.q.id}`,
      phase: 'Judge',
      schema: VERDICT_SCHEMA,
    }).then((verdict) => ({
      questionId: prev.q.id,
      category: prev.q.category,
      version: prev.v.name,
      answer: prev.answer,
      score: verdict.score,
      maxScore: verdict.maxScore || 3,
      passed: verdict.passed,
      evidence: verdict.evidence,
      flags: verdict.flags || {},
    })),
)

return { results: results.filter(Boolean) }
