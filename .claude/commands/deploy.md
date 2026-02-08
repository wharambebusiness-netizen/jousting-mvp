Build and deploy the jousting MVP to GitHub Pages.

Steps:
1. Run tests: `npx vitest run`
2. Check TypeScript: `npx tsc --noEmit`
3. If tests or TS fail, fix issues first
4. Build: `npm run build`
5. Deploy: `npm run deploy`
6. Verify vite.config.ts has base set to './' (required for gh-pages)
7. Report deployment status
