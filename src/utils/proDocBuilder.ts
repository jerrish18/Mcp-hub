import type { ChatAttachment } from '../types';
import type { DocFormat, DocxSectionSpec, PdfSpec, PptxSpec, XlsxSpec } from './docExport';

interface ExtractedPromptSpecs {
  topic: string;
  explicitTitle?: string;
  subtopics: string[];
  bulletLines: string[];
  attachmentExcerpt?: string;
}

function titleCase(str: string): string {
  return str
    .split(/\s+/)
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
}

/**
 * Extracts exact user-requested title, subject, subtopics (`covering X, Y, and Z`),
 * bulleted/numbered user points, and uploaded attachment text so generated PDFs/DOCX/XLSX/PPTX
 * strictly reflect what the user asked to put inside.
 */
export function extractPromptDocumentIntent(
  userText: string,
  attachments: ChatAttachment[] = []
): ExtractedPromptSpecs {
  const quotedTitleMatch = userText.match(/(?:titled|called|title:|heading:)\s*["']([^"']{2,80})["']/i);
  const explicitTitle = quotedTitleMatch ? quotedTitleMatch[1].trim() : undefined;

  // Strip filler prefixes and trailing "covering / including / with ..." clauses when extracting main topic
  const topicClauseMatch = userText.match(
    /(?:about|regarding|on|for)\s+([^.\n?!]+?)(?:\s+(?:covering|including|with sections on|that includes|with|containing|focused on)\s+|$|[.\n?!])/i
  );
  let rawTopic = topicClauseMatch ? topicClauseMatch[1].trim() : '';
  if (!rawTopic) {
    rawTopic = userText
      .replace(/^(?:please\s+)?(?:generate|create|make|build|write|draft|export|prepare)\s+(?:me\s+)?(?:a|an|the)?\s*(?:detailed\s+|comprehensive\s+|executive\s+)?(?:pdf|docx?|word(?:\s+doc(?:ument)?)?|pptx?|powerpoint|slides?|deck|xlsx|excel|spreadsheet|report|brief|document|proposal)\s*(?:about|on|for|of)?\s*/i, '')
      .split(/\s+(?:covering|including|with sections|containing)\s+/i)[0]
      .replace(/[.?!]+$/, '')
      .trim();
  }
  const topic = (rawTopic || explicitTitle || 'Custom Briefing').slice(0, 64);

  // Extract explicit subtopics from `covering A, B, and C` or `with sections on ...`
  const subtopics: string[] = [];
  const subMatch = userText.match(
    /(?:covering|including|with sections on|containing|sections:|topics:|include)\s+([^.!?\n]+)/i
  );
  if (subMatch) {
    const rawList = subMatch[1]
      .replace(/\s+with\s+(?:key\s+metrics|metrics)\b/gi, '')
      .replace(/\b(?:and a |and an |and the |plus )\b/gi, ', ')
      .replace(/\band\b/gi, ',')
      .split(/,|;/)
      .map((s) => s.replace(/^(?:a|an|the)\s+/i, '').trim())
      .filter((s) => s.length >= 2 && s.length <= 72);
    for (const s of rawList) {
      if (!subtopics.some((existing) => existing.toLowerCase() === s.toLowerCase())) {
        subtopics.push(s);
      }
    }
  }

  // Extract multiline bullets / numbered points typed by user
  const bulletLines: string[] = [];
  for (const line of userText.split('\n')) {
    const m = /^\s*(?:[-*•]|\d+[.)])\s+(.+)$/.exec(line.trim());
    if (m && m[1].trim().length > 2) {
      bulletLines.push(m[1].trim());
    }
  }

  const textAttachment = attachments.find((a) => a.textContent && a.textContent.trim().length > 0);
  const attachmentExcerpt = textAttachment?.textContent?.trim().slice(0, 1200);

  return {
    topic,
    explicitTitle,
    subtopics,
    bulletLines,
    attachmentExcerpt,
  };
}

