# bloub engine

Source: https://github.com/jeremy-prt/bloub
Revision: b4bb3c1b5f93c7b87a2e8d620f667c4093d97749
Retrieved: 2026-10-02
Copyright (c) 2026 Jérémy Perret. MIT; full license in LICENSE.

The framework-free `src/bot/*.ts` files are preserved from upstream (excluding tests).
AI Chat Hub adds the optional `lively` argument to `BotEngine.sample` to disable
automatic blinking, breathing and gaze drift while retaining smooth explicit morphs.
AI Chat Hub supplies its own DOM renderer, interaction lifecycle and settings UI.
Run `npm run build:floatball` to regenerate ../bloub.js from index.ts.
The upstream design is a recreation of the x.ai avatar. Neither project is affiliated with x.ai.
