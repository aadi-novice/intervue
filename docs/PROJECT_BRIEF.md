# Intervue: Project Brief for Marketing and Content

> **Purpose of this document:** give any person or AI agent (including a browser agent with no access to our code) everything needed to understand what Intervue is, why it is different, who it is for, what is real vs. not yet real, and how to market it, especially through LinkedIn. Read section 9 ("Claims") before writing anything public.

---

## 1. One-paragraph summary

**Intervue is an interview-intelligence platform for hiring teams.** A company signs up, opens roles, drops in hundreds of resumes, and runs interviews on the meeting tool it already uses. Intervue ranks the resumes against each role, joins the interview with a notetaker bot that records and transcribes it, then produces notes and an analysis where **every score and every claim points back to the exact line of the resume or the transcript that supports it**. Humans run the interviews and make every decision; Intervue is the analysis layer, and its output is always labelled a suggestion.

**Tagline options** (pick one, test the others):
1. "Hiring decisions you can show your work for."
2. "Every score, with the receipt."
3. "The interview notetaker that has to cite its sources."
4. "Rank resumes. Capture interviews. Keep the evidence."

---

## 2. The problem

Hiring teams lose time and quality in four places:

| Pain | What actually happens today |
|---|---|
| **Resume overload** | A role gets 200+ resumes. Someone skims them in 6 seconds each. Good candidates are missed; rankings are gut feel and are hard to defend or repeat. |
| **Interview notes are bad** | Interviewers type while talking, or write notes hours later from memory. Details are lost, and different interviewers capture different things. |
| **Opaque AI scoring** | Many AI hiring tools output a number or a verdict with no explanation. Recruiters cannot tell if it is right, and candidates and regulators increasingly ask how decisions were made. |
| **Bias and risk** | Names, schools and photos influence early screening. Recording calls without clear consent is a legal and trust problem. |

---

## 3. Who it is for

**Primary buyer and user:** in-house recruiters and talent-acquisition leads at startups and mid-size companies (roughly 20–1,000 employees) who hire repeatedly and run interviews on Google Meet, Teams or Zoom.

**Secondary users:**
- **Hiring managers**: want a comparison of finalists, not a pile of transcripts.
- **Interviewers**: want to focus on the candidate instead of typing, and to see what the previous round already covered.
- **Agencies and recruiting firms**: many roles, many resumes, need fast shortlisting.
- **Founders hiring their first 10 people**: no ATS, no process, little time.

**Org roles in the product:** admin, recruiter, hiring manager, interviewer (each sees only what they should).

---

## 4. What the product does (built today)

### 4.1 Resume ranking
- **Bulk intake:** drop up to 500 PDFs/DOCX files or a ZIP; duplicates are detected; progress is shown live.
- **Rubrics:** each role has a weighted rubric (criteria, weights, must-haves). The AI can **suggest a rubric from the job description**, which the recruiter edits before saving.
- **Two-stage ranking:** fast vector search shortlists the best matches, then an AI scores each rubric criterion 0–5.
- **Evidence for every score:** each criterion score shows **verbatim quotes from the resume**. The system checks the quotes really exist in the resume; if the AI cannot quote support, the score is capped. Fabricated quotes never reach the screen.
- **Must-have flags:** a failed must-have is surfaced clearly.
- **Cross-role matching:** "this candidate is also a strong fit for another open role."
- **Cost shown:** the total AI cost of each ranking run is displayed.

### 4.2 Interview capture (notetaker bot)
- Paste a **Google Meet** link (or connect a calendar). A bot joins as a guest, waits to be admitted, **posts a recording notice in the meeting chat**, records audio, and leaves when the meeting ends.
- **Speaker labels** come from the meeting's active-speaker signal, so the transcript says who spoke.
- Transcript, notes (summary, key points, topics) and **suggested follow-up questions for the next round** are generated automatically.
- Alternatively: upload a transcript (`.txt .vtt .srt .docx`) or an audio/video recording.