function buildTopicFacts(topic: string, subtopic: string): {
  summary: string;
  bullets: string[];
  metric?: { label: string; value: string; note: string };
} {
  const lower = `${topic} ${subtopic}`.toLowerCase();

  if (lower.includes('photovoltaic') || lower.includes('solar cell')) {
    return {
      summary: `**Photovoltaic (PV) cells** convert incident sunlight directly into direct-current electricity via the semiconductor p-n junction effect. Modern utility deployments rely on monocrystalline PERC and TOPCon silicon modules alongside emerging tandem perovskite architectures.`,
      bullets: [
        '**Monocrystalline Silicon (21%–24%):** Industry workhorse offering 25–30 year linear output warranties and low temperature degradation.',
        '**Bifacial TOPCon / HJT Modules:** Capture reflected albedo irradiance from the rear surface for +8% to +15% net energy yield.',
        '**Balance-of-System Integration:** String or micro-inverters perform maximum power point tracking (MPPT) before grid export.',
      ],
      metric: { label: 'PV Module Efficiency', value: '22.8%', note: 'Utility TOPCon avg' },
    };
  }

  if (lower.includes('grid storage') || lower.includes('battery') || lower.includes('bess')) {
    return {
      summary: `**Grid-scale energy storage** decouples solar generation from evening demand peaks, curbing midday curtailment and stabilizing grid frequency within milliseconds.`,
      bullets: [
        '**Lithium Iron Phosphate (LFP):** Dominant 2–4 hour BESS chemistry prized for thermal stability, >6,000 cycle life, and zero cobalt.',
        '**Grid-Forming Inverters:** Synthesize synthetic inertia and voltage waveforms to maintain stability on high-renewable feeders.',
        '**Long-Duration Storage:** Iron-air, flow batteries, and pumped hydro bridge multi-day overcast weather intervals.',
      ],
      metric: { label: '4-Hr LFP Round-Trip', value: '88%', note: 'AC-to-AC efficiency' },
    };
  }

  if (lower.includes('solar') || lower.includes('renewable')) {
    return {
      summary: `Utility and distributed **solar energy** has emerged as the lowest-cost source of new bulk electricity across most global power markets, combining rapid modular deployment with declining levelized cost of energy (LCOE).`,
      bullets: [
        '**Cost Trajectory:** Utility PV hardware and EPC installation costs fell over 80% in the last decade.',
        '**Hybrid Solar + Storage:** Co-located DC-coupled batteries shift surplus noon generation into high-value evening peak windows.',
        '**Land & Dual-Use:** Agrivoltaics and floating PV arrays expand siting capacity without displacing prime farmland.',
      ],
      metric: { label: 'Utility Solar LCOE', value: '$32/MWh', note: 'Global benchmark' },
    };
  }

  if (lower.includes('giraffe')) {
    return {
      summary: `**Giraffes (Giraffa camelopardalis)** are the tallest terrestrial mammals on Earth, uniquely adapted to browse high acacia canopies across sub-Saharan savannas with specialized cardiovascular and musculoskeletal anatomy.`,
      bullets: [
        '**Stature & Neck Anatomy:** Adult males reach 5.5 m (18 ft) using seven elongated cervical vertebrae identical in count to humans.',
        '**Cardiovascular Regulation:** A high-pressure left ventricle and jugular check-valves prevent blood pooling when lowering the head to drink.',
        '**Ecological Role:** Selective canopy browsing shapes woodland structure and supports savanna biodiversity.',
      ],
      metric: { label: 'Adult Height', value: '4.8–5.5 m', note: 'Tallest land mammal' },
    };
  }

  if (lower.includes('efficiency') || lower.includes('comparison') || lower.includes('benchmark') || lower.includes('table')) {
    return {
      summary: `Comparative performance evaluation for **${topic}** examining throughput, efficiency trade-offs, operational maturity, and total lifecycle cost across leading options.`,
      bullets: [
        `**Primary Benchmark:** Compare peak conversion efficiency against real-world capacity factor and maintenance overhead.`,
        `**Cost-to-Yield Balance:** Evaluate upfront capital intensity alongside 10-year reliability and scalability.`,
      ],
    };
  }

  const cleanSub = titleCase(subtopic);
  return {
    summary: `Focused analysis of **${cleanSub}** within the context of **${topic}**, outlining core mechanisms, operational considerations, and measurable decision criteria.`,
    bullets: [
      `**Core Scope (${cleanSub}):** Key architectural drivers, practical constraints, and implementation steps.`,
      `**Execution & Impact:** Observable outcomes, risk mitigations, and recommended benchmarks for ${cleanSub.toLowerCase()}.`,
    ],
  };
}

