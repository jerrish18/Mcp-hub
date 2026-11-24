import {
  buildContentFaithfulDocumentSpec,
  buildContentFaithfulPptxSpec,
  buildContentFaithfulXlsxSpec,
} from '../../utils/proDocBuilder';
import type { LlmToolCall, StreamCompletionRequest } from './types';

function delay(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new DOMException('Aborted', 'AbortError'));
      return;
    }
    const t = setTimeout(resolve, ms);
    signal?.addEventListener(
      'abort',
      () => {
        clearTimeout(t);
        reject(new DOMException('Aborted', 'AbortError'));
      },
      { once: true }
    );
  });
}

async function streamText(text: string, onDelta: (d: string) => void, signal?: AbortSignal): Promise<void> {
  // Stream in 2-word chunks at 6ms intervals for crisp, lag-free rendering
  const parts = text.split(/(?<=\s)/);
  for (let i = 0; i < parts.length; i += 2) {
    if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
    onDelta(parts.slice(i, i + 2).join(''));
    await delay(6, signal);
  }
}

/**
 * Deterministic zero-key interactive sandbox model supporting General Chat,
 * Study Session (Mermaid flowcharts, KaTeX math, callouts, flashcards, quizzes),
 * and Professional Mode (PPTX/DOCX/XLSX/PDF generation, HTML Canvas, MCP tool loops).
 */
