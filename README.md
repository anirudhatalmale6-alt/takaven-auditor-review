# Review — takaven-project-auditor v0.1

Reviewer: Anirudha Talmale
Date: 2026-10-11

Method: extracted, read every file, ran `npm test`, verified the fixtures actually behave as
documented, and probed five specific suspicions with executable tests rather than reasoning.
Everything below was reproduced; nothing is inferred from reading alone.

---

## Verdict

**This is good work, and it is close.** You took the discipline seriously rather than
cosmetically — the operating contract, the fixtures, the OBSERVED/INFERRED/UNKNOWN split and
the honesty about Codex never having run are all real.

There is one defect that matters more than the rest, and it is almost poetic: **the auditor
built to catch unearned success claims will itself print an unearned PASS.** Fix that and
confirm the Codex invocation works, and v0.1 is usable.

---

## What is genuinely good

I checked these rather than taking them on trust.

**The test suite passes — 10/10** on Node 22, and it is testing real behaviour, not
tautologies.

**The fixtures do what the README claims.** I ran both. `hostile-repo` really does crash:
`TypeError: Cannot read properties of undefined (reading 'regular')`, exit 1, behind a README
that says "COMPLETE… runtime verified". `clean-repo` really does print `PASS: app starts`,
exit 0. A fixture whose premise was never checked would be worthless as a control, and yours
holds. Using the actual Playkin bug as the hostile fixture is a nice touch.

**`AGENTS.md` is the strongest file in the package.** "Check the checks", "compare identities,
not totals", "unreferenced code is not a live feature… including barrel imports", and
`NOT RUN` being preferable to an unsafe execution. That is the method, written down and
operationalised.

**Prompt-injection defence is handled explicitly and in the right place** — README, AGENTS.md
and `prompts/audit.md` all state that repository contents, including its own `AGENTS.md`, are
untrusted evidence. Most people building an auditor miss this entirely, and the first hostile
repo they point it at rewrites their task.

**`normalizeGithub` is properly strict.** I tested it: embedded credentials, other hosts,
`http://`, query strings and `/tree/main` paths are all rejected.

**The "don't write into the audited project" guard works.** Verified — it refuses and exits
non-zero.

**The JSON schema is strict** where it counts: `additionalProperties: false` and `required` on
the nested evidence and finding objects.

**The README is honest about its own status** — "an authenticated Codex execution has not been
performed here… Do not call the agent production-verified yet." That sentence is the single
best indicator in the whole package that the method landed.

---

## Finding 1 — The auditor will print an unearned PASS — CRITICAL

`validateReport()` checks that fields exist and that six of them are arrays. It never checks
that the arrays contain anything, or that the contents have the right shape. So this passes
validation:

```js
{
  verdict: 'CONTINUE',
  runtime_status: 'PASS',
  runtime_evidence: [],        // nothing was ever run
  findings: [], unverified: [], ...
}
```

and renders this report:

```
**Verdict:** CONTINUE | **Runtime:** PASS | **Commit:** `abc123`

## Actual verification

| Check | Result | Command | Evidence | Negative control |
|---|---|---|---|---|

## Not verified
- None recorded; check that this is justified.
```

A section titled **"Actual verification"** that is empty, under a **PASS**, with "Not verified:
none recorded". That is precisely the Playkin pathology — a document asserting success with
nothing behind it — reproduced inside the tool built to detect it.

Two related holes in the same function:

- **`inspect` mode can return `PASS`.** The prompt tells the model "INSPECT ONLY… Mark runtime
  verification NOT RUN", but nothing enforces it. A model that ignores the instruction is not
  caught.
- **Malformed array items render as `undefined`.** I passed `runtime_evidence: ['the app
  booted fine']` (strings instead of objects) and `findings: [{title:'Something'}]`. Both were
  accepted, and the markdown came out containing five `undefined`s and an empty table row:
  `|  | undefined |  |  |  |`.

The JSON schema would have caught the shape problems — but only if Codex honours
`--output-schema`. `validateReport` is your local backstop, and it is far weaker than the
schema it is backing up. It should be *stricter*, not looser, because it is the last thing
between a bad model response and a report someone acts on.

### Fix

The invariants that matter are the ones a JSON schema cannot express — relationships between
fields. Add to `validateReport`, and pass `mode` in:

```js
export function validateReport(value, mode) {
  // ... existing checks ...

  // Evidence items must be complete, or the report renders "undefined" at people.
  const EV = ['check','status','command','observation','negative_control'];
  value.runtime_evidence.forEach((e, i) => {
    if (!e || typeof e !== 'object') throw new Error(`runtime_evidence[${i}] must be an object`);
    for (const k of EV) {
      if (typeof e[k] !== 'string' || !e[k].trim()) throw new Error(`runtime_evidence[${i}].${k} missing`);
    }
    if (!['PASS','FAIL','PARTIAL','NOT RUN'].includes(e.status)) throw new Error(`runtime_evidence[${i}].status invalid`);
  });

  const F = ['title','severity','evidence_type','evidence','location','recommended_fix'];
  value.findings.forEach((f, i) => {
    if (!f || typeof f !== 'object') throw new Error(`findings[${i}] must be an object`);
    for (const k of F) {
      if (typeof f[k] !== 'string' || !f[k].trim()) throw new Error(`findings[${i}].${k} missing`);
    }
    if (!['CRITICAL','HIGH','MEDIUM','LOW','INFO'].includes(f.severity)) throw new Error(`findings[${i}].severity invalid`);
    if (!['OBSERVED','INFERRED','UNKNOWN'].includes(f.evidence_type)) throw new Error(`findings[${i}].evidence_type invalid`);
  });

  // THE one that matters: a runtime claim requires runtime evidence.
  if (value.runtime_status !== 'NOT RUN' && value.runtime_evidence.length === 0) {
    throw new Error(`runtime_status "${value.runtime_status}" with zero runtime_evidence — refusing to emit an unearned result`);
  }

  // An OBSERVED finding cannot exist if nothing was observed.
  if (value.runtime_evidence.length === 0 && value.findings.some(f => f.evidence_type === 'OBSERVED')) {
    throw new Error('OBSERVED findings present but no runtime evidence recorded');
  }

  // inspect mode never runs anything, so it can never produce a runtime result.
  if (mode === 'inspect' && value.runtime_status !== 'NOT RUN') {
    throw new Error(`inspect mode must return runtime_status NOT RUN, got "${value.runtime_status}"`);
  }

  return value;
}
```

Then in `audit.mjs`: `validateReport(JSON.parse(...), args.mode)`.

Add the schema-level guard too — `"minItems": 1` cannot express the conditional, but you can
set `"minLength": 1` on every string in the schema so the model cannot emit empty strings.

**And add these as tests.** Each of the three probes above should be a failing-input test, so
the guard is itself guarded.

---

## Finding 2 — Local audits silently review the wrong code — HIGH

`--path` audits are done via `git clone --no-hardlinks <path>`, which copies **committed
history only**. Uncommitted edits and untracked files are invisible to the audit, and nothing
says so.

Reproduced: I committed the clean fixture, then broke `app.mjs` in the working tree so it
crashed on startup, then ran the auditor.

- On disk: `TypeError: Cannot read properties of undefined` — the app is broken.
- Auditor: cloned commit `f8b3162` (the clean one), audited that, and wrote
  `"originalUntouched": true` with **no warning anywhere** in `report.md` or
  `audit-metadata.json` that the working tree differs.

So the normal developer workflow — "I just fixed it, let me audit" — audits the code from
*before* the fix. Or worse, you break something, the auditor reports clean, and you trust it.
Given this tool's entire purpose is to stop people believing things that aren't true about
their code, this one is squarely on-theme.

### Fix

Before cloning a local path, check and surface it:

```js
if (args.path) {
  const dirty = spawnSync('git', ['-C', args.path, 'status', '--porcelain'], {encoding:'utf8'}).stdout.trim();
  if (dirty) {
    const files = dirty.split('\n').length;
    console.warn(`WARNING: ${files} uncommitted change(s) in the source. The audit covers committed state only.`);
    metadata.working_tree_dirty = true;
    metadata.uncommitted_files = files;
    // and surface it in report.md, not just the console
  }
}
```

Put it in the rendered report too, near the commit line — a console warning scrolls away, and
the report is what gets forwarded. Optionally offer `--include-working-tree` that copies the
tree instead of cloning, for the "I just fixed it" case.

---

## Finding 3 — The Codex invocation itself is unverified, and your tests cannot catch it — HIGH (unknown)

This is the highest-risk item in the package, and it is structural rather than a bug.

`audit.mjs` spawns:

```js
['exec', '--sandbox', 'read-only'|'workspace-write',
 '--output-schema', schema, '-o', responsePath, '-']
```

That is four assumptions about the CLI's interface — that `exec` takes a prompt on stdin via
`-`, that `--output-schema` exists and is honoured, that `-o` writes the structured response
to a file rather than a transcript, and that the sandbox values are spelled that way. **If any
one is wrong, every real run fails**, and the README already notes Codex was never run here.

The problem is that `tests/fake-codex.mjs` cannot surface it. The stub reads `-o`, checks the
prompt contains one string, and writes a report. It **ignores `--output-schema` entirely**, so
the test suite proves your wrapper's plumbing works while saying nothing about whether the
real binary accepts these flags. That is the classic trap: the stub removes the exact category
being tested, and the green suite reads as broader assurance than it is.