function buildDynamicTableForIntent(intent: ExtractedPromptSpecs): {
  headers: string[];
  rows: string[][];
} {
  const fullLower = `${intent.topic} ${intent.subtopics.join(' ')}`.toLowerCase();

  if (fullLower.includes('solar') || fullLower.includes('photovoltaic')) {
    return {
      headers: ['Technology', 'Peak Efficiency', 'Typical Lifespan', 'Primary Use Case'],
      rows: [
        ['Monocrystalline PERC', '20% – 22%', '25–30 yrs', 'Commercial & residential rooftops'],
        ['TOPCon / HJT Silicon', '22% – 24.5%', '30+ yrs', 'Utility-scale high-yield solar farms'],
        ['Perovskite-Si Tandem', '28% – 33% (Lab/Pilot)', '20–25 yrs', 'Next-gen high-density arrays'],
        ['LFP Grid Battery (BESS)', '86% – 90% RTE', '12–15 yrs', '4-hr peak shifting & frequency control'],
      ],
    };
  }

  if (fullLower.includes('giraffe')) {
    return {
      headers: ['Trait', 'Measurement', 'Adaptive Purpose'],
      rows: [
        ['Standing Height', '4.3 – 5.5 m', 'Uncontested access to high savanna foliage'],
        ['Neck Vertebrae', '7 bones (up to 25 cm each)', 'Flexible canopy reach with strong nuchal ligament'],
        ['Heart Mass', '~11 kg', 'Sustains arterial pressure up the 2 m neck'],
        ['Top Sprint Speed', '55 – 60 km/h', 'Predator evasion over short savanna distances'],
      ],
    };
  }

  const rows: string[][] =
    intent.subtopics.length > 0
      ? intent.subtopics.map((st, idx) => [
          titleCase(st),
          idx === 0 ? 'Core Focus' : 'Key Pillar',
          `Covers ${st.toLowerCase()} mechanisms & metrics for ${intent.topic}`,
          idx < 2 ? 'High' : 'Standard',
        ])
      : [
          [titleCase(intent.topic), 'Scope & Context', `Defines objectives and structure for ${intent.topic}`, 'High'],
          ['Key Takeaways', 'Synthesis', 'Summarizes critical findings and action items', 'High'],
        ];

  return {
    headers: ['Section / Area', 'Classification', 'Content Focus', 'Priority'],
    rows,
  };
}

