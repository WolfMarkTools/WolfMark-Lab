---
name: evidence-before-completion
description: Use when finishing, summarising, or handing off software work, before claiming tests pass, an issue is fixed, an implementation is complete, a build succeeds, or anything is ready to merge or ship.
---

# Evidence Before Completion

No claim without a receipt. A receipt is an observation from this session:
command output you saw, a test result you watched, a file state you read
after your last edit. Memory of an earlier green run, a plan that should
work, and a statement you were about to verify are not receipts.

## Map each claim to its receipt

Every completion claim in your final message must trace to a receipt named
beside it. The usual claims and what each one demands:

| Claim | Minimum receipt |
| --- | --- |
| "all tests pass" | The relevant suite ran in this session, after the last material edit, with exit 0 and no skips or deselections covering your change. Name the suite and scope. |
| "the issue is fixed" | The failure was reproduced before the fix and the same reproduction passes after it. If it was never reproduced, say so. |
| "the implementation is complete" | Every requirement in the request was checked against the real code, including error, edge, and negative cases, not just the happy path. |
| "the build succeeds" | A successful build ran after the last material edit. An earlier build, or a build of different code, proves nothing. |
| "this is ready to merge" | Tests, build, and the repo's own checks for the touched area all passed whole in this session, without narrowing, deselecting, or skipping, and the diff was re-read. |

A receipt expires on your next material edit: anything that could affect the
verified behaviour. A green run before such a change is history, not
evidence: re-run after the last edit or drop the claim. A trivially
non-behavioural edit (comment, formatting, docs) keeps the receipt only if
you name the edit and state why it cannot affect the evidence. When in
doubt, re-run.

## Report in two columns

End the work with what is verified apart from what is not:

- **Verified:** each claim followed by its receipt (command, result, scope).
- **Not verified:** everything you did not check, could not run, or only
  reasoned about. Give the command or steps that would close each gap.

Keep assumed and observed facts in separate sentences. "Should", "probably",
"appears to", and "no reason to believe otherwise" belong under Not verified.

## When full verification is not possible

No runner, no tests, blocked environment, or a check you are not permitted
to run: say that plainly instead of upgrading partial evidence. Report what
you did check, name what you could not, and give the user the command that
would close the gap. A deliverable that presents a failure as healthy output
(zeros, empty lists, silent success) is a defect in the deliverable: surface
the degraded state in the output itself, not just in chat.

The work is done when every claim you make carries a receipt, and everything
without one is labelled as unverified.
