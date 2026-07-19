# E2B template image for Codepet cloud builds (demo + real-repo). Built + pushed once with
# the E2B CLL as the `codepet-build` template; `lib/build/cloudSandbox.ts` boots it by name.
FROM node:20-slim

# git is needed for the real-repo build path (clone / branch / commit / push); ca-certificates
# for HTTPS to github.com and the Codepet API.
RUN apt-get update \
  && apt-get install -y --no-install-recommends git ca-certificates \
  && rm -rf /var/lib/apt/lists/*

# The Claude Code CLI must be on PATH so the runner can spawn `claude`.
RUN npm i -g @anthropic-ai/claude-code

# The runner is the only project code baked into the image.
COPY cloud-run.mjs /home/user/cloud-run.mjs

WORKDIR /home/user
