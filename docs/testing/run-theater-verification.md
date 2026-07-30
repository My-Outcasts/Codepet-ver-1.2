# Run theater — what to verify, and how to tell what's deployed

The run theater changed `/api/run-task` from a single JSON response to a streamed
NDJSON body. That makes two things worth checking deliberately.

## 1. Every caller must read the framing

There is exactly **one** place in the client that fetches `/api/run-task`
(`runByteTask` delegates to `runByteTaskStreaming` in `lib/ai/runTask.ts`). Keep it that
way. A second fetch site that calls `res.json()` on the streamed body throws:

```
SyntaxError: Unexpected non-whitespace character after JSON at position 162
```

This shipped once (PR #165) and broke the chat run path and the department run modal
while the run theater kept working — the theater was the only caller reading the stream.
Fixed in PR #166, guarded by `lib/ai/runTask.test.ts`.

**Bundle check — tells you which build is live without signing in:**

```sh
# 1 occurrence = fixed (single fetch site). 2 = the pre-fix build.
curl -s https://<host> \
  | grep -o '/_next/static/chunks/[A-Za-z0-9._-]*\.js' | sort -u \
  | while read -r c; do curl -s "https://<host>$c"; done \
  | grep -o '/api/run-task' | wc -l
```

## 2. Whether the stream is actually streaming

The rail's value is that phases land one at a time. If a CDN buffers the body, every
phase appears at once when the run finishes — the trace is still truthful, but the
liveness is gone. The route already sets `cache-control: no-transform` and
`x-accel-buffering: no`.

This needs an authenticated run, so it cannot be checked by fetching the page:

1. Sign in, go to **Tasks**, click **Run it here** on any card in Up next.
2. Watch the rail. Phases should tick over separately, before the deliverable appears.
3. If they all appear together at the end, switch the transport to SSE
   (`text/event-stream`), which proxies are far less likely to buffer.

## 3. Evidence must be the founder's own content

Expand a completed step. The quotes are read from the signed-in account's brief and
library, so they should be recognisably _theirs_. Anything generic means the trace has
drifted back toward `lib/helpers.ts:buildLog`, which fabricates its lines
(`"218 tests passed"`, diff counts from `t.t.length % 9`) and must never be the source
for the theater.

## Which branch is production

Both Vercel projects build this repo, from **different** branches:

| Project                   | Production branch | Host                         |
| ------------------------- | ----------------- | ---------------------------- |
| `codepet-ver-1-2` (giang) | `develop`         | `codepet-ver-1-2.vercel.app` |
| `codepet-v1-2` (mona)     | `main`            | `codepet-v1-2.vercel.app`    |

So **merging to `develop` publishes to a production site.** Treat `develop` as
production, not as a staging branch.