I could not resolve this — Codex CLI is not available to me, and I am not going to guess at
another tool's flags and present it as fact.

### Fix — 2 minutes, and do it before anything else

```bash
codex exec --help
```

Confirm `--output-schema`, `-o` and stdin `-` all exist and mean what you think. Then run one
real audit against `fixtures/hostile-repo` and confirm it reports FAIL rather than believing
the README.

Then harden the stub so the suite can catch drift: have `fake-codex.mjs` **assert** that
`--output-schema` points at a readable file and that `--sandbox` is `read-only` in inspect
mode, and exit non-zero otherwise. That converts it from a plumbing stub into a contract test.

---

## Finding 4 — A hung agent hangs forever — MEDIUM

`command()` has a 60s timeout, but the `spawn()` for Codex has none.

Reproduced with a stub that reads stdin then sleeps: the auditor was still running when I
killed it externally after 90 seconds. A model stall, a network wedge or a sandbox permission
prompt leaves the process hanging indefinitely, holding the temp directory.

### Fix

```js
const TIMEOUT_MS = Number(process.env.TAKAVEN_AUDIT_TIMEOUT_MS || 900000); // 15 min
const timer = setTimeout(() => { agent.kill('SIGKILL');
  fail(new Error(`Codex exceeded ${TIMEOUT_MS}ms — killed. Report NOT RUN.`)); }, TIMEOUT_MS);
agent.on('close', () => clearTimeout(timer));
```

The `finally` already removes the scratch directory, so cleanup is fine once it fails.

---

## Finding 5 — Git ref is passed without a `--` separator — LOW (hardening)

Line 37 runs `git fetch --quiet --depth 1 origin <ref>` with no `--` before the ref, so a ref
beginning with a dash is interpreted as a git option.

I tested how far that goes, and want to be accurate rather than dramatic: **the dangerous
cases are already blocked**, not by the ref validator but by the argument parser — line 12
rejects any value starting with `--`, so `--upload-pack=...` never reaches git. What does get
through is single-dash values: `--ref -o` is accepted and forwarded.

So this is hardening, not a vulnerability. Worth two lines because you clearly knew the
pattern — you used `--` correctly in both `git clone` calls and just missed it here.

### Fix

```js
if (result.ref && (result.ref.startsWith('-') || !/^[A-Za-z0-9._\/-]+$/.test(result.ref)))
  throw new Error('Invalid git ref');
```

and `['fetch','--quiet','--depth','1','origin','--',args.ref]`.

---

## Smaller notes

- **`--depth 1` + `--ref` may not fetch what you expect** for refs not on the default branch.
  Since you record the resolved commit, that is survivable, but worth a test.
- **Codex stdout is `'ignore'`**, so a long audit shows no progress. Consider streaming to a
  log file in the scratch dir — not into the report, which is the right instinct you already had.
- **Report files are `0o600`, but the output directory is default perms.** Minor.
- **`escapeMd` protects table cells**, but `f.evidence` and `executive_summary` are
  interpolated raw. A hostile repo could inject markdown into your report. Low impact given a
  human reads it, but you are explicitly treating repo content as untrusted, so it belongs in
  the same threat model.
- **No `LICENSE`** in the package.

---

## What I would do, in order

1. **`codex exec --help`** — confirm the four flag assumptions. Everything else is moot until
   this holds. (2 minutes)
2. **Fix Finding 1** and add the three failing-input tests. (30 minutes)
3. **Run the two fixtures with real Codex.** The hostile one must report FAIL, not PASS, and
   not NOT-RUN-with-a-reassuring-summary. The clean one must not manufacture a failure. This
   is your first actual evidence the agent works. (1 hour)
4. **Fix Findings 2 and 4.** (30 minutes)
5. **Then** point it at `isudally/playkin` at the pre-fix commit — you have a known-answer
   case now, with a documented expected result: blank page, dead engines, no games, fake
   paywall, link to a domain you don't own. If it finds those, you have a working auditor. If
   it reports CONTINUE, you have a calibration problem worth more than any feature.

---

## One last thing

The most useful thing that happened in this review is Finding 1: a tool whose entire purpose
is to stop unearned success claims will, as written, emit a PASS with an empty evidence table.

That is not embarrassing — it is the strongest possible argument for the fixtures and the
negative controls you built. The discipline has to be enforced *mechanically*, on your own
output, or it decays into good intentions. The invariant in Finding 1 is where that enforcement
lives: a runtime claim must carry runtime evidence, checked in code, with a test that proves
the check can fail.

Build that, and this tool can honestly say the thing it was made to say.
