export type MockDocument = {
  id: string;
  name: string;
  type: "pdf" | "md" | "txt";
  pages: number;
  chapters: number;
  status: "indexed" | "indexing";
};

export const INITIAL_DOCUMENTS: MockDocument[] = [
  {
    id: "doc_01",
    name: "Control_Systems_Ch5.pdf",
    type: "pdf",
    pages: 42,
    chapters: 4,
    status: "indexed",
  },
  {
    id: "doc_02",
    name: "Linear_Algebra_Reference.pdf",
    type: "pdf",
    pages: 28,
    chapters: 3,
    status: "indexed",
  },
  {
    id: "doc_03",
    name: "Robotics_Lab_Manual.pdf",
    type: "pdf",
    pages: 19,
    chapters: 2,
    status: "indexed",
  },
];

export type QueryMode = "search" | "define" | "summarize" | "formulas" | "compare";

export type Citation = {
  id: number;
  doc: string;
  page: string;
  chapter: string;
  excerpt: string;
  score: number;
};

export type MockFormula = {
  label: string;
  latex: string;
  doc: string;
  page: string;
  citation: number;
};

export type MockChapter = {
  doc: string;
  chapter: string;
  summary: string;
};

export type MockDefinition = {
  term: string;
  definition: string;
  citations: number[];
};

export const MOCK_COMPARE = {
  docA: "Control_Systems_Ch5.pdf",
  docB: "Robotics_Lab_Manual.pdf",
  overlaps: [
    "Both discuss state representation — theory in Ch5, application in Lab 2.",
    "Jacobian matrices appear in the lab manual; Ch5 references linearization near equilibria.",
  ],
  differences: [
    "Ch5 focuses on proofs and stability conditions; Lab Manual is procedural with code snippets.",
    "Only the lab manual includes DH parameter tables and joint-limit constraints.",
  ],
};

export const MOCK_METRICS = [
  { label: "Hit rate", value: "0.91" },
  { label: "MRR", value: "0.84" },
  { label: "Latency", value: "0.31s" },
  { label: "Sources", value: "3 docs" },
];