### 4.3 Interview analysis with citations
- Summary, strengths, weaknesses, key moments, technical/communication/confidence scores and a hire suggestion.
- **Every strength, weakness and moment links to the transcript lines that support it.** Clicking a citation jumps to that moment in the transcript and audio.
- **Resume-vs-interview claim checks:** each resume claim is marked *verified*, *unclear* or *contradicted*, using only what the **candidate** said (never the interviewer's words). A verdict without a quotable candidate line is automatically downgraded to *unclear*.

### 4.4 Decision support
- **Summary card** per candidate per role: resume fit with per-criterion bars, interview scores, claim-check flags, notes excerpt, and an **AI suggestion** (Strong yes / Yes / Lean no / No) always captioned *"AI suggestion — final decision by your team."*
- **Ranked list** with filters (must-haves met, score range, stage, interviewed) and a **side-by-side compare** of 2–4 candidates with the best value per row highlighted.
- Kanban **pipeline**, talent pool with "best matching role", dashboard with upcoming interviews and recent analyses.

### 4.5 Calendar auto-join
- Connect Google Calendar or Outlook. Meetings that have a video link and a **known candidate** among the attendees become interviews automatically.
- Per-user setting: send the notetaker to **all** such interviews, **only the ones I tag**, or **never**.

### 4.6 Fairness, privacy and control
- **Blind review mode:** hide name, photo, email and school until a reviewer explicitly reveals them; every reveal is logged. Names, emails, phone numbers and school names are also stripped from the resume text before the AI scores it.
- **Recording consent is mandatory:** the bot always posts a notice; organizations can re-word it but cannot turn it off; when it was sent is logged.
- **Multi-tenant security:** strict per-company data isolation, role-based access, audit log, private storage with short-lived links.
- **Audit trail:** who viewed, created, deleted, revealed or ran analysis.

---

## 5. What makes it different (the unique angles)

Use these as the core story. Ordered by strength.

1. **Evidence on everything ("show your work").** Most AI hiring tools give a score or verdict. Ours gives a score *plus the quote that justifies it*, and the system verifies the quote is real. This is the single most defensible and most shareable differentiator.
2. **Claim checks that only trust the candidate's own words.** Resume claims are tested against what the candidate actually said in the interview, and an unsupported verdict is downgraded rather than asserted.
3. **Humans decide; AI suggests.** No automated hire/reject. No AI interviewer. Every suggestion is labelled as such. This is a deliberate stance, not a missing feature.
4. **Bias guardrails built in, not bolted on.** Redacted resume text for scoring, optional blind review with logged reveals.
5. **One pipeline from resume to decision.** Resume ranking, interview capture, analysis and comparison live in one product instead of four tools.
6. **Works on the meeting tools teams already use.** No new meeting software for candidates to install.
7. **Cost transparency.** AI spend is tracked per run and shown, which matters for a product whose cost scales with usage.
8. **Open, portable architecture.** Runs as containers on AWS, Render or a single server; storage and bot launching are swappable. Useful for teams with data-residency or vendor-lock concerns.

---

## 6. Honest limits (read before promising anything)

| Not there yet | Detail |
|---|---|
| **Meeting platforms** | The notetaker works with **Google Meet only**. Teams and Zoom links are recognised, but the bot cannot join them yet. For those, users upload a transcript or recording. |
| **Real-world validation** | The Meet bot has been tested against recorded page fixtures, **not yet in a large number of real meetings**. Selectors can break when Google changes its UI. Treat reliability claims carefully. |
| **AI quality** | Prompts have **not** been tuned against a real evaluation set. Do not publish accuracy numbers. |
| **Speaker separation for uploaded audio** | Uploaded recordings produce a single speaker label; users map speakers by hand. Meet recordings made by the bot do get speaker labels. |
| **Not built** | Teams and Zoom bots, retention and "delete my data" tooling, org-wide export, billing, webhooks/API keys, ATS integrations, in-app notifications (email only). |
| **Compliance** | There is **no certification** (SOC 2, ISO, etc.) and no formal bias audit. Do not claim compliance. |
| **Google calendar access** | Until Google approves the app, new users see an "unverified app" warning and there is a cap on users. |

---

## 7. Positioning and messaging

**Category:** interview intelligence / AI-assisted hiring analysis (not an ATS, not an AI interviewer).

**Positioning statement:** *For recruiting teams that want faster, fairer, better-documented hiring decisions, Intervue is the interview-intelligence platform that ranks resumes and analyses interviews with evidence behind every score. Unlike black-box AI screening tools, Intervue shows the exact resume quote or transcript line behind each conclusion, and leaves the decision to people.*

**Messaging pillars** (each can anchor a post, a landing-page section and a demo segment):
1. **Receipts, not vibes.** Every score is backed by a quote you can click.
2. **You decide.** AI suggests, humans choose, and the product says so out loud.
3. **Fairer by design.** Blind review and redaction reduce what can bias a screen.
4. **From pile to shortlist in minutes.** Bulk resume ranking with a rubric you control.
5. **Never take notes again.** The bot captures the interview and writes the follow-up questions.

**Words to prefer:** evidence, citations, suggestion, rubric, shortlist, transparent, auditable.
**Words to avoid:** "fully automated hiring", "AI picks the best candidate", "bias-free", "guaranteed", "replaces recruiters", "compliant" (unless a certification exists).

---

## 8. Audiences, channels and how to reach them

### 8.1 LinkedIn is the primary channel
Recruiters, TA leaders, founders and hiring managers are all on LinkedIn, and "hiring" content performs well there.

**Two kinds of presence:**
- **Founder/personal profile** (best reach): build-in-public posts, opinions, demos, lessons.
- **Company page:** product announcements, release notes, case studies; lower reach, but needed for credibility.

**Posting cadence (first 8 weeks):** 3 posts a week. Suggested mix: 1 educational/opinion, 1 product demo or screenshot, 1 build-in-public/story. Reply to every comment in the first hour.

### 8.2 Other channels worth using
- **Short demo video** (60–90 s) embedded on the landing page and posted natively on LinkedIn.
- **Communities:** recruiting and HR-tech groups, startup founder communities, relevant subreddits (follow each community's self-promotion rules).
- **Product Hunt / Hacker News "Show" post** once there is a live demo.
- **Direct outreach** to 30–50 recruiters at companies that hire often (template in 8.5).
- **A public changelog** and a small blog; each shipped feature is a post.

### 8.3 LinkedIn content pillars
1. **Opinion:** "Why AI hiring scores without evidence are a liability."
2. **Education:** how to build a rubric; how to run a structured interview; what to write in a scorecard.
3. **Demo:** 30–60 s screen recording of one feature (the citation click is the hero shot).
4. **Build in public:** decisions, trade-offs, numbers, mistakes.
5. **Fairness and trust:** blind review, consent, human-in-the-loop.
6. **Proof:** early user feedback, before/after time saved (only real numbers).

### 8.4 Ready-to-edit post drafts

> Replace bracketed items. Keep claims within section 9. Add a screenshot or short screen recording to every post.

**Post 1: Launch / the idea**
> Most AI hiring tools give you a score.
> None of them show their work.
>
> So when an AI says "Candidate A: 82", what is that based on?
> Can you check it? Can you defend it to a hiring manager? To the candidate?
>
> We're building Intervue around one rule: **every score comes with a receipt.**
> Click any conclusion and you land on the exact resume line or interview moment behind it.
>
> It ranks resumes against a rubric you control, records interviews, and flags where a resume claim doesn't match what the candidate actually said.
> AI suggests. Your team decides.
>
> Early access soon. Would this change how your team hires? 👇

**Post 2: The hero feature (video)**
> 30 seconds: how we stop AI from making things up in hiring.
>
> 1. The AI scores a resume against your rubric and quotes the evidence.
> 2. We check every quote really exists in the resume.
> 3. If it can't quote support, the score is capped.
>
> No invented evidence reaches the screen.
> [screen recording of expanding a criterion and its quote]

**Post 3: Opinion**
> Unpopular opinion: "AI recommends hire" is the least useful output an interview tool can give you.
>
> What's useful:
> • What did the candidate actually say about X?
> • Does that match their resume?
> • What should the next interviewer ask?
>
> A verdict you can't inspect is a liability. Evidence you can inspect is leverage.

**Post 4: Education (carousel)**
> How to build a hiring rubric in 10 minutes (and stop re-debating every candidate)
> Slide 1: Why unstructured screening drifts
> 2: Pick 4–6 criteria that predict success in this role
> 3: Mark the true deal-breakers as must-haves (max 2)
> 4: Weight the rest
> 5: Score every resume the same way
> 6: Keep the evidence next to every score
> 7: CTA: we turned this into software [link]

**Post 5: Fairness**
> Names, schools and photos shape first impressions, even when we try to be fair.
> In Intervue's blind mode they're hidden until a reviewer deliberately reveals them, and every reveal is logged. The AI also never sees them when scoring.
> It doesn't make hiring bias-free (nothing does). It removes some of the easiest ways for bias to creep in, and leaves a trail.

**Post 6: Trust and consent**
> Our interview bot can't be switched off from saying hello.
> The moment it joins a call it posts a recording notice in the chat. Companies can reword it, but not disable it, and we log when it was sent.
> If you record people, they should know. We made that the default, not a setting.

**Post 7: Build in public**
> What I learned building an interview-analysis tool this week:
> [one real lesson, e.g. "the hardest part wasn't the AI, it was making the AI's claims checkable"]
> [one number, one screenshot, one question to the audience]

**Post 8: Demo walkthrough**
> From 200 resumes to a ranked shortlist in one afternoon:
> → drop the files in
> → set the rubric
> → read the evidence behind each score
> → compare your top 3 side by side
> [60-second video]

**Hooks that tend to work (reuse the pattern):** a counter-intuitive claim; a concrete number; "Most people think X. Here's what actually happens"; a before/after.

### 8.5 Direct outreach template (LinkedIn DM or email)
> Hi [Name], I saw [company] is hiring for [role]. I'm building a tool that ranks resumes against your rubric and shows the exact quote behind every score, and records interviews with notes tied to the transcript. Would you be open to 15 minutes of feedback on a demo? No pitch, I'm trying to learn how you screen today.

### 8.6 Landing page outline
1. Hero: tagline + 60 s video + "Request early access".
2. The problem in one sentence.
3. Three screenshots: ranked list with evidence, interview analysis with citation links, compare view.
4. "How it works" in 4 steps.
5. Trust section: humans decide, blind review, mandatory consent notice.
6. FAQ: Which meeting tools? (Google Meet today.) Does it make hiring decisions? (No.) Where is data stored? (Isolated per company, private storage.) Is it compliant with X? (Do not claim; say what exists.)
7. Early-access form.

### 8.7 Demo script (90 seconds)
1. (0–10 s) Role with a rubric and 200 resumes uploaded.
2. (10–30 s) Ranked list; open the top card; expand a criterion to show the quote.
3. (30–50 s) Open an interview; click a strength; jump to the transcript line and play the audio.
4. (50–65 s) Claim check: one resume claim marked *contradicted* with the candidate's own words.
5. (65–80 s) Compare three finalists side by side.
6. (80–90 s) Blind mode toggle and the caption "AI suggestion — final decision by your team".

---

## 9. Claims: what we can and cannot say

| Safe to say | Do **not** say (not true or not proven) |
|---|---|
| Every score links to the resume quote or transcript line behind it | "Always accurate" / "95% accurate" (no evaluation has been run) |
| The system verifies quotes exist and caps unsupported scores | "Eliminates bias" / "bias-free" / "EEOC/GDPR/SOC 2 compliant" |
| Humans make the decision; AI output is a labelled suggestion | "Fully automated hiring" / "replaces your recruiters" |
| Works with Google Meet today; Teams and Zoom via transcript/recording upload | "Works with Teams and Zoom bots" (bot not built) |
| Recording notice is mandatory and logged | "Candidates never notice the bot" |
| Blind review hides identity until a logged reveal | "Saves X hours per hire" (no measured data yet; wait for real users) |
| Per-run AI cost is tracked and visible | Specific cost per interview as a public promise (estimate only, about a few cents, unverified) |
| Runs on AWS, Render or a single server | Any customer logos, testimonials or numbers we do not have |

**Rule:** if a number or customer story isn't real yet, leave it out. Credibility matters more than reach.

---

## 10. Competitive context (keep it general)

Intervue sits between several categories. Position against the *approach*, not named competitors, unless you have verified current facts about them:
- **AI meeting notetakers** (general purpose): capture meetings, but are not built around rubrics, resume evidence or hiring comparisons.
- **Interview-intelligence and recruiting-AI tools:** often score or recommend; the gap we aim at is *verifiable evidence per score* and *candidate-only claim checks*.
- **ATS platforms:** manage pipelines and compliance records; usually shallow on analysis. Intervue is complementary, and ATS integration is a future item.
- **Spreadsheets + manual scorecards:** the real incumbent for small teams.

---

## 11. Success metrics to track

- **Awareness:** profile views, follower growth, post impressions, video views.
- **Interest:** early-access sign-ups, demo requests, replies to outreach.
- **Quality of interest:** number of recruiters willing to do a 15-minute feedback call; number who bring a real role and resumes.
- **Product-market signals:** time from upload to shortlist, share of scores whose evidence reviewers agree with, repeat usage across roles.
- **Content learning:** which hooks and pillars drive sign-ups (not just likes).

**First 30 days goal (suggested):** 12 posts, 1 demo video, 30 outreach messages, 10 feedback calls, 25 early-access sign-ups.

---

## 12. Facts about the company/project (for accuracy)

- **Product name:** Intervue.
- **Stage:** working product, not yet launched publicly; no paying customers or published user numbers.
- **Built by:** a small team; do not invent team size, funding or founding story.
- **Tech (for technical audiences):** web app with a Python/FastAPI backend, Next.js frontend, PostgreSQL with vector search, a Node + Playwright meeting bot, and a speech-to-text service; AI calls go through one gateway that records cost.
- **Deployment options:** containers on AWS, Render, or a single server.
- **Roadmap items not yet built:** Teams bot, Zoom bot, data-retention and export tools, billing, webhooks/API access, ATS integrations.

---

## 13. Instructions for an AI agent using this brief

1. Treat sections 4–6 and 9 as ground truth. If a request needs a fact not here, ask or leave it out; never invent customers, metrics, funding, certifications or dates.
2. When drafting public content, run each claim against section 9.
3. Match tone: clear, specific, a little contrarian about black-box AI, never hype-y. No buzzword stacking.
4. Always include a concrete example (a quote, a number from section 4, a screenshot description) rather than abstract statements.
5. For LinkedIn: short lines, one idea per post, a hook in the first two lines, one question or call-to-action at the end, no more than 3 hashtags (suggested: #recruiting #hiring #HRtech).
6. Offer 2–3 variants for any headline or hook so the owner can test.
7. Flag anything that needs the owner's input (real numbers, screenshots, quotes from real users, launch dates).