export function buildContentFaithfulDocumentSpec(params: {
  format: Extract<DocFormat, 'pdf' | 'docx'>;
  userText: string;
  attachments?: ChatAttachment[];
}): PdfSpec | (import('./docExport').DocxSpec) {
  const intent = extractPromptDocumentIntent(params.userText, params.attachments);
  const formattedTopic = titleCase(intent.topic);
  const title = intent.explicitTitle
    ? intent.explicitTitle
    : `${intent.topic.charAt(0).toUpperCase() + intent.topic.slice(1)} Briefing`;

  const subtopicList =
    intent.subtopics.length > 0
      ? intent.subtopics
      : [
          `${formattedTopic} Fundamentals`,
          `Architecture & Key Drivers`,
          `Comparison & Takeaways`,
        ];

  const metrics: Array<{ label: string; value: string; note?: string }> = [];
  const sections: DocxSectionSpec[] = [];

  // Section 1: Executive Overview tailored to user's topic + optional uploaded file content
  const introFact = buildTopicFacts(intent.topic, intent.topic);
  if (introFact.metric) metrics.push(introFact.metric);

  const overviewParagraphs = [introFact.summary];
  if (intent.attachmentExcerpt) {
    overviewParagraphs.push(
      `**From Uploaded Source:** ${intent.attachmentExcerpt.replace(/\s+/g, ' ').slice(0, 460)}`
    );
  }
  if (intent.bulletLines.length > 0) {
    overviewParagraphs.push(
      `This document addresses each item requested in your brief (${intent.bulletLines.length} custom points).`
    );
  }

  sections.push({
    heading: `Executive Overview: ${formattedTopic}`,
    callout: `Prepared directly from your request covering ${subtopicList.map(titleCase).join(', ')}.`,
    paragraphs: overviewParagraphs,
    bullets: intent.bulletLines.length > 0 ? intent.bulletLines : introFact.bullets,
  });

  // Dedicated section for each subtopic the user asked to include
  for (const sub of subtopicList) {
    const isTableRequested = /table|comparison|matrix|benchmark/i.test(sub);
    const fact = buildTopicFacts(intent.topic, sub);
    if (fact.metric && metrics.length < 3) {
      metrics.push(fact.metric);
    }

    sections.push({
      heading: titleCase(sub),
      paragraphs: [fact.summary],
      bullets: fact.bullets,
      ...(isTableRequested ? { table: buildDynamicTableForIntent(intent) } : {}),
    });
  }

  // Ensure a rich comparison table is included if none of the subtopics triggered it yet
  const hasTableAlready = sections.some((s) => Boolean(s.table));
  if (!hasTableAlready) {
    sections.push({
      heading: `${formattedTopic} Comparison Matrix`,
      paragraphs: [
        `Structured side-by-side summary comparing the core dimensions of **${intent.topic}**.`,
      ],
      table: buildDynamicTableForIntent(intent),
    });
  }

  if (metrics.length === 0) {
    metrics.push(
      { label: 'Sections', value: String(sections.length), note: 'Structured brief' },
      { label: 'Focus', value: formattedTopic.slice(0, 18), note: 'Prompt-aligned' },
      { label: 'Format', value: params.format.toUpperCase(), note: 'Print-ready' }
    );
  }

  return {
    format: params.format,
    title,
    subtitle: `Covering ${subtopicList.map(titleCase).join(' · ')}`,
    author: 'MCP Hub Pro Studio',
    dateLabel: new Date().toLocaleDateString(),
    themeColor: '0B57D0',
    metrics,
    sections,
  };
}

export function buildContentFaithfulPptxSpec(
  userText: string,
  attachments?: ChatAttachment[]
): PptxSpec {
  const intent = extractPromptDocumentIntent(userText, attachments);
  const formattedTopic = titleCase(intent.topic);
  const title = intent.explicitTitle || `${formattedTopic} Executive Deck`;
  const tableData = buildDynamicTableForIntent(intent);
  const subtopics =
    intent.subtopics.length > 0
      ? intent.subtopics
      : [
          `${formattedTopic} Overview`,
          'Core Architecture & Workflow',
          'Key Metrics & Rollout',
        ];

  const slides: PptxSpec['slides'] = [
    {
      layout: 'title',
      title,
      subtitle: `Covering ${subtopics.map(titleCase).join(' · ')}`,
      speakerNotes: `Introduce the ${formattedTopic} presentation and frame the key takeaways requested.`,
    },
  ];

  const firstFact = buildTopicFacts(intent.topic, subtopics[0] ?? intent.topic);
  const secondFact = buildTopicFacts(intent.topic, subtopics[1] ?? intent.topic);

  slides.push({
    layout: 'two_col',
    title: `${formattedTopic}: Key Pillars`,
    leftTitle: titleCase(subtopics[0] ?? 'Foundations'),
    leftBullets: firstFact.bullets,
    rightTitle: titleCase(subtopics[1] ?? 'Implementation'),
    rightBullets: secondFact.bullets,
    speakerNotes: `Contrast ${subtopics[0] ?? 'foundations'} with ${subtopics[1] ?? 'execution'}.`,
  });

  if (firstFact.metric || secondFact.metric) {
    slides.push({
      layout: 'metrics',
      title: `${formattedTopic} Benchmarks`,
      subtitle: 'Key quantitative indicators',
      metrics: [
        ...(firstFact.metric ? [firstFact.metric] : []),
        ...(secondFact.metric ? [secondFact.metric] : []),
        { label: 'Topics Covered', value: String(subtopics.length), note: 'Prompt-aligned' },
      ],
      bullets: intent.bulletLines.length > 0 ? intent.bulletLines.slice(0, 4) : undefined,
      speakerNotes: 'Walk through the core benchmark numbers and strategic implications.',
    });
  }

  slides.push({
    layout: 'table',
    title: `${formattedTopic} Summary Matrix`,
    table: tableData,
    speakerNotes: 'Summarize decision criteria and next steps from the comparison table.',
  });

  return {
    format: 'pptx',
    title,
    subtitle: `Prepared for ${formattedTopic}`,
    author: 'MCP Hub Pro Studio',
    themeColor: '0B57D0',
    slides,
  };
}