export async function streamDemoCompletion(req: StreamCompletionRequest): Promise<void> {
  const {
    effort,
    chatMode = 'professional',
    knowledgeSource = 'auto',
    a2uiEnabled = true,
    systemPrompt,
    messages,
    tools,
    signal,
    onEvent,
  } = req;

  const lastMessage = messages[messages.length - 1];
  const lastUser = [...messages].reverse().find((m) => m.role === 'user');
  const userText = lastUser?.role === 'user' ? lastUser.text : '';
  const userAttachments = lastUser?.role === 'user' ? (lastUser.attachments ?? []) : [];
  const lower = userText.toLowerCase();

  // Study Session mode — never invokes MCP tools, supports flowcharts, math, callouts, flashcards, quizzes
  if (chatMode === 'study') {
    if (lower.includes('```study-quiz') || lower.includes('4-question multiple-choice practice quiz')) {
      const quizJson = JSON.stringify(
        [
          {
            question: 'Why does Self-Attention compute Query, Key, and Value projections separately?',
            options: [
              'To allow each token to dynamically measure relevance to every other token regardless of distance',
              'To eliminate the need for matrix multiplication',
              'To restrict context strictly to adjacent words only',
              'To compress weights down to 1-bit integers during inference',
            ],
            correctIndex: 0,
            explanation:
              'Queries ask "what am I looking for?", Keys advertise "what do I contain?", and Values carry the information aggregated by the attention weights.',
          },
          {
            question: 'Why is the dot product Q·Kᵀ divided by √d_k before applying softmax?',
            options: [
              'To increase training learning rate automatically',
              'To prevent large dot products from pushing softmax into tiny-gradient saturation regions',
              'To convert causal attention into bidirectional attention',
              'To normalize token embeddings to zero length',
            ],
            correctIndex: 1,
            explanation:
              'As dimension d_k grows, raw dot products grow in variance, which makes softmax spiky and gradients vanish; scaling by √d_k keeps variance near 1.',
          },
          {
            question: 'Which matrix captures how strongly token i attends to token j?',
            options: [
              'The Value projection bias vector',
              'The token vocabulary embedding table',
              'The normalized softmax(QKᵀ / √d_k) attention weight matrix',
              'The final linear layer output bias',
            ],
            correctIndex: 2,
            explanation:
              'Each row of softmax(QKᵀ / √d_k) forms a probability distribution over all source tokens.',
          },
          {
            question: 'When studying a complex system using Active Recall, what makes practice testing effective?',
            options: [
              'Re-reading highlighted notes five times in a row',
              'Retrieving answers from memory without peeking, then diagnosing mistakes immediately',
              'Skipping worked examples completely',
              'Memorizing variable names without understanding relationships',
            ],
            correctIndex: 1,
            explanation:
              'Testing yourself forces memory retrieval pathways to strengthen and immediately reveals blind spots.',
          },
        ],
        null,
        2
      );
      const quizReply =
        `## Practice Quiz\n\n` +
        `Test your understanding with these 4 interactive questions.\n\n` +
        `\`\`\`study-quiz\n${quizJson}\n\`\`\``;
      await streamText(quizReply, (delta) => onEvent({ type: 'text_delta', delta }), signal);
      onEvent({ type: 'done' });
      return;
    }

    if (lower.includes('```study-flashcards') || lower.includes('high-yield study flashcards')) {
      const cardsJson = JSON.stringify(
        [
          {
            front: 'Query (Q) Vector',
            back: 'Represents what the current token is searching for across the rest of the sequence.',
            memoryHook: 'Think of Q as your search bar query.',
          },
          {
            front: 'Key (K) Vector',
            back: 'Acts as an index label describing what information each token offers to others.',
            memoryHook: 'Keys match against Queries like tags on a library shelf.',
          },
          {
            front: 'Value (V) Vector',
            back: 'Holds the actual semantic content blended together using attention weights.',
            memoryHook: 'Once Q matches K, you retrieve V.',
          },
          {
            front: 'Scaling Factor (1 / √d_k)',
            back: 'Keeps dot-product variance stable so softmax gradients remain healthy during training.',
            memoryHook: 'Stops softmax from saturating.',
          },
          {
            front: 'Multi-Head Attention',
            back: 'Runs multiple attention heads in parallel so the model tracks syntax, meaning, and long-range links simultaneously.',
            memoryHook: 'Multiple spotlights reading different patterns at once.',
          },
        ],
        null,
        2
      );
      const cardsReply =
        `## Study Flashcards\n\n` +
        `Tap **Practice Cards** below to drill active recall.\n\n` +
        `\`\`\`study-flashcards\n${cardsJson}\n\`\`\``;
      await streamText(cardsReply, (delta) => onEvent({ type: 'text_delta', delta }), signal);
      onEvent({ type: 'done' });
      return;
    }

    const attachmentSummary =
      userAttachments.length > 0
        ? `\n\n> [!NOTE] Uploaded Source Used\n> Referenced ${userAttachments.length} uploaded file${userAttachments.length > 1 ? 's' : ''} (${userAttachments.map((a) => a.name).join(', ')}).`
        : knowledgeSource === 'web'
          ? '\n\n> [!NOTE] Web Search Mode\n> Add a free Gemini API key in Settings for live Google Search citations.'
          : '';

    const snippetNote = userAttachments.find((a) => a.textContent)?.textContent?.slice(0, 220);
    const instructionPreview = systemPrompt.includes('[STUDY SESSION INSTRUCTIONS')
      ? 'Structured Study Guide'
      : 'Study Notes';

    const cleanTopic = userText.replace(/[.?!]+$/, '').trim() || 'Core Concept';
    const wantsDiagram =
      lower.includes('flowchart') ||
      lower.includes('diagram') ||
      lower.includes('flow') ||
      lower.includes('visual') ||
      lower.includes('mindmap') ||
      lower.includes('attention') ||
      lower.includes('anatomy') ||
      lower.includes('heart') ||
      lower.includes('how') ||
      lower.includes('step') ||
      lower.includes('pipeline');

    const isHeartQuery = lower.includes('heart') || lower.includes('cardiac') || lower.includes('anatomy');

    const mermaidSection = wantsDiagram
      ? isHeartQuery
        ? `\n### Blood Flow Diagram\n\n\`\`\`mermaid\nflowchart TD\n  A["Deoxygenated Blood (Vena Cava)"] --> B["Right Atrium"]\n  B --> C["Right Ventricle"]\n  C --> D["Lungs (Pulmonary Artery)"]\n  D --> E["Oxygenated Blood -> Left Atrium"]\n  E --> F["Left Ventricle"]\n  F --> G["Aorta -> Systemic Circulation"]\n\`\`\`\n`
        : `\n### Visual Process Flowchart\n\n\`\`\`mermaid\nflowchart TD\n  A["Input Tokens X"] --> B["Linear Projections Q, K, V"]\n  B --> C["Similarity Score Q · K^T / sqrt(d_k)"]\n  C --> D["Softmax Attention Weights"]\n  D --> E["Weighted Output Σ(Weights · V)"]\n  E --> F{"Residual & LayerNorm"}\n  F --> G["Contextual Representation"]\n\`\`\`\n`
      : '';

    const webImagesSectionMatch = /\[VERIFIED WEB IMAGES FOUND\][\s\S]*?never invent unverified image URLs:\n([\s\S]+)$/i.exec(
      systemPrompt
    );
    const extractedImageMarkdown = webImagesSectionMatch
      ? webImagesSectionMatch[1]
          .split('\n')
          .map((line) => line.replace(/^-\s*/, '').replace(/\s+\(Source:.*$/, '').trim())
          .filter((line) => line.startsWith('!['))
          .slice(0, 2)
          .join('\n\n')
      : '';

    const imagesSection = extractedImageMarkdown
      ? `\n### Web Images & Visual Reference\n\n${extractedImageMarkdown}\n`
      : '';

    const studyA2uiBlock = a2uiEnabled
      ? `\n\n\`\`\`a2ui\n${JSON.stringify(
          {
            title: isHeartQuery ? 'Cardiovascular Mastery Tracker' : 'Study Recall & Practice Hub',
            subtitle: 'Interactive self-check & next study actions',
            badge: 'Study A2UI',
            widgets: [
              {
                type: 'checklist',
                title: 'Concept Mastery Checklist',
                items: isHeartQuery
                  ? [
                      { id: 'c1', label: 'Trace blood flow from Vena Cava to Aorta', checked: false },
                      { id: 'c2', label: 'Apply Cardiac Output = HR × SV formula', checked: false },
                      { id: 'c3', label: 'Distinguish right vs left ventricular wall thickness', checked: false },
                    ]
                  : [
                      { id: 'c1', label: 'Understand the core mechanism & key variables', checked: false },
                      { id: 'c2', label: 'Walk through the visual flowchart step by step', checked: false },
                      { id: 'c3', label: 'Solve the self-check recall question without peeking', checked: false },
                    ],
              },
              {
                type: 'actions',
                buttons: [
                  {
                    label: 'Generate 4-Question Quiz',
                    prompt: `Create a 4-question multiple-choice practice quiz on ${cleanTopic}`,
                    variant: 'primary',
                  },
                  {
                    label: 'Build Flashcard Deck',
                    prompt: `Generate high-yield study flashcards for ${cleanTopic}`,
                    variant: 'secondary',
                  },
                ],
              },
            ],
          },
          null,
          2
        )}\n\`\`\``
      : '';

    const studyReply = isHeartQuery
      ? `## ${instructionPreview}: Human Heart Anatomy\n\n` +
        `> [!DEFINITION] Four-Chamber Pump\n> The human heart is a muscular four-chambered organ that circulates blood through the **pulmonary** (lung) and **systemic** (body) loops in a continuous double circuit.\n` +
        imagesSection +
        mermaidSection +
        `\n### Key Cardiovascular Formula\n\n` +
        `Cardiac output ($CO$) equals heart rate ($HR$) multiplied by stroke volume ($SV$):\n\n` +
        `$$\nCO = HR \\times SV\n$$\n\n` +
        `| Chamber / Vessel | Blood Oxygenation | Destination |\n` +
        `| :--- | :--- | :--- |\n` +
        `| **Right Ventricle** | Deoxygenated | Lungs via pulmonary artery |\n` +
        `| **Left Ventricle** | Oxygenated | Body via aorta |\n\n` +
        `> [!HINT]- Tap to reveal self-check\n> The **left ventricle** has the thickest myocardium because it pumps blood against high systemic arterial resistance.` +
        attachmentSummary +
        studyA2uiBlock
      : `## ${instructionPreview}: ${cleanTopic.slice(0, 56)}${cleanTopic.length > 56 ? '…' : ''}\n\n` +
        `> [!DEFINITION] Core Principle\n> **${cleanTopic}** links incoming signals to contextual relevance dynamically in parallel, rather than processing inputs strictly one token at a time.\n` +
        imagesSection +
        mermaidSection +
        `\n### Key Mathematical Formulation\n\n` +
        `The core relation scales dot products by $\\sqrt{d_k}$ so gradients remain well-conditioned:\n\n` +
        `$$\n\\text{Attention}(Q, K, V) = \\text{softmax}\\left(\\frac{Q K^T}{\\sqrt{d_k}}\\right) V\n$$\n\n` +
        `### Concepts at a Glance\n\n` +
        `| Component | Role in Practice | Diagnostic Question |\n` +
        `| :--- | :--- | :--- |\n` +
        `| **Query ($Q$)** | Defines what context is needed | What am I searching for? |\n` +
        `| **Key ($K$)** | Advertises token identity/features | What signal do I expose? |\n` +
        `| **Value ($V$)** | Supplies content aggregated by weight | What information gets passed? |\n\n` +
        (snippetNote ? `- **From Your Source:** \`${snippetNote.replace(/\s+/g, ' ').trim()}…\`\n\n` : '') +
        `> [!WARNING] Common Exam Trap\n> Forgetting the $\\frac{1}{\\sqrt{d_k}}$ scaling factor causes softmax outputs to saturate toward $0$ or $1$ at large dimensions, shrinking backprop gradients.\n\n` +
        `### Self-Check Question\n\n` +
        `What happens to gradient flow during backpropagation if $d_k$ becomes very large and scaling is omitted?\n\n` +
        `> [!HINT]- Tap to reveal answer\n> Raw dot products grow in variance proportional to $d_k$, pushing softmax into flat regions where gradients approach zero.\n` +
        attachmentSummary +
        studyA2uiBlock;

    await streamText(studyReply, (delta) => onEvent({ type: 'text_delta', delta }), signal);
    onEvent({ type: 'done' });
    return;
  }

  // General Chat mode — never invokes MCP tools
  if (chatMode === 'general') {
    const fileLine =
      userAttachments.length > 0
        ? `\n\nI received your attachment${userAttachments.length > 1 ? 's' : ''}: **${userAttachments.map((a) => a.name).join(', ')}**.`
        : '';
    const generalA2uiBlock = a2uiEnabled
      ? `\n\n\`\`\`a2ui\n${JSON.stringify(
          {
            title: 'Interactive Focus Planner',
            subtitle: 'Check off priorities or ask a follow-up',
            badge: 'General A2UI',
            widgets: [
              {
                type: 'checklist',
                title: 'Quick Action Steps',
                items: [
                  { id: 'g1', label: 'Block 90-minute deep-work morning slot', checked: true },
                  { id: 'g2', label: 'Batch messages & reviews after lunch', checked: false },
                  { id: 'g3', label: 'Wind down 45 min before sleep', checked: false },
                ],
              },
              {
                type: 'actions',
                buttons: [
                  {
                    label: 'Customize Schedule',
                    prompt: `Tailor this plan further for: ${userText.slice(0, 60)}`,
                    variant: 'primary',
                  },
                  {
                    label: 'Summarize Shorter',
                    prompt: 'Condense your previous response into 3 concise bullet points.',
                    variant: 'secondary',
                  },
                ],
              },
            ],
          },
          null,
          2
        )}\n\`\`\``
      : '';

    const generalReply =
      `Here is a direct **General Chat** response (${effort} effort, MCP tools paused):${fileLine}\n\n` +
      `You asked: *"${userText}"*\n\n` +
      `Switch to **Pro** mode anytime for Document Generation (PPTX, DOCX, XLSX, PDF), Coding Canvas, and MCP servers — or **Study** for flowcharts, KaTeX math, flashcards, and Study Reader.` +
      generalA2uiBlock;

    await streamText(generalReply, (delta) => onEvent({ type: 'text_delta', delta }), signal);
    onEvent({ type: 'done' });
    return;
  }

  // After MCP tool calls in Pro mode
  if (lastMessage?.role === 'tool') {
    const recentTools = messages.slice(-2).filter((m) => m.role === 'tool');
    const summaryLines = recentTools.map((t) => {
      if (t.role !== 'tool') return '';
      const displayName = t.toolName.includes('__') ? t.toolName.split('__').slice(1).join('__') : t.toolName;
      const cleanOutput = t.content
        .replace(/<untrusted_tool_output[^>]*>\s*/gi, '')
        .replace(/\s*<\/untrusted_tool_output>/gi, '')
        .trim();
      return t.isError
        ? `\`${displayName}\` notice: ${cleanOutput}`
        : `\`${displayName}\` completed:\n\n\`\`\`text\n${cleanOutput}\n\`\`\``;
    });
    const hasDenial = recentTools.some((t) => t.role === 'tool' && t.content.includes('denied'));
    const toolA2uiBlock = a2uiEnabled
      ? `\n\n\`\`\`a2ui\n${JSON.stringify(
          {
            title: hasDenial ? 'Approval Gate Paused' : 'MCP Execution Follow-Up',
            badge: 'Pro A2UI',
            widgets: [
              {
                type: 'callout',
                tone: hasDenial ? 'warning' : 'success',
                title: hasDenial ? 'Write Gate Respected' : 'Tool Execution Verified',
                text: hasDenial
                  ? 'No external state was modified. Review or adjust parameters below.'
                  : `Completed ${recentTools.length} MCP tool call(s) cleanly.`,
              },
              {
                type: 'actions',
                buttons: [
                  {
                    label: 'Export Summary (.PDF)',
                    prompt: 'Generate a concise PDF briefing summarizing the recent MCP tool results.',
                    style: 'primary',
                  },
                  {
                    label: 'List Sandbox Notes',
                    prompt: 'Search and list all workspace notes via MCP.',
                    style: 'secondary',
                  },
                ],
              },
            ],
          },
          null,
          2
        )}\n\`\`\``
      : '';
    const reply =
      (hasDenial
        ? `Understood — I respected your approval decision and paused that write step:\n\n${summaryLines.join('\n')}\n\nTell me how you would like to adjust parameters or proceed safely.`
        : effort === 'high'
          ? `Verified connected MCP tool output against your request:\n\n${summaryLines.join('\n')}\n\nEverything is synced. You can also export this summary as PDF, DOCX, XLSX, or PPTX below.`
          : `Completed via connected MCP tools:\n\n${summaryLines.join('\n')}`) + toolA2uiBlock;
    await streamText(reply, (delta) => onEvent({ type: 'text_delta', delta }), signal);
    onEvent({ type: 'done' });
    return;
  }

  // Pro Document Studio triggers: PPTX, XLSX, DOCX, PDF, and HTML Canvas
  if (lower.includes('pptx') || lower.includes('powerpoint') || lower.includes('presentation') || lower.includes('slide') || lower.includes('deck')) {
    const pptxSpec = buildContentFaithfulPptxSpec(userText, userAttachments);
    await streamText(
      `Designing a ${pptxSpec.slides.length}-slide executive presentation for "${pptxSpec.title}" using native slide layouts and speaker notes.`,
      (delta) => onEvent({ type: 'reasoning_delta', delta }),
      signal
    );

    const a2uiDocBlock = a2uiEnabled
      ? `\n\n\`\`\`a2ui\n${JSON.stringify(
          {
            title: 'Deck Quick Refine',
            badge: 'Pro A2UI',
            widgets: [
              {
                type: 'actions',
                buttons: [
                  {
                    label: 'Add Executive Risk Slide',
                    prompt: `Expand "${pptxSpec.title}" (.pptx) with a Risks & Mitigations slide.`,
                    variant: 'primary',
                  },
                  {
                    label: 'Convert Deck to PDF Brief',
                    prompt: `Generate a PDF briefing covering the exact contents of "${pptxSpec.title}".`,
                    variant: 'secondary',
                  },
                ],
              },
            ],
          },
          null,
          2
        )}\n\`\`\``
      : '';

    const reply =
      `## ${pptxSpec.title} Ready\n\n` +
      `I built a **${pptxSpec.slides.length}-slide PowerPoint presentation** tailored to your request (${pptxSpec.subtitle || 'native layouts & speaker notes'}).\n\n` +
      `\`\`\`artifact-pptx\n${JSON.stringify(pptxSpec, null, 2)}\n\`\`\`\n\n` +
      `Tap **Preview in Canvas** to step through every slide interactively, or **Download .PPTX** to open it in PowerPoint or Google Slides.` +
      a2uiDocBlock;

    await streamText(reply, (delta) => onEvent({ type: 'text_delta', delta }), signal);
    onEvent({ type: 'done' });
    return;
  }

  if (lower.includes('xlsx') || lower.includes('excel') || lower.includes('spreadsheet') || lower.includes('workbook') || lower.includes('budget')) {
    const xlsxSpec = buildContentFaithfulXlsxSpec(userText, userAttachments);
    await streamText(
      `Structuring multi-sheet Excel workbook "${xlsxSpec.title}" (${xlsxSpec.sheets.map((s) => s.name).join(', ')}).`,
      (delta) => onEvent({ type: 'reasoning_delta', delta }),
      signal
    );

    const xlsxA2uiBlock = a2uiEnabled
      ? `\n\n\`\`\`a2ui\n${JSON.stringify(
          {
            title: 'Spreadsheet Studio Controls',
            subtitle: `${xlsxSpec.sheets.length} worksheet tabs ready`,
            badge: 'Pro A2UI',
            widgets: [
              {
                type: 'kpi_grid',
                items: xlsxSpec.sheets.slice(0, 3).map((s) => ({
                  label: s.name,
                  value: `${s.rows.length} rows`,
                  hint: `${s.headers.length} columns`,
                })),
              },
              {
                type: 'actions',
                buttons: [
                  {
                    label: 'Generate Executive .PPTX',
                    prompt: `Create a PowerPoint presentation summarizing "${xlsxSpec.title}".`,
                    style: 'primary',
                  },
                  {
                    label: 'Generate Executive .PDF',
                    prompt: `Generate a PDF financial briefing covering "${xlsxSpec.title}".`,
                    style: 'secondary',
                  },
                ],
              },
            ],
          },
          null,
          2
        )}\n\`\`\``
      : '';

    const reply =
      `## ${xlsxSpec.title} Ready\n\n` +
      `I compiled a ${xlsxSpec.sheets.length}-tab Excel workbook (**${xlsxSpec.sheets.map((s) => s.name).join('** and **')}**).\n\n` +
      `\`\`\`artifact-xlsx\n${JSON.stringify(xlsxSpec, null, 2)}\n\`\`\`\n\n` +
      `Open **Preview in Canvas** to inspect all tabs or click **Download .XLSX** to open directly in Excel / Google Sheets.` +
      xlsxA2uiBlock;

    await streamText(reply, (delta) => onEvent({ type: 'text_delta', delta }), signal);
    onEvent({ type: 'done' });
    return;
  }

  if (lower.includes('docx') || lower.includes('word doc') || lower.includes('pdf') || lower.includes('proposal') || lower.includes('report')) {
    const fmt = lower.includes('docx') || lower.includes('word') ? 'docx' : 'pdf';
    const docSpec = buildContentFaithfulDocumentSpec({
      format: fmt,
      userText,
      attachments: userAttachments,
    });
    const sectionNames = docSpec.sections.map((s) => s.heading).join(', ');
    await streamText(
      `Organizing content-faithful ${fmt.toUpperCase()} document "${docSpec.title}" covering ${sectionNames}.`,
      (delta) => onEvent({ type: 'reasoning_delta', delta }),
      signal
    );

    const a2uiDocControls = a2uiEnabled
      ? `\n\n\`\`\`a2ui\n${JSON.stringify(
          {
            title: 'Document Studio Controls',
            subtitle: 'Tailor sections or export in another format',
            badge: 'Pro A2UI',
            widgets: [
              ...(docSpec.metrics && docSpec.metrics.length > 0
                ? [
                    {
                      type: 'kpi_grid',
                      items: docSpec.metrics.map((m) => ({
                        label: m.label,
                        value: m.value,
                        delta: m.note,
                        tone: 'positive',
                      })),
                    },
                  ]
                : []),
              {
                type: 'actions',
                buttons: [
                  {
                    label: `Expand "${docSpec.title}"`,
                    prompt: `Expand "${docSpec.title}" (.${fmt}) with deeper technical benchmarks and implementation steps.`,
                    variant: 'primary',
                  },
                  {
                    label: fmt === 'pdf' ? 'Also Generate .DOCX' : 'Also Generate .PDF',
                    prompt: `Generate a ${fmt === 'pdf' ? 'DOCX' : 'PDF'} version of "${docSpec.title}" keeping every section.`,
                    variant: 'secondary',
                  },
                ],
              },
            ],
          },
          null,
          2
        )}\n\`\`\``
      : '';

    const reply =
      `## ${docSpec.title} (.${fmt.toUpperCase()}) Ready\n\n` +
      `Your formatted **${fmt.toUpperCase()}** document is ready covering **${sectionNames}** with structured metrics, callouts, and styled tables.\n\n` +
      `\`\`\`artifact-${fmt}\n${JSON.stringify(docSpec, null, 2)}\n\`\`\`\n\n` +
      `You can preview the page layout in **Canvas** or download the ready-to-share **.${fmt.toUpperCase()}** file.` +
      a2uiDocControls;

    await streamText(reply, (delta) => onEvent({ type: 'text_delta', delta }), signal);
    onEvent({ type: 'done' });
    return;
  }

  if (
    lower.includes('multi-file') ||
    lower.includes('multifile') ||
    lower.includes('web app') ||
    lower.includes('build an app') ||
    lower.includes('develop an app') ||
    lower.includes('application') ||
    lower.includes('kanban') ||
    lower.includes('task tracker')
  ) {
    await streamText(
      'Architecting a modular multi-file web application (index.html, styles.css, app.js, README.md) with live Canvas bundling and GitHub MCP sync readiness.',
      (delta) => onEvent({ type: 'reasoning_delta', delta }),
      signal
    );

    const appSpec = {
      title: 'Sprint Taskboard Pro',
      description: 'Multi-file interactive engineering sprint board ready for live Canvas preview and GitHub sync.',
      framework: 'HTML / CSS / ES6',
      entryFile: 'index.html',
      files: [
        {
          path: 'index.html',
          language: 'html',
          content: `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Sprint Taskboard Pro</title>
  <link rel="stylesheet" href="./styles.css" />
</head>
<body>
  <main class="shell">
    <header class="topbar">
      <div>
        <h1>Sprint Taskboard Pro</h1>
        <p>Multi-file Pro Canvas app · Sync straight to GitHub</p>
      </div>
      <div class="pill" id="countPill">3 tasks</div>
    </header>
    <form class="composer" id="taskForm">
      <input id="taskInput" type="text" placeholder="Add engineering task or bug fix..." required />
      <button type="submit">Add Task</button>
    </form>
    <section class="board" id="taskList"></section>
  </main>
  <script src="./app.js"></script>
</body>
</html>`,
        },
        {
          path: 'styles.css',
          language: 'css',
          content: `:root {
  color-scheme: light;
  --bg: #f8fafc;
  --card: #ffffff;
  --border: #e2e8f0;
  --ink: #0f172a;
  --muted: #64748b;
  --accent: #0b57d0;
}
* { box-sizing: border-box; font-family: system-ui, -apple-system, sans-serif; }
body { margin: 0; padding: 20px; background: var(--bg); color: var(--ink); }
.shell { max-width: 620px; margin: 0 auto; background: var(--card); border: 1px solid var(--border); border-radius: 20px; padding: 20px; }
.topbar { display: flex; justify-content: space-between; align-items: flex-start; gap: 12px; margin-bottom: 16px; }
h1 { margin: 0; font-size: 18px; }
.topbar p { margin: 4px 0 0; font-size: 12px; color: var(--muted); }
.pill { font-size: 12px; font-weight: 600; background: #eff6ff; color: var(--accent); border: 1px solid #bfdbfe; padding: 5px 10px; border-radius: 999px; font-variant-numeric: tabular-nums; }
.composer { display: flex; gap: 8px; margin-bottom: 16px; }
.composer input { flex: 1; padding: 10px 12px; border: 1px solid var(--border); border-radius: 12px; font-size: 13px; }
.composer button { padding: 10px 16px; border: 0; border-radius: 12px; background: var(--accent); color: #fff; font-weight: 600; font-size: 13px; cursor: pointer; }
.board { display: flex; flex-direction: column; gap: 8px; }
.item { display: flex; align-items: center; justify-content: space-between; gap: 10px; padding: 10px 12px; border: 1px solid var(--border); border-radius: 12px; font-size: 13px; }
.item.done span { text-decoration: line-through; color: var(--muted); }
.item button { border: 1px solid var(--border); background: #fff; border-radius: 8px; padding: 5px 10px; font-size: 11px; font-weight: 600; cursor: pointer; }`,
        },
        {
          path: 'app.js',
          language: 'javascript',
          content: `const tasks = [
  { id: 1, title: 'Verify Gemini thoughtSignature multi-turn tool replay', done: true },
  { id: 2, title: 'Ship multi-file Pro Canvas preview & runtime console', done: false },
  { id: 3, title: 'Push repository batch commit via GitHub MCP', done: false },
];

const listEl = document.getElementById('taskList');
const pillEl = document.getElementById('countPill');
const formEl = document.getElementById('taskForm');
const inputEl = document.getElementById('taskInput');

function render() {
  pillEl.textContent = tasks.length + (tasks.length === 1 ? ' task' : ' tasks');
  listEl.innerHTML = '';
  tasks.forEach((task) => {
    const row = document.createElement('div');
    row.className = 'item' + (task.done ? ' done' : '');
    const label = document.createElement('span');
    label.textContent = task.title;
    const toggle = document.createElement('button');
    toggle.type = 'button';
    toggle.textContent = task.done ? 'Reopen' : 'Done';
    toggle.addEventListener('click', () => {
      task.done = !task.done;
      render();
    });
    row.append(label, toggle);
    listEl.appendChild(row);
  });
}

formEl.addEventListener('submit', (ev) => {
  ev.preventDefault();
  const val = inputEl.value.trim();
  if (!val) return;
  tasks.unshift({ id: Date.now(), title: val, done: false });
  inputEl.value = '';
  render();
});

render();`,
        },
        {
          path: 'README.md',
          language: 'markdown',
          content: `# Sprint Taskboard Pro\n\nBuilt inside **MCP Hub Pro Studio** as a modular 4-file web application.\n\n## Files\n- \`index.html\` — Semantic shell & form layout\n- \`styles.css\` — Responsive CSS variables & board styling\n- \`app.js\` — State rendering & interactive task toggles\n\nUse **Sync to GitHub** in Pro Canvas to push all files cleanly in a single commit.`,
        },
      ],
    };

    const appA2uiBlock = a2uiEnabled
      ? `\n\n\`\`\`a2ui\n${JSON.stringify(
          {
            title: 'IDE App Delivery Controls',
            subtitle: '4 modular files ready for Canvas & GitHub',
            badge: 'Pro A2UI',
            widgets: [
              {
                type: 'checklist',
                title: 'App Architecture Checklist',
                items: [
                  { id: 'app1', label: 'Semantic HTML shell (index.html)', checked: true },
                  { id: 'app2', label: 'Responsive CSS variables (styles.css)', checked: true },
                  { id: 'app3', label: 'Interactive JS state & GitHub sync ready (app.js)', checked: true },
                ],
              },
              {
                type: 'actions',
                buttons: [
                  {
                    label: 'Sync to GitHub Repo',
                    prompt: 'Push the Sprint Taskboard Pro application files to a new GitHub repository via GitHub MCP.',
                    style: 'primary',
                  },
                  {
                    label: 'Add Unit Tests Spec',
                    prompt: 'Add a lightweight test suite and architecture overview PDF for Sprint Taskboard Pro.',
                    style: 'secondary',
                  },
                ],
              },
            ],
          },
          null,
          2
        )}\n\`\`\``
      : '';

    const reply =
      `## Multi-File App Engineered: Sprint Taskboard Pro\n\n` +
      `I created a **4-file application** (\`index.html\`, \`styles.css\`, \`app.js\`, \`README.md\`) with live interactive task state and responsive styling.\n\n` +
      `\`\`\`artifact-app\n${JSON.stringify(appSpec, null, 2)}\n\`\`\`\n\n` +
      `Tap **Open IDE Canvas** below to test the live app across Desktop/Tablet/Mobile viewports, inspect or edit every file, and **Sync to GitHub**.` +
      appA2uiBlock;

    await streamText(reply, (delta) => onEvent({ type: 'text_delta', delta }), signal);
    onEvent({ type: 'done' });
    return;
  }

  if (lower.includes('canvas') || lower.includes('html') || lower.includes('interactive app') || lower.includes('widget') || lower.includes('roi calculator')) {
    await streamText(
      'Designing a responsive self-contained HTML/CSS/JS ROI calculator widget for live sandboxed Canvas preview.',
      (delta) => onEvent({ type: 'reasoning_delta', delta }),
      signal
    );
    const htmlCode = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width,initial-scale=1" />
<title>Team ROI Calculator</title>
<style>
  * { box-sizing: border-box; font-family: system-ui, -apple-system, sans-serif; }
  body { margin: 0; padding: 20px; background: #f8fafc; color: #0f172a; }
  .card { max-width: 460px; margin: 0 auto; background: #fff; border: 1px solid #e2e8f0; border-radius: 20px; padding: 20px; box-shadow: 0 2px 10px rgba(15,23,42,0.05); }
  h1 { margin: 0 0 6px; font-size: 18px; }
  p { margin: 0 0 18px; font-size: 13px; color: #475569; }
  .row { margin-bottom: 14px; }
  label { display: flex; justify-content: space-between; font-size: 12px; font-weight: 600; margin-bottom: 6px; }
  input[type=range] { width: 100%; accent-color: #0b57d0; }
  .grid { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; margin-top: 16px; }
  .kpi { background: #eff6ff; border: 1px solid #bfdbfe; border-radius: 14px; padding: 12px; }
  .kpi span { display: block; font-size: 11px; color: #1e40af; font-weight: 600; }
  .kpi strong { font-size: 22px; color: #0f172a; font-variant-numeric: tabular-nums; }
</style>
</head>
<body>
  <div class="card">
    <h1>Workflow Automation ROI</h1>
    <p>Adjust team size and hours saved weekly to estimate annual impact.</p>
    <div class="row">
      <label>Team Size <span id="teamVal">12 people</span></label>
      <input id="team" type="range" min="1" max="100" value="12" />
    </div>
    <div class="row">
      <label>Hours Saved / Person / Week <span id="hrsVal">4 hrs</span></label>
      <input id="hrs" type="range" min="1" max="20" value="4" />
    </div>
    <div class="row">
      <label>Blended Hourly Cost <span id="rateVal">$85/hr</span></label>
      <input id="rate" type="range" min="25" max="250" step="5" value="85" />
    </div>
    <div class="grid">
      <div class="kpi"><span>Hours Reclaimed / Yr</span><strong id="yrHrs">2,496</strong></div>
      <div class="kpi"><span>Estimated Value / Yr</span><strong id="yrVal">$212,160</strong></div>
    </div>
  </div>
  <script>
    const team = document.getElementById('team');
    const hrs = document.getElementById('hrs');
    const rate = document.getElementById('rate');
    function update() {
      const t = +team.value, h = +hrs.value, r = +rate.value;
      document.getElementById('teamVal').textContent = t + ' people';
      document.getElementById('hrsVal').textContent = h + ' hrs';
      document.getElementById('rateVal').textContent = '$' + r + '/hr';
      const totalH = t * h * 52;
      document.getElementById('yrHrs').textContent = totalH.toLocaleString();
      document.getElementById('yrVal').textContent = '$' + (totalH * r).toLocaleString();
    }
    [team, hrs, rate].forEach(el => el.addEventListener('input', update));
    update();
  </script>
</body>
</html>`;

    const htmlA2uiBlock = a2uiEnabled
      ? `\n\n\`\`\`a2ui\n${JSON.stringify(
          {
            title: 'ROI Widget Quick Tweaks',
            badge: 'Pro A2UI',
            widgets: [
              {
                type: 'actions',
                buttons: [
                  {
                    label: 'Upgrade to Multi-File App',
                    prompt: 'Build a multi-file web app version of the Team ROI Calculator with CSV export.',
                    style: 'primary',
                  },
                  {
                    label: 'Export ROI Model (.XLSX)',
                    prompt: 'Generate an Excel workbook (.xlsx) for Team Workflow Automation ROI projections.',
                    style: 'secondary',
                  },
                ],
              },
            ],
          },
          null,
          2
        )}\n\`\`\``
      : '';

    const reply =
      `## Interactive ROI Calculator Built\n\n` +
      `Click **Open in Canvas** below to run and tweak this interactive widget live.\n\n` +
      `\`\`\`html\n${htmlCode}\n\`\`\`` +
      htmlA2uiBlock;

    await streamText(reply, (delta) => onEvent({ type: 'text_delta', delta }), signal);
    onEvent({ type: 'done' });
    return;
  }

  // Standard MCP tool triggers
  const searchTool = tools.find((t) => t.originalName === 'workspace_search_notes');
  const calcTool = tools.find((t) => t.originalName === 'calculate_expression');
  const createTool = tools.find((t) => t.originalName === 'workspace_create_note');
  const deleteTool = tools.find((t) => t.originalName === 'workspace_delete_note');

  const proposedCalls: LlmToolCall[] = [];

  if ((lower.includes('create') || lower.includes('save') || lower.includes('write') || lower.includes('add note')) && createTool) {
    const titleMatch = userText.match(/(?:titled|called|named)\s+"([^"]+)"/i);
    const title = titleMatch ? titleMatch[1] : 'MCP Hub Session Note';
    proposedCalls.push({
      id: `demo_call_${Date.now()}`,
      name: createTool.qualifiedName,
      rawArguments: JSON.stringify({ title, content: userText }),
      parsedArguments: { title, content: userText },
    });
  } else if ((lower.includes('delete') || lower.includes('remove')) && deleteTool) {
    const idMatch = userText.match(/note-\d+/i);
    const noteId = idMatch ? idMatch[0] : 'note-1';
    proposedCalls.push({
      id: `demo_call_${Date.now()}`,
      name: deleteTool.qualifiedName,
      rawArguments: JSON.stringify({ id: noteId }),
      parsedArguments: { id: noteId },
    });
  } else if ((lower.includes('calc') || /[0-9]+\s*[+\-*/]\s*[0-9]+/.test(userText)) && calcTool) {
    const exprMatch = userText.match(/([0-9().+\-*/\s]{3,})/);
    const expr = exprMatch ? exprMatch[1].trim() : '24 * 7';
    proposedCalls.push({
      id: `demo_call_${Date.now()}`,
      name: calcTool.qualifiedName,
      rawArguments: JSON.stringify({ expression: expr }),
      parsedArguments: { expression: expr },
    });
  } else if ((lower.includes('note') || lower.includes('search') || lower.includes('list') || lower.includes('mcp')) && searchTool) {
    proposedCalls.push({
      id: `demo_call_${Date.now()}`,
      name: searchTool.qualifiedName,
      rawArguments: JSON.stringify({ query: '' }),
      parsedArguments: { query: '' },
    });
  }

  if (proposedCalls.length > 0) {
    await streamText(
      `Inspecting ${tools.length} connected MCP tools and preparing verified call parameters for ${proposedCalls[0].name.split('__').slice(1).join('__')}.`,
      (delta) => onEvent({ type: 'reasoning_delta', delta }),
      signal
    );
    onEvent({ type: 'tool_calls', calls: proposedCalls });
    onEvent({ type: 'done' });
    return;
  }

  const toolCount = tools.length;
  const fallbackA2uiBlock = a2uiEnabled
    ? `\n\n\`\`\`a2ui\n${JSON.stringify(
        {
          title: 'Pro Studio Quick Launch',
          subtitle: `${toolCount} active MCP tool${toolCount === 1 ? '' : 's'} ready`,
          badge: 'Pro A2UI',
          widgets: [
            {
              type: 'actions',
              buttons: [
                {
                  label: 'Generate .PPTX Deck',
                  prompt: 'Build a Q3 executive presentation deck (.pptx)',
                  style: 'primary',
                },
                {
                  label: 'Build Multi-File App',
                  prompt: 'Build a multi-file web app taskboard',
                  style: 'secondary',
                },
                {
                  label: 'Run 24 * 7 Calc',
                  prompt: 'Calculate 24 * 7 using MCP',
                  style: 'secondary',
                },
              ],
            },
          ],
        },
        null,
        2
      )}\n\`\`\``
    : '';

  const fallbackReply =
    `I am running in **Pro Studio Simulator** mode with **${toolCount}** active MCP tool${toolCount === 1 ? '' : 's'} (${effort} effort).\n\n` +
    `Try asking me to:\n` +
    `- **"Build a Q3 executive presentation deck (.pptx)"** (native PowerPoint slides + Canvas)\n` +
    `- **"Generate a financial Excel workbook (.xlsx)"** (multi-sheet spreadsheet)\n` +
    `- **"Write an enterprise PDF report"** (formatted PDF & DOCX)\n` +
    `- **"Build an interactive HTML ROI calculator for Canvas"** (live Coding Canvas preview)\n` +
    `- **"Create a note titled \\"Release Plan\\""** (interactive write-action approval)\n\n` +
    `For live Gemini, Groq, or OpenRouter inference, add your free API key in **Settings**.` +
    fallbackA2uiBlock;

  await streamText(fallbackReply, (delta) => onEvent({ type: 'text_delta', delta }), signal);
  onEvent({ type: 'done' });
}