export function createDocumentFromFile(file: File): MockDocument {
  const base = file.name.replace(/\.pdf$/i, "");
  const seed = base.length + file.size;
  return {
    id: `doc_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
    name: file.name.endsWith(".pdf") ? file.name : `${file.name}.pdf`,
    type: "pdf",
    pages: 12 + (seed % 38),
    chapters: 1 + (seed % 5),
    status: "indexing",
  };
}

export type MockReply = {
  intent: Exclude<QueryMode, "compare">;
  answer: string;
  citationIds: number[];
  citations: Citation[];
  definition?: MockDefinition;
  formulas?: MockFormula[];
  chapters?: MockChapter[];
};

const FORMULA_RE = /\b(formula|formulas|equation|equations|expression|expressions)\b/i;
const DEFINE_RE = /\b(define|definition of|what is|what does|meaning of|explain)\b/i;
const SUMMARIZE_RE = /\b(summarize|summary|summarise|chapter|chapters|sections|overview)\b/i;

type ContentTopic = "mechanics" | "controls" | "general";

export function detectIntent(question: string): Exclude<QueryMode, "compare"> {
  const q = question.trim().toLowerCase();
  if (FORMULA_RE.test(q)) return "formulas";
  if (DEFINE_RE.test(q)) return "define";
  if (SUMMARIZE_RE.test(q)) return "summarize";
  return "search";
}

function libraryNames(documents: MockDocument[]): Set<string> {
  return new Set(documents.map((d) => d.name));
}

function detectTopic(question: string, documents: MockDocument[]): ContentTopic {
  const text = `${question} ${documents.map((d) => d.name).join(" ")}`.toLowerCase();
  if (/resultant|force|couple|moment|equilibrium|static|torque|vector/.test(text)) {
    return "mechanics";
  }
  if (/observab|state.?space|control|eigen|pid|robot/.test(text)) {
    return "controls";
  }
  return "general";
}

function titleCase(text: string): string {
  return text
    .split(/\s+/)
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

function extractTerm(question: string, documents: MockDocument[]): string {
  const cleaned = question
    .replace(
      /\b(give me|show me|find|get|the|a|an|of|for|about|please|define|definition|what is|what does|meaning of|explain|formulas?|equations?)\b/gi,
      " ",
    )
    .replace(/\s+/g, " ")
    .trim();

  if (cleaned.length >= 3) return titleCase(cleaned);

  const fromFile = documents[0]?.name.replace(/\.pdf$/i, "").replace(/[_-]+/g, " ").trim();
  return fromFile ? titleCase(fromFile) : "this topic";
}

function excerptForDoc(topic: ContentTopic, doc: MockDocument, term: string): string {
  const label = doc.name.replace(/\.pdf$/i, "");

  if (topic === "mechanics") {
    return `In ${label}: the resultant force-couple system combines net force R = ΣFᵢ with the resultant couple M about the reference point — statically equivalent to the original force distribution. Relevant to “${term}”.`;
  }
  if (topic === "controls") {
    return `In ${label}: observability requires the observability matrix to have full rank so the initial state can be recovered from output measurements — tied to “${term}”.`;
  }
  return `In ${label}: passage discussing “${term}” — key concepts, definitions, and worked examples appear in this section of your uploaded material.`;
}

function buildCitations(documents: MockDocument[], topic: ContentTopic, term: string): Citation[] {
  return documents.map((doc, index) => ({
    id: index + 1,
    doc: doc.name,
    page: `p. ${Math.min(4 + index * 3, doc.pages)}`,
    chapter: doc.chapters > 1 ? `§${1 + (index % doc.chapters)}` : "§1",
    excerpt: excerptForDoc(topic, doc, term),
    score: Math.max(0.72, 0.95 - index * 0.05),
  }));
}

function buildDefinition(term: string, topic: ContentTopic): MockDefinition {
  if (topic === "mechanics") {
    return {
      term: term.includes("Force") || term.includes("Couple") ? term : "Resultant force-couple",
      definition:
        "A resultant force-couple system is a single force vector R plus a couple M (resultant moment) that together produce the same external effect as any distributed set of forces on a rigid body.",
      citations: [1],
    };
  }
  if (topic === "controls") {
    return {
      term: term.includes("Observ") ? term : "Observability",
      definition:
        "A system is observable if the initial state can be determined from a finite sequence of outputs over time.",
      citations: [1],
    };
  }
  return {
    term,
    definition: `${term} is defined in your uploaded material as the central concept linking the sections cited below.`,
    citations: [1],
  };
}

function buildFormulas(documents: MockDocument[], topic: ContentTopic): MockFormula[] {
  const primary = documents[0];
  if (!primary) return [];

  if (topic === "mechanics") {
    return [
      {
        label: "Resultant force",
        latex: "\\mathbf{R} = \\sum_i \\mathbf{F}_i",
        doc: primary.name,
        page: "p. 8",
        citation: 1,
      },
      {
        label: "Resultant moment",
        latex: "\\mathbf{M}_O = \\sum_i (\\mathbf{r}_i \\times \\mathbf{F}_i)",
        doc: documents[1]?.name ?? primary.name,
        page: "p. 11",
        citation: documents.length > 1 ? 2 : 1,
      },
    ];
  }
  if (topic === "controls") {
    return [
      {
        label: "State transition",
        latex: "x_{k+1} = A x_k + B u_k",
        doc: primary.name,
        page: "p. 87",
        citation: 1,
      },
      {
        label: "Eigenvalue stability",
        latex: "\\lambda_i(A) < 0 \\forall i",
        doc: documents[1]?.name ?? primary.name,
        page: "p. 41",
        citation: documents.length > 1 ? 2 : 1,
      },
    ];
  }
  return [
    {
      label: "Key relation",
      latex: "y = f(x)",
      doc: primary.name,
      page: "p. 5",
      citation: 1,
    },
  ];
}

function buildChapters(documents: MockDocument[], topic: ContentTopic): MockChapter[] {
  return documents.map((doc, index) => {
    const label = doc.name.replace(/\.pdf$/i, "");
    let summary: string;

    if (topic === "mechanics") {
      summary =
        index === 0
          ? "Introduces force vectors, moment arms, and reduction of force systems to a resultant force-couple at a point."
          : "Applies resultant force-couple equivalence to equilibrium problems and free-body diagrams.";
    } else if (topic === "controls") {
      summary =
        index === 0
          ? "Develops state-space models, observability rank conditions, and stability arguments."
          : "Connects theory to examples — eigenvalues, simulation, and practical checks before tuning.";
    } else {
      summary = `Covers the main ideas in ${label} — definitions, examples, and end-of-section review.`;
    }

    return {
      doc: doc.name,
      chapter: doc.chapters > 1 ? `Ch. ${1 + (index % doc.chapters)}` : "Overview",
      summary,
    };
  });
}

function searchAnswer(topic: ContentTopic, term: string, documents: MockDocument[]): string {
  if (topic === "mechanics") {
    return `Your material on resultant force-couple systems shows that any force distribution on a rigid body can be replaced by a resultant force R and a resultant couple M about a chosen point. ${documents.length > 1 ? `This appears across ${documents.length} of your PDFs` : "This is covered in your uploaded PDF"} with respect to “${term}”.`;
  }
  if (topic === "controls") {
    return `Across your library, “${term}” is treated through state-space models and observability — the initial state must be recoverable from output data when the observability matrix has full rank.`;
  }
  return `Found relevant passages for “${term}” in ${documents.length} PDF${documents.length === 1 ? "" : "s"} — see cited excerpts from your uploaded files.`;
}

export function filterCitationsByLibrary(
  citations: Citation[],
  documents: MockDocument[],
): Citation[] {
  const names = libraryNames(documents);
  return citations.filter((c) => names.has(c.doc));
}

export function filterReplyByLibrary(reply: MockReply, documents: MockDocument[]): MockReply {
  const names = libraryNames(documents);
  const citations = reply.citations.filter((c) => names.has(c.doc));
  const allowedIds = new Set(citations.map((c) => c.id));

  const formulas = reply.formulas?.filter((f) => names.has(f.doc));
  const chapters = reply.chapters?.filter((ch) => names.has(ch.doc));
  const definition =
    reply.definition && reply.definition.citations.some((id) => allowedIds.has(id))
      ? {
          ...reply.definition,
          citations: reply.definition.citations.filter((id) => allowedIds.has(id)),
        }
      : undefined;

  const citationIds = reply.citationIds.filter((id) => allowedIds.has(id));

  return {
    ...reply,
    citations,
    citationIds: citationIds.length ? citationIds : citations.map((c) => c.id),
    formulas: formulas?.length ? formulas : undefined,
    chapters: chapters?.length ? chapters : undefined,
    definition,
  };
}

export function buildMockReply(question: string, documents: MockDocument[]): MockReply {
  const intent = detectIntent(question);
  const indexed = documents.filter((d) => d.status === "indexed");

  if (!documents.length) {
    return {
      intent,
      answer: "Add at least one PDF to your library before searching.",
      citationIds: [],
      citations: [],
    };
  }

  if (!indexed.length) {
    return {
      intent,
      answer: "Your PDFs are still indexing — wait a moment, then ask again.",
      citationIds: [],
      citations: [],
    };
  }

  const topic = detectTopic(question, indexed);
  const term = extractTerm(question, indexed);
  const citations = buildCitations(indexed, topic, term);
  const citationIds = citations.map((c) => c.id);

  let reply: MockReply;

  if (intent === "formulas") {
    reply = {
      intent,
      answer: `Formulas related to “${term}” from your library:`,
      citationIds,
      citations,
      formulas: buildFormulas(indexed, topic),
    };
  } else if (intent === "define") {
    const definition = buildDefinition(term, topic);
    reply = {
      intent,
      answer: "Definition from your uploaded PDFs:",
      citationIds: definition.citations,
      citations,
      definition,
    };
  } else if (intent === "summarize") {
    reply = {
      intent,
      answer: "Chapter summaries from your indexed PDFs:",
      citationIds,
      citations,
      chapters: buildChapters(indexed, topic),
    };
  } else {
    reply = {
      intent: "search",
      answer: searchAnswer(topic, term, indexed),
      citationIds,
      citations,
    };
  }

  return filterReplyByLibrary(reply, indexed);
}

export const ASK_PLACEHOLDER =
  "Ask in plain language — e.g. resultant force-couple, define equilibrium, formulas for moments…";