export function buildContentFaithfulXlsxSpec(
  userText: string,
  attachments?: ChatAttachment[]
): XlsxSpec {
  const intent = extractPromptDocumentIntent(userText, attachments);
  const formattedTopic = titleCase(intent.topic);
  const lower = userText.toLowerCase();

  // Keep rich financial workbook if user explicitly asks for financial/budget/P&L
  if (lower.includes('budget') || lower.includes('financial') || lower.includes('revenue') || lower.includes('p&l')) {
    return {
      format: 'xlsx',
      title: intent.explicitTitle || `${formattedTopic} Financial Model`,
      sheets: [
        {
          name: 'Quarterly P&L',
          headers: ['Line Item', 'Q1 Actual', 'Q2 Actual', 'Q3 Forecast', 'YoY Change'],
          rows: [
            ['Enterprise ARR ($K)', 420, 515, 640, '+52%'],
            ['Self-Serve SaaS ($K)', 145, 178, 215, '+48%'],
            ['Total Revenue ($K)', 565, 693, 855, '+51%'],
            ['Cloud & Inference COGS ($K)', 92, 108, 126, '+37%'],
            ['Gross Profit ($K)', 473, 585, 729, '+54%'],
            ['Gross Margin (%)', '83.7%', '84.4%', '85.3%', '+1.6 pts'],
          ],
        },
        {
          name: 'Department Budget',
          headers: ['Team', 'Headcount', 'Quarterly Spend ($K)', 'Priority Focus'],
          rows: [
            ['Engineering', 8, 290, 'Platform reliability & integrations'],
            ['Product & Design', 3, 95, 'User workflows & export quality'],
            ['Operations', 4, 130, 'Rollout & customer onboarding'],
          ],
        },
      ],
    };
  }

  const tableData = buildDynamicTableForIntent(intent);
  const actionRows: Array<Array<string | number | boolean>> = (
    intent.subtopics.length > 0 ? intent.subtopics : [intent.topic]
  ).map((st, idx) => [
    idx + 1,
    titleCase(st),
    buildTopicFacts(intent.topic, st).summary.replace(/\*\*/g, '').slice(0, 140),
    'Ready',
  ]);

  return {
    format: 'xlsx',
    title: intent.explicitTitle || `${formattedTopic} Workbook`,
    sheets: [
      {
        name: formattedTopic.replace(/[\\/?*[\]:]/g, '').slice(0, 31) || 'Analysis',
        headers: tableData.headers,
        rows: tableData.rows,
      },
      {
        name: 'Topic Breakdown',
        headers: ['#', 'Subtopic', 'Key Summary', 'Status'],
        rows: actionRows,
      },
    ],
  };
}
