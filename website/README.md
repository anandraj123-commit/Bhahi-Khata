This is a [Next.js](https://nextjs.org) project bootstrapped with [`create-next-app`](https://nextjs.org/docs/app/api-reference/cli/create-next-app).

## Getting Started

First, run the development server:

```bash
npm run dev
# or
yarn dev
# or
pnpm dev
# or
bun dev
```

Open [http://localhost:3000](http://localhost:3000) with your browser to see the result.

You can start editing the page by modifying `app/page.tsx`. The page auto-updates as you edit the file.

This project uses [`next/font`](https://nextjs.org/docs/app/building-your-application/optimizing/fonts) to automatically optimize and load [Geist](https://vercel.com/font), a new font family for Vercel.

## Learn More

To learn more about Next.js, take a look at the following resources:

- [Next.js Documentation](https://nextjs.org/docs) - learn about Next.js features and API.
- [Learn Next.js](https://nextjs.org/learn) - an interactive Next.js tutorial.

You can check out [the Next.js GitHub repository](https://github.com/vercel/next.js) - your feedback and contributions are welcome!

## Deploy on Vercel

The easiest way to deploy your Next.js app is to use the [Vercel Platform](https://vercel.com/new?utm_medium=default-template&filter=next.js&utm_source=create-next-app&utm_campaign=create-next-app-readme) from the creators of Next.js.

Check out our [Next.js deployment documentation](https://nextjs.org/docs/app/building-your-application/deploying) for more details.

## Refreshing a locally running production Admin server

`npm start` runs `next start`: it serves a production build and does not hot-reload
source changes. Running a new build alone does not restart that process. Replacing
`.next` while the old process is running can leave cached route manifests pointing
to removed JavaScript chunks, causing missing UI or failed navigation.

For local production-mode development:

1. Stop the existing **website frontend** process in its terminal (leave the API
   and databases running).
2. Run `npm run typecheck` and `npm run build -- --webpack` from `website`.
3. Run `npm start` from the same directory, on the intended port.
4. Reload the browser on that same origin. Verify that the page's referenced
   `/_next/static/chunks/...` files return HTTP 200.

Use `npm run dev` when source hot reload is desired. Do not confuse a second
frontend on another port with the configured Admin origin. `.env.local` uses
`ADMIN_FRONTEND_ORIGIN` and `EXPRESS_ADMIN_API_URL`; keep secrets private and do
not change these values simply to bypass authentication.
